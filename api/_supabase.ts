/* ============================================================
   ONE ON ONE BUSINESS — Helper Supabase SOLO servidor
   - Todas las claves viven en variables de Vercel (nunca en el cliente).
   - Verifica el JWT de Supabase Auth (Authorization: Bearer <token>).
   - Expone perfiles, acceso a proyectos y validación de responsables.
   ============================================================ */

import type { VercelRequest } from '@vercel/node';

export interface ProfileRow {
  id: string;
  display_name: string;
  cargo: string;
  created_at: string;
}

export interface SupaEnv {
  url: string;
  anon: string;
  service: string;
}

export interface AuthedUser {
  id: string; // auth.users.id
  email: string;
}

export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function supaEnv(): SupaEnv | null {
  const rawUrl = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!rawUrl || !service) return null;
  // Tolerancia: si pegaron .../rest/v1 con o sin / final, lo normalizamos.
  const url = rawUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1\/?$/, '');
  return { url, anon: anon ?? '', service };
}

export function supaHeaders(env: SupaEnv, extra?: Record<string, string>): Record<string, string> {
  return {
    apikey: env.service,
    Authorization: 'Bearer ' + env.service,
    'Content-Type': 'application/json',
    ...(extra || {})
  };
}

export async function sfetch(
  env: SupaEnv,
  path: string,
  init?: RequestInit,
  timeoutMs = 12000
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const initHeaders = (init?.headers ?? {}) as Record<string, string>;
    const headers: Record<string, string> = { ...supaHeaders(env), ...initHeaders };
    return await fetch(env.url + path, { ...init, headers, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function jsonOf(r: Response): Promise<unknown> {
  return r.json().catch(() => null);
}

function bearerOf(req: VercelRequest): string {
  const h = req.headers.authorization;
  if (typeof h === 'string') {
    const m = h.match(/^Bearer\s+(.+)$/i);
    if (m && m[1]) return m[1].trim();
  }
  const q = req.query?.access_token;
  if (typeof q === 'string' && q) return q;
  return '';
}

/** Verifica el token contra Supabase Auth. Lanza HttpError 401 si falla. */
export async function requireAuth(req: VercelRequest): Promise<{ env: SupaEnv; user: AuthedUser }> {
  const env = supaEnv();
  if (!env) {
    throw new HttpError(
      503,
      'NO_SUPABASE',
      'Configura SUPABASE_URL y SUPABASE_SERVICE_KEY en las variables de entorno de Vercel.'
    );
  }
  const token = bearerOf(req);
  if (!token) {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Inicia sesión para continuar');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(env.url + '/auth/v1/user', {
      headers: { apikey: env.service, Authorization: 'Bearer ' + token },
      signal: ctrl.signal
    });
    if (!r.ok) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sesión inválida o expirada. Inicia sesión de nuevo.');
    }
    const data = (await jsonOf(r)) as { id?: unknown; email?: unknown } | null;
    const id = data && typeof data.id === 'string' ? data.id : '';
    if (!id) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Sesión inválida o expirada. Inicia sesión de nuevo.');
    }
    const email = data && typeof data.email === 'string' ? data.email : '';
    return { env, user: { id, email } };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(401, 'UNAUTHENTICATED', 'No se pudo validar la sesión. Inicia sesión de nuevo.');
  } finally {
    clearTimeout(timer);
  }
}

export async function getProfile(env: SupaEnv, userId: string): Promise<ProfileRow | null> {
  const r = await sfetch(
    env,
    '/rest/v1/profiles?select=*&id=eq.' + encodeURIComponent(userId) + '&limit=1'
  );
  if (!r.ok) return null;
  const rows = await jsonOf(r);
  if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object') {
    const p = rows[0] as Partial<ProfileRow>;
    if (typeof p.id === 'string') {
      return {
        id: p.id,
        display_name: String(p.display_name ?? ''),
        cargo: String(p.cargo ?? 'Otro'),
        created_at: String(p.created_at ?? '')
      };
    }
  }
  return null;
}

export async function listProfiles(env: SupaEnv): Promise<ProfileRow[]> {
  const r = await sfetch(env, '/rest/v1/profiles?select=*&order=display_name.asc');
  if (!r.ok) {
    throw new HttpError(502, 'SUPABASE', 'No se pudieron leer los perfiles (HTTP ' + r.status + ')');
  }
  const rows = await jsonOf(r);
  if (!Array.isArray(rows)) return [];
  const out: ProfileRow[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const p = row as Partial<ProfileRow>;
    if (typeof p.id !== 'string' || typeof p.display_name !== 'string') continue;
    out.push({
      id: p.id,
      display_name: p.display_name,
      cargo: typeof p.cargo === 'string' ? p.cargo : 'Otro',
      created_at: typeof p.created_at === 'string' ? p.created_at : ''
    });
  }
  return out;
}

export async function listAccessibleProjectIds(env: SupaEnv, userId: string): Promise<string[]> {
  const [owned, member] = await Promise.all([
    sfetch(env, '/rest/v1/projects?select=id&owner_id=eq.' + encodeURIComponent(userId)),
    sfetch(env, '/rest/v1/project_members?select=project_id&user_id=eq.' + encodeURIComponent(userId))
  ]);
  const ids = new Set<string>();
  if (owned.ok) {
    const rows = await jsonOf(owned);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === 'object') {
          const id = (row as { id?: unknown }).id;
          if (typeof id === 'string') ids.add(id);
        }
      }
    }
  }
  if (member.ok) {
    const rows = await jsonOf(member);
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === 'object') {
          const pid = (row as { project_id?: unknown }).project_id;
          if (typeof pid === 'string') ids.add(pid);
        }
      }
    }
  }
  return [...ids];
}

/** Lanza 404 si el usuario no tiene acceso al proyecto. */
export async function assertProjectAccess(
  env: SupaEnv,
  userId: string,
  projectId: string | null | undefined
): Promise<void> {
  if (!projectId) return; // tareas globales sin proyecto
  const ids = await listAccessibleProjectIds(env, userId);
  if (!ids.includes(projectId)) {
    throw new HttpError(404, 'NOT_FOUND', 'Proyecto no encontrado');
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/** Resuelve un responsable (display_name) a perfil; null si no existe. */
export function findProfile(profiles: ProfileRow[], responsable: string): ProfileRow | null {
  const key = String(responsable || '').trim().toLowerCase();
  if (!key) return null;
  return profiles.find(p => p.display_name.toLowerCase() === key) ?? null;
}
