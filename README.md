# ONE ON ONE BUSINESS — Gestión de proyectos por equipo registrado

Stack: **Vercel** (frontend + serverless) + **Supabase** (Auth + PostgreSQL + Storage) + **Gemini** (IA de la Minuta).
Solo personas registradas pueden ver y modificar sus datos. No hay nombres fijos: los responsables son los `display_name` de `public.profiles` y la IA asigna por cargo.

## 0. Qué cambió (misión Senior Backend)

- Eliminado `José / Luis` hardcodeado de código, UI y base de datos.
- Registro con `display_name + correo + contraseña + rol obligatorio` (`Técnico Informático / Tecnologico` o `Técnico Contable / Contable` — sin default, la IA lo exige para asignar).
- Todo protegido con Supabase Auth: calendario, dashboard, Data Room, minuta y tareas exigen `Authorization: Bearer <JWT>`.
- Todas las claves viven **solo en Vercel** (nunca en el navegador): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `GEMINI_API_KEY`.
- Lógica y estética intactas (neumorfismo, `--jose/--luis` como colores 1–2 de la paleta de miembros, `.modal`, `.user-chip`, `.field`).

## 1. Supabase: crear el proyecto y pegar el SQL

1. Entra a [supabase.com](https://supabase.com) → **New project** (name: `one-on-one-business`).
2. En el proyecto: **SQL Editor → New query**.
3. Abre `supabase/schema.sql` de este repo, copia **todo** y pégalo → **Run**.
   - Crea `profiles`, `projects`, `project_members`, `tasks`, `documents`, `minutas`.
   - Crea el trigger `handle_new_user()` (crea el `profile` al registrarse con su cargo).
   - Activa RLS (sin políticas públicas: solo el servidor con `service_role` entra).
4. En **Authentication → Providers → Email**, deja **Email** activado. Si activaste **Confirm email**, desactívalo para el primer uso (o necesitarás confirmar cada correo).
5. En **Settings → API** copia:
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_ANON_KEY`
   - `service_role secret key` → `SUPABASE_SERVICE_KEY` (solo servidor)
6. En **Storage**, crea un bucket privado llamado `documentos` (si el servidor lo crea solo al subir el primer archivo, también sirve; créalo a mano para ir seguro).

> **Storage (rol service_role):** el bucket debe quedar **privado**. Las subidas y descargas van con URLs firmadas desde Vercel.

## 2. Vercel: variables secretas + deploy

1. Sube este repo a GitHub y créalo en [vercel.com/new](https://vercel.com/new) (framework: **Other**).
2. En **Settings → Environment Variables** agrega (marca **Production** y **Preview**):

   | Variable | Valor |
   |---|---|
   | `SUPABASE_URL` | `https://TU_REF.supabase.co` |
   | `SUPABASE_ANON_KEY` | anon public key (solo servidor) |
   | `SUPABASE_SERVICE_KEY` | service_role secret key (solo servidor) |
   | `GEMINI_API_KEY` | Clave de [Google AI Studio](https://aistudio.google.com/app/apikey) |
   | `GEMINI_MODEL` | *(opcional)* p. ej. `gemini-3.5-flash-lite` |

3. **Deploy**. Vercel detecta:
   - `api/auth.ts`, `api/sync.ts`, `api/minuta.ts`, `api/data-room.ts` → Serverless Functions
   - `index.html`, `dashboard.html`, `data-room.html` → estáticos
4. Si ya habías puesto `GAS_URL` / `API_SECRET`, puedes dejarlas: sin Supabase se usa el respaldo legacy Google Sheets. Con Supabase, las tareas van en `public.tasks`.

### Clave de IA (Gemini)

1. Entra a [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → **Create API key**.
2. En Vercel: **Settings → Environment Variables → Add New** → `GEMINI_API_KEY` → **Redeploy**.

La clave de IA vive **solo en Vercel**: jamás se sube a GitHub ni llega al navegador.
Si falta la clave, la Minuta sigue en **modo líneas** (una tarea por línea), sin romper nada.

## 3. Primer uso (hoy) — 5 minutos

1. Abre tu dominio de Vercel → verás **Inicia sesión** (sin nombres fijos). En **Inicia sesión** solo correo + contraseña (el rol solo se pide al registrarse).
2. Pulsa **Crear cuenta** → completa:
   - `Nombre` (visible como responsable, ej. `Ana`)
   - `Correo` y `Contraseña` (mín. 8 caracteres)
   - `Rol obligatorio *` — **Técnico Informático** o **Técnico Contable** (sin default: si no eliges, el registro se bloquea. La IA usará esto para asignar)
3. Repite el registro para tu socio con su propio nombre y rol.
4. En **Data Room → Nuevo proyecto**, crea el primer proyecto (ej. `Cliente Norte`). Eres el `owner` (pueden añadirse miembros en `project_members`).
5. En el calendario usa el desplegable **Todos los proyectos / [tu proyecto]** para filtrar.
6. Pulsa **Minuta** → pega el texto (ej. *“Ana envía la propuesta el jueves a las 10. El técnico contable revisa el presupuesto mañana.”*) → la IA crea las tareas y las asigna por nombre/rol.
7. Completa tareas con `✓` (solo puedes cambiar **tus** tareas: verás el aviso si intentas tocar las ajenas).
8. Comparte el link de Vercel con tu socio: ambos entran con su cuenta y ven sus tareas.

## 4. Cómo fluyen los datos (seguridad)

```
index.html / dashboard.html / data-room.html
      │  fetch('/api/*', { Authorization: 'Bearer <JWT>' })
      ▼
  api/auth.ts · api/sync.ts · api/minuta.ts · api/data-room.ts (Vercel)
      │  valida el JWT contra Supabase Auth (/auth/v1/user)
      │  usa SUPABASE_SERVICE_KEY solo en servidor
      ▼
  Supabase (PostgreSQL + Auth + Storage)
      - profiles · projects · project_members · tasks · documents · minutas
      ▼
  Gemini (IA) — solo desde api/minuta.ts
```

- El secreto **nunca** llega al navegador. Solo guardas el JWT en `sessionStorage`.
- RLS activa sin políticas públicas: `anon`/`authenticated` no tocan las tablas. Solo Vercel con `service_role` entra, y antes valida el JWT.
- Cada usuario ve/crea/edita según su proyecto y sus tareas asignadas (reassignar/borrar: solo el creador o el dueño del proyecto).

## 5. Desarrollo local

```bash
npm i
npm run dev
```

Crea `.env.local` (no se sube a GitHub) con las mismas variables de Vercel:

```
SUPABASE_URL=https://TU_REF.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...
GEMINI_API_KEY=...
```

> En local también necesitas `vercel dev` para que las Serverless Functions corran.

## 6. Subir a GitHub

```bash
git add .
git commit -m "feat(auth): equipo registrado con cargo + Supabase tasks + RLS"
git push
```

Vercel hace deploy automático al hacer push.

## 7. Funcionalidades

### Calendario (`index.html`)
- Grid de **7 días** (Dom → Sáb); `‹` `›` cambian de semana; `Hoy` vuelve a la semana actual.
- Título marquesina con rango: **"Sem 44: 27 Oct - 02 Nov"**.
- Botón de tema (Sol/Luna) en la **barra superior del header** + **Salir** (cierra sesión).
- **Filtro de proyecto** en la toolbar (Todos / cada proyecto).
- **Barra GENERAL** (equipo del día seleccionado).
- **Barra PERSONAL** con chips **dinámicos** (uno por perfil registrado, colores por índice).
- Modal **Minuta**: la IA asigna por **nombre o cargo** desde `profiles`. Sin IA, crea una tarea por línea.
- Editar/eliminar solo tus tareas. El resto se muestra en solo lectura.

### Dashboard (`dashboard.html`)
- Total completadas / en progreso / pendientes + avance global.
- Tabla **Rendimiento por responsable** (una fila por perfil registrado).
- Velocidad de finalización promedio (y por miembro) con `fecha_creacion → fecha_finalizacion`.

### Data Room (`data-room.html`)
- Proyectos propios + de equipo. Solo el dueño o un miembro los ve.
- Subida directa a Storage con URL firmada (15 MB, categorías fijas, nombre saneado en el servidor).
- Histórico de minutas por proyecto (fecha, título, tareas y acuerdos).

### API
- `/api/auth` → `register | login | me | profiles` (Supabase Auth vía servidor).
- `/api/sync` → tareas en Supabase `tasks` (`getTasks | create | update | delete | bulk`). Sin Supabase, respaldo Google Sheets.
- `/api/minuta` → extrae con **Gemini** (título, acuerdos y action items), asigna por **nombre/cargo**, crea las tareas en el servidor e archiva la minuta en Supabase.
- `/api/data-room` → proyectos, documentos y minutas (solo accesibles).

## 8. Notas

- El sonido de "tarea completada" y las alarmas siguen intactos.
- Estilos, colores, fuente Inter y layout **no se modificaron**: todo lo nuevo reutiliza el mismo lenguaje neumórfico (`--jose`/`--luis` = miembros 1–2, `--member-2…7` para el resto).
- **Google Sheets / Apps Script (`apps-script/Code.gs`)** queda como respaldo legacy: con Supabase configurado, la fuente primaria es `public.tasks`.
