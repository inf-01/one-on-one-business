/* ============================================================
   ONE ON ONE BUSINESS — Dashboard de métricas
   - KPIs: completadas · en progreso · pendientes · total
   - Tabla ejecutiva de rendimiento por responsable
   - Velocidad de finalización (FechaCreacion → FechaFinalizacion)
   ============================================================ */

import { API } from './api';
import type { Task } from './types';

const USER_JOSE = 'José';
const USER_LUIS = 'Luis';

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

/* Fila de la tabla de rendimiento por responsable */
function userRow(user: string, tasks: Task[]): string {
  const mine = tasks.filter(t => t.responsable === user);
  const done = countEstado(mine, 'completada');
  const progress = countEstado(mine, 'en progreso');
  const pending = countEstado(mine, 'pendiente');
  const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
  const key = user === USER_LUIS ? 'luis' : 'jose';
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

function paint(tasks: Task[]): void {
  const total = tasks.length;
  const done = countEstado(tasks, 'completada');
  const progress = countEstado(tasks, 'en progreso');
  const pending = countEstado(tasks, 'pendiente');
  const pctGlobal = total ? Math.round((done / total) * 100) : 0;

  $('statDone').textContent = String(done);
  $('statProgress').textContent = String(progress);
  $('statPending').textContent = String(pending);
  $('statTotal').textContent = String(total);
  $('globalFill').style.width = pctGlobal + '%';
  $('globalCount').textContent = done + '/' + total;

  /* Tabla ejecutiva: José + Luis */
  $('userRows').innerHTML =
    userRow(USER_JOSE, tasks) + userRow(USER_LUIS, tasks);

  /* Velocidad de finalización */
  $('speedAvg').textContent = fmtDuration(avgHours(tasks));
  $('speedJose').textContent = fmtDuration(
    avgHours(tasks.filter(t => t.responsable === USER_JOSE))
  );
  $('speedLuis').textContent = fmtDuration(
    avgHours(tasks.filter(t => t.responsable === USER_LUIS))
  );

  $('dashNote').textContent =
    'Última actualización: ' + new Date().toLocaleString('es-ES');
}

async function load(): Promise<void> {
  $('dashNote').textContent = 'Sincronizando con la API…';
  try {
    const data = await API.getTasks();
    const tasks: Task[] = Array.isArray(data.tasks) ? data.tasks : [];
    paint(tasks);
    if (!tasks.length) {
      $('dashNote').textContent =
        'Sin tareas todavía. Crea una desde el calendario y vuelve aquí.';
    }
  } catch (err) {
    console.error('[dashboard] no se pudo cargar la API:', errMsg(err));
    $('dashNote').textContent = '⚠ No se pudo cargar la API: ' + errMsg(err);
  }
}

$('refreshBtn').addEventListener('click', e => {
  e.preventDefault();
  void load();
});

void load();
