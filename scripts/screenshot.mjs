/* ============================================================
   Capturas de pantalla del diseño corporativo (dev only).
   Uso: node scripts/screenshot.mjs   →  /tmp/opencode/shots/*.png
   Sirve dist/ con una API en memoria sembrada de tareas.
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const OUT = '/tmp/opencode/shots';

function localDateKey(d = new Date()) {
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

const today = localDateKey();
const iso = new Date(Date.now() - 3600000).toISOString();

const tasks = [
  { id: 'T-1', fecha: today, titulo: 'Enviar propuesta al cliente', responsable: 'José', estado: 'completada', fechaCreacion: iso, fechaFinalizacion: new Date().toISOString(), hora: '10:00' },
  { id: 'T-2', fecha: today, titulo: 'Revisar presupuesto', responsable: 'Luis', estado: 'en progreso', fechaCreacion: iso, fechaFinalizacion: '', hora: '12:30' },
  { id: 'T-3', fecha: today, titulo: 'Llamar al proveedor', responsable: 'José', estado: 'pendiente', fechaCreacion: iso, fechaFinalizacion: '', hora: '' },
  { id: 'T-4', fecha: today, titulo: 'Preparar presentación', responsable: 'Luis', estado: 'pendiente', fechaCreacion: iso, fechaFinalizacion: '', hora: '16:00' }
];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json', '.ico': 'image/x-icon'
};

const server = createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
  if (pathname === '/api/sync') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, tasks }));
    return;
  }
  if (pathname === '/api/minuta') {
    // Espejo del pipeline real: responde tareas ya repartidas + acuerdos
    const created = [
      { id: 'T-91', fecha: today, titulo: 'Enviar propuesta al cliente', responsable: 'José', estado: 'pendiente', fechaCreacion: iso, fechaFinalizacion: '', hora: '10:00' },
      { id: 'T-92', fecha: today, titulo: 'Llamar al proveedor', responsable: 'José', estado: 'pendiente', fechaCreacion: iso, fechaFinalizacion: '', hora: '' },
      { id: 'T-93', fecha: today, titulo: 'Revisar presupuesto', responsable: 'Luis', estado: 'pendiente', fechaCreacion: iso, fechaFinalizacion: '', hora: '' }
    ];
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      titulo: 'Reunión semanal — seguimiento de propuestas',
      acuerdos: [
        'Mantener el precio actual hasta diciembre',
        'Enviar el informe financiero el viernes',
        'Contratar soporte externo para la migración'
      ],
      tasks: created,
      minutaId: 'M-1'
    }));
    return;
  }
  if (pathname === '/api/data-room') {
    // Espejo del endpoint real: proyectos, documentos y minutas sembrados
    const action = new URL(req.url || '/', 'http://x').searchParams.get('action');
    let body;
    if (action === 'projects') {
      body = {
        ok: true,
        projects: [
          { id: 'P-1', name: 'Cliente Norte', created_at: iso },
          { id: 'P-2', name: 'Proyecto Demo', created_at: iso }
        ]
      };
    } else if (action === 'documents') {
      body = {
        ok: true,
        documents: [
          { id: 'D-1', project_id: 'P-1', filename: 'propuesta-norte-v3.pdf', path: 'projects/P-1/1_propuesta-norte-v3.pdf', size: 2481230, mime: 'application/pdf', category: 'Propuestas', uploaded_at: iso },
          { id: 'D-2', project_id: 'P-1', filename: 'contrato-marco-2026.docx', path: 'projects/P-1/2_contrato-marco-2026.docx', size: 184512, mime: 'application/msword', category: 'Contratos', uploaded_at: iso },
          { id: 'D-3', project_id: 'P-1', filename: 'factura-0042.pdf', path: 'projects/P-1/3_factura-0042.pdf', size: 96304, mime: 'application/pdf', category: 'Facturas', uploaded_at: iso }
        ]
      };
    } else if (action === 'minutas') {
      body = {
        ok: true,
        minutas: [
          { id: 'M-3', project_id: null, fecha: '2026-11-03', titulo: 'Reunión con Cliente Norte — alcance', fuente: 'ia', acuerdos: ['Precio', 'Plazo'], tareas: ['T1', 'T2', 'T3'], created_at: iso },
          { id: 'M-2', project_id: null, fecha: '2026-10-27', titulo: 'Semana 43 — seguimiento', fuente: 'ia', acuerdos: ['A', 'B'], tareas: ['T1', 'T2', 'T3', 'T4'], created_at: iso },
          { id: 'M-1', project_id: null, fecha: '2026-10-20', titulo: 'Kickoff del proyecto', fuente: 'manual', acuerdos: ['Ok'], tareas: ['T1', 'T2'], created_at: iso }
        ]
      };
    } else {
      body = { ok: false, error: 'Acción no válida' };
    }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
    return;
  }
  const rel = pathname === '/' ? '/index.html' : pathname;
  try {
    const data = await readFile(join(DIST, normalize(rel)));
    res.writeHead(200, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end();
  }
});

async function shot(page, name) {
  await new Promise(r => setTimeout(r, 350)); // dejamos respirar fuentes y animaciones
  await page.screenshot({ path: join(OUT, name) });
  console.log('  📷 ' + name);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 950, deviceScaleFactor: 1.5 });

  // 1) Calendario — tema oscuro
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.event .badge', { timeout: 10000 });
  await shot(page, '01-calendario-oscuro.png');

  // 2) Calendario — tema claro
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await shot(page, '02-calendario-claro.png');

  // 3) Modal de Minuta — tema oscuro (formulario)
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await page.click('#minutaBtn');
  await page.waitForSelector('#minutaOverlay.open', { timeout: 3000 });
  await page.type('#minutaText', 'Reunión semanal: José envía la propuesta al cliente el jueves a las 10.\nLuis revisa el presupuesto mañana.\nRecordar llamar al proveedor.');
  await shot(page, '03-minuta-modal.png');

  // 3b) Procesar → panel de resultado (acuerdos + tareas creadas)
  await page.click('#minutaProcessBtn');
  await page.waitForFunction(() => {
    const r = document.getElementById('minutaResult');
    return !!r && !r.hidden;
  }, { timeout: 5000 });
  await shot(page, '06-minuta-resultado.png');
  await page.click('#minutaDoneBtn');

  // 4) Dashboard — tema claro (tabla + KPIs)
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(base + '/dashboard.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#userRows tr', { timeout: 10000 });
  await shot(page, '04-dashboard-claro.png');

  // 5) Dashboard — tema oscuro
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await shot(page, '05-dashboard-oscuro.png');

  // 7) Data Room — tema claro (documentos + histórico de minutas)
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.goto(base + '/data-room.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const s = document.getElementById('projectSelect');
    return !!s && !s.disabled;
  }, { timeout: 10000 });
  await page.waitForSelector('#docRows .icon-btn', { timeout: 10000 });
  await shot(page, '07-data-room-claro.png');

  // 8) Data Room — tema oscuro
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await shot(page, '08-data-room-oscuro.png');

  await browser.close();
  server.close();
  console.log('\nListo: ' + OUT);
}

main().catch(err => {
  console.error('ERROR:', err);
  process.exit(1);
});
