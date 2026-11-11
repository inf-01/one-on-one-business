/* ============================================================
   ONE ON ONE BUSINESS — Tipos de dominio (cliente + servidor)
   Solo tipos: `import type` desde api/ se elimina al compilar,
   así que Vercel nunca los ejecuta como código.
   ============================================================ */

/** Estados de tarea (Supabase `tasks.estado` + respaldo Sheets columna E). */
export type Estado = 'pendiente' | 'en progreso' | 'completada';

/** Roles: Técnico Informático (Tecnologico) o Técnico Contable (Contable).
 *  Los nuevos registros solo usan esos dos (obligatorio para la IA).
 *  Se mantienen los legacy en el tipo para no romper filas existentes. */
export type Cargo =
  | 'Tecnologico'
  | 'Contable'
  | 'Administracion'
  | 'Ventas'
  | 'Operaciones'
  | 'Otro';

/** Perfil de usuario registrado (fila en `public.profiles`). */
export interface Profile {
  id: string;
  display_name: string;
  cargo: Cargo | string;
  created_at: string;
}

/** Responsable = display_name de un perfil registrado (NO hay nombres fijos). */
export type Responsable = string;

/** Tarea normalizada tal como la usa la UI. */
export interface Task {
  id: string | null;
  fecha: string; // YYYY-MM-DD
  titulo: string;
  responsable: Responsable; // display_name del perfil asignado
  estado: Estado;
  fechaCreacion: string; // ISO 8601
  fechaFinalizacion: string; // ISO 8601 o '' (la pone el servidor al completar)
  hora: string; // HH:MM o ''
  project_id?: string | null;
  assigned_to?: string | null; // uuid de profiles.id
  created_by?: string | null;
  motivoRetraso?: string; // por qué se retrasó la tarea (lo anota el responsable/creador)
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
  project_id?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  motivoRetraso?: string;
}

/** Cambios permitidos vía action=update. */
export type TaskChanges = Partial<Omit<Task, 'id'>>;

/** Respuesta genérica de todas las Serverless Functions. */
export interface ApiOk {
  ok: boolean;
  error?: string;
  code?: string;
}

/** Sesión de frontend (solo dentro de sessionStorage, nunca la service_key). */
export interface Session {
  access_token: string;
  refresh_token?: string;
  user_id: string;
  email: string;
  display_name: string;
  cargo: string;
}

/** Petición/respuesta de /api/auth. */
export interface AuthResponse extends ApiOk {
  session?: Session;
  profile?: Profile;
  profiles?: Profile[];
}

/** Respuestas de /api/sync (Supabase `tasks` como fuente primaria). */
export interface SyncResponse extends ApiOk {
  tasks?: Task[];
  task?: Task;
}

/** Petición a /api/minuta. `responsable`/`project_id` son opcionales: el
 *  servidor asigna por cargo desde los perfiles registrados. */
export interface MinutaRequest {
  text: string;
  responsable?: string; // display_name, opcional (default = usuario actual)
  fecha: string; // fecha por defecto de las tareas
  hoy: string; // "hoy" para interpretar fechas relativas
  project_id?: string | null;
  idempotencyKey?: string; // evita duplicados si se reintenta la misma minuta
}

/** Respuesta de /api/minuta: las tareas YA creadas en el servidor. */
export interface MinutaResponse extends ApiOk {
  tasks?: Task[];
  acuerdos?: string[];
  titulo?: string;
  minutaId?: string | null; // id del registro en Supabase (null si no hay histórico)
  deduped?: boolean; // true si la respuesta vino de la caché de idempotencia
}

/* ---------- Data Room (/api/data-room · Supabase) ---------- */

/** Proyecto del Data Room (agrupa documentos, minutas y tareas). */
export interface Project {
  id: string;
  name: string;
  owner_id?: string | null;
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
