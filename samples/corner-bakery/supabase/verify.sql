-- supabase/verify.sql: one read-only query that reports which of Corner Bakery's
-- migrations have run on this database. Paste it into the Supabase SQL editor and
-- Run: every row shows a migration, what marks it, and OK or MISSING. birdsI reads
-- these markers from the code and checks them against the connected database.
with markers (migration, kind, name, col) as (
  values
    ('0001 init: customers',        'table',  'customers',  null),
    ('0001 init: orders',           'table',  'orders',     null),
    ('0001 init: menu items',       'table',  'menu_items', null),
    ('0001 init: search_menu',      'function', 'search_menu', null),
    ('0002 specials: special_since', 'column', 'menu_items', 'special_since')
)
select m.migration, m.kind, m.name, m.col,
  case
    when m.kind = 'table' and exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = m.name) then 'OK'
    when m.kind = 'column' and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = m.name and column_name = m.col) then 'OK'
    when m.kind = 'function' and exists (select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.name) then 'OK'
    else 'MISSING'
  end as status
from markers m
order by m.migration;
