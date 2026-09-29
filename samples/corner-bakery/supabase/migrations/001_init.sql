create table customers (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  phone text,
  created_at timestamptz default now()
);
alter table customers enable row level security;
create policy "customers read own" on customers for select using (auth.uid() = id);

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references customers(id),
  items jsonb not null,
  total_cents integer not null,
  status text not null default 'pending',
  payment_intent text,
  created_at timestamptz default now()
);

create table menu_items (
  id serial primary key,
  name text not null,
  price_cents integer not null,
  special boolean default false
);

create or replace function search_menu(query text)
returns setof menu_items
language plpgsql
as $$
begin
  return query execute 'select * from menu_items where name ilike ''' || query || '''';
end;
$$;
