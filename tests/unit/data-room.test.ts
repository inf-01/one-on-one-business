/* ============================================================
   Tests unitarios de /api/data-room (sin red: fetch simulado)
   Cubren: validación estricta (15 MB, mime, categoría, uuid,
   nombre hostil), firma de subida, confirmación, descarga,
   borrado, creación de proyectos y degradación sin Supabase.
   Ejecutar: npm run test:unit
   ============================================================ */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/data-room';

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

function makeReq(method: string, body?: unknown, query?: Record<string, string>): Req {
  return {
    method,
    body,
    query: query ?? {},
    headers: {},
    url: '/api/data-room'
  } as unknown as Req;
}

function bodyAs(out: TestOut): Record<string, unknown> {
  assert.ok(out.body && typeof out.body === 'object', 'el body debe ser un objeto');
  return out.body as Record<string, unknown>;
}

/* ---------- Simulación de red: PostgREST + Storage ---------- */
const realFetch = globalThis.fetch;
const BASE = 'https://unit.supabase.co';
const UUID = '550e8400-e29b-41d4-a716-446655440000';
const DOC_ID = '11111111-2222-3333-4444-555555555555';

let lastUrl = '';
let bucketList: unknown[] = [];
let bucketCreateCalls = 0;
let infoSize = 1234;
let infoStatus = 200;
let docs: Array<Record<string, unknown>> = [];
let projectCreateCalls = 0;
let projectCreateStatus = 201;
let insertCalls = 0;
let lastInsertBody: Record<string, unknown> | null = null;
let rowDeleteCalls = 0;
let storageDeleteCalls = 0;
let lastDeletePrefixes: unknown = null;

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function parseBody(init?: RequestInit): Record<string, unknown> | null {
  try {
    const b = JSON.parse(String(init?.body ?? '{}')) as unknown;
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function installFetchMock(): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    lastUrl = url;

    /* ----- PostgREST (tablas) ----- */
    if (url.includes('/rest/v1/')) {
      const rest = url.split('/rest/v1/')[1] ?? '';
      const table = rest.split('?')[0];

      if (table === 'projects') {
        if (init?.method === 'POST') {
          projectCreateCalls++;
          if (projectCreateStatus === 409) {
            return jsonRes(409, { code: '23505', message: 'duplicate key value' });
          }
          const b = parseBody(init);
          return jsonRes(201, [{ id: UUID, name: b?.name, created_at: '2026-11-05T00:00:00Z' }]);
        }
        return jsonRes(200, [{ id: UUID, name: 'Proyecto Demo', created_at: '2026-11-01T00:00:00Z' }]);
      }

      if (table === 'documents') {
        if (init?.method === 'POST') {
          insertCalls++;
          lastInsertBody = parseBody(init);
          return jsonRes(201, [{ id: DOC_ID, uploaded_at: '2026-11-05T12:00:00Z', ...lastInsertBody }]);
        }
        if (init?.method === 'DELETE') {
          rowDeleteCalls++;
          return new Response(null, { status: 204 });
        }
        if (url.includes('&id=eq.')) {
          const id = url.split('id=eq.')[1]?.split('&')[0] ?? '';
          const row = docs.find(d => d.id === id);
          return jsonRes(200, row ? [row] : []);
        }
        return jsonRes(200, docs);
      }

      if (table === 'minutas') {
        return jsonRes(200, [
          {
            id: 'm-1',
            project_id: null,
            fecha: '2026-11-04',
            titulo: 'Reunión semanal',
            fuente: 'ia',
            acuerdos: ['Mantener el precio'],
            tareas: [{ titulo: 'T' }],
            created_at: '2026-11-04T10:00:00Z'
          }
        ]);
      }

      return jsonRes(404, { message: 'not found' });
    }

    /* ----- Storage ----- */
    if (url.includes('/storage/v1/')) {
      if (url.endsWith('/storage/v1/bucket')) {
        if (init?.method === 'POST') {
          bucketCreateCalls++;
          const b = parseBody(init);
          return jsonRes(201, { name: b?.name, public: false });
        }
        return jsonRes(200, bucketList);
      }

      if (url.includes('/object/upload/sign/')) {
        const after = url.split('/object/upload/sign/documentos/')[1] ?? '';
        return jsonRes(200, {
          url: '/object/upload/sign/documentos/' + after + '?token=tok-abc'
        });
      }

      if (url.includes('/object/info/')) {
        if (infoStatus !== 200) return jsonRes(infoStatus, { message: 'Object not found' });
        return jsonRes(200, { name: 'archivo', size: infoSize });
      }

      if (url.includes('/object/sign/')) {
        return jsonRes(200, { signedURL: '/object/sign/documentos/x.pdf?token=tok-dl' });
      }

      if (init?.method === 'DELETE') {
        storageDeleteCalls++;
        lastDeletePrefixes = parseBody(init)?.prefixes;
        return jsonRes(200, {});
      }

      return jsonRes(404, { message: 'not found' });
    }

    throw new Error('fetch inesperado en el test: ' + url);
  }) as typeof fetch;
}

beforeEach(() => {
  process.env.SUPABASE_URL = BASE;
  process.env.SUPABASE_SERVICE_KEY = 'unit-service-key';
  lastUrl = '';
  bucketList = [{ name: 'documentos' }];
  bucketCreateCalls = 0;
  infoSize = 1234;
  infoStatus = 200;
  docs = [];
  projectCreateCalls = 0;
  projectCreateStatus = 201;
  insertCalls = 0;
  lastInsertBody = null;
  rowDeleteCalls = 0;
  storageDeleteCalls = 0;
  lastDeletePrefixes = null;
  installFetchMock();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
});

/* ---------- Degradación y métodos ---------- */

test('sin SUPABASE_URL/SERVICE_KEY → 503 NO_SUPABASE', async () => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_KEY;
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'projects' }), res);
  assert.equal(out.code, 503);
  assert.equal(bodyAs(out).code, 'NO_SUPABASE');
});

test('PUT → 405 Método no permitido', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('PUT'), res);
  assert.equal(out.code, 405);
});

test('GET acción desconocida → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'volar' }), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /Acción no válida/);
});

test('POST acción desconocida → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'borrarTodo' }), res);
  assert.equal(out.code, 400);
});

/* ---------- Listados ---------- */

test('GET projects → 200 con la lista', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'projects' }), res);
  assert.equal(out.code, 200);
  const projects = bodyAs(out).projects as Array<Record<string, string>>;
  assert.equal(projects.length, 1);
  assert.equal(projects[0]?.name, 'Proyecto Demo');
});

test('GET documents sin projectId → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'documents' }), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /projectId/);
});

test('GET documents con projectId → filtra por proyecto', async () => {
  docs = [{ id: DOC_ID, project_id: UUID, filename: 'a.pdf', path: 'p', size: 1, mime: 'application/pdf', category: 'Otros', uploaded_at: 'x' }];
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'documents', projectId: UUID }), res);
  assert.equal(out.code, 200);
  assert.ok(lastUrl.includes('project_id=eq.' + UUID), 'la query filtra por proyecto');
  assert.ok(lastUrl.includes('order=uploaded_at.desc'));
  assert.equal((bodyAs(out).documents as unknown[]).length, 1);
});

test('GET minutas → 200 con el histórico', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('GET', undefined, { action: 'minutas' }), res);
  assert.equal(out.code, 200);
  const minutas = bodyAs(out).minutas as Array<Record<string, unknown>>;
  assert.equal(minutas.length, 1);
  assert.equal(minutas[0]?.titulo, 'Reunión semanal');
});

/* ---------- sign: validación estricta ---------- */

function signBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'sign',
    projectId: UUID,
    filename: 'informe_final.pdf',
    size: 2048,
    mime: '',
    category: 'Informes',
    ...over
  };
}

test('sign válido → URL firmada y ruta projects/{uuid}/{ts}_{archivo}', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody()), res);
  assert.equal(out.code, 200);
  const body = bodyAs(out);
  const path = String(body.path);
  assert.match(path, /^projects\/550e8400-e29b-41d4-a716-446655440000\/\d+_informe_final\.pdf$/);
  assert.ok(String(body.uploadUrl).startsWith(BASE + '/storage/v1/object/upload/sign/documentos/'));
  assert.ok(String(body.uploadUrl).includes('token=tok-abc'));
  assert.equal(body.filename, 'informe_final.pdf');
  assert.equal(body.mime, 'application/pdf', 'mime vacío → se infiere de la extensión');
  assert.equal(body.category, 'Informes');
});

test('sign >15 MB → 413 TOO_LARGE (nunca llega a Storage)', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody({ size: 16 * 1024 * 1024 })), res);
  assert.equal(out.code, 413);
  assert.equal(bodyAs(out).code, 'TOO_LARGE');
  assert.equal(bucketCreateCalls, 0);
});

test('sign mime no permitido → 415 UNSUPPORTED', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody({ filename: 'setup.exe', mime: 'application/x-msdownload' })), res);
  assert.equal(out.code, 415);
  assert.equal(bodyAs(out).code, 'UNSUPPORTED');
});

test('sign projectId inválido → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody({ projectId: '../../otro' })), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /projectId/);
});

test('sign categoría fuera de la lista → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody({ category: 'Hackeo' })), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /Categoría/);
});

test('sign con nombre hostil → sin separadores ni path traversal', async () => {
  const { res, out } = makeRes();
  await handler(
    makeReq('POST', signBody({ filename: '../../etc/passwd.pdf', mime: 'application/pdf' })),
    res
  );
  assert.equal(out.code, 200);
  const path = String(bodyAs(out).path);
  assert.ok(!path.includes('..'), 'sin ".." en la ruta');
  assert.equal(path.split('/').length, 3, 'exactamente projects/uuid/archivo');
  assert.equal(String(bodyAs(out).filename), 'etc_passwd.pdf');
});

test('sign crea el bucket si no existe', async () => {
  bucketList = [];
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody()), res);
  assert.equal(out.code, 200);
  assert.equal(bucketCreateCalls, 1, 'se crea una sola vez');
});

test('sign no recrea un bucket que ya existe', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', signBody()), res);
  assert.equal(out.code, 200);
  assert.equal(bucketCreateCalls, 0);
});

/* ---------- confirm ---------- */

function confirmBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'confirm',
    projectId: UUID,
    path: 'projects/' + UUID + '/1730000000000_informe_final.pdf',
    filename: 'informe_final.pdf',
    size: 2048,
    mime: 'application/pdf',
    category: 'Informes',
    ...over
  };
}

test('confirm correcto → verifica Storage y registra la fila', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', confirmBody()), res);
  assert.equal(out.code, 200);
  const doc = bodyAs(out).document as Record<string, unknown>;
  assert.equal(doc.id, DOC_ID);
  assert.equal(insertCalls, 1);
  assert.equal(lastInsertBody?.project_id, UUID);
  assert.equal(lastInsertBody?.filename, 'informe_final.pdf');
  assert.equal(lastInsertBody?.size, 1234, 'se registra el tamaño REAL de Storage');
  assert.equal(lastInsertBody?.mime, 'application/pdf');
  assert.equal(lastInsertBody?.category, 'Informes');
});

test('confirm con ruta de otro proyecto → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', confirmBody({ path: 'projects/otro-uuid/archivo.pdf' })), res);
  assert.equal(out.code, 400);
  assert.match(String(bodyAs(out).error), /Ruta/);
  assert.equal(insertCalls, 0);
});

test('confirm pero el archivo no llegó a Storage → 404', async () => {
  infoStatus = 404;
  const { res, out } = makeRes();
  await handler(makeReq('POST', confirmBody()), res);
  assert.equal(out.code, 404);
  assert.equal(insertCalls, 0, 'sin fila si no hay archivo');
});

test('confirm con archivo de 16 MB en Storage → 413 y limpia el objeto', async () => {
  infoSize = 16 * 1024 * 1024;
  const { res, out } = makeRes();
  await handler(makeReq('POST', confirmBody()), res);
  assert.equal(out.code, 413);
  assert.equal(insertCalls, 0);
  assert.equal(storageDeleteCalls, 1, 'el objeto que excede se elimina');
  assert.deepEqual(lastDeletePrefixes, ['projects/' + UUID + '/1730000000000_informe_final.pdf']);
});

/* ---------- createProject ---------- */

test('createProject ok → 200 con el proyecto creado', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'createProject', name: '  Cliente   Norte  ' }), res);
  assert.equal(out.code, 200);
  const project = bodyAs(out).project as Record<string, unknown>;
  assert.equal(project.name, 'Cliente Norte', 'espacios normalizados');
  assert.equal(projectCreateCalls, 1);
});

test('createProject duplicado (409) → mensaje claro', async () => {
  projectCreateStatus = 409;
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'createProject', name: 'Cliente Norte' }), res);
  assert.equal(out.code, 409);
  assert.equal(bodyAs(out).code, 'DUPLICATE');
  assert.match(String(bodyAs(out).error), /Ya existe/);
});

test('createProject sin nombre → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'createProject', name: '   ' }), res);
  assert.equal(out.code, 400);
  assert.equal(projectCreateCalls, 0);
});

/* ---------- downloadUrl ---------- */

test('downloadUrl → URL firmada con parámetro de descarga', async () => {
  docs = [{ id: DOC_ID, path: 'projects/' + UUID + '/1_a.pdf', filename: 'informe_final.pdf' }];
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'downloadUrl', documentId: DOC_ID }), res);
  assert.equal(out.code, 200);
  const url = String(bodyAs(out).url);
  assert.ok(url.startsWith(BASE + '/storage/v1/object/sign/documentos/'));
  assert.ok(url.includes('token=tok-dl'));
  assert.ok(url.includes('download=informe_final.pdf'), 'descarga con nombre legible');
});

test('downloadUrl con id inválido → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'downloadUrl', documentId: 'no-uuid' }), res);
  assert.equal(out.code, 400);
});

test('downloadUrl de un documento inexistente → 404', async () => {
  docs = [];
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'downloadUrl', documentId: DOC_ID }), res);
  assert.equal(out.code, 404);
});

/* ---------- delete ---------- */

test('delete → borra el objeto en Storage y la fila', async () => {
  docs = [{ id: DOC_ID, path: 'projects/' + UUID + '/1_a.pdf', filename: 'a.pdf' }];
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'delete', documentId: DOC_ID }), res);
  assert.equal(out.code, 200);
  assert.equal(storageDeleteCalls, 1);
  assert.deepEqual(lastDeletePrefixes, ['projects/' + UUID + '/1_a.pdf']);
  assert.equal(rowDeleteCalls, 1);
});

test('delete con id inválido → 400', async () => {
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'delete', documentId: 'x' }), res);
  assert.equal(out.code, 400);
  assert.equal(rowDeleteCalls, 0);
});

test('delete de un documento inexistente → 404', async () => {
  docs = [];
  const { res, out } = makeRes();
  await handler(makeReq('POST', { action: 'delete', documentId: DOC_ID }), res);
  assert.equal(out.code, 404);
  assert.equal(storageDeleteCalls, 0, 'no se borra nada si no existe');
});
