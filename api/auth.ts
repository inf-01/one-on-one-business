/* ============================================================
   ONE ON ONE BUSINESS — /api/auth (Vercel Serverless Function)
   Auth a través de Supabase Auth SIN exponer claves al navegador.

   Acciones:
   · GET  ?action=me        → valida el Bearer y devuelve tu profile
   · GET  ?action=profiles  → lista de perfiles registrados (para repartir)
   · POST {action:'register', display_name, email, password, cargo}
   · POST {action:'login', email, password}

   Variables (solo servidor, en Vercel):
     SUPABASE_URL          → https://xxxx.supabase.co
     SUPABASE_ANON_KEY     → ANON key (solo servidor)
     SUPABASE_SERVICE_KEY  → service_role (solo servidor)
   ============================================================ */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProfile, HttpError, listProfiles, requireAuth, sfetch, supaEnv } from './_supabase';

const CARGOS = ['Tecnologico', 'Contable', 'Administracion', 'Ventas', 'Operaciones', 'Otro'];

async function jsonOf(r: Response): Promise<unknown> {
  return r.json().catch(() => null);
}

function bodyOf(req: VercelRequest): Record<string, unknown> {
  let body: unknown = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = null;
    }
  }
  if (!body || typeof body !== 'object') return {};
  return body as Record<string, unknown>;
}

function normCargo(v: unknown): string {
  const s = String(v ?? 'Otro').trim();
  return CARGOS.includes(s) ? s : 'Otro';
}

function normName(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
}

function validEmail(v: unknown): string {
  const s = String(v ?? '').trim().toLowerCase().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
    throw new HttpError(400, 'VALIDATION', 'Escribe un correo válido');
  }
  return s;
}

function validPassword(v: unknown): string {
  const s = String(v ?? '');
  if (s.length < 8) throw new HttpError(400, 'VALIDATION', 'La contraseña debe tener al menos 8 caracteres');
  if (s.length > 72) throw new HttpError(400, 'VALIDATION', 'La contraseña es demasiado larga');
  return s;
}

async function handleRegister(req: VercelRequest): Promise<{ status: number; body: unknown }> {
  const env = supaEnv();
  if (!env || !env.anon) {
    throw new HttpError(503, 'NO_SUPABASE', 'Configura SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_KEY en Vercel.');
  }
  const raw = bodyOf(req);
  const display_name = normName(raw.display_name);
  if (!display_name) throw new HttpError(400, 'VALIDATION', 'Escribe tu nombre');
  const email = validEmail(raw.email);
  const password = validPassword(raw.password);
  const cargo = normCargo(raw.cargo);

  // 1) Crear usuario en Supabase Auth
  const signup = await sfetch(
    env,
    '/auth/v1/signup',
    {
      method: 'POST',
      headers: { apikey: env.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        options: { data: { display_name, cargo } }
      })
    },
    15000
  );
  const signupData = (await jsonOf(signup)) as {
    id?: unknown;
    email?: unknown;
    session?: { access_token?: unknown; refresh_token?: unknown } | null;
    msg?: unknown;
    message?: unknown;
  } | null;
  if (!signup.ok) {
    const msg = String(
      (signupData as { msg?: unknown; message?: unknown } | null)?.msg ??
        (signupData as { message?: unknown } | null)?.message ??
        'No se pudo crear la cuenta'
    );
    if (signup.status === 422 || /exist|registered|already/i.test(msg)) {
      throw new HttpError(409, 'DUPLICATE', 'Ya existe una cuenta con ese correo');
    }
    throw new HttpError(502, 'AUTH', msg.slice(0, 200));
  }
  const userId =
    signupData && typeof signupData.id === 'string'
      ? signupData.id
      : signupData && typeof (signupData as { user?: { id?: unknown } }).user?.id === 'string'
        ? String((signupData as { user: { id: string } }).user.id)
        : '';
  const session = signupData?.session ?? null;
  const access_token = session && typeof session.access_token === 'string' ? session.access_token : '';
  const refresh_token =
    session && typeof session.refresh_token === 'string' ? session.refresh_token : '';

  // 2) Perfiles: el trigger handle_new_user debería haberlo creado.
  //    Si no hay sesión todavía (confirm email), devolvemos mensaje claro.
  if (userId) {
    let profile = await getProfile(env, userId);
    if (!profile) {
      // Fallback: insertar manualmente (por si el trigger aún no corrió)
      const ins = await sfetch(env, '/rest/v1/profiles', {
        method: 'POST',
        headers: {
          apikey: env.service,
          Authorization: 'Bearer ' + env.service,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ id: userId, display_name, cargo })
      });
      if (ins.ok) profile = await getProfile(env, userId);
    }
    if (profile) {
      return {
        status: 200,
        body: {
          ok: true,
          profile,
          session: access_token
            ? { access_token, refresh_token, user_id: userId, email, display_name: profile.display_name, cargo: profile.cargo }
            : null
        }
      };
    }
  }
  // Email confirmation requerida en Supabase → el usuario aún no tiene sesión
  return {
    status: 200,
    body: {
      ok: true,
      needsConfirm: true,
      message: 'Cuenta creada. Confirma tu correo (revisa tu bandeja) y luego inicia sesión.'
    }
  };
}

async function handleLogin(req: VercelRequest): Promise<{ status: number; body: unknown }> {
  const env = supaEnv();
  if (!env || !env.anon) {
    throw new HttpError(503, 'NO_SUPABASE', 'Configura SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_KEY en Vercel.');
  }
  const raw = bodyOf(req);
  const email = validEmail(raw.email);
  const password = String(raw.password ?? '');
  if (!password) throw new HttpError(400, 'VALIDATION', 'Escribe tu contraseña');

  const token = await sfetch(
    env,
    '/auth/v1/token?grant_type=password',
    {
      method: 'POST',
      headers: { apikey: env.anon, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    },
    15000
  );
  const data = (await jsonOf(token)) as {
    access_token?: unknown;
    refresh_token?: unknown;
    user?: { id?: unknown; email?: unknown } | null;
    error_description?: unknown;
    msg?: unknown;
  } | null;
  if (!token.ok || !data || typeof data.access_token !== 'string') {
    throw new HttpError(401, 'UNAUTHENTICATED', 'Correo o contraseña incorrectos');
  }
  const userId =
    data.user && typeof data.user.id === 'string' ? data.user.id : '';
  if (!userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Correo o contraseña incorrectos');
  let profile = await getProfile(env, userId);
  if (!profile) {
    // Usuario de Auth sin profile (trigger no corrió): crear con defaults del metadata no disponibles
    profile = { id: userId, display_name: 'Usuario', cargo: 'Otro', created_at: '' };
  }
  return {
    status: 200,
    body: {
      ok: true,
      profile,
      session: {
        access_token: data.access_token,
        refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : '',
        user_id: userId,
        email,
        display_name: profile.display_name,
        cargo: profile.cargo
      }
    }
  };
}

const handler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const action = (typeof req.query.action === 'string' ? req.query.action : undefined) || 'me';
      const { env, user } = await requireAuth(req);
      if (action === 'me') {
        const profile = await getProfile(env, user.id);
        if (!profile) {
          res.status(404).json({ ok: false, code: 'NO_PROFILE', error: 'Perfil no encontrado. Vuelve a iniciar sesión.' });
          return;
        }
        res.status(200).json({
          ok: true,
          profile,
          session: {
            access_token: '',
            user_id: user.id,
            email: user.email,
            display_name: profile.display_name,
            cargo: profile.cargo
          }
        } as unknown as Record<string, unknown>);
        return;
      }
      if (action === 'profiles') {
        res.status(200).json({ ok: true, profiles: await listProfiles(env) });
        return;
      }
      res.status(400).json({ ok: false, error: 'Acción no válida: ' + action });
      return;
    }
    if (req.method === 'POST') {
      const action = String(bodyOf(req).action || '');
      if (action === 'register') {
        const out = await handleRegister(req);
        res.status(out.status).json(out.body as Record<string, unknown>);
        return;
      }
      if (action === 'login') {
        const out = await handleLogin(req);
        res.status(out.status).json(out.body as Record<string, unknown>);
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
    console.error('[api/auth] error:', e instanceof Error ? e.message : e);
    res.status(500).json({ ok: false, error: 'Error interno de autenticación.' });
  }
};

export default handler;
