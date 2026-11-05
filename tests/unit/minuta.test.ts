/* ============================================================
   Tests unitarios de /api/minuta (sin red: fetch simulado)
   Cubren el pipeline v2: validación → extracción (Gemini) →
   reparto en servidor (Apps Script) → histórico (Supabase)
   → idempotencia.
   Ejecutar: npm run test:unit
   ============================================================ */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/minuta';

type Req = Parameters<typeof handler>[0];
type Res = Parameters<typeof handler>[1];

interface TestOut {
  code: number;
  body: unknown;
  headers: Record<string, string>;
}

function makeRes(): { res: Res; out: TestOut } {
  const out: TestOut = { code: 0, body: null, headers: {} };
  const res = {
    status(c: number): unknown {
      out.code = c;
      return res;
    },
    json(b: unknown): unknown {
      out.body = b;
      return res;
    },
    send(b: unknown): unknown {
      out.body = b;
      return res;
    },
    setHeader(k: string, v: string): unknown {
      out.headers[k.toLowerCase()] = v;
      return res;
    }
  };
  return { res: res as unknown as Res, out };
}

function makeReq(body: unknown, method = 'POST'): Req {
  return {
    method,
    body,
    query: {},
    headers: {},
    url: '/api/minuta'
  } as unknown as Req;
}

function bodyAs(out: TestOut): Record<string, unknown> {
  assert.ok(out.body && typeof out.body === 'object', 'el body debe ser un objeto');
  return out.body as Record<string, unknown>;
}

/* ---------- Simulación de red: Gemini + Apps Script + Supabase ---------- */
const realFetch = globalThis.fetch;
const KEY = 'unit-test-key';
const GAS_BASE = 'https://script.google.com/macros/s/UNIT_TEST/exec';
const SUPA_BASE = 'https://unit.supabase.co';

let geminiQueue: Array<{ status: number; body: unknown }> = [];
let geminiCalls = 0;
let gasCalls = 0;
let supabaseCalls = 0;
let gasMode: 'ok' | 'error' | 'html' = 'ok';
let supabaseMode: 'ok' | 'error' = 'ok';
let lastGasBody: Record<string, unknown> | null = null;
let lastSupabaseBody: Record<string, unknown> | null = null;
let gasSeq = 0;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

/** Respuesta de Gemini con el esquema v2: {titulo, acuerdos, actionItems}. */
function geminiOk(
  items: unknown,
  titulo = 'Minuta de prueba',
  acuerdos: string[] = []
): { status: number; body: unknown } {
  return {
    status: 200,
    body: {
      candidates: [
        { content: { parts: [{ text: JSON.stringify({ titulo, acuerdos, actionItems: items }) }] } }
      ]
    }
  };
}

function geminiErr(status: number, message: string): { status: number; body: unknown } {
  return { status, body: { error: { message } } };
}

function installFetchMock(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);

    if (url.includes('generativelanguage.googleapis.com')) {
      geminiCalls++;
      const next = geminiQueue.shift() ?? geminiOk([]);
      return jsonRes(next.status, next.body);
    }

    if (url.startsWith(GAS_BASE)) {
      gasCalls++;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      lastGasBody = parsed;
      if (gasMode === 'html') {
        return new Response('<html>login de Google</html>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' }
        });
      }
      if (gasMode === 'error') return jsonRes(200, { ok: false, error: 'La hoja está ocupada' });
      const list = Array.isArray(parsed?.tasks)
        ? (parsed.tasks as Array<Record<string, unknown>>)
        : [];
      const created = list.map(t => ({ ...t, id: 'G-' + ++gasSeq }));
      return jsonRes(200, { ok: true, tasks: created });
    }

    if (url.startsWith(SUPA_BASE)) {
      supabaseCalls++;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      } catch {
        parsed = null;
      }
      lastSupabaseBody = parsed;
      if (supabaseMode === 'error') {
        return jsonRes(400, { message: 'new row violates row-level security policy' });
      }
      return jsonRes(201, [{ id: 'M-1' }]);
    }

    throw new Error('fetch inesperado en el test: ' + url);
  }) as typeof fetch;
}

/** Petición estándar de los tests (fechas fijas para no depender del reloj). */
function req(overrides: Record<string, unknown> = {}): Req {
  return makeReq({
    text: 'x',
    responsable: 'José',
    fecha: '2026-11-05',
    hoy: '2026-11-05',
    ...overrides
  });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = KEY;
  process.env.GAS_URL = GAS_BASE;
  process.env.API_SECRET = 'unit-secret';
  process.env.SUPABASE_URL = SUPA_BASE;
  process.env.SUPABASE_SERVICE_KEY = 'unit-service-key';
  geminiQueue = [];
  geminiCalls = 0;
  gasCalls = 0;
  supabaseCalls = 0;
  gasMode = 'ok';
  supabaseMode = 'ok';
  lastGasBody = null;
  lastSupabaseBody = null;
  gasSeq = 0;
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GAS_URL;
  delete process.env.API_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

/* ---------- Validación ---------- */

test('GET → 405 Método no permitido', async () => {
  const { res, out } = makeRes();
  await handler(makeReq(null, 'GET'), res);
  assert.equal(out.code, 405);
  assert.equal(bodyAs(out).ok, false);
});

test('sin GEMINI_API_KEY → 503 con code NO_KEY (sin tocar nada)', async () => {
  delete process.env.GEMINI_API_KEY;
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 503);
  assert.equal(bodyAs(out).code, 'NO_KEY');
  assert.equal(geminiCalls, 0, 'no se llama a Gemini sin clave');
  assert.equal(gasCalls, 0, 'no se reparte nada sin clave');
});

test('texto vacío → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq({ text: '   ' }), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /vacío/);
});

/* ---------- Extracción + reparto + histórico ---------- */

test('extracción válida → 200 con tareas repartidas en Sheets e histórico en Supabase', async () => {
  geminiQueue.push(
    geminiOk(
      [{ titulo: 'Enviar la propuesta al cliente', fecha: '2026-11-06', hora: '10:00', responsable: 'Luis' }],
      'Reunión semanal',
      ['Mantener el precio actual']
    )
  );
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);

  const body = bodyAs(out);
  assert.equal(body.titulo, 'Reunión semanal');
  assert.deepEqual(body.acuerdos, ['Mantener el precio actual']);

  const tasks = body.tasks as Array<Record<string, string>>;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.titulo, 'Enviar la propuesta al cliente');
  assert.equal(tasks[0]?.fecha, '2026-11-06');
  assert.equal(tasks[0]?.hora, '10:00');
  assert.equal(tasks[0]?.responsable, 'Luis');
  assert.equal(tasks[0]?.estado, 'pendiente');
  assert.match(String(tasks[0]?.id), /^G-/, 'el id lo genera Apps Script');

  /* Reparto: UNA llamada bulk a Apps Script con las tareas saneadas */
  assert.equal(gasCalls, 1, 'el reparto es en el servidor');
  const gasBody = lastGasBody as { action?: string; tasks?: unknown[] } | null;
  assert.equal(gasBody?.action, 'bulk');
  assert.equal(gasBody?.tasks?.length, 1);

  /* Histórico: la minuta queda registrada en Supabase */
  assert.equal(supabaseCalls, 1);
  assert.equal(body.minutaId, 'M-1');
  const supaBody = lastSupabaseBody as {
    fecha?: string;
    fuente?: string;
    titulo?: string;
    acuerdos?: string[];
    tareas?: unknown[];
  } | null;
  assert.equal(supaBody?.fecha, '2026-11-05');
  assert.equal(supaBody?.fuente, 'ia');
  assert.deepEqual(supaBody?.acuerdos, ['Mantener el precio actual']);
  assert.equal(supaBody?.tareas?.length, 1);
});

test('campos vacíos/inválios caen en los defaults del payload', async () => {
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: 'no-fecha', hora: '', responsable: 'otro' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  const tasks = bodyAs(out).tasks as Array<Record<string, string>>;
  assert.equal(tasks[0]?.fecha, '2026-11-05', 'fecha inválida → default');
  assert.equal(tasks[0]?.responsable, 'José');
});

test('hora AM/PM se convierte a 24h y la basura queda vacía', async () => {
  geminiQueue.push(
    geminiOk([
      { titulo: 'A', fecha: '2026-11-05', hora: '3:30 PM', responsable: 'José' },
      { titulo: 'B', fecha: '2026-11-05', hora: '10:05', responsable: 'José' },
      { titulo: 'C', fecha: '2026-11-05', hora: 'mañana temprano', responsable: 'José' }
    ])
  );
  const { res, out } = makeRes();
  await handler(req(), res);
  const tasks = bodyAs(out).tasks as Array<Record<string, string>>;
  assert.equal(tasks[0]?.hora, '15:30');
  assert.equal(tasks[1]?.hora, '10:05');
  assert.equal(tasks[2]?.hora, '');
});

test('títulos: viñetas/numeración fuera y corte a 120 caracteres', async () => {
  const largo = 'L'.repeat(200);
  geminiQueue.push(
    geminiOk([
      { titulo: ' -  Enviar correo al cliente ', fecha: '2026-11-05', hora: '', responsable: 'José' },
      { titulo: '3) Llamar al proveedor', fecha: '2026-11-05', hora: '', responsable: 'José' },
      { titulo: largo, fecha: '2026-11-05', hora: '', responsable: 'José' },
      { titulo: '   ', fecha: '2026-11-05', hora: '', responsable: 'José' }
    ])
  );
  const { res, out } = makeRes();
  await handler(req(), res);
  const tasks = bodyAs(out).tasks as Array<Record<string, string>>;
  assert.equal(tasks.length, 3, 'la tarea vacía se descarta');
  assert.equal(tasks[0]?.titulo, 'Enviar correo al cliente');
  assert.equal(tasks[1]?.titulo, 'Llamar al proveedor');
  const tercera = tasks[2]?.titulo ?? '';
  assert.equal(tercera.length, 120);
});

test('máximo 20 tareas por minuta (MAX_TASKS)', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({
    titulo: 'Tarea ' + i,
    fecha: '2026-11-05',
    hora: '',
    responsable: 'José'
  }));
  geminiQueue.push(geminiOk(many));
  const { res, out } = makeRes();
  await handler(req(), res);
  const tasks = bodyAs(out).tasks as unknown[];
  assert.equal(tasks.length, 20);
});

test('acuerdos: viñetas fuera y tope de 10', async () => {
  const many = Array.from({ length: 14 }, (_, i) => ' - Acuerdo ' + i);
  geminiQueue.push(geminiOk([], 'Decisión de precio', many));
  const { res, out } = makeRes();
  await handler(req(), res);
  const acuerdos = bodyAs(out).acuerdos as string[];
  assert.equal(acuerdos.length, 10);
  assert.equal(acuerdos[0], 'Acuerdo 0');
  assert.equal(gasCalls, 0, 'sin action items no se reparte');
});

test('acepta JSON envuelto en bloques ```json (y la clave legada "tasks")', async () => {
  const inner = JSON.stringify({
    tasks: [{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]
  });
  const fenced = '```json\n' + inner + '\n```';
  geminiQueue.push({
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: fenced }] } }] }
  });
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);
  assert.equal((bodyAs(out).tasks as unknown[]).length, 1);
});

/* ---------- Errores de extracción (el frontend cae en modo líneas) ---------- */

test('reintenta SIN responseSchema si el modelo la rechaza (400 + "schema")', async () => {
  geminiQueue.push(geminiErr(400, 'responseSchema is not supported for this model'));
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);
  assert.equal(geminiCalls, 2, 'exactamente dos intentos');
});

test('error de Gemini SIN relación con schema → 502 sin reintentos ni reparto', async () => {
  geminiQueue.push(geminiErr(400, 'API key not valid'));
  const { res, out } = makeRes();
  await handler(makeReq({ text: 'x' }), res);
  assert.equal(out.code, 502);
  assert.match(String(bodyAs(out).error), /^Gemini:/);
  assert.equal(geminiCalls, 1, 'sin reintento para otros errores');
  assert.equal(gasCalls, 0, 'nada que repartir');
  assert.equal(supabaseCalls, 0, 'sin histórico si la extracción falla');
});

test('Gemini devuelve JSON irrelevante → 502 formato inesperado', async () => {
  geminiQueue.push({
    status: 200,
    body: { candidates: [{ content: { parts: [{ text: 'hola, no soy JSON' }] } }] }
  });
  const { res, out } = makeRes();
  await handler(makeReq({ text: 'x' }), res);
  assert.equal(out.code, 502);
  assert.match(String(bodyAs(out).error), /formato inesperado/);
});

test('la fecha por defecto es hoy (UTC YYYY-MM-DD) cuando no se envía', async () => {
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(makeReq({ text: 'x' }), res);
  const tasks = bodyAs(out).tasks as Array<Record<string, string>>;
  const esperada = new Date().toISOString().slice(0, 10);
  assert.equal(tasks[0]?.fecha, esperada);
});

/* ---------- Reparto en servidor (DISTRIBUTE_FAILED) ---------- */

test('Apps Script rechaza → 502 DISTRIBUTE_FAILED (el frontend reintenta, no crea duplicados)', async () => {
  gasMode = 'error';
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 502);
  assert.equal(bodyAs(out).code, 'DISTRIBUTE_FAILED');
  assert.match(String(bodyAs(out).error), /ocupada/);
  assert.equal(supabaseCalls, 0, 'sin histórico si el reparto falla');
});

test('Apps Script devuelve HTML (permisos/URL) → 502 DISTRIBUTE_FAILED', async () => {
  gasMode = 'html';
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 502);
  assert.equal(bodyAs(out).code, 'DISTRIBUTE_FAILED');
  assert.match(String(bodyAs(out).error), /JSON/);
});

test('GAS_URL sin configurar → 502 DISTRIBUTE_FAILED con instrucción clara', async () => {
  delete process.env.GAS_URL;
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 502);
  assert.equal(bodyAs(out).code, 'DISTRIBUTE_FAILED');
  assert.match(String(bodyAs(out).error), /GAS_URL/);
  assert.equal(gasCalls, 0);
});

/* ---------- Histórico en Supabase (best-effort) ---------- */

test('Supabase falla → la respuesta sigue 200 con minutaId null', async () => {
  supabaseMode = 'error';
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200, 'el histórico nunca rompe la respuesta');
  assert.equal(bodyAs(out).minutaId, null);
  assert.equal((bodyAs(out).tasks as unknown[]).length, 1);
  assert.equal(supabaseCalls, 1);
});

test('Supabase sin configurar → 200 sin registro histórico', async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);
  assert.equal(bodyAs(out).minutaId, null);
  assert.equal(supabaseCalls, 0, 'sin env no se intenta guardar');
});

test('minuta solo con acuerdos → se registra el histórico con tareas []', async () => {
  geminiQueue.push(geminiOk([], 'Decisión de precio', ['Se acordó mantener el precio']));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);
  assert.deepEqual(bodyAs(out).tasks, []);
  assert.equal(supabaseCalls, 1, 'los acuerdos también se archivan');
  const supaBody = lastSupabaseBody as { tareas?: unknown[] } | null;
  assert.deepEqual(supaBody?.tareas, []);
});

test('minuta sin tareas ni acuerdos → 200 sin reparto ni histórico', async () => {
  geminiQueue.push(geminiOk([], 'Sin novedad', []));
  const { res, out } = makeRes();
  await handler(req(), res);
  assert.equal(out.code, 200);
  assert.deepEqual(bodyAs(out).tasks, []);
  assert.deepEqual(bodyAs(out).acuerdos, []);
  assert.equal(bodyAs(out).minutaId, null);
  assert.equal(gasCalls, 0);
  assert.equal(supabaseCalls, 0, 'no se guardan minutas vacías');
});

/* ---------- Idempotencia ---------- */

test('misma idempotencyKey → una sola extracción y un solo reparto', async () => {
  geminiQueue.push(geminiOk([{ titulo: 'T', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  const r1 = makeRes();
  await handler(req({ idempotencyKey: 'idem-unit-1' }), r1.res);
  const r2 = makeRes();
  await handler(req({ idempotencyKey: 'idem-unit-1' }), r2.res);

  assert.equal(r1.out.code, 200);
  assert.equal(r2.out.code, 200);
  assert.equal(geminiCalls, 1, 'Gemini se llama una sola vez');
  assert.equal(gasCalls, 1, 'el reparto ocurre una sola vez');
  assert.equal(supabaseCalls, 1, 'un solo registro histórico');

  const t1 = bodyAs(r1.out).tasks as Array<Record<string, string>>;
  const t2 = bodyAs(r2.out).tasks as Array<Record<string, string>>;
  assert.deepEqual(t2, t1, 'la respuesta repetida devuelve las MISMAS tareas');
  assert.equal(bodyAs(r1.out).deduped, undefined, 'la primera no viene de caché');
  assert.equal(bodyAs(r2.out).deduped, true, 'la segunda viene de la caché');
});

test('keys distintas procesan minutas distintas', async () => {
  geminiQueue.push(geminiOk([{ titulo: 'A', fecha: '2026-11-05', hora: '', responsable: 'José' }]));
  geminiQueue.push(geminiOk([{ titulo: 'B', fecha: '2026-11-05', hora: '', responsable: 'Luis' }]));
  const r1 = makeRes();
  await handler(req({ idempotencyKey: 'idem-unit-a' }), r1.res);
  const r2 = makeRes();
  await handler(req({ idempotencyKey: 'idem-unit-b' }), r2.res);
  assert.equal(geminiCalls, 2, 'claves distintas → pipeline distinto');
  assert.equal(gasCalls, 2);
  const t1 = bodyAs(r1.out).tasks as Array<Record<string, string>>;
  const t2 = bodyAs(r2.out).tasks as Array<Record<string, string>>;
  assert.equal(t1[0]?.titulo, 'A');
  assert.equal(t2[0]?.titulo, 'B');
});
