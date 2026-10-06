-- The record: everything written about an app by its owner, its coding agents
-- or birdsI itself, append-only, so a decision made once is never asked again
-- and every change outside the code has an author and a reason.
create table public.record_entries (
  id uuid primary key default gen_random_uuid(),
  repo_id uuid not null references public.repos(id) on delete cascade,
  kind text not null,
  author_kind text not null,
  author_label text,
  subject text,
  text text not null,
  why text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index record_entries_repo_idx on public.record_entries(repo_id, created_at desc);
create index record_entries_kind_idx on public.record_entries(repo_id, kind, created_at desc);
alter table public.record_entries enable row level security;
grant all on public.record_entries to service_role;

-- Agents may write to the record (decisions, facts in their own name, fixed marks); always logged.
alter table public.agent_policies add column if not exists allow_write boolean not null default true;

-- A fact an agent states carries its own source, shown as such and outranked by the account and the owner.
alter type public.fact_source add value if not exists 'agent';
