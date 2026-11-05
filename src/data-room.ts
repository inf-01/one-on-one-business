/* ============================================================
   ONE ON ONE BUSINESS — Data Room
   - Selector de proyectos (crear / cambiar)
   - Subida DIRECTA a Supabase Storage con URL firmada
     (15 MB, categorías fijas, nombre saneado en el servidor)
   - Tabla de documentos: descargar / eliminar
   - Histórico de minutas: fecha, título, tareas y acuerdos
   - Tema claro/oscuro compartido con el calendario
   ============================================================ */

import { ApiError, DataRoom as DR } from './api';
import { drawIcon } from './icons';
import type { DocumentRow, MinutaRow, Project } from './types';

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB (misma regla que el servidor)
const EXT_OK = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'ppt', 'pptx'
];

/* ---------- Helpers ---------- */
function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error('Falta el elemento #' + id);
  return el as T;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* Preferencias de UI (solo tema): los datos siempre van a la API */
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

/* Toast (mismo patrón que el calendario) */
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

/* ---------- Tema claro/oscuro (mismo localStorage que index) ---------- */
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

/* ---------- Elementos ---------- */
const projectSelect = $<HTMLSelectElement>('projectSelect');
const newProjectBtn = $<HTMLButtonElement>('newProjectBtn');
const drNote = $<HTMLElement>('drNote');

const uploadZone = $<HTMLElement>('uploadZone');
const fileInput = $<HTMLInputElement>('fileInput');
const categorySelect = $<HTMLSelectElement>('categorySelect');
const uploadProgress = $<HTMLElement>('uploadProgress');
const uploadFill = $<HTMLElement>('uploadFill');
const uploadStatus = $<HTMLElement>('uploadStatus');

const docRows = $<HTMLElement>('docRows');
const docCount = $<HTMLElement>('docCount');
const minutaRows = $<HTMLElement>('minutaRows');
const minutaCount = $<HTMLElement>('minutaCount');

const projectOverlay = $<HTMLElement>('projectOverlay');
const projectName = $<HTMLInputElement>('projectName');
const projectCancelBtn = $<HTMLButtonElement>('projectCancelBtn');
const projectCreateBtn = $<HTMLButtonElement>('projectCreateBtn');

/* ---------- Estado ---------- */
let projects: Project[] = [];
let documents: DocumentRow[] = [];
let minutas: MinutaRow[] = [];
let currentProject = '';
let uploading = false;
let creating = false;

/* ---------- Normalización defensiva (la API es dato no confiable) ---------- */
function isProject(v: unknown): v is Project {
  if (!v || typeof v !== 'object') return false;
  const p = v as Project;
  return typeof p.id === 'string' && typeof p.name === 'string';
}
function isDoc(v: unknown): v is DocumentRow {
  if (!v || typeof v !== 'object') return false;
  const d = v as DocumentRow;
  return typeof d.id === 'string' && typeof d.filename === 'string' && typeof d.path === 'string';
}
function isMinuta(v: unknown): v is MinutaRow {
  if (!v || typeof v !== 'object') return false;
  return typeof (v as MinutaRow).id === 'string';
}

/* ---------- Formato ---------- */
function fmtSize(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 1024) return Math.round(n) + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function fmtDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m || !m[1] || !m[2] || !m[3]) return iso || '—';
  return m[3] + '/' + m[2] + '/' + m[1];
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    String(d.getDate()).padStart(2, '0') + '/' +
    String(d.getMonth() + 1).padStart(2, '0') + '/' +
    d.getFullYear()
  );
}

function count(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

/* ---------- Carga de datos ---------- */
function showNote(text: string): void {
  drNote.textContent = text;
  drNote.hidden = false;
}

function handleLoadError(e: unknown): void {
  const code = e instanceof ApiError ? e.code : undefined;
  if (code === 'NO_SUPABASE') {
    showNote('Configura SUPABASE_URL y SUPABASE_SERVICE_KEY en Vercel para usar el Data Room.');
    uploadZone.classList.add('is-disabled');
  } else {
    showToast('⚠ ' + errMsg(e));
  }
}

async function loadProjects(keepId?: string): Promise<void> {
  try {
    const data = await DR.projects();
    projects = (data.projects ?? []).filter(isProject);
    fillProjectSelect(keepId);
    if (currentProject) {
      await Promise.all([loadDocuments(), loadMinutas()]);
    } else {
      documents = [];
      minutas = [];
      renderDocs();
      renderMinutas();
    }
  } catch (e) {
    handleLoadError(e);
  }
}

function fillProjectSelect(keepId?: string): void {
  projectSelect.textContent = '';
  if (!projects.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'Sin proyectos — crea el primero';
    projectSelect.appendChild(opt);
    projectSelect.disabled = true;
    currentProject = '';
    return;
  }
  const wanted =
    keepId && projects.some(p => p.id === keepId) ? keepId : (projects[0]?.id ?? '');
  projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    projectSelect.appendChild(opt);
  });
  projectSelect.value = wanted;
  currentProject = wanted;
  projectSelect.disabled = false;
}

async function loadDocuments(): Promise<void> {
  if (!currentProject) {
    documents = [];
    renderDocs();
    return;
  }
  try {
    const data = await DR.documents(currentProject);
    documents = (data.documents ?? []).filter(isDoc);
    renderDocs();
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  }
}

async function loadMinutas(): Promise<void> {
  try {
    const data = await DR.minutas();
    minutas = (data.minutas ?? []).filter(isMinuta);
    renderMinutas();
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  }
}

/* ---------- Render: documentos ---------- */
function renderDocs(): void {
  docCount.textContent = String(documents.length);
  docRows.textContent = '';

  if (!documents.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'empty';
    td.textContent = currentProject
      ? 'Sin documentos en este proyecto'
      : 'Crea un proyecto para empezar';
    tr.appendChild(td);
    docRows.appendChild(tr);
    return;
  }

  documents.forEach(d => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'doc-name';
    tdName.textContent = d.filename;
    tdName.title = d.filename;

    const tdCat = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = d.category || 'Otros';
    tdCat.appendChild(badge);

    const tdSize = document.createElement('td');
    tdSize.textContent = fmtSize(d.size);

    const tdDate = document.createElement('td');
    tdDate.textContent = fmtDateTime(d.uploaded_at);

    const tdAct = document.createElement('td');
    tdAct.className = 'right row-actions';

    const dl = document.createElement('button');
    dl.className = 'neu-btn icon-btn';
    dl.title = 'Descargar';
    dl.setAttribute('aria-label', 'Descargar ' + d.filename);
    const dlIco = document.createElement('span');
    dlIco.className = 'pxicon';
    drawIcon(dlIco, 'download');
    dl.appendChild(dlIco);
    dl.addEventListener('click', () => void downloadDoc(d));

    const rm = document.createElement('button');
    rm.className = 'neu-btn icon-btn danger';
    rm.title = 'Eliminar';
    rm.setAttribute('aria-label', 'Eliminar ' + d.filename);
    const rmIco = document.createElement('span');
    rmIco.className = 'pxicon';
    drawIcon(rmIco, 'trash');
    rm.appendChild(rmIco);
    rm.addEventListener('click', () => void deleteDoc(d));

    tdAct.append(dl, rm);
    tr.append(tdName, tdCat, tdSize, tdDate, tdAct);
    docRows.appendChild(tr);
  });
}

/* ---------- Render: minutas ---------- */
function renderMinutas(): void {
  minutaCount.textContent = String(minutas.length);
  minutaRows.textContent = '';

  if (!minutas.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'empty';
    td.textContent = 'Sin minutas registradas todavía';
    tr.appendChild(td);
    minutaRows.appendChild(tr);
    return;
  }

  minutas.forEach(m => {
    const tr = document.createElement('tr');

    const tdFecha = document.createElement('td');
    tdFecha.textContent = fmtDay(m.fecha);

    const tdTitulo = document.createElement('td');
    tdTitulo.className = 'doc-name';
    tdTitulo.textContent = (m.titulo || '').trim() || 'Minuta sin título';
    tdTitulo.title = tdTitulo.textContent;

    const tdTareas = document.createElement('td');
    tdTareas.className = 'right';
    tdTareas.textContent = String(count(m.tareas));

    const tdAcuerdos = document.createElement('td');
    tdAcuerdos.className = 'right';
    tdAcuerdos.textContent = String(count(m.acuerdos));

    tr.append(tdFecha, tdTitulo, tdTareas, tdAcuerdos);
    minutaRows.appendChild(tr);
  });
}

/* ---------- Subida: firma → PUT directo → confirmación ---------- */
function setProgress(show: boolean, pct: number): void {
  uploadProgress.hidden = !show;
  uploadFill.style.width = pct + '%';
  uploadStatus.textContent = pct >= 100 ? 'Registrando…' : 'Subiendo ' + pct + '%';
}

function putFile(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error('La subida falló (HTTP ' + xhr.status + ')'));
    });
    xhr.addEventListener('error', () =>
      reject(new Error('Sin conexión con el servidor de archivos'))
    );
    xhr.addEventListener('abort', () => reject(new Error('Subida cancelada')));
    xhr.send(file);
  });
}

async function handleFile(file: File): Promise<void> {
  if (uploading) return;
  if (!currentProject) {
    showToast('Crea o selecciona un proyecto primero');
    return;
  }

  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!EXT_OK.includes(ext)) {
    showToast('⚠ Tipo de archivo no permitido (PDF, Word, Excel, imágenes o texto)');
    return;
  }
  if (file.size > MAX_SIZE) {
    showToast('⚠ El archivo supera los 15 MB permitidos');
    return;
  }
  if (file.size === 0) {
    showToast('⚠ El archivo está vacío');
    return;
  }

  uploading = true;
  setProgress(true, 0);
  try {
    /* 1) El servidor valida (15 MB, mime, categoría) y firma la subida */
    const signed = await DR.sign({
      projectId: currentProject,
      filename: file.name,
      size: file.size,
      mime: file.type,
      category: categorySelect.value
    });
    if (!signed.uploadUrl || !signed.path) throw new Error('No se pudo preparar la subida');

    /* 2) El archivo sube DIRECTO a Supabase (sin pasar por Vercel) */
    await putFile(signed.uploadUrl, file, p => setProgress(true, p));

    /* 3) El servidor verifica y crea la fila en documents */
    const confirmed = await DR.confirm({
      projectId: currentProject,
      path: signed.path,
      filename: signed.filename || file.name,
      size: file.size,
      mime: signed.mime || file.type,
      category: categorySelect.value
    });
    if (confirmed.document && isDoc(confirmed.document)) {
      documents.unshift(confirmed.document);
      renderDocs();
      showToast('Documento subido ✓ ' + confirmed.document.filename);
    } else {
      throw new Error('El servidor no confirmó el documento');
    }
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  } finally {
    uploading = false;
    setProgress(false, 0);
  }
}

/* Clic en la zona */
uploadZone.addEventListener('click', () => {
  if (uploading || !currentProject) return;
  fileInput.click();
});
uploadZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    uploadZone.click();
  }
});
/* Arrastrar y soltar */
uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('drop-active');
});
uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drop-active');
});
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drop-active');
  const f = e.dataTransfer?.files[0];
  if (f) void handleFile(f);
});
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = ''; // permite volver a elegir el mismo archivo
  if (f) void handleFile(f);
});

/* ---------- Descargar / eliminar ---------- */
async function downloadDoc(d: DocumentRow): Promise<void> {
  try {
    const data = await DR.downloadUrl(d.id);
    if (!data.url) throw new Error('No se pudo generar la descarga');
    window.open(data.url, '_blank', 'noopener');
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  }
}

async function deleteDoc(d: DocumentRow): Promise<void> {
  const ok = window.confirm('¿Eliminar "' + d.filename + '"? Esta acción no se puede deshacer.');
  if (!ok) return;
  try {
    await DR.remove(d.id);
    documents = documents.filter(x => x.id !== d.id);
    renderDocs();
    showToast('Documento eliminado ✓');
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  }
}

/* ---------- Cambiar de proyecto ---------- */
projectSelect.addEventListener('change', () => {
  currentProject = projectSelect.value;
  void loadDocuments();
});

/* ---------- Modal: nuevo proyecto ---------- */
function closeProjectModal(): void {
  projectOverlay.classList.remove('open');
}

newProjectBtn.addEventListener('click', () => {
  projectName.value = '';
  projectOverlay.classList.add('open');
  window.setTimeout(() => projectName.focus(), 50);
});
projectCancelBtn.addEventListener('click', closeProjectModal);
projectOverlay.addEventListener('click', e => {
  if (e.target === projectOverlay) closeProjectModal();
});
projectName.addEventListener('keydown', e => {
  if (e.key === 'Enter') projectCreateBtn.click();
  if (e.key === 'Escape') closeProjectModal();
});

projectCreateBtn.addEventListener('click', async () => {
  const name = projectName.value.trim();
  if (!name) {
    projectName.focus();
    showToast('Escribe un nombre para el proyecto');
    return;
  }
  if (creating) return;
  creating = true;
  const btn = projectCreateBtn;
  const label = btn.textContent ?? '';
  btn.disabled = true;
  btn.textContent = 'Creando…';
  try {
    const data = await DR.createProject(name);
    if (data.project && isProject(data.project)) {
      closeProjectModal();
      await loadProjects(data.project.id); // queda seleccionado el nuevo
      showToast('Proyecto creado ✓ ' + data.project.name);
    } else {
      throw new Error('El servidor no devolvió el proyecto');
    }
  } catch (e) {
    showToast('⚠ ' + errMsg(e));
  } finally {
    creating = false;
    btn.disabled = false;
    btn.textContent = label;
  }
});

/* ---------- Arranque ---------- */
drawIcon($<HTMLElement>('uploadIcon'), 'upload');
void loadProjects();
