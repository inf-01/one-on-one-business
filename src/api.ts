/* ============================================================
   ONE ON ONE BUSINESS — Cliente de API tipado (index + dashboard)
   Todo pasa por /api/sync (Serverless Function de Vercel),
   que habla con Google Apps Script de forma segura.
   La Minuta usa /api/minuta (otra Serverless Function) que
   habla con Gemini: la clave de IA vive solo en Vercel.
   ============================================================ */

import type {
  ApiOk,
  DataRoomResponse,
  MinutaRequest,
  MinutaResponse,
  SyncResponse,
  TaskChanges,
  TaskRaw
} from './types';

/** Error de API con código opcional (p. ej. NO_KEY). */
export class ApiError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

const BASE = '/api/sync';
const DR_BASE = '/api/data-room';

async function request<T extends ApiOk>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, options ?? {});
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new ApiError('El servidor tardó demasiado en responder');
    }
    throw new ApiError('Sin conexión con el servidor');
  }

  let data: T | null = null;
  try {
    data = (await res.json()) as T;
  } catch {
    throw new ApiError('Respuesta inválida del servidor');
  }

  if (!res.ok || data === null || data.ok === false) {
    const message = data && data.error ? data.error : 'Error HTTP ' + res.status;
    throw new ApiError(message, data && data.code ? data.code : undefined);
  }
  return data;
}

function post<T extends ApiOk>(payload: unknown): Promise<T> {
  return request<T>(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

/** Señal de timeout si el navegador la soporta (AbortSignal.timeout). */
function timeoutSignal(ms: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined') return undefined;
  const cap = AbortSignal as unknown as { timeout?: (m: number) => AbortSignal };
  return typeof cap.timeout === 'function' ? cap.timeout(ms) : undefined;
}

export const API = {
  /* Lectura */
  getTasks(): Promise<SyncResponse> {
    return request<SyncResponse>(BASE + '?action=getTasks');
  },

  /* Escritura */
  createTask(task: TaskRaw): Promise<SyncResponse> {
    return post<SyncResponse>({ action: 'create', task });
  },

  updateTask(id: string, changes: TaskChanges): Promise<SyncResponse> {
    return post<SyncResponse>({ action: 'update', id, changes });
  },

  deleteTask(id: string): Promise<SyncResponse> {
    return post<SyncResponse>({ action: 'delete', id });
  },

  bulkCreate(tasks: TaskRaw[]): Promise<SyncResponse> {
    return post<SyncResponse>({ action: 'bulk', tasks });
  },

  /* IA: extrae la minuta y reparte las tareas EN EL SERVIDOR */
  processMinuta(payload: MinutaRequest): Promise<MinutaResponse> {
    return request<MinutaResponse>('/api/minuta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: timeoutSignal(60000) // extracción + Sheets + histórico
    });
  }
};

/* ============================================================
   Data Room: proyectos, documentos y minutas (Supabase)
   La subida del archivo NO pasa por aquí: el navegador sube
   directo a Supabase con la URL firmada que da `sign`.
   ============================================================ */
function drGet(qs: string): Promise<DataRoomResponse> {
  return request<DataRoomResponse>(DR_BASE + qs);
}

function drPost(payload: unknown): Promise<DataRoomResponse> {
  return request<DataRoomResponse>(DR_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export const DataRoom = {
  projects(): Promise<DataRoomResponse> {
    return drGet('?action=projects');
  },

  documents(projectId: string): Promise<DataRoomResponse> {
    return drGet('?action=documents&projectId=' + encodeURIComponent(projectId));
  },

  minutas(): Promise<DataRoomResponse> {
    return drGet('?action=minutas');
  },

  createProject(name: string): Promise<DataRoomResponse> {
    return drPost({ action: 'createProject', name });
  },

  /* Pide la URL firmada de subida (valida tamaño/mime/categoría en el servidor) */
  sign(p: {
    projectId: string;
    filename: string;
    size: number;
    mime: string;
    category: string;
  }): Promise<DataRoomResponse> {
    return drPost({ action: 'sign', ...p });
  },

  /* Confirma que el archivo llegó a Storage y crea la fila en documents */
  confirm(p: {
    projectId: string;
    path: string;
    filename: string;
    size: number;
    mime: string;
    category: string;
  }): Promise<DataRoomResponse> {
    return drPost({ action: 'confirm', ...p });
  },

  downloadUrl(documentId: string): Promise<DataRoomResponse> {
    return drPost({ action: 'downloadUrl', documentId });
  },

  remove(documentId: string): Promise<DataRoomResponse> {
    return drPost({ action: 'delete', documentId });
  }
};
