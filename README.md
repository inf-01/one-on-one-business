# ONE ON ONE BUSINESS — Gestión de proyectos (José & Luis)

Stack: **Vercel** (frontend + serverless) + **Google Sheets** (base de datos vía Google Apps Script).

## Estructura de archivos (lista para GitHub)

```
/
├── index.html            ← Calendario SEMANAL (Dom–Sáb)
├── dashboard.html        ← Dashboard de métricas
├── favicon.png           ← icono de pestaña (versión recortada del logo)
├── logo-dark.png         ← logotipo para fondos OSCUROS (tema noche)
├── logo-light.png        ← logotipo para fondos CLAROS (tema día)
├── logo con para fondo negro.png   ← original del diseñador (no editar)
├── logo con para fondo blanco.png  ← original del diseñador (no editar)
├── css/
│   └── styles.css        ← CSS compartido (estilo original intacto + nuevos componentes)
├── js/
│   ├── api.js            ← cliente fetch() a /api/sync
│   ├── app.js            ← lógica del calendario semanal
│   └── dashboard.js      ← lógica del dashboard
├── api/
│   └── sync.js           ← Serverless Function de Vercel (puente a Apps Script)
├── apps-script/
│   └── Code.gs           ← código para Google Apps Script
└── README.md
```

---

## 1. Google Sheets + Google Apps Script

1. Crea una hoja de cálculo nueva en Google Drive (ej. `ONE_ON_ONE_DB`).
2. **Extensiones > Apps Script** y pega todo el contenido de `apps-script/Code.gs`.
3. Cambia la constante secreta:
   ```js
   var API_KEY = 'ONE_ON_ONE_CAMBIA_ESTA_CLAVE'; // ⚠️ pon tu propia clave
   ```
4. **Implementar > Nueva implementación > Aplicación web**:
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier persona**
5. Autoriza los permisos la primera vez y copia la **URL pública** (termina en `/exec`).
   → Esto será tu `GAS_URL`.
6. La hoja crea sola la pestaña **`Tareas`** con las columnas exactas:

| Columna | Campo | Descripción |
|---|---|---|
| **A** | `ID` | Identificador único (`T-<uuid>`). Nunca se edita a mano. |
| **B** | `Fecha` | Fecha de la tarea en formato `YYYY-MM-DD` (la usa el calendario). |
| **C** | `Titulo` | Texto de la tarea (máx. 120 caracteres). |
| **D** | `Responsable` | `José` o `Luis` (define el color de la barra: cian / magenta). |
| **E** | `Estado` | `pendiente` o `completada`. |
| **F** | `FechaCreacion` | ISO 8601 (`2026-11-01T14:30:00.000Z`). Se pone al crear. |
| **G** | `FechaFinalizacion` | ISO 8601. **La pone sola el script** al marcar `completada` y borra al reabrir. Es lo que alimenta la métrica de velocidad del dashboard. |
| **H** | `Hora` | *(opcional)* `HH:MM` para las alarmas de 5 minutos. |

> Si cambias `Code.gs`, vuelve a **Implementar > Administrar implementaciones > Editar > Implementar** para publicar la nueva versión (la URL no cambia).

---

## 2. Vercel

1. Sube el repo a GitHub y créalo en [vercel.com/new](https://vercel.com/new) (framework: **Other**).
2. En **Settings > Environment Variables** agrega:

   | Variable | Valor |
   |---|---|
   | `GAS_URL` | URL de Apps Script (la que termina en `/exec`) |
   | `API_SECRET` | **Exactamente la misma** clave que `API_KEY` en `Code.gs` |

3. Deploy. Vercel detecta automáticamente:
   - `/api/sync.js` → Serverless Function
   - `index.html`, `dashboard.html`, `css/`, `js/` → estáticos.

### Cómo fluyen los datos (seguridad)

```
index.html / dashboard.html
      │  fetch('/api/sync')      ← sin secretos
      ▼
api/sync.js (Vercel)             ← inyecta API_SECRET (variable de entorno)
      │  fetch(GAS_URL?key=…)
      ▼
Code.gs (Google Apps Script)      ← valida key, lee/escribe la hoja "Tareas"
      ▼
Google Sheets
```

El secreto **nunca** llega al navegador.

---

## 3. Desarrollo local

```bash
npm i -g vercel
vercel dev
```

Crea un archivo `.env.local` (no se sube a GitHub):

```
GAS_URL=https://script.google.com/macros/s/XXXX/exec
API_SECRET=tu-clave-secreta
```

---

## 4. Subir a GitHub

```bash
git init
git add .
git commit -m "One on One Business: calendario semanal + dashboard + API"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/TU_REPO.git
git push -u origin main
```

---

## 5. Funcionalidades

### index.html (calendario semanal)
- Grid de **7 días** (Dom → Sáb) de la semana visible; `‹` `›` cambian de semana; `Hoy` vuelve a la semana actual.
- Título marquesina con rango: **"Sem 44: 27 Oct - 02 Nov"**.
- Botón de tema (Sol/Luna) reubicado en la **barra superior del header**.
- **Barra GENERAL** en la toolbar (suma José + Luis del día seleccionado).
- **Barra PERSONAL** en el panel inferior con toggle **JOSÉ / LUIS**.
- Barra de color por responsable: **cian `--neon` (José)**, **magenta `--neon2` (Luis)**; los puntos del día también.
- Modal **Minuta**: pega texto (una tarea por línea), eliges responsable y se crea todo por la API (`Ctrl+Enter` procesa).
- Todo el CRUD pasa por `fetch()` → `/api/sync` → Google Sheets.
- `localStorage` solo guarda preferencias de UI (tema, alarmas, usuario activo) — **ningún dato del proyecto**.

### dashboard.html
- Total completadas vs pendientes + avance global.
- Rendimiento José vs Luis (barras cian/magenta).
- Velocidad de finalización promedio (y por usuario) calculada con `FechaCreacion → FechaFinalizacion`.
- Botón `‹` / "Calendario" para volver y `↻` para actualizar.

### API (apps-script/Code.gs)
- `doGet` → `action=getTasks` (leer tareas).
- `doPost` → `action=create | update | delete | bulk` (escribir, con `LockService`).
- Respuesta JSON siempre con `{ ok: true/false, … }`.

---

## 6. Notas
- El sonido de "tarea completada" y las alarmas siguen intactos.
- Los estilos, colores (`--neon`, `--bt-dia`, `--bt-cero`), fuente Orbitron e iconos pixel-art **no se modificaron**: todo lo nuevo reutiliza el mismo lenguaje neumórfico.
