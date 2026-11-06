/* ============================================================
   Tests E2E del navegador (Chrome headless + puppeteer-core)
   - Sirve dist/ + una API en memoria (/api/sync, /api/minuta)
   - Verifica flujos reales: carga, CRUD, minuta IA, fallback,
     tema, navegación semanal, dashboard y cero errores de consola
   Ejecutar: npm test   (build + unit + e2e)
   ============================================================ */

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';

/* ---------- Base de datos en memoria (espejo de Code.gs) ---------- */
function localDateKey(d = new Date()) {
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}

const todayKey = localDateKey();
const tomorrowKey = localDateKey(new Date(Date.now() + 86400000));
const isoNow = new Date().toISOString();

let tasks = [
  {
    id: 'T-1', fecha: todayKey, titulo: 'Revisar propuesta', responsable: 'Ana',
    estado: 'pendiente', fechaCreacion: isoNow, fechaFinalizacion: '', hora: '10:00'
  },
  {
    id: 'T-2', fecha: todayKey, titulo: 'Llamar al proveedor', responsable: 'Bruno',
    estado: 'pendiente', fechaCreacion: isoNow, fechaFinalizacion: '', hora: ''
  }
];
let seq = 2;
let noKeyMode = false; // alterna el modo "sin IA" para el test de fallback
let lastIdem = ''; // idempotencyKey recibida por /api/minuta

const E2E_PROFILES = [
  { id: 'U-ANA', display_name: 'Ana', cargo: 'Tecnologico', created_at: '2026-11-01T00:00:00Z' },
  { id: 'U-BRUNO', display_name: 'Bruno', cargo: 'Contable', created_at: '2026-11-01T00:00:00Z' }
];
const E2E_SESSION = { id: 'U-ANA', email: 'ana@test.local', display_name: 'Ana', cargo: 'Tecnologico' };

/* ---------- Estado del Data Room en memoria (espejo de Supabase) ---------- */
let drSeq = 0;
let drProjects = [{ id: 'P-1', name: 'Proyecto Demo', created_at: '2026-11-01T00:00:00Z' }];
let drDocs = [];
let drMinutas = [{
  id: 'M-1',
  project_id: 'P-1',
  fecha: '2026-11-04',
  titulo: 'Reunión semanal',
  fuente: 'ia',
  acuerdos: ['Mantener el precio'],
  tareas: [{ titulo: 'T' }],
  created_at: '2026-11-04T10:00:00Z'
}];
let drSign = null; // firma pendiente de confirmación
let drUploadSize = 0; // tamaño real del PUT recibido
const DR_MAX = 15 * 1024 * 1024;
const DR_EXT = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ppt', 'pptx'];

const MINUTA_TASKS = [
  { titulo: 'Enviar propuesta al cliente', fecha: todayKey, hora: '10:00', responsable: 'Ana' },
  { titulo: 'Revisar presupuesto', fecha: tomorrowKey, hora: '', responsable: 'Bruno' },
  { titulo: 'Llamar al proveedor', fecha: todayKey, hora: '', responsable: 'Ana' }
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function apiHandler(req, res, pathname) {
  const send = obj => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };

  if (pathname === '/api/auth') {
    const url = new URL(req.url || '/', 'http://x');
    const action = url.searchParams.get('action') || '';
    if (req.method === 'GET') {
      if (action === 'me') {
        send({ ok: true, profile: E2E_SESSION, session: { user_id: 'U-ANA', email: 'ana@test.local', display_name: 'Ana', cargo: 'Tecnologico' } });
        return true;
      }
      if (action === 'profiles') {
        send({ ok: true, profiles: E2E_PROFILES });
        return true;
      }
      send({ ok: true, profiles: E2E_PROFILES });
      return true;
    }
    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (body.action === 'register' || body.action === 'login') {
        send({
          ok: true,
          profile: E2E_SESSION,
          session: { access_token: 'e2e-token', refresh_token: 'refresh', user_id: 'U-ANA', email: 'ana@test.local', display_name: 'Ana', cargo: 'Tecnologico' }
        });
        return true;
      }
      send({ ok: false, error: 'Acción no válida' });
      return true;
    }
    send({ ok: false, error: 'Método no permitido' });
    return true;
  }

  if (pathname === '/api/sync' && req.method === 'GET') {
    send({ ok: true, tasks });
    return true;
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (body.action === 'create') {
      const task = { ...body.task, id: 'T-' + ++seq };
      tasks.push(task);
      send({ ok: true, task });
    } else if (body.action === 'update') {
      const t = tasks.find(x => x.id === body.id);
      if (!t) { send({ ok: false, error: 'Tarea no encontrada' }); return true; }
      Object.assign(t, body.changes);
      t.fechaFinalizacion = t.estado === 'completada' ? new Date().toISOString() : '';
      send({ ok: true, task: t });
    } else if (body.action === 'delete') {
      tasks = tasks.filter(x => x.id !== body.id);
      send({ ok: true });
    } else if (body.action === 'bulk') {
      const created = (body.tasks || []).map(t => ({ ...t, id: 'T-' + ++seq }));
      tasks.push(...created);
      send({ ok: true, tasks: created });
    } else {
      send({ ok: false, error: 'Acción desconocida' });
    }
    return true;
  }

  if (pathname === '/api/minuta' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    if (noKeyMode) {
      send({ ok: false, code: 'NO_KEY', error: 'GEMINI_API_KEY no está configurada en Vercel' });
      return true;
    }
    lastIdem = String(body.idempotencyKey || '');
    await new Promise(r => setTimeout(r, 600)); // ventana para verificar el bloqueo del botón
    // Reparto EN el servidor (espejo del pipeline real: extrae → crea en Sheets → guarda)
    const created = MINUTA_TASKS.map(t => ({
      ...t,
      id: 'T-' + ++seq,
      estado: 'pendiente',
      fechaCreacion: new Date().toISOString(),
      fechaFinalizacion: ''
    }));
    tasks.push(...created);
    send({
      ok: true,
      titulo: 'Reunión semanal',
      acuerdos: ['Mantener el precio actual', 'Enviar informe el viernes'],
      tasks: created,
      minutaId: 'M-1'
    });
    return true;
  }

  /* ---------- Data Room (mock de Supabase: PostgREST + Storage) ---------- */
  if (pathname === '/api/data-room') {
    const url = new URL(req.url || '/', 'http://x');
    const action = url.searchParams.get('action') || '';

    if (req.method === 'GET') {
      if (action === 'projects') {
        send({ ok: true, projects: drProjects });
      } else if (action === 'documents') {
        const pid = url.searchParams.get('projectId') || '';
        send({ ok: true, documents: drDocs.filter(d => d.project_id === pid) });
      } else if (action === 'minutas') {
        send({ ok: true, minutas: drMinutas });
      } else {
        send({ ok: false, error: 'Acción no válida: ' + action });
      }
      return true;
    }

    if (req.method === 'POST') {
      const body = JSON.parse((await readBody(req)) || '{}');

      if (body.action === 'createProject') {
        const name = String(body.name || '').trim();
        if (!name) { send({ ok: false, error: 'Escribe un nombre para el proyecto' }); return true; }
        if (drProjects.some(p => p.name === name)) {
          send({ ok: false, code: 'DUPLICATE', error: 'Ya existe un proyecto con ese nombre' });
          return true;
        }
        const project = { id: 'P-' + ++drSeq, name, created_at: new Date().toISOString() };
        drProjects.push(project);
        send({ ok: true, project });
        return true;
      }

      if (body.action === 'sign') {
        // Misma validación que el servidor real
        const size = Number(body.size) || 0;
        if (size > DR_MAX) {
          send({ ok: false, code: 'TOO_LARGE', error: 'El archivo supera los 15 MB permitidos' });
          return true;
        }
        const ext = String(body.filename || '').split('.').pop().toLowerCase();
        if (!DR_EXT.includes(ext)) {
          send({ ok: false, code: 'UNSUPPORTED', error: 'Tipo de archivo no permitido' });
          return true;
        }
        const safe = String(body.filename).replace(/[\\/]+/g, '_').replace(/\.{2,}/g, '.');
        drSign = {
          path: 'projects/' + body.projectId + '/' + Date.now() + '_' + safe,
          filename: safe,
          mime: body.mime || 'application/pdf',
          category: body.category
        };
        send({ ok: true, uploadUrl: '/__upload', ...drSign });
        return true;
      }

      if (body.action === 'confirm') {
        if (!drSign || drSign.path !== body.path) {
          send({ ok: false, code: 'NOT_FOUND', error: 'El archivo no llegó a Storage. Vuelve a subirlo.' });
          return true;
        }
        const doc = {
          id: 'D-' + ++drSeq,
          project_id: body.projectId,
          filename: drSign.filename,
          path: drSign.path,
          size: drUploadSize || Number(body.size) || 0,
          mime: drSign.mime,
          category: drSign.category,
          uploaded_at: new Date().toISOString()
        };
        drDocs.unshift(doc);
        drSign = null;
        drUploadSize = 0;
        send({ ok: true, document: doc });
        return true;
      }

      if (body.action === 'downloadUrl') {
        const doc = drDocs.find(d => d.id === body.documentId);
        if (!doc) { send({ ok: false, code: 'NOT_FOUND', error: 'Documento no encontrado' }); return true; }
        send({ ok: true, url: '/__download/' + encodeURIComponent(doc.filename) });
        return true;
      }

      if (body.action === 'delete') {
        const before = drDocs.length;
        drDocs = drDocs.filter(d => d.id !== body.documentId);
        if (drDocs.length === before) {
          send({ ok: false, code: 'NOT_FOUND', error: 'Documento no encontrado' });
          return true;
        }
        send({ ok: true });
        return true;
      }

      send({ ok: false, error: 'Acción no válida: ' + (body.action || '(vacía)') });
      return true;
    }

    send({ ok: false, error: 'Método no permitido' });
    return true;
  }

  /* Subida DIRECTA del archivo (simula Supabase Storage) */
  if (pathname === '/__upload' && req.method === 'PUT') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    drUploadSize = Buffer.concat(chunks).length;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ Key: 'documentos/ok' }));
    return true;
  }

  return false;
}

async function staticHandler(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = join(DIST, normalize(rel));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403); res.end(); return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404');
  }
}

/* ---------- Infra de la prueba ---------- */
const results = [];
async function t(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  ✓ ' + name);
  } catch (err) {
    results.push({ name, ok: false });
    console.log('  ✗ ' + name + ' → ' + (err && err.message));
  }
}

function watchPage(page, sink) {
  page.on('console', msg => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() && msg.location().url) || '';
    if (!url || url.startsWith(sink.base)) sink.console.push(msg.text() + (url ? ' @ ' + url : ''));
  });
  page.on('pageerror', err => sink.console.push('pageerror: ' + String(err)));
}

/* ---------- Programa principal ---------- */
async function main() {
  try {
    await readFile(join(DIST, 'index.html'));
  } catch {
    console.error('✗ No existe dist/: ejecuta primero "npm run build" (o "npm test").');
    process.exit(1);
  }

  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
    apiHandler(req, res, pathname)
      .then(handled => (handled ? undefined : staticHandler(req, res, pathname)))
      .catch(() => { res.writeHead(500); res.end(); });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const sink = { base, console: [] };
  async function injectSession(p) {
    const sessionJson = JSON.stringify({
      access_token: 'e2e-token',
      refresh_token: 'refresh',
      user_id: 'U-ANA',
      email: 'ana@test.local',
      display_name: 'Ana',
      cargo: 'Tecnologico'
    });
    await p.evaluateOnNewDocument(s => {
      try { sessionStorage.setItem('neu_session', s); } catch {}
    }, sessionJson);
  }
  const page = await browser.newPage();
  await injectSession(page);
  await page.setViewport({ width: 1280, height: 900 });
  watchPage(page, sink);

  try {
    await t('index.html carga sin errores de consola ni de JS', async () => {
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#grid .day', { timeout: 10000 });
      assert.equal(sink.console.length, 0, sink.console.join(' | '));
    });

    await t('el grid muestra exactamente 7 días (Dom–Sáb)', async () => {
      const n = await page.$$eval('.day', els => els.length);
      assert.equal(n, 7);
    });

    await t('la marquesina muestra el rango de la semana', async () => {
      const txt = await page.$eval('#marqueeTrack', el => el.textContent || '');
      assert.match(txt, /SEM \d+/i);
    });

    await t('las tareas del día aparecen con barra por responsable', async () => {
      await page.waitForFunction(
        () => document.querySelectorAll('.event').length >= 2,
        { timeout: 5000 }
      );
      const bars = await page.$$eval('.event .bar', els => els.map(e => e.className));
      assert.ok(bars.some(c => c.includes('jose')), 'barra del miembro 1');
      assert.ok(bars.some(c => c.includes('luis')), 'barra del miembro 2');
      const count = await page.$eval('#generalCount', el => el.textContent || '');
      assert.match(count, /\d+\/\d+/);
    });

    await t('ciclo de estados ✓: pendiente → en progreso → completada', async () => {
      await page.click('.event .check');
      await page.waitForFunction(() => {
        const row = document.querySelector('.event');
        return !!row && row.classList.contains('progreso');
      }, { timeout: 5000 });
      const enProgreso = tasks.find(x => x.titulo === 'Revisar propuesta');
      assert.ok(enProgreso, 'la tarea sembrada existe');
      assert.equal(enProgreso.estado, 'en progreso', 'primer clic → en progreso');

      await page.click('.event .check');
      await page.waitForFunction(() => {
        const row = document.querySelector('.event');
        return !!row && row.classList.contains('done');
      }, { timeout: 5000 });
      assert.equal(enProgreso.estado, 'completada', 'segundo clic → completada');
      assert.ok(enProgreso.fechaFinalizacion, 'fechaFinalizacion la pone el servidor');

      const badge = await page.$eval('.event .badge', el => el.textContent || '');
      assert.equal(badge, 'Completada', 'badge del estado visible');
    });

    await t('agregar tarea desde el modal la crea en el servidor', async () => {
      const before = tasks.length;
      await page.click('#addBtn');
      await page.waitForSelector('#overlay.open', { timeout: 3000 });
      await page.type('#evTitle', 'Tarea creada por E2E');
      await page.click('#saveBtn');
      await page.waitForFunction(
        () => Array.from(document.querySelectorAll('.event .t'))
          .some(e => e.textContent === 'Tarea creada por E2E'),
        { timeout: 5000 }
      );
      assert.equal(tasks.length, before + 1);
      assert.ok(tasks.some(x => x.titulo === 'Tarea creada por E2E'));
    });

    await t('eliminar tarea la quita también del servidor', async () => {
      const before = await page.$$eval('.event', els => els.length);
      await page.click('.event-list .event:last-child .del');
      await page.waitForFunction(
        n => document.querySelectorAll('.event').length === n - 1,
        { timeout: 5000 },
        before
      );
      assert.ok(!tasks.some(x => x.titulo === 'Tarea creada por E2E'));
    });

    await t('el selector de miembro cambia el progreso personal', async () => {
      await page.click('#userToggle .user-chip[data-user="Bruno"]');
      const label = await page.$eval('#personalLabel', el => el.textContent || '');
      assert.equal(label, 'Progreso Bruno');
      await page.click('#userToggle .user-chip[data-user="Ana"]');
    });

    await t('la Minuta con IA crea 3 tareas en el servidor y muestra el resultado', async () => {
      const before = tasks.length;
      await page.click('#minutaBtn');
      await page.waitForSelector('#minutaOverlay.open', { timeout: 3000 });
      await page.type('#minutaText', 'Reunión: revisar el avance del proyecto.');
      await page.keyboard.down('Control');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Control');
      await page.waitForFunction(() => {
        const b = document.getElementById('minutaProcessBtn');
        return !!b && b.disabled && b.textContent === 'Procesando…';
      }, { timeout: 3000 });
      await page.waitForFunction(() => {
        const r = document.getElementById('minutaResult');
        return !!r && !r.hidden;
      }, { timeout: 8000 });

      // el botón queda restaurado aunque el formulario esté oculto
      const btn = await page.$eval('#minutaProcessBtn', b => ({
        disabled: b.disabled,
        text: b.textContent || ''
      }));
      assert.equal(btn.disabled, false, 'botón restaurado');
      assert.equal(btn.text, 'Procesar');

      // el reparto ocurrió EN el servidor y llegó la idempotencyKey
      assert.equal(tasks.length, before + 3, 'bulk en el servidor');
      assert.ok(lastIdem.length >= 8, 'el cliente envía idempotencyKey');

      // panel de resultado: acuerdos extraídos + tareas creadas
      const acuerdos = await page.$eval('#minutaAcuerdos', el => el.textContent || '');
      assert.match(acuerdos, /Mantener el precio actual/);
      const listado = await page.$eval('#minutaResultTasks', el => el.textContent || '');
      assert.match(listado, /Enviar propuesta al cliente/);
      assert.match(listado, /Llamar al proveedor/);

      // las tareas nuevas ya se ven en el calendario
      const vistas = await page.$$eval('.event .t', els =>
        els.filter(e => /Enviar propuesta al cliente/.test(e.textContent || '')).length
      );
      assert.ok(vistas >= 1, 'las tareas nuevas aparecen en el grid');

      const toast = await page.$eval('.toast', el => el.textContent || '');
      assert.match(toast, /3 tareas creadas desde la minuta/);

      // «Cerrar» devuelve al calendario
      await page.click('#minutaDoneBtn');
      await page.waitForFunction(
        () => !document.getElementById('minutaOverlay').classList.contains('open'),
        { timeout: 3000 }
      );
    });

    await t('modo sin IA: fallback crea una tarea por línea', async () => {
      noKeyMode = true;
      try {
        const before = tasks.length;
        await page.click('#minutaBtn');
        await page.waitForSelector('#minutaOverlay.open', { timeout: 3000 });
        await page.type('#minutaText', 'Primera linea\nSegunda linea\nTercera linea');
        await page.keyboard.down('Control');
        await page.keyboard.press('Enter');
        await page.keyboard.up('Control');
        await page.waitForFunction(() => {
          const el = document.querySelector('.toast');
          return !!el && (el.textContent || '').includes('IA sin configurar en Vercel');
        }, { timeout: 8000 });
        const toast = await page.$eval('.toast', el => el.textContent || '');
        assert.match(toast, /3 tareas por líneas/);
        assert.equal(tasks.length, before + 3, 'bulk de respaldo en el servidor');
        // el resultado del modo líneas también se cierra a mano
        await page.click('#minutaDoneBtn');
        await page.waitForFunction(
          () => !document.getElementById('minutaOverlay').classList.contains('open'),
          { timeout: 3000 }
        );
      } finally {
        noKeyMode = false;
      }
    });

    await t('el botón de tema alterna claro/oscuro', async () => {
      const before = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'));
      await page.click('#themeBtn');
      const after = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'));
      assert.notEqual(before, after);
      assert.ok(after === 'light' || after === 'dark');
    });

    await t('‹ › navegan entre semanas y «Hoy» vuelve', async () => {
      const t1 = await page.$eval('#marqueeTrack', el => el.textContent || '');
      await page.click('#nextBtn');
      await page.waitForFunction(
        prev => document.getElementById('marqueeTrack').textContent !== prev,
        { timeout: 3000 }, t1
      );
      await page.click('#todayBtn');
      await page.waitForFunction(
        prev => document.getElementById('marqueeTrack').textContent === prev,
        { timeout: 3000 }, t1
      );
    });

    await t('el dashboard carga métricas sin errores', async () => {
      const dash = await browser.newPage();
      await injectSession(dash);
      const sinkDash = { base, console: [] };
      watchPage(dash, sinkDash);
      await dash.setViewport({ width: 1280, height: 900 });
      await dash.goto(base + '/dashboard.html', { waitUntil: 'domcontentloaded' });
      await dash.waitForSelector('#statTotal', { timeout: 10000 });
      await dash.waitForFunction(
        () => /^\d+$/.test(document.getElementById('statTotal').textContent || ''),
        { timeout: 5000 }
      );
      const done = await dash.$eval('#statDone', el => el.textContent || '');
      assert.match(done, /^\d+$/);
      const progress = await dash.$eval('#statProgress', el => el.textContent || '');
      assert.match(progress, /^\d+$/);
      const rows = await dash.$eval('#userRows', el => el.textContent || '');
      assert.match(rows, /Ana/, 'fila de Ana en la tabla');
      assert.match(rows, /Bruno/, 'fila de Bruno en la tabla');
      assert.equal(sinkDash.console.length, 0, sinkDash.console.join(' | '));
      await dash.close();
    });

    /* ---------- Data Room ---------- */
    const drSink = { base, console: [] };
    const dr = await browser.newPage();
    await injectSession(dr);
    watchPage(dr, drSink);
    await dr.setViewport({ width: 1280, height: 900 });
    dr.on('dialog', d => d.accept()); // confirm() de «Eliminar»

    const drPdf = join(tmpdir(), 'e2e-dr-test.pdf');
    const drBig = join(tmpdir(), 'e2e-dr-grande.pdf');
    await writeFile(drPdf, '%PDF-1.4\n% archivo de prueba E2E\n');
    await writeFile(drBig, Buffer.alloc(16 * 1024 * 1024, 0x61));

    await t('el Data Room carga con proyecto, minutas y cero errores', async () => {
      await dr.goto(base + '/data-room.html', { waitUntil: 'domcontentloaded' });
      await dr.waitForFunction(() => {
        const s = document.getElementById('projectSelect');
        return !!s && !s.disabled && s.options.length >= 1;
      }, { timeout: 10000 });
      const selected = await dr.$eval('#projectSelect', s => s.value);
      assert.ok(selected, 'hay un proyecto seleccionado');
      const docs = await dr.$eval('#docRows', el => el.textContent || '');
      assert.match(docs, /Sin documentos/);
      const minutas = await dr.$eval('#minutaRows', el => el.textContent || '');
      assert.match(minutas, /Reunión semanal/, 'histórico de minutas visible');
      const cats = await dr.$$eval('#categorySelect option', els => els.length);
      assert.equal(cats, 5, 'categorías fijas');
      const zone = await dr.$('#uploadZone');
      assert.ok(zone, 'zona de subida visible');
    });

    await t('subir un documento válido lo registra con categoría y tamaño', async () => {
      await dr.select('#categorySelect', 'Contratos');
      const input = await dr.$('#fileInput');
      await input.uploadFile(drPdf);
      await dr.waitForFunction(() => {
        const t = document.getElementById('docRows').textContent || '';
        return t.includes('e2e-dr-test.pdf');
      }, { timeout: 10000 });
      const text = await dr.$eval('#docRows', el => el.textContent || '');
      assert.match(text, /Contratos/, 'categoría elegida');
      assert.match(text, /\d+(\.\d+)?\s?(B|KB|MB)/, 'tamaño formateado');
      const count = await dr.$eval('#docCount', el => el.textContent || '');
      assert.equal(count, '1');
      const btns = await dr.$$eval('#docRows .icon-btn', els => els.length);
      assert.equal(btns, 2, 'descargar + eliminar');
    });

    await t('un archivo de 16 MB se rechaza sin subir', async () => {
      const input = await dr.$('#fileInput');
      await input.uploadFile(drBig);
      await dr.waitForFunction(() => {
        const el = document.querySelector('.toast');
        return !!el && /15 MB/.test(el.textContent || '');
      }, { timeout: 5000 });
      const text = await dr.$eval('#docRows', el => el.textContent || '');
      assert.ok(!text.includes('grande'), 'el archivo no se registra');
      const count = await dr.$eval('#docCount', el => el.textContent || '');
      assert.equal(count, '1', 'sigue habiendo solo el primer documento');
    });

    await t('crear proyecto lo agrega y queda seleccionado', async () => {
      await dr.click('#newProjectBtn');
      await dr.waitForSelector('#projectOverlay.open', { timeout: 3000 });
      await dr.type('#projectName', 'Cliente Norte');
      await dr.click('#projectCreateBtn');
      await dr.waitForFunction(() => {
        const s = document.getElementById('projectSelect');
        return !!s && Array.from(s.options).some(o => o.textContent === 'Cliente Norte');
      }, { timeout: 5000 });
      const docs = await dr.$eval('#docRows', el => el.textContent || '');
      assert.match(docs, /Sin documentos/, 'el proyecto nuevo empieza vacío');
      const count = await dr.$eval('#docCount', el => el.textContent || '');
      assert.equal(count, '0');
    });

    await t('eliminar documento quita la fila tras confirmar', async () => {
      const demoId = await dr.$eval('#projectSelect option', o => o.value);
      await dr.select('#projectSelect', demoId);
      await dr.waitForFunction(() => {
        const t = document.getElementById('docRows').textContent || '';
        return t.includes('e2e-dr-test.pdf');
      }, { timeout: 5000 });
      await dr.click('#docRows .icon-btn.danger');
      await dr.waitForFunction(() => {
        const t = document.getElementById('docRows').textContent || '';
        return !t.includes('e2e-dr-test.pdf');
      }, { timeout: 5000 });
      const count = await dr.$eval('#docCount', el => el.textContent || '');
      assert.equal(count, '0');
    });

    await t('Data Room sin errores de consola', async () => {
      assert.equal(drSink.console.length, 0, drSink.console.join(' | '));
      await dr.close();
    });

    await t('cero errores de consola en toda la sesión', async () => {
      assert.equal(sink.console.length, 0, sink.console.join(' | '));
    });
  } finally {
    await browser.close();
    server.close();
  }

  const pass = results.filter(r => r.ok).length;
  const fail = results.length - pass;
  console.log('\n' + pass + '/' + results.length + ' pruebas E2E' + (fail ? ' (' + fail + ' fallidas)' : ' ✓'));
  process.exit(fail ? 1 : 0);
}

main().catch(err => {
  console.error('ERROR FATAL:', err);
  process.exit(1);
});
