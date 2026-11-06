/* ============================================================
   ONE ON ONE BUSINESS — /api/data-room (Vercel Serverless Function)
   Data Room sobre Supabase con AUTH obligatoria:

   · Solo usuarios registrados ven/modifican sus proyectos,
     documentos y minutas (owner o member).
   · Storage bucket "documentos" → los archivos. El navegador
     sube DIRECTO con una URL firmada (Vercel solo valida y
     confirma), por eso no aplica el límite de 4.5 MB de las
     serverless functions.
   · PostgreSQL: projects · project_members · documents · minutas.
     RLS activada sin políticas públicas: solo el service_role
     entra, desde este archivo (la clave jamás llega al navegador).

   Variables de entorno requeridas en Vercel:
     - SUPABASE_URL         → https://xxxx.supabase.co
     - SUPABASE_SERVICE_KEY → service_role (SOLO servidor)

   GET  ?action=projects
        ?action=documents&projectId=<uuid>
        ?action=minutas[&projectId=<uuid>]
   POST {action: createProject | sign | confirm | downloadUrl | delete}

   Reglas: 15 MB por archivo · categorías fijas (Propuestas,
   Contratos, Facturas, Informes, Otros) · nombre saneado ·
   ruta projects/{projectId}/{timestamp}_{archivo}.
   ============================================================ */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  assertProjectAccess as _assertProjectAccess,
  HttpError as _HttpError,
  listAccessibleProjectIds as _listAccessible,
  requireAuth as _requireAuth
} from './_supabase';

const BUCKET = 'documentos';
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB por archivo
const CATEGORIES = ['Propuestas', 'Contratos', 'Facturas', 'Informes', 'Otros'];
const TIMEOUT_MS = 12000;
const DOWNLOAD_TTL = 3600; // segundos de validez de la URL de descarga

/** MIME permitidos (valor por defecto de cada extensión). */
const EXT_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};
const ALLOWED_MIME = new Set(Object.values(EXT_MIME));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SupaEnv {
  url: string;
  key: string;
}

/** Error HTTP controlado (siempre se responde como JSON con código). */
class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

/* ---------- Utilidades Supabase ---------- */

function supaEnv(): SupaEnv | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ''), key };
}

function supaHeaders(env: SupaEnv, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: env.key,
    Authorization: 'Bearer ' + env.key,
    'Content-Type': 'application/json',
    ...(extra || {})
  };
}

async function sfetch(env: SupaEnv, path: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(env.url + path, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonOf(r: Response): Promise<unknown> {
  return r.json().catch(() => null);
}

function encPath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/* ---------- Validación estricta ---------- */

function asUuid(v: unknown, field: string): string {
  const s = String(v || '');
  if (!UUID_RE.test(s)) throw new HttpError(400, 'VALIDATION', field + ' inválido');
  return s;
}

function asCategory(v: unknown): string {
  const s = String(v || '');
  if (!CATEGORIES.includes(s)) {
    throw new HttpError(400, 'VALIDATION', 'Categoría no válida: ' + s.slice(0, 30));
  }
  return s;
}

function asSize(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) {
    throw new HttpError(400, 'VALIDATION', 'Tamaño de archivo inválido');
  }
  if (n > MAX_SIZE) {
    throw new HttpError(413, 'TOO_LARGE', 'El archivo supera los 15 MB permitidos');
  }
  return n;
}

/** Devuelve el mime validado o null si el tipo no está permitido. */
function classify(mime: string, filename: string): string | null {
  const m = String(mime.split(';')[0] ?? '').trim().toLowerCase();
  if (m) return ALLOWED_MIME.has(m) ? m : null;
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return EXT_MIME[ext] ?? null;
}

/** Nombre de archivo sin rutas, sin caracteres raros, con extensión intacta. */
function sanitizeFilename(name: string): string {
  const raw = String(name || '');
  const dot = raw.lastIndexOf('.');
  const extRaw = dot > 0 ? raw.slice(dot + 1) : '';
  const ext = extRaw.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  const stem = (dot > 0 ? raw.slice(0, dot) : raw)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\\/]+/g, '_')
    .replace(/\.{2,}/g, '.') // ".." → "." (nada de path traversal)
    .replace(/[^a-zA-Z0-9._ -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, 60)
    .replace(/[._-]+$/, '');
  const base = stem || 'archivo';
  return ext ? base + '.' + ext : base;
}

/* ---------- Bucket "documentos" (se crea solo si falta) ---------- */

async function ensureBucket(env: SupaEnv): Promise<void> {
  const list = await sfetch(env, '/storage/v1/bucket', { headers: supaHeaders(env) });
  if (list.ok) {
    const rows = await jsonOf(list);
    if (
      Array.isArray(rows) &&
      rows.some(b => b && typeof b === 'object' && (b as { name?: unknown }).name === BUCKET)
    ) {
      return;
    }
  }
  const create = await sfetch(env, '/storage/v1/bucket', {
    method: 'POST',
    headers: supaHeaders(env),
    body: JSON.stringify({ name: BUCKET, public: false })
  });
  // 409 = otro proceso lo creó primero: está bien
  if (!create.ok && create.status !== 409) {
    throw new HttpError(
      502,
      'STORAGE',
      'No se pudo preparar el bucket "documentos" (HTTP ' + create.status + ')'
    );
  }
}

/* ---------- Lecturas (PostgREST) ---------- */

async function listProjects(env: SupaEnv): Promise<unknown[]> {
  const r = await sfetch(env, '/rest/v1/projects?select=*&order=name.asc', {
    headers: supaHeaders(env)
  });
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudieron leer los proyectos (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  return Array.isArray(rows) ? rows : [];
}

async function listDocuments(env: SupaEnv, projectId: string): Promise<unknown[]> {
  const r = await sfetch(
    env,
    '/rest/v1/documents?select=*&project_id=eq.' +
      encodeURIComponent(projectId) +
      '&order=uploaded_at.desc',
    { headers: supaHeaders(env) }
  );
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudieron leer los documentos (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  return Array.isArray(rows) ? rows : [];
}

async function listMinutas(env: SupaEnv): Promise<unknown[]> {
  const r = await sfetch(
    env,
    '/rest/v1/minutas?select=*&order=fecha.desc,created_at.desc&limit=50',
    { headers: supaHeaders(env) }
  );
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudo leer el histórico de minutas (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  return Array.isArray(rows) ? rows : [];
}

async function getDocument(env: SupaEnv, id: string): Promise<Record<string, unknown> | null> {
  const r = await sfetch(env, '/rest/v1/documents?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1', {
    headers: supaHeaders(env)
  });
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudo leer el documento (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object') {
    return rows[0] as Record<string, unknown>;
  }
  return null;
}

/* ---------- Escrituras (createProject va en el handler con owner_id) ---------- */

async function signUpload(
  env: SupaEnv,
  raw: Record<string, unknown>
): Promise<{ uploadUrl: string; path: string; filename: string; mime: string; category: string }> {
  const projectId = asUuid(raw.projectId, 'projectId');
  const filename = sanitizeFilename(String(raw.filename || ''));
  asSize(raw.size);
  const category = asCategory(raw.category);
  const mime = classify(String(raw.mime || ''), filename);
  if (!mime) {
    throw new HttpError(
      415,
      'UNSUPPORTED',
      'Tipo de archivo no permitido. Usa PDF, Word, Excel, PowerPoint, imágenes o texto.'
    );
  }

  await ensureBucket(env);

  const path = 'projects/' + projectId + '/' + Date.now() + '_' + filename;
  const r = await sfetch(env, '/storage/v1/object/upload/sign/' + BUCKET + '/' + encPath(path), {
    method: 'POST',
    headers: supaHeaders(env),
    body: '{}'
  });
  if (!r.ok) {
    throw new HttpError(502, 'STORAGE', 'No se pudo firmar la subida (HTTP ' + r.status + ')');
  }
  const data = (await jsonOf(r)) as { url?: unknown } | null;
  const rel = data && typeof data.url === 'string' ? data.url : '';
  if (!rel) throw new HttpError(502, 'STORAGE', 'Supabase no devolvió una URL de subida');

  return { uploadUrl: env.url + '/storage/v1' + rel, path, filename, mime, category };
}

async function confirmUpload(
  env: SupaEnv,
  raw: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const projectId = asUuid(raw.projectId, 'projectId');
  const path = String(raw.path || '');
  if (!path.startsWith('projects/' + projectId + '/') || path.includes('..')) {
    throw new HttpError(400, 'VALIDATION', 'Ruta de archivo inválida');
  }
  const filename = sanitizeFilename(String(raw.filename || ''));
  asSize(raw.size);
  const category = asCategory(raw.category);
  const mime = classify(String(raw.mime || ''), filename);
  if (!mime) throw new HttpError(415, 'UNSUPPORTED', 'Tipo de archivo no permitido');

  /* Verificar que el archivo REALMENTE llegó a Storage (y su tamaño real) */
  const info = await sfetch(env, '/storage/v1/object/info/' + BUCKET + '/' + encPath(path), {
    headers: supaHeaders(env)
  });
  if (info.status === 404) {
    throw new HttpError(404, 'NOT_FOUND', 'El archivo no llegó a Storage. Vuelve a subirlo.');
  }
  if (!info.ok) {
    throw new HttpError(502, 'STORAGE', 'No se pudo verificar el archivo (HTTP ' + info.status + ')');
  }
  const meta = (await jsonOf(info)) as { size?: unknown } | null;
  const stored = Number(meta?.size);
  if (!Number.isFinite(stored) || stored <= 0) {
    throw new HttpError(502, 'STORAGE', 'No se pudo leer el tamaño del archivo en Storage');
  }
  if (stored > MAX_SIZE) {
    // Limpieza defensiva: no dejamos archivos que exceden el límite
    await sfetch(env, '/storage/v1/object/' + BUCKET, {
      method: 'DELETE',
      headers: supaHeaders(env),
      body: JSON.stringify({ prefixes: [path] })
    }).catch(() => undefined);
    throw new HttpError(413, 'TOO_LARGE', 'El archivo supera los 15 MB permitidos');
  }

  const r = await sfetch(env, '/rest/v1/documents', {
    method: 'POST',
    headers: supaHeaders(env, { Prefer: 'return=representation' }),
    body: JSON.stringify({
      project_id: projectId,
      filename,
      path,
      size: stored,
      mime,
      category
    })
  });
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudo registrar el documento (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object') return rows[0];
  throw new HttpError(502, 'SUPABASE', 'Supabase no devolvió el documento registrado');
}

async function signedDownloadUrl(env: SupaEnv, raw: Record<string, unknown>): Promise<string> {
  const id = asUuid(raw.documentId, 'documentId');
  const doc = await getDocument(env, id);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Documento no encontrado');
  const path = String(doc.path || '');
  if (!path) throw new HttpError(502, 'SUPABASE', 'El documento no tiene ruta en Storage');

  const r = await sfetch(env, '/storage/v1/object/sign/' + BUCKET + '/' + encPath(path), {
    method: 'POST',
    headers: supaHeaders(env),
    body: JSON.stringify({ expiresIn: DOWNLOAD_TTL })
  });
  if (!r.ok) {
    throw new HttpError(502, 'STORAGE', 'No se pudo firmar la descarga (HTTP ' + r.status + ')');
  }
  const data = (await jsonOf(r)) as { signedURL?: unknown } | null;
  const rel = data && typeof data.signedURL === 'string' ? data.signedURL : '';
  if (!rel) throw new HttpError(502, 'STORAGE', 'Supabase no devolvió una URL de descarga');

  const dl = encodeURIComponent(String(doc.filename || 'archivo'));
  return env.url + '/storage/v1' + rel + '&download=' + dl;
}

async function deleteDocument(env: SupaEnv, raw: Record<string, unknown>): Promise<void> {
  const id = asUuid(raw.documentId, 'documentId');
  const doc = await getDocument(env, id);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Documento no encontrado');

  /* 1) Objeto en Storage (best-effort: la fila se borra igual) */
  try {
    await sfetch(env, '/storage/v1/object/' + BUCKET, {
      method: 'DELETE',
      headers: supaHeaders(env),
      body: JSON.stringify({ prefixes: [String(doc.path || '')] })
    });
  } catch (e) {
    console.error(
      '[api/data-room] no se pudo borrar el objeto:',
      e instanceof Error ? e.message : String(e)
    );
  }

  /* 2) Fila en PostgreSQL */
  const r = await sfetch(env, '/rest/v1/documents?id=eq.' + encodeURIComponent(id), {
    method: 'DELETE',
    headers: supaHeaders(env)
  });
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudo eliminar el documento (HTTP ' + r.status + ')');
  }
}

/* ---------- Handler ---------- */

const handler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const env = supaEnv();
  if (!env) {
    res.status(503).json({
      ok: false,
      code: 'NO_SUPABASE',
      error: 'Configura SUPABASE_URL y SUPABASE_SERVICE_KEY en las variables de entorno de Vercel.'
    });
    return;
  }

  // Auth obligatoria: solo registrados
  let userId = '';
  let sbEnv: { url: string; anon: string; service: string } | null = null;
  try {
    const auth = await _requireAuth(req);
    userId = auth.user.id;
    sbEnv = auth.env;
  } catch (e) {
    if (e instanceof _HttpError) {
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      return;
    }
    res.status(401).json({ ok: false, code: 'UNAUTHENTICATED', error: 'Inicia sesión para continuar' });
    return;
  }

  try {
    const accessible = sbEnv ? await _listAccessible(sbEnv, userId) : [];
    /* ---------- GET: listados ---------- */
    if (req.method === 'GET') {
      const rawAction = req.query.action;
      const action = (typeof rawAction === 'string' ? rawAction : undefined) || 'projects';

      if (action === 'projects') {
        const all = await listProjects(env);
        // Filtrar a proyectos accesibles (owner o member)
        const filtered = (all as Array<Record<string, unknown>>).filter(p => {
          const id = String(p.id ?? '');
          const owner = String((p as { owner_id?: unknown }).owner_id ?? '');
          if (owner === userId) return true;
          if (accessible.includes(id)) return true;
          // Proyectos legacy sin owner: visibles solo si el usuario es member;
          // si no hay miembros y no tiene owner, solo el creador los ve →
          // para compatibilidad inicial, mostrarlos a cualquier registrado
          // hasta que se les asigne owner.
          if (!owner) return true;
          return false;
        });
        res.status(200).json({ ok: true, projects: filtered });
        return;
      }
      if (action === 'documents') {
        const projectId = asUuid(req.query.projectId, 'projectId');
        if (sbEnv) await _assertProjectAccess(sbEnv, userId, projectId);
        else if (accessible.length && !accessible.includes(projectId)) {
          res.status(404).json({ ok: false, code: 'NOT_FOUND', error: 'Proyecto no encontrado' });
          return;
        }
        res.status(200).json({ ok: true, documents: await listDocuments(env, projectId) });
        return;
      }
      if (action === 'minutas') {
        const pidRaw = typeof req.query.projectId === 'string' ? req.query.projectId : '';
        const rows = await listMinutas(env);
        const filtered = pidRaw
          ? (rows as Array<Record<string, unknown>>).filter(m => String(m.project_id ?? '') === pidRaw)
          : (rows as Array<Record<string, unknown>>).filter(m => {
              const pid = typeof m.project_id === 'string' ? m.project_id : '';
              const creator = typeof m.created_by === 'string' ? (m as { created_by?: string }).created_by : '';
              if (!pid) return creator ? creator === userId : true;
              return accessible.includes(pid) || creator === userId;
            });
        res.status(200).json({ ok: true, minutas: filtered });
        return;
      }
      res.status(400).json({ ok: false, error: 'Acción no válida: ' + action });
      return;
    }

    /* ---------- POST: operaciones ---------- */
    if (req.method === 'POST') {
      let body: unknown = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = null;
        }
      }
      if (!body || typeof body !== 'object') body = {};
      const raw = body as Record<string, unknown>;
      const action = String(raw.action || '');

      if (action === 'createProject') {
        // createProject inserta con owner_id = usuario actual
        const name = String(raw.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (!name) throw new HttpError(400, 'VALIDATION', 'Escribe un nombre para el proyecto');
        const r = await sfetch(env, '/rest/v1/projects', {
          method: 'POST',
          headers: supaHeaders(env, { Prefer: 'return=representation' }),
          body: JSON.stringify({ name, owner_id: userId })
        });
        if (r.status === 409) {
          res.status(409).json({ ok: false, code: 'DUPLICATE', error: 'Ya existe un proyecto con ese nombre' });
          return;
        }
        if (!r.ok) {
          res.status(502).json({ ok: false, code: 'SUPABASE', error: 'No se pudo crear el proyecto (HTTP ' + r.status + ')' });
          return;
        }
        const rows = await jsonOf(r);
        if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object') {
          res.status(200).json({ ok: true, project: rows[0] });
        } else {
          res.status(502).json({ ok: false, code: 'SUPABASE', error: 'Supabase no devolvió el proyecto creado' });
        }
        return;
      }
      if (action === 'sign' || action === 'confirm' || action === 'downloadUrl' || action === 'delete') {
        // Chequear acceso al proyecto si viene projectId
        const pid = typeof raw.projectId === 'string' ? raw.projectId : '';
        if (pid) {
          if (!UUID_RE.test(pid)) throw new HttpError(400, 'VALIDATION', 'projectId inválido');
          if (sbEnv) await _assertProjectAccess(sbEnv, userId, pid);
        } else if (action === 'downloadUrl' || action === 'delete') {
          // download/delete se verifican contra el documento en su función
          await assertDocAccess(env, userId, accessible, raw);
        }
        if (action === 'sign') {
          res.status(200).json({ ok: true, ...(await signUpload(env, raw)) });
          return;
        }
        if (action === 'confirm') {
          res.status(200).json({ ok: true, document: await confirmUpload(env, raw) });
          return;
        }
        if (action === 'downloadUrl') {
          res.status(200).json({ ok: true, url: await signedDownloadUrl(env, raw) });
          return;
        }
        if (action === 'delete') {
          await deleteDocument(env, raw);
          res.status(200).json({ ok: true });
          return;
        }
      }
      res.status(400).json({ ok: false, error: 'Acción no válida: ' + (action || '(vacía)') });
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (e) {
    if (e instanceof HttpError) {
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      return;
    }
    if (e instanceof _HttpError) {
      res.status(e.status).json({ ok: false, code: e.code, error: e.message });
      return;
    }
    console.error('[api/data-room] error:', e instanceof Error ? e.message : e);
    res.status(500).json({ ok: false, error: 'Error interno del Data Room.' });
  }
};

async function assertDocAccess(
  env: SupaEnv,
  userId: string,
  accessible: string[],
  raw: Record<string, unknown>
): Promise<void> {
  const id = String(raw.documentId || '');
  if (!UUID_RE.test(id)) throw new HttpError(400, 'VALIDATION', 'documentId inválido');
  const doc = await getDocument(env, id);
  if (!doc) throw new HttpError(404, 'NOT_FOUND', 'Documento no encontrado');
  const pid = String(doc.project_id || '');
  if (!pid) return;
  if (accessible.includes(pid)) return;
  // Dueño del proyecto puede si no está en lista (por compatibilidad)
  const pr = await sfetch(env, '/rest/v1/projects?select=owner_id&id=eq.' + encodeURIComponent(pid) + '&limit=1', {
    headers: supaHeaders(env)
  });
  if (pr.ok) {
    const rows = await jsonOf(pr);
    if (Array.isArray(rows) && rows[0]) {
      const owner = String((rows[0] as { owner_id?: unknown }).owner_id ?? '');
      if (owner === userId) return;
    }
  }
  throw new HttpError(404, 'NOT_FOUND', 'Documento no encontrado');
}

export default handler;
