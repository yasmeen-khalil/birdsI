-- A priority lane for the jobs a person is waiting on (quick checks, fixes)
-- and a presence record per worker process, so the app can say when no
-- scanner is running instead of "starts in a moment".
alter table public.jobs add column if not exists priority integer not null default 0;
drop index if exists public.jobs_queue_idx;
create index jobs_queue_idx on public.jobs(status, priority desc, run_after) where status = 'queued';

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
   order by priority desc, created_at
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

create table if not exists public.workers (
  id text primary key,
  hostname text not null,
  version text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  current_job_id uuid
);
alter table public.workers enable row level security;
grant all on public.workers to service_role;
