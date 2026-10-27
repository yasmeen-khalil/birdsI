-- v4 step 6: what no API reports, entered by the owner. A subscription or a
-- fee counts in the money section as entered by hand, a credit and a note are
-- listed beside it, and a renewal date joins the alerts like a date to watch.
create table if not exists public.app_entries (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps(id) on delete cascade,
  vendor text,
  kind text not null check (kind in ('subscription', 'fee', 'credit', 'note')),
  label text not null,
  amount_usd numeric(12, 2),
  period text check (period in ('month', 'year', 'once')),
  renews_on date,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists app_entries_app_idx on public.app_entries(app_id, created_at desc);
alter table public.app_entries enable row level security;
grant all on public.app_entries to service_role;
comment on table public.app_entries is 'What no API reports, entered by the owner: a subscription, a fee, a credit, a note. Counted in the money section as entered by hand.';
