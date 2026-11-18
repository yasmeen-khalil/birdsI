-- Access by approval. A new account starts as pending: it can sign in and ask
-- for access, and nothing else. The owner approves or denies each request.
-- Accounts that existed before this migration keep their access. The block
-- runs once: a second run finds the column and changes nothing.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'access'
  ) then
    alter table public.users add column access text not null default 'pending' check (access in ('pending', 'approved', 'denied'));
    alter table public.users add column access_requested_at timestamptz;
    alter table public.users add column access_decided_at timestamptz;
    update public.users set access = 'approved', access_decided_at = now();
  end if;
end $$;
create index if not exists users_access_idx on public.users(access, access_requested_at);
comment on column public.users.access is 'pending, approved or denied. Only an approved account can use birdsI.';
