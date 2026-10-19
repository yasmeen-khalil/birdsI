-- birdsI v3 step 5 (2026-10-18): the alert stream, and the dates the owner
-- asks to be warned about. Safe to run more than once.
--
-- An alert is one cause, written by the hourly read from the service map, the
-- project reads, the account facts and the dates to watch: a paused project,
-- a failed deployment, a cron that does not run, an env name a deployment
-- lacks, a migration its database still owes, a plan near its limit, a date
-- coming up, a project that could not be read. It stays one row while the
-- cause stays (seen_at moves), and is closed (resolved_at) when a read that
-- checks it no longer finds it. A cause that comes back opens a new row.
-- email_status says whether the alert was emailed, or why not.

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  app_project_id uuid references public.app_projects(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('critical', 'warning', 'notice')),
  sentence text not null,
  action text,
  details jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  scope text not null,
  opened_at timestamptz not null default now(),
  seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  email_status text,
  emailed_at timestamptz
);
create unique index if not exists alerts_one_open_per_cause on public.alerts(app_id, dedupe_key) where resolved_at is null;
create index if not exists alerts_app_idx on public.alerts(app_id, opened_at desc);
alter table public.alerts enable row level security;
grant all on public.alerts to service_role;
comment on table public.alerts is 'birdsI v3 step 5: the alert stream, one row per cause, closed when a read no longer finds it.';

create table if not exists public.app_deadlines (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  vendor text,
  label text not null,
  due_on date not null,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists app_deadlines_app_idx on public.app_deadlines(app_id, due_on);
alter table public.app_deadlines enable row level security;
grant all on public.app_deadlines to service_role;
