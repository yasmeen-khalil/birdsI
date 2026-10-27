-- v4 step 7: the weekly watch over the pricing pages the checked limits list
-- rests on. One row per page per check: which quoted sentences the page no
-- longer has, and what the page appears to say now, for a person to confirm.
-- The list itself is never changed by a machine.
create table if not exists public.limits_watch (
  id uuid primary key default gen_random_uuid(),
  vendor text not null,
  url text not null,
  checked_at timestamptz not null default now(),
  quotes_total integer not null default 0,
  quotes_missing jsonb not null default '[]'::jsonb,
  proposal text,
  error text
);
create index if not exists limits_watch_vendor_idx on public.limits_watch(vendor, checked_at desc);
alter table public.limits_watch enable row level security;
grant all on public.limits_watch to service_role;
comment on table public.limits_watch is 'Weekly check of the pricing pages behind the checked limits list: quoted sentences gone from a page, and the model''s reading of what it says now.';
