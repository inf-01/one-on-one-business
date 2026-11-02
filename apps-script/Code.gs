/**
 * ============================================================
 * ONE ON ONE BUSINESS — Google Apps Script (Google Sheets como base de datos)
 * ============================================================
 * Pega este archivo en: Extensiones > Apps Script (dentro de tu hoja).
 *
 * PASOS:
 * 1. Cambia la constante API_KEY por tu propia clave secreta.
 * 2. Despliega: Implementar > Nueva implementación > Aplicación web
 *      - Ejecutar como: Yo
 *      - Quién tiene acceso: Cualquier persona
 * 3. Copia la URL pública (termina en /exec) → esa va en GAS_URL (Vercel).
 * 4. La misma API_KEY va en API_SECRET (Vercel).
 * NOTA: si modificas este script, vuelve a "Implementar > Administrar
 * implementaciones > Editar > Implementar" para generar una nueva versión.
 *
 * COLUMNAS DE LA HOJA "Tareas" (las crea automáticamente):
 *   A ID               → identificador único (ej. T-UUID)
 *   B Fecha            → fecha de la tarea, formato YYYY-MM-DD
 *   C Titulo           → texto de la tarea
 *   D Responsable      → "José" o "Luis"
 *   E Estado           → "pendiente" o "completada"
 *   F FechaCreacion    → ISO 8601 (ej. 2026-11-01T14:30:00.000Z)
 *   G FechaFinalizacion→ ISO 8601, se pone sola al completar; se borra al reabrir
 *   H Hora             → opcional, HH:MM (para las alarmas de 5 min)
 * ============================================================
 */

var SHEET_NAME = 'Tareas';
var API_KEY = 'ONE_ON_ONE_CAMBIA_ESTA_CLAVE'; // ⚠️ cámbiala por una clave propia
var HEADERS = ['ID', 'Fecha', 'Titulo', 'Responsable', 'Estado', 'FechaCreacion', 'FechaFinalizacion', 'Hora'];

/* ---------- Utilidades ---------- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) sh = ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(extra) { return json_(Object.assign({ ok: true }, extra || {})); }
function err_(msg) { return json_({ ok: false, error: msg }); }

function authorized_(e) {
  return !!(e && e.parameter && String(e.parameter.key) === String(API_KEY));
}

function rowToTask_(r) {
  return {
    id: String(r[0] || ''),
    fecha: String(r[1] || ''),
    titulo: String(r[2] || ''),
    responsable: String(r[3] || 'José'),
    estado: String(r[4] || 'pendiente'),
    fechaCreacion: String(r[5] || ''),
    fechaFinalizacion: String(r[6] || ''),
    hora: String(r[7] || '')
  };
}

function taskToRow_(t) {
  return [t.id, t.fecha, t.titulo, t.responsable, t.estado, t.fechaCreacion, t.fechaFinalizacion, t.hora];
}

function readAll_() {
  var sh = getSheet_();
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, 8).getValues();
  return values
    .filter(function (r) { return r[0] !== ''; })
    .map(rowToTask_);
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2; // fila real en la hoja
  }
  return -1;
}

function newId_() {
  return 'T-' + Utilities.getUuid();
}

function sanitize_(raw) {
  raw = raw || {};
  var responsable = String(raw.responsable || 'José');
  if (responsable !== 'Luis') responsable = 'José';
  return {
    id: raw.id || newId_(),
    fecha: String(raw.fecha || ''),
    titulo: String(raw.titulo || '').slice(0, 120),
    responsable: responsable,
    estado: raw.estado === 'completada' ? 'completada' : 'pendiente',
    fechaCreacion: raw.fechaCreacion || new Date().toISOString(),
    fechaFinalizacion: raw.fechaFinalizacion || '',
    hora: String(raw.hora || '')
  };
}

/* ---------- LECTURA (GET) ---------- */

function doGet(e) {
  if (!authorized_(e)) return err_('No autorizado');
  var action = (e.parameter.action || 'getTasks');
  if (action === 'getTasks') {
    return ok_({ tasks: readAll_() });
  }
  return err_('Acción no válida: ' + action);
}

/* ---------- ESCRITURA (POST) ---------- */

function doPost(e) {
  if (!authorized_(e)) return err_('No autorizado');

  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return err_('JSON inválido');
  }

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000); // evita escrituras simultáneas
  } catch (err) {
    return err_('La hoja está ocupada, intenta de nuevo');
  }

  try {
    var sh = getSheet_();
    var action = body.action;

    /* Crear una tarea */
    if (action === 'create') {
      var t = sanitize_(body.task);
      sh.appendRow(taskToRow_(t));
      return ok_({ task: t });
    }

    /* Crear muchas tareas (minuta / importar respaldo) */
    if (action === 'bulk') {
      var list = Array.isArray(body.tasks) ? body.tasks : [];
      if (!list.length) return err_('Lista vacía');
      var created = list.map(function (raw) { return sanitize_(raw); });
      var rows = created.map(taskToRow_);
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, 8).setValues(rows);
      return ok_({ tasks: created });
    }

    /* Actualizar (cambiar estado, título, fecha, responsable u hora) */
    if (action === 'update') {
      var row = findRow_(sh, body.id);
      if (row < 0) return err_('Tarea no encontrada');
      var current = rowToTask_(sh.getRange(row, 1, 1, 8).getValues()[0]);
      var c = body.changes || {};

      if (typeof c.titulo === 'string' && c.titulo.trim()) current.titulo = c.titulo.slice(0, 120);
      if (typeof c.fecha === 'string' && c.fecha) current.fecha = c.fecha;
      if (typeof c.responsable === 'string' && c.responsable) current.responsable = c.responsable === 'Luis' ? 'Luis' : 'José';
      if (typeof c.hora === 'string') current.hora = c.hora;
      if (typeof c.estado === 'string' && (c.estado === 'pendiente' || c.estado === 'completada')) {
        current.estado = c.estado;
        // La fecha de finalización se gestiona sola para la métrica de velocidad
        if (c.estado === 'completada') {
          current.fechaFinalizacion = c.fechaFinalizacion || new Date().toISOString();
        } else {
          current.fechaFinalizacion = '';
        }
      }
      sh.getRange(row, 1, 1, 8).setValues([taskToRow_(current)]);
      return ok_({ task: current });
    }

    /* Eliminar */
    if (action === 'delete') {
      var r = findRow_(sh, body.id);
      if (r < 0) return err_('Tarea no encontrada');
      sh.deleteRow(r);
      return ok_({ deleted: String(body.id) });
    }

    return err_('Acción no válida: ' + action);
  } finally {
    lock.releaseLock();
  }
}
