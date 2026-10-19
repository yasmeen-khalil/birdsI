-- birdsI v3 step 4 (2026-10-18): what each vendor project said when birdsI
-- last read it. Safe to run more than once.
--
-- One row per read of one project of an app: a Vercel project's deployments,
-- env names (never values), crons, domains and errors; a Supabase project's
-- status, size, advisors and the migrations it still owes; a OneSignal app's
-- subscribers and recent notifications. Every part of a read is dated with the
-- address it came from, and a part that could not be read carries the reason,
-- never a zero. The read job keeps the newest 48 reads per project.

create table if not exists public.project_reads (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  app_project_id uuid not null references public.app_projects(id) on delete cascade,
  vendor text not null,
  read_at timestamptz not null default now(),
  -- How many parts of the read could not be read; 0 when every part was.
  problems integer not null default 0,
  data jsonb not null
);
create index if not exists project_reads_project_idx on public.project_reads(app_project_id, read_at desc);
create index if not exists project_reads_app_idx on public.project_reads(app_id, read_at desc);
alter table public.project_reads enable row level security;
grant all on public.project_reads to service_role;
comment on table public.project_reads is 'birdsI v3 step 4: what each vendor project said when birdsI last read it, every part dated with its source.';
