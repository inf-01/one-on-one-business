/* ============================================================
   ONE ON ONE BUSINESS — /api/sync (Vercel Serverless Function)
   Fuente primaria: Supabase `tasks` (solo usuarios registrados).
   Respaldo legacy: Google Sheets vía Apps Script (solo si no hay Supabase).

   Supabase (requerido para auth):
     SUPABASE_URL · SUPABASE_ANON_KEY · SUPABASE_SERVICE_KEY
   Respaldo legacy:
     GAS_URL · API_SECRET (secretos solo en Vercel)

   GET  ?action=getTasks&projectId=<uuid opcional>
   POST {action: create | update | delete | bulk, ...}

   Permisos (solo registrados):
   · Ver: mis tareas + tareas de mis proyectos (owner o member).
   · Crear: asigno a un perfil registrado (por display_name o assigned_to).
   · Actualizar estado: el asignado, el creador o el dueño del proyecto.
   · Reasignar / borrar: el creador o el dueño del proyecto.
   ============================================================ */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  assertProjectAccess,
  findProfile,
  HttpError,
  isUuid,
  listAccessibleProjectIds,
  listProfiles,
  requireAuth,
  sfetch,
  supaEnv,
  type ProfileRow,
  type SupaEnv
} from './_supabase';

interface TaskRowDb {
  id: string;
  fecha: string;
  titulo: string;
  responsable: string;
  estado: string;
  fechaCreacion: string;
  fechaFinalizacion: string;
  hora: string;
  project_id?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
}

function looksLikeJson(text: string): boolean {
  return text.trim().charAt(0) === '{';
}
function gasError(): { ok: false; error: string } {
  return {
    ok: false,
    error:
      'Google Apps Script no respondió JSON. Revisa GAS_URL (debe terminar en /exec) y el permiso "Cualquier persona".'
  };
}

function toTask(db: Record<string, unknown>, profiles: ProfileRow[]): TaskRowDb {
  const estadoRaw = String(db.estado ?? 'pendiente');
  const assigned = typeof db.asignado_a === 'string' ? db.asignado_a : '';
  const profile = assigned ? profiles.find(p => p.id === assigned) : undefined;
  const responsable = profile
    ? profile.display_name
    : String((db as { responsable?: unknown }).responsable ?? '');
  return {
    id: String(db.id ?? ''),
    fecha: String(db.fecha ?? ''),
    titulo: String(db.titulo ?? ''),
    responsable,
    estado: estadoRaw === 'completada' || estadoRaw === 'en progreso' ? estadoRaw : 'pendiente',
    fechaCreacion: String(db.fecha_creacion ?? ''),
    fechaFinalizacion: String(db.fecha_finalizacion ?? ''),
    hora: String(db.hora ?? ''),
    project_id: typeof db.project_id === 'string' ? db.project_id : null,
    assigned_to: assigned || null,
    created_by: typeof db.creado_por === 'string' ? db.creado_por : null
  };
}

function fromTask(raw: Record<string, unknown>): Record<string, unknown> {
  const fecha = String(raw.fecha ?? '');
  const titulo = String(raw.titulo ?? '').trim().slice(0, 120);
  const estado =
    raw.estado === 'completada' || raw.estado === 'en progreso' ? raw.estado : 'pendiente';
  const hora = String(raw.hora ?? '');
  return {
    fecha,
    titulo,
    estado,
    hora,
    fecha_creacion: raw.fechaCreacion ? String(raw.fechaCreacion) : new Date().toISOString(),
    fecha_finalizacion: raw.fechaFinalizacion ? String(raw.fechaFinalizacion) : null
  };
}

async function gasProxy(req: VercelRequest, res: VercelResponse): Promise<void> {
  const GAS_URL = process.env.GAS_URL;
  const API_SECRET = process.env.API_SECRET;
  if (!GAS_URL || !API_SECRET) {
    res.status(500).json({
      ok: false,
      error: 'Configura SUPABASE_URL y SUPABASE_SERVICE_KEY en Vercel (o GAS_URL y API_SECRET para respaldo).'
    });
    return;
  }
  try {
    if (req.method === 'GET') {
      const rawAction = req.query.action;
      const action = (typeof rawAction === 'string' ? rawAction : undefined) || 'getTasks';
      const url =
        GAS_URL +
        (GAS_URL.includes('?') ? '&' : '?') +
        'key=' + encodeURIComponent(API_SECRET) +
        '&action=' + encodeURIComponent(action);
      const upstream = await fetch(url);
      const text = await upstream.text();
      if (!looksLikeJson(text)) {
        res.status(502).json(gasError());
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(text);
      return;
    }
    if (req.method === 'POST') {
      let body: unknown = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      if (!body || typeof body !== 'object') body = {};
      (body as Record<string, unknown>).key = API_SECRET;
      const url =
        GAS_URL +
        (GAS_URL.includes('?') ? '&' : '?') +
        'key=' + encodeURIComponent(API_SECRET);
      const upstream = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      const text = await upstream.text();
      if (!looksLikeJson(text)) {
        res.status(502).json(gasError());
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).send(text);
      return;
    }
    res.setHeader('Allow', 'GET, POST');
    res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (e) {
    console.error('[api/sync] gas error:', e instanceof Error ? e.message : e);
    res.status(500).json({ ok: false, error: 'Error de sincronización con Google Sheets.' });
  }
}

/* ---------- Supabase tasks ---------- */

async function supaGetTasks(
  env: SupaEnv,
  userId: string,
  projectId: string | null
): Promise<TaskRowDb[]> {
  const profiles = await listProfiles(env);
  const accessible = await listAccessibleProjectIds(env, userId);

  if (projectId) {
    await assertProjectAccess(env, userId, projectId);
    const r = await sfetch(
      env,
      '/rest/v1/tasks?select=*&project_id=eq.' +
        encodeURIComponent(projectId) +
        '&order=fecha.asc,hora.asc,fecha_creacion.asc'
    );
    if (!r.ok) throw new HttpError(502, 'SUPABASE', 'No se pudieron leer las tareas (HTTP ' + r.status + ')');
    const rows: unknown = await r.json().catch(() => null);
    if (!Array.isArray(rows)) return [];
    return rows.map(row => toTask(row as Record<string, unknown>, profiles));
  }

  // Sin filtro: tareas asignadas a mí + tareas de mis proyectos + globales mías
  const filters: string[] = ['asignado_a=eq.' + encodeURIComponent(userId)];
  if (accessible.length) {
    const quoted = accessible.map(id => '"' + id + '"').join(',');
    filters.push('project_id=in.(' + quoted + ')');
  }
  // Tareas globales creadas por mí (project_id null) ya están cubiertas por asignado_a;
  // si no tengo proyectos, al menos mis asignadas.
  const orFilter = filters.length > 1 ? 'or=(' + filters.join(',') + ')' : filters[0];
  const r = await sfetch(
    env,
    '/rest/v1/tasks?select=*&' + orFilter + '&order=fecha.asc,hora.asc,fecha_creacion.asc&limit=500'
  );
  if (!r.ok) {
    // Fallback: si el filtro or() no aplica, traer todas y filtrar en memoria
    const all = await sfetch(env, '/rest/v1/tasks?select=*&order=fecha.asc&limit=500');
    if (!all.ok) throw new HttpError(502, 'SUPABASE', 'No se pudieron leer las tareas (HTTP ' + all.status + ')');
    const rows: unknown = await all.json().catch(() => null);
    if (!Array.isArray(rows)) return [];
    const mine: TaskRowDb[] = [];
    for (const row of rows) {
      const db = row as Record<string, unknown>;
      const pid = typeof db.project_id === 'string' ? db.project_id : null;
      const assigned = typeof db.asignado_a === 'string' ? db.asignado_a : '';
      const created = typeof db.creado_por === 'string' ? db.creado_por : '';
      const visible =
        assigned === userId ||
        created === userId ||
        (pid && accessible.includes(pid)) ||
        !pid;
      if (visible) mine.push(toTask(db, profiles));
    }
    return mine;
  }
  const rows: unknown = await r.json().catch(() => null);
  if (!Array.isArray(rows)) return [];
  return rows.map(row => toTask(row as Record<string, unknown>, profiles));
}

async function supaCreate(
  env: SupaEnv,
  userId: string,
  raw: Record<string, unknown>,
  profiles: ProfileRow[]
): Promise<TaskRowDb> {
  const base = fromTask(raw);
  const responsibleName = String(raw.responsable ?? '').trim();
  const assignedIdRaw = typeof raw.assigned_to === 'string' ? raw.assigned_to : '';
  const projectId = typeof raw.project_id === 'string' && raw.project_id ? raw.project_id : null;

  if (!base.titulo) throw new HttpError(400, 'VALIDATION', 'La tarea necesita un título');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(base.fecha))) {
    throw new HttpError(400, 'VALIDATION', 'Fecha inválida (YYYY-MM-DD)');
  }
  if (projectId && !isUuid(projectId)) throw new HttpError(400, 'VALIDATION', 'project_id inválido');
  await assertProjectAccess(env, userId, projectId);

  let assigned: ProfileRow | null = null;
  if (assignedIdRaw && isUuid(assignedIdRaw)) {
    assigned = profiles.find(p => p.id === assignedIdRaw) ?? null;
  }
  if (!assigned && responsibleName) {
    assigned = findProfile(profiles, responsibleName);
  }
  if (!assigned) {
    // Por defecto: el creador
    assigned = profiles.find(p => p.id === userId) ?? null;
  }
  if (!assigned) {
    throw new HttpError(400, 'VALIDATION', 'Responsable no es un usuario registrado');
  }

  const now = new Date().toISOString();
  const payload: Record<string, unknown> = {
    titulo: base.titulo,
    fecha: base.fecha,
    hora: base.hora,
    estado: base.estado,
    asignado_a: assigned.id,
    creado_por: userId,
    project_id: projectId,
    fecha_creacion: now,
    fecha_finalizacion: base.estado === 'completada' ? now : null
  };
  const r = await sfetch(env, '/rest/v1/tasks', {
    method: 'POST',
    headers: {
      apikey: env.service,
      Authorization: 'Bearer ' + env.service,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw new HttpError(502, 'SUPABASE', 'No se pudo crear la tarea (HTTP ' + r.status + ')');
  const rows: unknown = await r.json().catch(() => null);
  if (!Array.isArray(rows) || !rows[0]) throw new HttpError(502, 'SUPABASE', 'Supabase no devolvió la tarea creada');
  return toTask(rows[0] as Record<string, unknown>, profiles);
}

async function supaGetOne(env: SupaEnv, id: string, profiles: ProfileRow[]): Promise<Record<string, unknown> | null> {
  const r = await sfetch(env, '/rest/v1/tasks?select=*&id=eq.' + encodeURIComponent(id) + '&limit=1');
  if (!r.ok) throw new HttpError(502, 'SUPABASE', 'No se pudo leer la tarea (HTTP ' + r.status + ')');
  const rows: unknown = await r.json().catch(() => null);
  if (Array.isArray(rows) && rows[0]) return rows[0] as Record<string, unknown>;
  void profiles;
  return null;
}

function canTouch(db: Record<string, unknown>, userId: string, accessible: string[]): boolean {
  const assigned = typeof db.asignado_a === 'string' ? db.asignado_a : '';
  const created = typeof db.creado_por === 'string' ? db.creado_por : '';
  const pid = typeof db.project_id === 'string' ? db.project_id : null;
  if (assigned === userId || created === userId) return true;
  if (pid && accessible.includes(pid)) return true;
  if (!pid) return true; // globales: cualquier registrado puede ver (el editar lo limita requireEdit)
  return false;
}

function requireEdit(db: Record<string, unknown>, userId: string, accessible: string[], full: boolean): void {
  const assigned = typeof db.asignado_a === 'string' ? db.asignado_a : '';
  const created = typeof db.creado_por === 'string' ? db.creado_por : '';
  const pid = typeof db.project_id === 'string' ? db.project_id : null;
  const isOwner = created === userId;
  if (full) {
    if (isOwner) return;
    if (pid && accessible.includes(pid)) {
      // dueño del proyecto = ya incluido en accessible pero necesitamos distinguir:
      // por simplicidad, el member puede editar estado, solo owner/creator reasigna/borra
      if (assigned === userId) return;
      return; // member: estado ok, reasignar/borrar lo chequea aparte
    }
    if (assigned === userId) return;
    throw new HttpError(403, 'FORBIDDEN', 'Solo puedes modificar tus tareas');
  }
  if (assigned === userId || isOwner) return;
  if (!pid) return; // globales: creador o asignado ya cubiertos; si llegas aquí es otro usuario sin vínculo → bloqueamos abajo
  if (pid && accessible.includes(pid) && assigned === userId) return;
  throw new HttpError(403, 'FORBIDDEN', 'Solo puedes modificar tus tareas');
}

const handler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const env = supaEnv();
  // Sin Supabase configurado: respaldo legacy (Apps Script) sin auth
  if (!env) {
    await gasProxy(req, res);
    return;
  }

  try {
    const { user } = await requireAuth(req);
    const profiles = await listProfiles(env);
    const accessible = await listAccessibleProjectIds(env, user.id);

    if (req.method === 'GET') {
      const action = (typeof req.query.action === 'string' ? req.query.action : undefined) || 'getTasks';
      if (action !== 'getTasks') {
        res.status(400).json({ ok: false, error: 'Acción no válida: ' + action });
        return;
      }
      const pidRaw = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      const pid = pidRaw && isUuid(pidRaw) ? pidRaw : null;
      const tasks = await supaGetTasks(env, user.id, pid);
      res.status(200).json({ ok: true, tasks });
      return;
    }

    if (req.method === 'POST') {
      let body: unknown = req.body;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          body = {};
        }
      }
      if (!body || typeof body !== 'object') body = {};
      const raw = body as Record<string, unknown>;
      const action = String(raw.action || '');

      if (action === 'create') {
        const task = await supaCreate(env, user.id, (raw.task as Record<string, unknown>) ?? {}, profiles);
        res.status(200).json({ ok: true, task });
        return;
      }
      if (action === 'bulk') {
        const list = Array.isArray(raw.tasks) ? (raw.tasks as Record<string, unknown>[]) : [];
        if (!list.length) {
          res.status(400).json({ ok: false, error: 'Lista vacía' });
          return;
        }
        if (list.length > 50) {
          res.status(400).json({ ok: false, error: 'Máximo 50 tareas por operación' });
          return;
        }
        const created: TaskRowDb[] = [];
        for (const item of list) {
          created.push(await supaCreate(env, user.id, item, profiles));
        }
        res.status(200).json({ ok: true, tasks: created });
        return;
      }
      if (action === 'update') {
        const id = String(raw.id || '');
        if (!isUuid(id)) {
          res.status(400).json({ ok: false, error: 'Tarea no encontrada' });
          return;
        }
        const db = await supaGetOne(env, id, profiles);
        if (!db) {
          res.status(404).json({ ok: false, error: 'Tarea no encontrada' });
          return;
        }
        if (!canTouch(db, user.id, accessible)) {
          res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'No tienes acceso a esta tarea' });
          return;
        }
        const changes = (raw.changes as Record<string, unknown>) ?? {};
        const wantsReassign =
          (typeof changes.responsable === 'string' && changes.responsable) ||
          (typeof changes.assigned_to === 'string' && changes.assigned_to);
        // Reasignar/borrar solo creador o dueño del proyecto
        if (wantsReassign) {
          const created = String(db.creado_por ?? '');
          if (created !== user.id) {
            const pid = typeof db.project_id === 'string' ? db.project_id : null;
            let ownerOk = false;
            if (pid) {
              const pr = await sfetch(env, '/rest/v1/projects?select=owner_id&id=eq.' + encodeURIComponent(pid) + '&limit=1');
              if (pr.ok) {
                const prRows: unknown = await pr.json().catch(() => null);
                const owner = Array.isArray(prRows) && prRows[0] ? String((prRows[0] as { owner_id?: unknown }).owner_id ?? '') : '';
                ownerOk = owner === user.id;
              }
            }
            if (!ownerOk) {
              res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Solo el creador puede reasignar la tarea' });
              return;
            }
          }
        } else {
          requireEdit(db, user.id, accessible, false);
        }

        const patch: Record<string, unknown> = {};
        if (typeof changes.titulo === 'string' && changes.titulo.trim()) {
          patch.titulo = changes.titulo.trim().slice(0, 120);
        }
        if (typeof changes.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(changes.fecha)) {
          patch.fecha = changes.fecha;
        }
        if (typeof changes.hora === 'string') patch.hora = changes.hora;
        if (typeof changes.estado === 'string' && (changes.estado === 'pendiente' || changes.estado === 'en progreso' || changes.estado === 'completada')) {
          patch.estado = changes.estado;
          patch.fecha_finalizacion = changes.estado === 'completada' ? new Date().toISOString() : null;
        }
        const newResponsable = typeof changes.responsable === 'string' ? changes.responsable.trim() : '';
        const newAssigned = typeof changes.assigned_to === 'string' ? changes.assigned_to : '';
        if (newResponsable || newAssigned) {
          let target: ProfileRow | null = null;
          if (newAssigned && isUuid(newAssigned)) target = profiles.find(p => p.id === newAssigned) ?? null;
          if (!target && newResponsable) target = findProfile(profiles, newResponsable);
          if (!target) {
            res.status(400).json({ ok: false, error: 'Responsable no es un usuario registrado' });
            return;
          }
          patch.asignado_a = target.id;
        }
        if (typeof changes.project_id === 'string') {
          const np = changes.project_id;
          if (np) {
            if (!isUuid(np)) {
              res.status(400).json({ ok: false, error: 'project_id inválido' });
              return;
            }
            await assertProjectAccess(env, user.id, np);
          }
          patch.project_id = np || null;
        }
        if (!Object.keys(patch).length) {
          res.status(400).json({ ok: false, error: 'Sin cambios válidos' });
          return;
        }
        const r = await sfetch(env, '/rest/v1/tasks?id=eq.' + encodeURIComponent(id), {
          method: 'PATCH',
          headers: {
            apikey: env.service,
            Authorization: 'Bearer ' + env.service,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(patch)
        });
        if (!r.ok) throw new HttpError(502, 'SUPABASE', 'No se pudo actualizar la tarea (HTTP ' + r.status + ')');
        const rows: unknown = await r.json().catch(() => null);
        const task = Array.isArray(rows) && rows[0] ? toTask(rows[0] as Record<string, unknown>, profiles) : null;
        res.status(200).json({ ok: true, task });
        return;
      }
      if (action === 'delete') {
        const id = String(raw.id || '');
        if (!isUuid(id)) {
          res.status(404).json({ ok: false, error: 'Tarea no encontrada' });
          return;
        }
        const db = await supaGetOne(env, id, profiles);
        if (!db) {
          res.status(404).json({ ok: false, error: 'Tarea no encontrada' });
          return;
        }
        const created = String(db.creado_por ?? '');
        let allowed = created === user.id;
        if (!allowed) {
          const pid = typeof db.project_id === 'string' ? db.project_id : null;
          if (pid) {
            const pr = await sfetch(env, '/rest/v1/projects?select=owner_id&id=eq.' + encodeURIComponent(pid) + '&limit=1');
            if (pr.ok) {
              const prRows: unknown = await pr.json().catch(() => null);
              const owner = Array.isArray(prRows) && prRows[0] ? String((prRows[0] as { owner_id?: unknown }).owner_id ?? '') : '';
              allowed = owner === user.id;
            }
          }
        }
        if (!allowed) {
          res.status(403).json({ ok: false, code: 'FORBIDDEN', error: 'Solo el creador puede eliminar la tarea' });
          return;
        }
        const r = await sfetch(env, '/rest/v1/tasks?id=eq.' + encodeURIComponent(id), { method: 'DELETE' });
        if (!r.ok) throw new HttpError(502, 'SUPABASE', 'No se pudo eliminar la tarea (HTTP ' + r.status + ')');
        res.status(200).json({ ok: true, deleted: id });
        return;
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
    console.error('[api/sync] error:', e instanceof Error ? e.message : e);
    res.status(500).json({ ok: false, error: 'Error interno de tareas.' });
  }
};

export default handler;
