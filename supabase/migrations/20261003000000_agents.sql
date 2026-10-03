-- birdsI: the operations layer for coding agents.
-- Local repositories, the owner's vision, vendors and their facts, cached
-- vendor knowledge, connected accounts, the question queue, action requests
-- and the per-repo agent policy. Same rule as the first migration: RLS on,
-- no policies, every read goes through server code that checks ownership.

-- Repositories uploaded by the terminal tool have no GitHub App behind them.
create type public.repo_source as enum ('github', 'local');
alter table public.repos add column source public.repo_source not null default 'github';
alter table public.repos add column vision text;
alter table public.repos add column vision_updated_at timestamptz;
-- One local repository per owner and name.
create unique index repos_local_owner_name_idx on public.repos(owner_user_id, full_name) where github_repo_id is null and archived_at is null;

-- Hints the CLI collected on the owner's machine (Stripe Projects state, spend).
alter table public.snapshots add column project_hints jsonb;

-- What the app depends on outside the code, per repository, replaced on every scan.
create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  scan_id uuid references public.scans(id) on delete set null,
  slug text not null,
  name text not null,
  category text not null,
  what text not null,
  purpose text,
  detected_by text[] not null default '{}',
  packages text[] not null default '{}',
  env_vars text[] not null default '{}',
  call_sites jsonb not null default '[]'::jsonb,
  pricing_url text,
  docs_url text,
  connectable boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (repo_id, slug)
);
create index vendors_repo_idx on public.vendors(repo_id);
alter table public.vendors enable row level security;

-- Facts about a vendor for this app: plan, limits, usage, cost. Each fact
-- carries its source. Facts from one source are replaced together.
create type public.fact_source as enum ('static', 'connector', 'docs', 'estimate', 'asked');

create table public.vendor_facts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  kind text not null,
  metric text not null,
  label text not null,
  value text not null,
  numeric double precision,
  unit text,
  limit_numeric double precision,
  source public.fact_source not null,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  unique (vendor_id, metric, source)
);
create index vendor_facts_vendor_idx on public.vendor_facts(vendor_id);
alter table public.vendor_facts enable row level security;

-- What is true about a vendor for every app: what it is, its tiers. Shared, cached.
create table public.vendor_knowledge (
  slug text primary key,
  name text not null,
  what text not null,
  pricing_url text,
  tiers jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table public.vendor_knowledge enable row level security;

-- Tokens the owner gave birdsI to read their vendor accounts. Encrypted at
-- rest with a server-side key; only the server ever sees the plain token.
create table public.connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.users(id) on delete cascade,
  vendor_slug text not null,
  label text,
  token_ciphertext text not null,
  -- Identifiers the connector needs besides the token (a team id, a project ref).
  settings jsonb not null default '{}'::jsonb,
  last_probed_at timestamptz,
  last_status text,
  last_error text,
  created_at timestamptz not null default now(),
  unique (owner_user_id, vendor_slug)
);
alter table public.connections enable row level security;

-- Questions only a person can answer. birdsI asks when it cannot know; agents ask through MCP.
create type public.question_status as enum ('open', 'answered', 'dismissed');

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete cascade,
  asked_by text not null check (asked_by in ('birdsi', 'agent')),
  question text not null,
  why text not null,
  options jsonb not null default '[]'::jsonb,
  lookup_url text,
  updates jsonb,
  -- Stable key so the same question is not asked twice while open.
  key text not null,
  answer text,
  status public.question_status not null default 'open',
  created_at timestamptz not null default now(),
  answered_at timestamptz
);
create unique index questions_open_key_idx on public.questions(repo_id, key) where status = 'open';
create index questions_repo_idx on public.questions(repo_id, status, created_at desc);
alter table public.questions enable row level security;

-- Actions an agent wants taken outside the code. Approved by a person,
-- executed on the owner's machine by the terminal tool, result reported back.
create type public.action_status as enum ('pending', 'approved', 'denied', 'executed', 'failed', 'expired');

create table public.action_requests (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  requested_by text not null check (requested_by in ('agent', 'birdsi', 'owner')),
  title text not null,
  reason text not null,
  command text not null,
  estimated_monthly_usd double precision,
  estimated_once_usd double precision,
  status public.action_status not null default 'pending',
  auto_approved boolean not null default false,
  decided_by uuid references public.users(id) on delete set null,
  decided_at timestamptz,
  result text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);
create index action_requests_repo_idx on public.action_requests(repo_id, status, created_at desc);
alter table public.action_requests enable row level security;

-- What agents may do in this repository.
create table public.agent_policies (
  repo_id uuid primary key references public.repos(id) on delete cascade,
  allow_read boolean not null default true,
  allow_propose boolean not null default true,
  auto_approve_under_usd double precision,
  auto_approve_prefixes text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table public.agent_policies enable row level security;

-- When vendors were last synced per repository (connectors probed, knowledge refreshed).
alter table public.repos add column vendors_synced_at timestamptz;
