-- birdsI v3 step 2 (2026-10-18): apps and the vendor projects they have, and
-- connections tied to one project each. Safe to run more than once.
--
-- An app is the owner's own record: a name, the repository its code lives in,
-- the environments it runs in, and the vendor projects it has (a Vercel app
-- project and an ops project, a Supabase project ref, a Clerk instance, a
-- OneSignal app id, a RevenueCat project, a Stripe account, an App Store app
-- id, a Resend domain). A connection is a read key for one of those projects,
-- with a label, never one per vendor per person.
--
-- Nothing is lost: every repository becomes an app, and every existing
-- connection keeps its key. An owner with a single app has each connection
-- tied to a project built from the connection's own settings. An owner with
-- several apps keeps the connections as they are, untied, and birdsI shows
-- them in Settings to tie to a project in one step; until then they are read
-- the way they were before.

create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  repo_id uuid not null unique references public.repos(id) on delete cascade,
  name text not null,
  environments text[] not null default '{production}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists apps_owner_idx on public.apps(owner_user_id);
alter table public.apps enable row level security;
grant all on public.apps to service_role;

create table if not exists public.app_projects (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  -- The vendor's slug in birdsI's catalog: vercel, supabase, onesignal, ...
  vendor text not null,
  -- What the ref names at that vendor: project, team, organization, instance, app, account, domain.
  kind text not null,
  -- The vendor's own id or name for it.
  ref text not null,
  -- The owner's word for it: product, ops, schools.
  label text,
  -- production, preview or development, or null when it serves every environment.
  environment text,
  -- The plan, only when the vendor's API does not say it.
  plan text,
  -- Identifiers a reader needs besides the ref, such as a Vercel team id. Never a key.
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (app_id, vendor, kind, ref)
);
create index if not exists app_projects_app_idx on public.app_projects(app_id);
alter table public.app_projects enable row level security;
grant all on public.app_projects to service_role;

alter table public.connections add column if not exists app_id uuid references public.apps(id) on delete cascade;
alter table public.connections add column if not exists app_project_id uuid references public.app_projects(id) on delete cascade;
-- Read keys only in this phase. Write keys come later, each write behind an approval and a log.
alter table public.connections add column if not exists scope text not null default 'read';
alter table public.connections drop constraint if exists connections_scope_read_only;
alter table public.connections add constraint connections_scope_read_only check (scope = 'read');
-- A keyed hash of the key, so birdsI can say two projects share a key without ever comparing keys.
alter table public.connections add column if not exists key_fingerprint text;
alter table public.connections drop constraint if exists connections_owner_user_id_vendor_slug_key;
create unique index if not exists connections_project_idx on public.connections(app_project_id) where app_project_id is not null;
create index if not exists connections_app_idx on public.connections(app_id);

-- Every repository is an app, named after the repository.
insert into public.apps (owner_user_id, repo_id, name)
select r.owner_user_id, r.id, regexp_replace(r.full_name, '^.*/', '')
from public.repos r
where r.archived_at is null
  and not exists (select 1 from public.apps a where a.repo_id = r.id);

-- An owner with exactly one app: each untied connection becomes a project of
-- that app, named from the connection's own settings. (Before this migration an
-- owner had at most one connection per vendor, so each maps to one project.)
create or replace function pg_temp.birdsi_project_kind(vendor text, settings jsonb) returns text language sql immutable as $$
  select case
    when vendor = 'vercel' and coalesce(settings->>'teamId', '') <> '' then 'team'
    when vendor = 'supabase' and coalesce(settings->>'projectRef', '') <> '' then 'project'
    when vendor = 'supabase' then 'organization'
    else 'account'
  end
$$;
create or replace function pg_temp.birdsi_project_ref(vendor text, settings jsonb) returns text language sql immutable as $$
  select case
    when vendor = 'vercel' and coalesce(settings->>'teamId', '') <> '' then settings->>'teamId'
    when vendor = 'supabase' and coalesce(settings->>'projectRef', '') <> '' then settings->>'projectRef'
    when vendor = 'supabase' and coalesce(settings->>'orgSlug', '') <> '' then settings->>'orgSlug'
    else vendor
  end
$$;

insert into public.app_projects (app_id, vendor, kind, ref, settings)
select a.id, c.vendor_slug,
       pg_temp.birdsi_project_kind(c.vendor_slug, c.settings),
       pg_temp.birdsi_project_ref(c.vendor_slug, c.settings),
       coalesce(c.settings, '{}'::jsonb)
from public.connections c
join public.apps a on a.owner_user_id = c.owner_user_id
where c.app_project_id is null
  and (select count(*) from public.apps o where o.owner_user_id = c.owner_user_id) = 1
on conflict (app_id, vendor, kind, ref) do nothing;

update public.connections c
   set app_id = p.app_id, app_project_id = p.id
  from public.apps a, public.app_projects p
 where c.app_project_id is null
   and a.owner_user_id = c.owner_user_id
   and (select count(*) from public.apps o where o.owner_user_id = c.owner_user_id) = 1
   and p.app_id = a.id
   and p.vendor = c.vendor_slug
   and p.kind = pg_temp.birdsi_project_kind(c.vendor_slug, c.settings)
   and p.ref = pg_temp.birdsi_project_ref(c.vendor_slug, c.settings)
   and not exists (select 1 from public.connections other where other.app_project_id = p.id);
