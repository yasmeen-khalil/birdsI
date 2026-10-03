-- Usage observations over time, so birdsI can say when a limit runs out at
-- the observed rate. Appended on every sync; never updated.
create table public.vendor_fact_history (
  id bigint generated always as identity primary key,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  metric text not null,
  numeric double precision not null,
  limit_numeric double precision,
  observed_at timestamptz not null default now()
);
create index vendor_fact_history_idx on public.vendor_fact_history(vendor_id, metric, observed_at desc);
alter table public.vendor_fact_history enable row level security;
grant all on public.vendor_fact_history to service_role;
grant all on all sequences in schema public to service_role;
