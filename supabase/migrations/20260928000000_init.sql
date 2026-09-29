-- birdsI initial schema.
-- Every table has row level security enabled with no policies: the anon and
-- authenticated roles can read nothing. All access goes through server code
-- holding the service role key, which checks ownership on every query.

create extension if not exists pgcrypto;
create extension if not exists vector;

-- Users are created on first sign-in through Clerk.
create table public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  github_login text,
  github_user_id bigint,
  email text,
  email_updates boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table public.users enable row level security;

-- One row per GitHub App installation (a user account or an organisation).
create table public.installations (
  id uuid primary key default gen_random_uuid(),
  github_installation_id bigint not null unique,
  account_login text not null,
  account_type text not null,
  connected_by uuid references public.users(id) on delete set null,
  suspended_at timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.installations enable row level security;

create table public.repos (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid references public.installations(id) on delete set null,
  github_repo_id bigint unique,
  full_name text not null,
  default_branch text not null default 'main',
  private boolean not null default true,
  -- The user who connected it; team access comes later through memberships.
  owner_user_id uuid not null references public.users(id) on delete cascade,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index repos_owner_idx on public.repos(owner_user_id) where archived_at is null;
alter table public.repos enable row level security;

-- Snapshots uploaded by the CLI live in storage; this row tracks them.
create table public.snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  storage_path text not null,
  full_name text,
  branch text,
  commit_sha text,
  bytes bigint,
  uploaded_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.snapshots enable row level security;

create type public.scan_kind as enum ('light', 'deep', 'audit');
create type public.scan_status as enum ('queued', 'running', 'done', 'failed', 'stopped');
create type public.scan_source as enum ('web', 'cli', 'mcp', 'demo');

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid references public.repos(id) on delete cascade,
  snapshot_id uuid references public.snapshots(id) on delete set null,
  -- Null for demo scans.
  owner_user_id uuid references public.users(id) on delete cascade,
  kind public.scan_kind not null,
  status public.scan_status not null default 'queued',
  source public.scan_source not null,
  branch text,
  commit_sha text,
  app_description text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  summary jsonb,
  audit jsonb,
  stats jsonb,
  stop_requested_at timestamptz,
  created_at timestamptz not null default now()
);
create index scans_repo_idx on public.scans(repo_id, created_at desc);
create index scans_owner_idx on public.scans(owner_user_id, created_at desc);
alter table public.scans enable row level security;

-- Append-only progress log; the source of truth for what a scan did.
create table public.scan_events (
  scan_id uuid not null references public.scans(id) on delete cascade,
  seq integer not null,
  at timestamptz not null default now(),
  event jsonb not null,
  primary key (scan_id, seq)
);
alter table public.scan_events enable row level security;

create type public.severity as enum ('critical', 'high', 'medium', 'low');
create type public.confidence as enum ('proven', 'doc_verified', 'judgment');
create type public.action_kind as enum ('fix', 'steps');
create type public.finding_status as enum ('open', 'pr_open', 'fixed', 'dismissed');

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  repo_id uuid references public.repos(id) on delete cascade,
  key text not null,
  check_id text not null,
  title text not null,
  explanation text not null,
  why_it_matters text not null,
  severity public.severity not null,
  confidence public.confidence not null,
  category text not null,
  location jsonb,
  evidence jsonb not null default '{}'::jsonb,
  action_kind public.action_kind not null,
  steps jsonb not null default '[]'::jsonb,
  fix_plan jsonb,
  status public.finding_status not null default 'open',
  created_at timestamptz not null default now(),
  unique (scan_id, key)
);
create index findings_repo_key_idx on public.findings(repo_id, key);
alter table public.findings enable row level security;

-- Status carried across scans: a dismissed or fixed key stays that way.
create table public.finding_states (
  repo_id uuid not null references public.repos(id) on delete cascade,
  key text not null,
  status public.finding_status not null,
  updated_at timestamptz not null default now(),
  primary key (repo_id, key)
);
alter table public.finding_states enable row level security;

create table public.dependencies (
  id uuid primary key default gen_random_uuid(),
  scan_id uuid not null references public.scans(id) on delete cascade,
  ecosystem text not null,
  name text not null,
  version_in_use text not null,
  latest_version text,
  manifest_path text not null,
  direct boolean not null default true,
  vulnerabilities jsonb not null default '[]'::jsonb,
  docs_check jsonb
);
create index dependencies_scan_idx on public.dependencies(scan_id);
alter table public.dependencies enable row level security;

create type public.fix_status as enum ('proposed', 'testing', 'tested', 'pr_open', 'failed');

create table public.fixes (
  id uuid primary key default gen_random_uuid(),
  finding_id uuid not null references public.findings(id) on delete cascade,
  requested_by uuid references public.users(id) on delete set null,
  status public.fix_status not null default 'proposed',
  summary text,
  patch text,
  files jsonb,
  verify_command text,
  test_log text,
  follow_up jsonb not null default '[]'::jsonb,
  pr_number integer,
  pr_url text,
  branch_name text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index fixes_finding_idx on public.fixes(finding_id, created_at desc);
alter table public.fixes enable row level security;

-- Immutable record of every model call, priced at write time.
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  owner_user_id uuid references public.users(id) on delete set null,
  scan_id uuid references public.scans(id) on delete set null,
  fix_id uuid references public.fixes(id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens integer not null,
  output_tokens integer not null,
  cost_microdollars bigint not null,
  at timestamptz not null default now()
);
create index usage_ledger_owner_idx on public.usage_ledger(owner_user_id, at desc);
alter table public.usage_ledger enable row level security;

-- The job queue. Workers claim rows with claim_job() below.
create type public.job_status as enum ('queued', 'running', 'done', 'failed');

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null,
  status public.job_status not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 2,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index jobs_queue_idx on public.jobs(status, run_after) where status = 'queued';
alter table public.jobs enable row level security;

create or replace function public.claim_job(worker text, kinds text[])
returns setof public.jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed public.jobs;
begin
  -- Return stale running jobs to the queue first (a worker died mid-run).
  update public.jobs
     set status = 'queued', locked_by = null, locked_at = null,
         last_error = coalesce(last_error, '') || ' worker lost'
   where status = 'running' and heartbeat_at < now() - interval '3 minutes';

  select * into claimed
    from public.jobs
   where status = 'queued' and run_after <= now() and kind = any(kinds)
   order by created_at
   for update skip locked
   limit 1;
  if not found then
    return;
  end if;
  update public.jobs
     set status = 'running', locked_by = worker, locked_at = now(),
         heartbeat_at = now(), attempts = attempts + 1
   where id = claimed.id
   returning * into claimed;
  return next claimed;
end;
$$;
revoke all on function public.claim_job(text, text[]) from public, anon, authenticated;

-- Tokens for the CLI and MCP server. Only the hash is stored.
create table public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  name text not null,
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index api_tokens_owner_idx on public.api_tokens(owner_user_id);
alter table public.api_tokens enable row level security;

-- Device-code sign-in for the CLI: the terminal shows a code, the browser approves it.
create type public.device_login_status as enum ('pending', 'approved', 'denied', 'expired', 'claimed');

create table public.device_logins (
  id uuid primary key default gen_random_uuid(),
  device_code_hash text not null unique,
  user_code text not null unique,
  status public.device_login_status not null default 'pending',
  approved_by uuid references public.users(id) on delete cascade,
  token_id uuid references public.api_tokens(id) on delete set null,
  -- The plain token is held only until the CLI collects it once.
  token_plain text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.device_logins enable row level security;

-- Demo scans without sign-in, rate limited by a hashed client key.
create table public.demo_requests (
  client_hash text not null,
  at timestamptz not null default now()
);
create index demo_requests_idx on public.demo_requests(client_hash, at desc);
alter table public.demo_requests enable row level security;

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  owner_user_id uuid not null references public.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  judgment boolean not null default false,
  created_at timestamptz not null default now()
);
create index chat_messages_repo_idx on public.chat_messages(repo_id, owner_user_id, created_at);
alter table public.chat_messages enable row level security;

-- Code chunks embedded at scan time for chat retrieval.
create table public.repo_chunks (
  id bigint generated always as identity primary key,
  repo_id uuid not null references public.repos(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  path text not null,
  line_start integer not null,
  line_end integer not null,
  text text not null,
  embedding vector(4096)
);
create index repo_chunks_repo_idx on public.repo_chunks(repo_id);
alter table public.repo_chunks enable row level security;

create or replace function public.match_chunks(p_repo_id uuid, p_query vector(4096), p_limit integer)
returns table (path text, line_start integer, line_end integer, text text, similarity float)
language sql
security definer
set search_path = public
as $$
  select c.path, c.line_start, c.line_end, c.text, 1 - (c.embedding <=> p_query) as similarity
    from public.repo_chunks c
   where c.repo_id = p_repo_id and c.embedding is not null
   order by c.embedding <=> p_query
   limit p_limit;
$$;
revoke all on function public.match_chunks(uuid, vector, integer) from public, anon, authenticated;

-- Storage bucket for CLI snapshots. Private; the server signs uploads.
insert into storage.buckets (id, name, public, file_size_limit)
values ('snapshots', 'snapshots', false, 209715200)
on conflict (id) do nothing;
