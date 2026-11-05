/* ============================================================
   ONE ON ONE BUSINESS — /api/sync (Vercel Serverless Function)
   Puente SEGURO entre el frontend y Google Apps Script.
   El secreto (API_SECRET) NUNCA llega al navegador: solo vive
   en las variables de entorno de Vercel.

   Variables de entorno requeridas en Vercel:
     - GAS_URL    → URL de la app web de Apps Script (termina en /exec)
     - API_SECRET → misma clave que define la constante API_KEY en Code.gs

   Método GET  → lee tareas   (action=getTasks)
   Método POST → escribe      (action=create | update | delete | bulk)
   ============================================================ */

import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Apps Script debe devolver JSON; si devuelve HTML (login, permisos
 *  o URL incorrecta) lo detectamos y respondemos claro. */
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

const handler = async (req: VercelRequest, res: VercelResponse): Promise<void> => {
  const GAS_URL = process.env.GAS_URL;
  const API_SECRET = process.env.API_SECRET;

  if (!GAS_URL || !API_SECRET) {
    res.status(500).json({
      ok: false,
      error: 'Configura GAS_URL y API_SECRET en las variables de entorno de Vercel.'
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
      (body as Record<string, unknown>).key = API_SECRET; // el secreto se inyecta solo, del lado del servidor

      // La clave viaja en el JSON (como espera Code.gs) y también en la URL (redundancia)
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
    console.error('[api/sync] error:', e instanceof Error ? e.message : e);
    res.status(500).json({
      ok: false,
      error: 'Error de sincronización con Google Sheets.'
    });
  }
};

export default handler;
