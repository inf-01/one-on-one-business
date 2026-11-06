-- ============================================================
-- ONE ON ONE BUSINESS — Esquema completo (pegar en Supabase SQL Editor)
-- ------------------------------------------------------------
-- Cole este archivo entero en: Supabase → SQL Editor → New query → Run.
-- Es idempotente: puedes ejecutarlo de nuevo sin romper nada.
-- Solo se ven datos estando registrados: Auth (auth.users) + profiles.
-- Todo el acceso lo hace el servidor con la service_role (RLS activa,
-- sin políticas públicas). Los roles alimentan a la IA de la Minuta.
-- Nuevos registros: SOLO Técnico Informático / Tecnologico o Técnico
-- Contable / Contable (el servidor los exige; ver api/auth.ts).
-- ============================================================

-- ---------- Perfiles (1 fila por usuario registrado) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null unique,
  cargo text not null default 'Otro',
  created_at timestamptz not null default now()
);

-- Roles permitidos en BD (la IA asigna tareas por rol).
-- Los nuevos registros solo pueden ser Tecnologico (Técnico Informático)
-- o Contable (Técnico Contable). Se mantienen los valores legacy en el
-- check para no romper filas existentes.
alter table public.profiles drop constraint if exists profiles_cargo_check;
alter table public.profiles add constraint profiles_cargo_check
  check (cargo in ('Tecnologico','Contable','Administracion','Ventas','Operaciones','Otro'));

-- ---------- Proyectos (dueño registrado + miembros del equipo) ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.projects add column if not exists owner_id uuid references public.profiles(id) on delete set null;
create unique index if not exists projects_name_key on public.projects (name);

-- Miembros del proyecto (para compartir con el equipo)
create table if not exists public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------- Tareas (fuente primaria del calendario) ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  titulo text not null,
  fecha date not null,
  hora text not null default '',
  estado text not null default 'pendiente',
  asignado_a uuid not null references public.profiles(id) on delete cascade,
  creado_por uuid references public.profiles(id) on delete set null,
  fecha_creacion timestamptz not null default now(),
  fecha_finalizacion timestamptz
);
alter table public.tasks drop constraint if exists tasks_estado_check;
alter table public.tasks add constraint tasks_estado_check
  check (estado in ('pendiente','en progreso','completada'));
alter table public.tasks add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.tasks add column if not exists asignado_a uuid references public.profiles(id) on delete cascade;
alter table public.tasks add column if not exists creado_por uuid references public.profiles(id) on delete set null;
alter table public.tasks add column if not exists fecha_creacion timestamptz not null default now();
alter table public.tasks add column if not exists fecha_finalizacion timestamptz;
alter table public.tasks add column if not exists hora text not null default '';
alter table public.tasks add column if not exists titulo text;
alter table public.tasks add column if not exists fecha date;
alter table public.tasks add column if not exists estado text not null default 'pendiente';

-- ---------- Documentos (el archivo vive en Storage, aquí la fila) ----------
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  filename text not null,
  path text not null,
  size bigint not null,
  mime text not null,
  category text not null default 'Otros',
  uploaded_by uuid references public.profiles(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
alter table public.documents add column if not exists category text not null default 'Otros';
alter table public.documents add column if not exists uploaded_by uuid references public.profiles(id) on delete set null;

-- ---------- Minutas (histórico inmutable) ----------
create table if not exists public.minutas (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.projects(id) on delete set null,
  fecha date not null,
  titulo text,
  fuente text not null default 'ia',
  acuerdos jsonb not null default '[]',
  tareas jsonb not null default '[]',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.minutas add column if not exists titulo text;
alter table public.minutas add column if not exists fuente text not null default 'ia';
alter table public.minutas add column if not exists acuerdos jsonb not null default '[]';
alter table public.minutas add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.minutas add column if not exists created_by uuid references public.profiles(id) on delete set null;

-- ---------- Índices de lectura ----------
create index if not exists profiles_name_idx on public.profiles (display_name);
create index if not exists profiles_cargo_idx on public.profiles (cargo);
create index if not exists projects_owner_idx on public.projects (owner_id);
create index if not exists project_members_user_idx on public.project_members (user_id);
create index if not exists tasks_assigned_idx on public.tasks (asignado_a, fecha asc);
create index if not exists tasks_project_idx on public.tasks (project_id, fecha asc);
create index if not exists tasks_fecha_idx on public.tasks (fecha desc);
create index if not exists documents_project_idx on public.documents (project_id, uploaded_at desc);
create index if not exists minutas_fecha_idx on public.minutas (fecha desc, created_at desc);
create index if not exists minutas_project_idx on public.minutas (project_id, fecha desc);

-- ---------- Perfil automático al registrarse ----------
-- El nombre/cargo viaja en auth.users.raw_user_meta_data (lo envía el registro).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, cargo)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data->>'display_name'), ''), 'Usuario'),
    coalesce(nullif(new.raw_user_meta_data->>'cargo', ''), 'Otro')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Seguridad: RLS activa, solo el servidor (service_role) ----------
alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tasks enable row level security;
alter table public.documents enable row level security;
alter table public.minutas enable row level security;

-- Sin políticas públicas: anon y authenticated NO tocan las tablas.
-- Solo el service_role (Vercel) entra, y valida el JWT antes.
-- Si quisieras acceso directo del cliente, crea políticas aquí.
