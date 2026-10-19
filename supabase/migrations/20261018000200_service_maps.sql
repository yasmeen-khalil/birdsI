-- birdsI v3 step 3 (2026-10-18): the service map of each app, kept and dated.
-- Safe to run more than once.
--
-- A service map is what birdsI reads from an app's code by rules, with the
-- file and line of every entry: the services and SDKs, the env names each
-- deployment needs, the crons and their handlers, the webhooks and who sends
-- them, the store apps, the migrations the repository holds and the public
-- pages. It names env variables and never holds a value. Each map of the code
-- stores one, so the cockpit always has the latest and the ones before it to
-- compare with. The map job keeps the newest 30 per repository.

create table if not exists public.service_maps (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  app_id uuid references public.apps(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  commit_sha text,
  branch text,
  map jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists service_maps_repo_idx on public.service_maps(repo_id, created_at desc);
alter table public.service_maps enable row level security;
grant all on public.service_maps to service_role;
comment on table public.service_maps is 'birdsI v3 step 3: the dated service map of each app, read from its code by rules.';
