/* ============================================================
   ONE ON ONE BUSINESS — Dashboard de métricas
   - KPIs: completadas · en progreso · pendientes · total
   - Tabla ejecutiva de rendimiento por miembro registrado
   - Velocidad de finalización (FechaCreacion → FechaFinalizacion)
   ============================================================ */

import '../css/styles.css'; // Vite bundlea el CSS junto con este módulo
import { API, Auth, getSession, setSession, ApiError } from './api';
import { memberClass, memberNames } from './members';
import type { Profile, Task } from './types';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('Falta el elemento #' + id);
  return el as T;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* Restaurar el tema elegido en el calendario (mismo localStorage) */
try {
  const t = localStorage.getItem('neu_theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
} catch {
  /* sin almacenamiento disponible */
}

let profiles: Profile[] = [];

function avgHours(list: Task[]): number | null {
  const done = list.filter(t =>
    t.estado === 'completada' && t.fechaCreacion && t.fechaFinalizacion
  );
  if (!done.length) return null;
  let sum = 0;
  done.forEach(t => {
    const ms =
      new Date(t.fechaFinalizacion).getTime() - new Date(t.fechaCreacion).getTime();
    sum += Math.max(0, ms) / 3600000; // horas, sin valores negativos
  });
  return sum / done.length;
}

function fmtDuration(h: number | null): string {
  if (h === null || Number.isNaN(h)) return '—';
  if (h < 48) return h.toFixed(1) + ' h';
  return (h / 24).toFixed(1) + ' d';
}

/* Cuenta de un estado dentro de una lista */
function countEstado(list: Task[], estado: Task['estado']): number {
  return list.filter(t => t.estado === estado).length;
}

/* Fila de la tabla de rendimiento por miembro */
function userRow(user: string, tasks: Task[], names: string[]): string {
  const mine = tasks.filter(t => t.responsable === user);
  const done = countEstado(mine, 'completada');
  const progress = countEstado(mine, 'en progreso');
  const pending = countEstado(mine, 'pendiente');
  const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
  const key = memberClass(user, names);
  return `
    <tr>
      <td><span class="who"><span class="dotm ${key}"></span>${user}</span></td>
      <td class="num">${mine.length}</td>
      <td class="num">${done}</td>
      <td class="num">${progress}</td>
      <td class="num">${pending}</td>
      <td class="num">
        <div>${pct}%</div>
        <span class="mini"><i class="${key}" style="width:${pct}%"></i></span>
      </td>
    </tr>`;
}

function paintSpeedUsers(tasks: Task[], names: string[]): void {
  const wrap = $<HTMLElement>('speedUsers');
  wrap.textContent = '';
  // Mostrar hasta 4 miembros + resumen
  names.slice(0, 4).forEach(name => {
    const item = document.createElement('div');
    item.className = 'speed-item';
    const user = document.createElement('span');
    user.className = 'speed-user ' + memberClass(name, names);
    user.textContent = name.toUpperCase();
    const val = document.createElement('span');
    val.className = 'speed-val';
    val.textContent = fmtDuration(avgHours(tasks.filter(t => t.responsable === name)));
    item.append(user, val);
    wrap.appendChild(item);
  });
  if (names.length > 4) {
    const extra = document.createElement('div');
    extra.className = 'speed-item';
    extra.textContent = '+' + (names.length - 4) + ' miembros más';
    wrap.appendChild(extra);
  }
}

function paint(tasks: Task[]): void {
  const total = tasks.length;
  const done = countEstado(tasks, 'completada');
  const progress = countEstado(tasks, 'en progreso');
  const pending = countEstado(tasks, 'pendiente');
  const pctGlobal = total ? Math.round((done / total) * 100) : 0;
  const names = memberNames(profiles);

  $('statDone').textContent = String(done);
  $('statProgress').textContent = String(progress);
  $('statPending').textContent = String(pending);
  $('statTotal').textContent = String(total);
  $('globalFill').style.width = pctGlobal + '%';
  $('globalCount').textContent = done + '/' + total;

  /* Tabla ejecutiva: un renglón por miembro registrado */
  const rows = $('userRows');
  if (!names.length) {
    rows.innerHTML = '<tr><td colspan="6" class="empty">Sin usuarios registrados todavía</td></tr>';
  } else {
    rows.innerHTML = names.map(n => userRow(n, tasks, names)).join('');
  }

  /* Velocidad de finalización */
  $('speedAvg').textContent = fmtDuration(avgHours(tasks));
  paintSpeedUsers(tasks, names);

  $('dashNote').textContent =
    'Última actualización: ' + new Date().toLocaleString('es-ES');
}

async function load(): Promise<void> {
  const session = getSession();
  if (!session || !session.access_token) {
    $('dashNote').textContent = 'Inicia sesión en el calendario para ver las métricas.';
    showAuth(true);
    return;
  }
  $('dashNote').textContent = 'Sincronizando con la API…';
  try {
    const listData = await Auth.profiles();
    const list = (listData as unknown as { profiles?: Profile[] }).profiles;
    profiles = Array.isArray(list) ? list : [];
    const data = await API.getTasks();
    const tasks: Task[] = Array.isArray(data.tasks) ? data.tasks : [];
    paint(tasks);
    if (!tasks.length) {
      $('dashNote').textContent =
        'Sin tareas todavía. Crea una desde el calendario y vuelve aquí.';
    }
  } catch (err) {
    const code = err instanceof ApiError ? err.code : undefined;
    if (code === 'UNAUTHENTICATED') {
      setSession(null);
      $('dashNote').textContent = 'Tu sesión expiró. Inicia sesión en el calendario.';
      showAuth(true);
      return;
    }
    console.error('[dashboard] no se pudo cargar la API:', errMsg(err));
    $('dashNote').textContent = '⚠ No se pudo cargar la API: ' + errMsg(err);
  }
}

/* ---------- Auth gate de dashboard (misma estética .modal) ---------- */
const authOverlay = $<HTMLElement>('authOverlay');
const authEmail = $<HTMLInputElement>('authEmail');
const authPassword = $<HTMLInputElement>('authPassword');
const authNote = $<HTMLElement>('authNote');
const authSubmitBtn = $<HTMLButtonElement>('authSubmitBtn');
const authGoBtn = $<HTMLButtonElement>('authGoBtn');
function showAuth(open: boolean): void {
  authOverlay.classList.toggle('open', open);
  if (open) window.setTimeout(() => authEmail.focus(), 50);
}
authGoBtn.addEventListener('click', () => {
  location.href = 'index.html';
});
async function submitAuth(): Promise<void> {
  authNote.hidden = true;
  const email = authEmail.value.trim();
  const password = authPassword.value;
  if (!email || !password) {
    authNote.hidden = false;
    authNote.textContent = '⚠ Escribe tu correo y contraseña';
    return;
  }
  authSubmitBtn.disabled = true;
  try {
    const data = await Auth.login({ email, password });
    const payload = data as unknown as { session?: import('./types').Session };
    if (payload.session) {
      setSession(payload.session);
      showAuth(false);
      await load();
    } else {
      authNote.hidden = false;
      authNote.textContent = '⚠ No se pudo iniciar sesión';
    }
  } catch (e) {
    authNote.hidden = false;
    authNote.textContent = '⚠ ' + errMsg(e);
  } finally {
    authSubmitBtn.disabled = false;
  }
}
authSubmitBtn.addEventListener('click', () => void submitAuth());
authPassword.addEventListener('keydown', e => {
  if (e.key === 'Enter') void submitAuth();
});

$('refreshBtn').addEventListener('click', e => {
  e.preventDefault();
  void load();
});

void load();
