/* ============================================================
   ONE ON ONE BUSINESS — Tipos de dominio (cliente + servidor)
   Solo tipos: `import type` desde api/ se elimina al compilar,
   así que Vercel nunca los ejecuta como código.
   ============================================================ */

/** Estados de tarea en la hoja "Tareas" (columna E). */
export type Estado = 'pendiente' | 'en progreso' | 'completada';

/** Las dos personas del proyecto (definen el color de la barra). */
export type Responsable = 'José' | 'Luis';

/** Tarea normalizada tal como la usa la UI. */
export interface Task {
  id: string | null;
  fecha: string; // YYYY-MM-DD
  titulo: string;
  responsable: Responsable;
  estado: Estado;
  fechaCreacion: string; // ISO 8601
  fechaFinalizacion: string; // ISO 8601 o '' (la pone el script al completar)
  hora: string; // HH:MM o ''
}

/** Crudo que llega de la API, de un JSON importado o de la IA. */
export interface TaskRaw {
  id?: string | null;
  fecha?: string;
  titulo?: string;
  responsable?: string;
  estado?: string;
  fechaCreacion?: string;
  fechaFinalizacion?: string;
  hora?: string;
}

/** Cambios permitidos vía action=update. */
export type TaskChanges = Partial<Omit<Task, 'id'>>;

/** Respuesta genérica de todas las Serverless Functions. */
export interface ApiOk {
  ok: boolean;
  error?: string;
  code?: string;
}

/** Respuestas de /api/sync (Google Sheets vía Apps Script). */
export interface SyncResponse extends ApiOk {
  tasks?: Task[];
  task?: Task;
}

/** Petición a /api/minuta. */
export interface MinutaRequest {
  text: string;
  responsable: Responsable;
  fecha: string; // fecha por defecto de las tareas
  hoy: string; // "hoy" para interpretar fechas relativas
  idempotencyKey?: string; // evita duplicados si se reintenta la misma minuta
}

/** Respuesta de /api/minuta: las tareas YA creadas en la hoja (reparto en servidor). */
export interface MinutaResponse extends ApiOk {
  tasks?: Task[];
  acuerdos?: string[];
  titulo?: string;
  minutaId?: string | null; // id del registro en Supabase (null si no hay histórico)
  deduped?: boolean; // true si la respuesta vino de la caché de idempotencia
}

/* ---------- Data Room (/api/data-room · Supabase) ---------- */

/** Proyecto del Data Room (agrupa documentos y minutas). */
export interface Project {
  id: string;
  name: string;
  created_at: string;
}

/** Metadatos de un documento (el archivo vive en Storage, esto es la fila). */
export interface DocumentRow {
  id: string;
  project_id: string;
  filename: string;
  path: string;
  size: number;
  mime: string;
  category: string;
  uploaded_at: string;
}

/** Fila del histórico de minutas (jsonb ya parseado por PostgREST). */
export interface MinutaRow {
  id: string;
  project_id: string | null;
  fecha: string;
  titulo: string | null;
  fuente: string;
  acuerdos?: string[];
  tareas?: unknown[];
  created_at: string;
}

/** Categorías fijas del Data Room. */
export type DocCategory = 'Propuestas' | 'Contratos' | 'Facturas' | 'Informes' | 'Otros';

/** Respuesta de /api/data-room (todas las claves son opcionales según la acción). */
export interface DataRoomResponse extends ApiOk {
  projects?: Project[];
  documents?: DocumentRow[];
  minutas?: MinutaRow[];
  project?: Project;
  document?: DocumentRow;
  uploadUrl?: string; // URL firmada de Supabase para subir directo
  path?: string; // ruta final en el bucket
  filename?: string; // nombre saneado
  mime?: string; // mime validado
  url?: string; // URL firmada de descarga
}
