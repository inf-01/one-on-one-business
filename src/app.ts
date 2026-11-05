/* ============================================================
   ONE ON ONE BUSINESS — Calendario SEMANAL (Dom–Sáb) con API en la nube
   - 7 días de la semana actual, ‹ › navegan entre semanas
   - Título con rango: "Sem 44: 27 Oct - 02 Nov"
   - Progreso GENERAL (toolbar) + PROGRESO PERSONAL (panel)
   - Colores: José = indigo · Luis = sky (ver styles.css)
   - Modal Minuta: pegar texto → Gemini (IA) crea las tareas
   - localStorage solo para preferencias de UI (tema/alarma/usuario)
   ============================================================ */

import '../css/styles.css'; // Vite bundlea el CSS junto con este módulo
import { API, ApiError } from './api';
import { drawIcon } from './icons';
import type { Estado, Task, TaskRaw } from './types';

const USER_JOSE = 'José';
const USER_LUIS = 'Luis';
const MON_SHORT = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

/* ---------- Helpers ---------- */
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('Falta el elemento #' + id);
  return el as T;
}

function $q<T extends HTMLElement>(root: ParentNode, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error('Falta el elemento ' + sel);
  return el;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

/* ---------- Preferencias de UI (solo tema/alarma/usuario) ----------
   Los DATOS del proyecto nunca se guardan en localStorage: van a la API. */
function prefGet(k: string, d: string | null): string | null {
  try {
    const v = localStorage.getItem(k);
    return v === null ? d : v;
  } catch {
    return d;
  }
}
function prefSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sin almacenamiento */
  }
}

/* ---------- Estado ---------- */
let tasks: Task[] = []; // tareas desde la API
let currentUser: 'José' | 'Luis' =
  prefGet('neu_active_user', USER_JOSE) === USER_LUIS ? USER_LUIS : USER_JOSE;

const today = new Date();
let viewWeek = weekStart(today); // domingo de la semana visible
let selected = fmt(today);

/* ---------- Fechas ---------- */
function fmt(d: Date): string {
  return (
    d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0')
  );
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function weekStart(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - r.getDay()); // Dom = 0
  return r;
}
/* Número de semana ISO de un día cualquiera */
function isoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function weekRangeText(): string {
  const end = addDays(viewWeek, 6);
  const n = isoWeekNumber(viewWeek);
  return (
    'Sem ' + n + ': ' + viewWeek.getDate() + ' ' + (MON_SHORT[viewWeek.getMonth()] ?? '') +
    ' - ' + end.getDate() + ' ' + (MON_SHORT[end.getMonth()] ?? '')
  );
}

/* ---------- Feriados de Costa Rica ---------- */
const holidayCache: Record<number, Set<string>> = {};
function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function getHolidays(year: number): Set<string> {
  const cached = holidayCache[year];
  if (cached) return cached;
  const easter = easterSunday(year);
  const set = new Set([
    year + '-01-01',
    fmt(addDays(easter, -3)),
    fmt(addDays(easter, -2)),
    year + '-04-11',
    year + '-05-01',
    year + '-07-25',
    year + '-08-02',
    year + '-08-15',
    year + '-09-15',
    year + '-12-25'
  ]);
  holidayCache[year] = set;
  return set;
}

/* ---------- Helpers de datos ---------- */
function tasksOn(dateKey: string): Task[] {
  return tasks.filter(t => t.fecha === dateKey);
}
function isDone(t: Task): boolean {
  return t.estado === 'completada';
}
/** Clase CSS del badge (sin espacios). */
function estadoClass(e: Estado): string {
  return e === 'en progreso' ? 'en-progreso' : e;
}
/** Texto visible del badge. */
function estadoLabel(e: Estado): string {
  return e === 'en progreso' ? 'En progreso' : e === 'completada' ? 'Completada' : 'Pendiente';
}
/** Ciclo de estados al tocar ✓: pendiente → en progreso → completada → pendiente. */
function nextEstado(e: Estado): Estado {
  if (e === 'pendiente') return 'en progreso';
  if (e === 'en progreso') return 'completada';
  return 'pendiente';
}

/* ---------- DOM ---------- */
const grid = $<HTMLDivElement>('grid');
const marqueeTrack = $<HTMLSpanElement>('marqueeTrack');
const selTitle = $<HTMLElement>('selTitle');
const eventList = $<HTMLElement>('eventList');
const generalFill = $<HTMLElement>('generalFill');
const generalCount = $<HTMLElement>('generalCount');
const personalFill = $<HTMLElement>('personalFill');
const personalCount = $<HTMLElement>('personalCount');
const personalLabel = $<HTMLElement>('personalLabel');

const toast = document.createElement('div');
toast.className = 'toast';
document.body.appendChild(toast);
let toastTimer: number | undefined;
function showToast(msg: string): void {
  toast.textContent = msg;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3500);
}

/* ---------- Iconos SVG corporativos (módulo icons.ts) ---------- */
drawIcon($<HTMLElement>('exportIcon'), 'download');
drawIcon($<HTMLElement>('importIcon'), 'upload');
drawIcon($<HTMLElement>('minutaIcon'), 'doc');
drawIcon($<HTMLElement>('dashIcon'), 'chart');
drawIcon($<HTMLElement>('dataRoomIcon'), 'doc');

/* ---------- Tema claro/oscuro (botón en el header) ---------- */
const themeBtn = $<HTMLButtonElement>('themeBtn');
const themeIcon = $<HTMLElement>('themeIcon');
function applyTheme(t: string | null): void {
  if (t) {
    document.documentElement.setAttribute('data-theme', t);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  const isLight =
    t === 'light' || (!t && window.matchMedia('(prefers-color-scheme: light)').matches);
  drawIcon(themeIcon, isLight ? 'sun' : 'moon');
}
applyTheme(prefGet('neu_theme', null));
themeBtn.addEventListener('click', () => {
  const current =
    document.documentElement.getAttribute('data-theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  prefSet('neu_theme', next);
});

/* ---------- Sonidos via Web Audio API ---------- */
let audioCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) audioCtx = new Ctor();
    } catch {
      /* sin audio disponible */
    }
  }
  return audioCtx;
}
function tone(freq: number, start: number, dur: number, type?: OscillatorType, gain?: number): void {
  const ctx = getCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, ctx.currentTime + start);
  g.gain.linearRampToValueAtTime(gain || 0.18, ctx.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(ctx.currentTime + start);
  osc.stop(ctx.currentTime + start + dur + 0.05);
}
function playSuccessSound(): void {
  tone(523.25, 0, 0.14, 'triangle');
  tone(659.25, 0.09, 0.14, 'triangle');
  tone(783.99, 0.18, 0.22, 'triangle');
}
function playAlarmSound(): void {
  tone(880, 0, 0.15, 'sine', 0.22);
  tone(880, 0.22, 0.15, 'sine', 0.22);
  tone(880, 0.44, 0.22, 'sine', 0.22);
}

/* ---------- Notificaciones / alarma 5 min antes ---------- */
const alarmBtn = $<HTMLButtonElement>('alarmBtn');
let alarmsOn = prefGet('neu_alarms', '0') === '1';
const notifiedIds = new Set<string>(); // en memoria: no se reavisa al recargar
const alarmIcon = $<HTMLElement>('alarmIcon');
function refreshAlarmBtn(): void {
  alarmBtn.classList.toggle('active', alarmsOn);
  drawIcon(alarmIcon, alarmsOn ? 'bell' : 'bellOff');
}
refreshAlarmBtn();
alarmBtn.addEventListener('click', async () => {
  if (!alarmsOn) {
    if ('Notification' in window && Notification.permission !== 'granted') {
      try {
        await Notification.requestPermission();
      } catch {
        /* permiso denegado */
      }
    }
    alarmsOn = true;
    showToast('Alarmas activadas: avisamos 5 min antes de cada tarea');
  } else {
    alarmsOn = false;
    showToast('Alarmas desactivadas');
  }
  prefSet('neu_alarms', alarmsOn ? '1' : '0');
  refreshAlarmBtn();
});
function triggerAlarm(t: Task): void {
  playAlarmSound();
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification('⏰ En 5 minutos: ' + t.titulo, { body: t.hora || '' });
    } catch {
      /* sin notificaciones */
    }
  }
  showToast('⏰ En 5 min: ' + t.titulo);
}
function checkAlarms(): void {
  if (!alarmsOn) return;
  const now = new Date();
  tasks.forEach(t => {
    if (!t.hora || isDone(t) || !t.id || notifiedIds.has(t.id) || !t.fecha) return;
    const evDate = new Date(t.fecha + 'T' + t.hora + ':00');
    const diffMs = evDate.getTime() - now.getTime();
    if (diffMs > 0 && diffMs <= 5 * 60 * 1000) {
      triggerAlarm(t);
      notifiedIds.add(t.id);
    }
  });
}
window.setInterval(checkAlarms, 20000);
checkAlarms();

/* ---------- Marquee: rango de la semana + tareas del día ---------- */
function updateMarquee(): void {
  const dayTasks = tasksOn(selected);
  let text = weekRangeText().toUpperCase();
  if (dayTasks.length) {
    const abbr = dayTasks.slice(0, 6).map(t => {
      const s = t.titulo.length > 16 ? t.titulo.slice(0, 16) + '…' : t.titulo;
      return (isDone(t) ? '✓ ' : '') + s + (t.hora ? ' ' + t.hora : '');
    }).join('   •   ');
    text += '   •   ' + abbr;
  }
  const full = text + '   •   ' + text;
  marqueeTrack.textContent = full;
  const dur = Math.max(8, text.length * 0.16);
  marqueeTrack.style.animationDuration = dur + 's';
}

/* ---------- Exportar / Importar respaldo (vía API) ---------- */
$<HTMLElement>('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(tasks, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'micro-tareas-respaldo.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('Respaldo descargado ✓');
});
$<HTMLInputElement>('importInput').addEventListener('change', e => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed: unknown = JSON.parse(String(reader.result));
      const list: TaskRaw[] = Array.isArray(parsed)
        ? (parsed as TaskRaw[])
        : ((parsed as { tasks?: TaskRaw[] } | null)?.tasks ?? []);
      if (!list.length) throw new Error('vacío');
      const payload = list.map(normalizeTask).filter(t => t.titulo);
      await API.bulkCreate(payload);
      await reload();
      render();
      showToast(payload.length + ' tareas importadas ✓');
    } catch {
      showToast('Archivo inválido');
    }
  };
  reader.readAsText(file);
  input.value = '';
});

/* ---------- Sincronización con la API ---------- */
function normalizeTask(raw: TaskRaw | undefined): Task {
  const src: TaskRaw = raw || {};
  return {
    id: src.id ?? null,
    fecha: String(src.fecha || selected),
    titulo: String(src.titulo || ''),
    responsable: src.responsable === USER_LUIS ? USER_LUIS : USER_JOSE,
    estado:
      src.estado === 'completada' || src.estado === 'en progreso'
        ? src.estado
        : 'pendiente',
    fechaCreacion: src.fechaCreacion || new Date().toISOString(),
    fechaFinalizacion: src.fechaFinalizacion || '',
    hora: String(src.hora || '')
  };
}
async function reload(): Promise<void> {
  try {
    const data = await API.getTasks();
    tasks = Array.isArray(data.tasks) ? data.tasks.map(normalizeTask) : [];
  } catch (err) {
    tasks = [];
    console.error('[app] no se pudo sincronizar:', errMsg(err));
    showToast('⚠ No se pudo sincronizar: ' + errMsg(err));
  }
}

/* ---------- Render: grid SEMANAL (7 celdas Dom–Sáb) ---------- */
function render(): void {
  updateMarquee();
  grid.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const cellDate = addDays(viewWeek, i);
    const key = fmt(cellDate);
    const isHoliday = getHolidays(cellDate.getFullYear()).has(key);

    const cell = document.createElement('div');
    cell.className = 'day' +
      (cellDate.getDay() === 0 ? ' wd0' : '') +
      (isHoliday ? ' holiday' : '') +
      (key === fmt(today) ? ' today' : '') +
      (key === selected ? ' selected' : '');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.dataset.date = key;

    const num = document.createElement('span');
    num.textContent = String(cellDate.getDate());
    cell.appendChild(num);

    const dayTasks = tasksOn(key);
    if (dayTasks.length) {
      const dots = document.createElement('div');
      dots.className = 'dots';
      dayTasks.slice(0, 3).forEach(t => {
        const d = document.createElement('span');
        d.className = 'dot ' + (t.responsable === USER_LUIS ? 'luis' : 'jose');
        dots.appendChild(d);
      });
      cell.appendChild(dots);
    }

    cell.addEventListener('click', () => {
      selected = key;
      render();
    });
    cell.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        cell.click();
      }
    });

    grid.appendChild(cell);
  }

  renderEvents();
}

/* ---------- Render: panel + barras de progreso ---------- */
function renderEvents(): void {
  const d = new Date(selected + 'T00:00:00');
  const label = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  selTitle.textContent = label.charAt(0).toUpperCase() + label.slice(1);

  const list = tasksOn(selected)
    .slice()
    .sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99'));
  eventList.innerHTML = '';

  /* GENERAL = José + Luis del día seleccionado */
  const gTotal = list.length;
  const gDone = list.filter(isDone).length;
  const gPct = gTotal ? Math.round((gDone / gTotal) * 100) : 0;
  generalFill.style.width = gPct + '%';
  generalCount.textContent = gDone + '/' + gTotal;

  /* PERSONAL = solo el usuario activo */
  const mine = list.filter(t => t.responsable === currentUser);
  const mTotal = mine.length;
  const mDone = mine.filter(isDone).length;
  const mPct = mTotal ? Math.round((mDone / mTotal) * 100) : 0;
  personalLabel.textContent = 'Progreso ' + currentUser;
  personalFill.className = 'progress-fill ' + (currentUser === USER_LUIS ? 'luis' : 'jose');
  personalFill.style.width = mPct + '%';
  personalCount.textContent = mDone + '/' + mTotal;

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No hay eventos este día. Toca + para agregar uno.';
    eventList.appendChild(empty);
    return;
  }

  list.forEach(t => {
    const row = document.createElement('div');
    row.className =
      'neu-inset event' +
      (isDone(t) ? ' done' : t.estado === 'en progreso' ? ' progreso' : '');
    row.innerHTML = `
      <div class="check" aria-label="Cambiar estado">${isDone(t) ? '✓' : t.estado === 'en progreso' ? '◐' : ''}</div>
      <div class="bar ${t.responsable === USER_LUIS ? 'luis' : 'jose'}"></div>
      <div class="info">
        <div class="t"></div>
        <div class="h"></div>
      </div>
      <span class="badge ${estadoClass(t.estado)}">${estadoLabel(t.estado)}</span>
      <button class="neu-btn del" aria-label="Eliminar evento">✕</button>
    `;
    $q<HTMLElement>(row, '.t').textContent = t.titulo;
    $q<HTMLElement>(row, '.h').textContent =
      t.responsable + ' · ' + (t.hora ? t.hora : 'Todo el día');

    $q<HTMLElement>(row, '.check').addEventListener('click', async () => {
      if (!t.id) return;
      const next: Estado = nextEstado(t.estado);
      try {
        const data = await API.updateTask(t.id, { estado: next });
        Object.assign(t, normalizeTask({ ...t, ...data.task }));
        if (isDone(t)) playSuccessSound();
        render();
        if (isDone(t) && mTotal > 0 && mDone + 1 === mTotal) {
          window.setTimeout(() => {
            tone(1046.5, 0, 0.12, 'triangle');
            tone(1318.5, 0.1, 0.12, 'triangle');
            tone(1568, 0.2, 0.12, 'triangle');
            showToast('🎉 ¡Todas las tareas completadas!');
          }, 150);
        }
      } catch (err) {
        showToast('⚠ ' + errMsg(err));
        await reload();
        render();
      }
    });

    $q<HTMLElement>(row, '.del').addEventListener('click', async () => {
      if (!t.id) return;
      try {
        await API.deleteTask(t.id);
        tasks = tasks.filter(x => x.id !== t.id);
        render();
        showToast('Tarea eliminada ✓');
      } catch (err) {
        showToast('⚠ ' + errMsg(err));
        await reload();
        render();
      }
    });

    eventList.appendChild(row);
  });
}

/* ---------- Navegación semanal ---------- */
$<HTMLButtonElement>('prevBtn').addEventListener('click', () => {
  viewWeek = addDays(viewWeek, -7);
  render();
});
$<HTMLButtonElement>('nextBtn').addEventListener('click', () => {
  viewWeek = addDays(viewWeek, 7);
  render();
});
$<HTMLButtonElement>('todayBtn').addEventListener('click', () => {
  viewWeek = weekStart(today);
  selected = fmt(today);
  render();
});

/* ---------- Dashboard ---------- */
$<HTMLElement>('dashBtn').addEventListener('click', () => {
  location.href = 'dashboard.html';
});

/* ---------- Data Room (documentos y minutas) ---------- */
$<HTMLElement>('dataRoomBtn').addEventListener('click', () => {
  location.href = 'data-room.html';
});

/* ---------- Selector de usuario (panel personal) ---------- */
const userToggle = $<HTMLElement>('userToggle');
function paintUserToggle(): void {
  userToggle.querySelectorAll<HTMLButtonElement>('.user-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.user === currentUser);
  });
}
userToggle.addEventListener('click', e => {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest<HTMLButtonElement>('.user-chip');
  if (!btn) return;
  currentUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
  prefSet('neu_active_user', currentUser);
  paintUserToggle();
  renderEvents();
});
paintUserToggle();

/* ---------- Modal: nuevo evento ---------- */
const overlay = $<HTMLElement>('overlay');
const evTitle = $<HTMLInputElement>('evTitle');
const evTime = $<HTMLInputElement>('evTime');
const evUserToggle = $<HTMLElement>('evUserToggle');
const saveBtn = $<HTMLButtonElement>('saveBtn');
let evUser: 'José' | 'Luis' = currentUser;

function paintEvUser(): void {
  evUserToggle.querySelectorAll<HTMLButtonElement>('.user-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.user === evUser);
  });
}
evUserToggle.addEventListener('click', e => {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest<HTMLButtonElement>('.user-chip');
  if (!btn) return;
  evUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
  paintEvUser();
});

$<HTMLButtonElement>('addBtn').addEventListener('click', () => {
  evTitle.value = '';
  evTime.value = '';
  evUser = currentUser;
  paintEvUser();
  overlay.classList.add('open');
  window.setTimeout(() => evTitle.focus(), 50);
});
$<HTMLButtonElement>('cancelBtn').addEventListener('click', () => overlay.classList.remove('open'));
overlay.addEventListener('click', e => {
  if (e.target === overlay) overlay.classList.remove('open');
});

saveBtn.addEventListener('click', async () => {
  const title = evTitle.value.trim();
  if (!title) {
    evTitle.focus();
    return;
  }
  const task = normalizeTask({
    fecha: selected,
    titulo: title,
    responsable: evUser,
    estado: 'pendiente',
    fechaCreacion: new Date().toISOString(),
    hora: evTime.value || ''
  });
  try {
    const data = await API.createTask(task);
    tasks.push(normalizeTask(data.task));
    overlay.classList.remove('open');
    render();
    showToast('Tarea agregada ✓');
  } catch (err) {
    showToast('⚠ ' + errMsg(err));
  }
});
evTitle.addEventListener('keydown', e => {
  if (e.key === 'Enter') saveBtn.click();
});

/* ---------- Modal: MINUTA (pegar texto → API) ---------- */
const minutaOverlay = $<HTMLElement>('minutaOverlay');
const minutaForm = $<HTMLElement>('minutaForm');
const minutaText = $<HTMLTextAreaElement>('minutaText');
const minutaUserToggle = $<HTMLElement>('minutaUserToggle');
const minutaProcessBtn = $<HTMLButtonElement>('minutaProcessBtn');
const minutaResult = $<HTMLElement>('minutaResult');
const minutaResultTitle = $<HTMLElement>('minutaResultTitle');
const minutaAcuerdosWrap = $<HTMLElement>('minutaAcuerdosWrap');
const minutaAcuerdos = $<HTMLElement>('minutaAcuerdos');
const minutaResultTasks = $<HTMLElement>('minutaResultTasks');
const minutaResultNote = $<HTMLElement>('minutaResultNote');
const minutaDoneBtn = $<HTMLButtonElement>('minutaDoneBtn');
let minutaUser: 'José' | 'Luis' = currentUser;
let minutaIdem = '';

/** Clave única por apertura del modal: los reintentos la reutilizan
 *  (el servidor no duplica tareas) y cada minuta nueva trae una clave nueva. */
function newIdemKey(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    /* sin crypto disponible */
  }
  return 'idem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function paintMinutaUser(): void {
  minutaUserToggle.querySelectorAll<HTMLButtonElement>('.user-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.user === minutaUser);
  });
}
minutaUserToggle.addEventListener('click', e => {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest<HTMLButtonElement>('.user-chip');
  if (!btn) return;
  minutaUser = btn.dataset.user === USER_LUIS ? USER_LUIS : USER_JOSE;
  paintMinutaUser();
});

function showMinutaForm(): void {
  minutaForm.hidden = false;
  minutaResult.hidden = true;
}

function closeMinuta(): void {
  minutaOverlay.classList.remove('open');
  showMinutaForm(); // deja el modal listo para la próxima minuta
}

$<HTMLElement>('minutaBtn').addEventListener('click', () => {
  minutaText.value = '';
  minutaUser = currentUser;
  paintMinutaUser();
  minutaIdem = newIdemKey();
  showMinutaForm();
  minutaOverlay.classList.add('open');
  window.setTimeout(() => minutaText.focus(), 50);
});
minutaDoneBtn.addEventListener('click', closeMinuta);
$<HTMLButtonElement>('minutaCancelBtn').addEventListener('click', closeMinuta);
minutaOverlay.addEventListener('click', e => {
  if (e.target === minutaOverlay) closeMinuta();
});

/* Panel de resultado: acuerdos + tareas creadas (o aviso de modo líneas) */
function showMinutaResult(r: {
  titulo: string;
  acuerdos: string[];
  created: Task[];
  note: string;
}): void {
  minutaResultTitle.textContent = r.titulo || 'Minuta procesada';

  minutaAcuerdosWrap.hidden = r.acuerdos.length === 0;
  minutaAcuerdos.textContent = '';
  r.acuerdos.forEach(a => {
    const li = document.createElement('li');
    li.textContent = a;
    minutaAcuerdos.appendChild(li);
  });

  minutaResultTasks.textContent = '';
  r.created.forEach(t => {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dotm ' + (t.responsable === USER_LUIS ? 'luis' : 'jose');
    const title = document.createElement('span');
    title.className = 'mr-title';
    title.textContent = t.titulo;
    const meta = document.createElement('span');
    meta.className = 'mr-meta';
    meta.textContent = t.fecha + (t.hora ? ' · ' + t.hora : '') + ' · ' + t.responsable;
    li.append(dot, title, meta);
    minutaResultTasks.appendChild(li);
  });

  minutaResultNote.hidden = !r.note;
  minutaResultNote.textContent = r.note
    ? '⚠ ' + r.note + ' → tareas creadas en modo líneas'
    : '';

  minutaForm.hidden = true;
  minutaResult.hidden = false;
  minutaDoneBtn.focus();
}

minutaProcessBtn.addEventListener('click', async () => {
  const raw = minutaText.value.trim();
  if (!raw) {
    minutaText.focus();
    showToast('Pega al menos una línea de texto');
    return;
  }

  const btn = minutaProcessBtn;
  const labelOriginal = btn.textContent ?? '';
  btn.disabled = true;
  btn.textContent = 'Procesando…';

  try {
    let created: Task[] = [];
    let acuerdos: string[] = [];
    let titulo = '';
    let note = '';

    try {
      /* 1) El servidor extrae con IA y reparte EN EL SERVIDOR (Google Sheets) */
      const data = await API.processMinuta({
        text: raw,
        responsable: minutaUser,
        fecha: selected,
        hoy: fmt(today),
        idempotencyKey: minutaIdem
      });
      created = (data.tasks ?? []).map(t => normalizeTask(t));
      acuerdos = Array.isArray(data.acuerdos) ? data.acuerdos : [];
      titulo = typeof data.titulo === 'string' ? data.titulo : '';
    } catch (iaErr) {
      const code = iaErr instanceof ApiError ? iaErr.code : undefined;
      /* El reparto falló en el servidor: NO hay respaldo de líneas (crearía
         duplicados o fallaría igual). Se avisa y se puede reintentar con la
         MISMA idempotencyKey → el servidor no duplica. */
      if (code === 'DISTRIBUTE_FAILED') throw iaErr;
      /* Sin IA (sin clave o error de extracción) → respaldo: una tarea por línea */
      note = code === 'NO_KEY' ? 'IA sin configurar en Vercel' : 'IA no disponible';
      const nowIso = new Date().toISOString();
      const payload = raw
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .map(line =>
          normalizeTask({
            fecha: selected,
            titulo: line.slice(0, 120),
            responsable: minutaUser,
            estado: 'pendiente',
            fechaCreacion: nowIso,
            hora: ''
          })
        );
      const data = await API.bulkCreate(payload);
      created = (data.tasks ?? []).map(t => normalizeTask(t));
    }

    if (!created.length && !acuerdos.length) {
      showToast('No se detectaron tareas en el texto');
      return;
    }

    created.forEach(t => tasks.push(t));
    render();
    showMinutaResult({ titulo, acuerdos, created, note });
    showToast(
      note
        ? '⚠ ' + note + ' → ' + created.length + ' tareas por líneas'
        : created.length
          ? created.length + ' tareas creadas desde la minuta ✓'
          : 'Minuta registrada: solo acuerdos, sin tareas ✓'
    );
  } catch (err) {
    showToast('⚠ ' + errMsg(err));
  } finally {
    btn.disabled = false;
    btn.textContent = labelOriginal;
  }
});
minutaText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) minutaProcessBtn.click();
  if (e.key === 'Escape') closeMinuta();
});

/* ---------- Init ---------- */
void (async function init(): Promise<void> {
  await reload();
  render();
})();
