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

module.exports = async (req, res) => {
  const GAS_URL = process.env.GAS_URL;
  const API_SECRET = process.env.API_SECRET;

  if (!GAS_URL || !API_SECRET) {
    return res.status(500).json({
      ok: false,
      error: 'Configura GAS_URL y API_SECRET en las variables de entorno de Vercel.'
    });
  }

  try {
    if (req.method === 'GET') {
      const action = (req.query && req.query.action) || 'getTasks';
      const url =
        GAS_URL +
        (GAS_URL.includes('?') ? '&' : '?') +
        'key=' + encodeURIComponent(API_SECRET) +
        '&action=' + encodeURIComponent(action);

      const upstream = await fetch(url);
      const text = await upstream.text();

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(text);
    }

    if (req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
      }
      body = body || {};
      body.key = API_SECRET; // el secreto se inyecta solo, del lado del servidor

      const upstream = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body)
      });
      const text = await upstream.text();

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(text);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Método no permitido' });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: 'Error de sincronización con Google Sheets.'
    });
  }
};
