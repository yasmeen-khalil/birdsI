-- supabase/verify.sql: ONE read-only query that reports which of birdsI's
-- migrations have run on THIS database. Paste the whole file into the
-- Supabase SQL editor (project BirdsI) and Run: every row shows a migration,
-- what marks it, and OK or MISSING. Every migration adds its marker rows here
-- in the same commit. birdsI's own map reads these markers, and its Supabase
-- connector checks them with its own read-only query, never by running this
-- file.
--
-- Kinds: table, column, function (a function in public by name), comment (a
-- function whose comment starts with the text in col), table_comment (a table
-- whose comment starts with the text in col), no_table, no_column.
-- 20261003000100_grants.sql grants privileges and has no marker these kinds
-- can see: if every other row is OK and the server can read the tables, it ran.

with markers (migration, kind, name, col) as (
  values
    ('20260928000000 init: users',               'table',    'users',               null),
    ('20260928000000 init: repos',               'table',    'repos',               null),
    ('20260928000000 init: scans',               'table',    'scans',               null),
    ('20260928000000 init: findings',            'table',    'findings',            null),
    ('20260928000000 init: jobs',                'table',    'jobs',                null),
    ('20260928000000 init: claim_job',           'function', 'claim_job',           null),
    ('20261003000000 agents: vendors',           'table',    'vendors',             null),
    ('20261003000000 agents: vendor facts',      'table',    'vendor_facts',        null),
    ('20261003000000 agents: connections',       'table',    'connections',         null),
    ('20261003000000 agents: questions',         'table',    'questions',           null),
    ('20261003000000 agents: vision',            'column',   'repos',               'vision'),
    ('20261003000200 fact history',              'table',    'vendor_fact_history', null),
    ('20261006000000 queue priority',            'column',   'jobs',                'priority'),
    ('20261006000000 worker presence',           'table',    'workers',             null),
    ('20261006000100 record',                    'table',    'record_entries',      null),
    ('20261006000100 agent writes',              'column',   'agent_policies',      'allow_write'),
    ('20261018000000 v3 retired tables',         'table_comment', 'chat_messages',  'Retired in birdsI v3'),
    ('20261018000100 apps',                      'table',    'apps',                null),
    ('20261018000100 app projects',              'table',    'app_projects',        null),
    ('20261018000100 keys per project',          'column',   'connections',         'app_project_id'),
    ('20261018000200 service maps',              'table',    'service_maps',        null),
    ('20261018000300 project reads',             'table',    'project_reads',       null),
    ('20261018000400 alerts',                    'table',    'alerts',              null),
    ('20261018000400 dates to watch',            'table',    'app_deadlines',       null),
    ('20261027000000 manual entries',            'table',    'app_entries',         null),
    ('20261027000100 limits watch',              'table',    'limits_watch',        null)
)
select
  m.migration,
  m.name || coalesce('.' || m.col, '') as marker,
  case
    when m.kind = 'table' and exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = m.name
    ) then 'OK'
    when m.kind = 'column' and exists (
      select 1 from information_schema.columns where table_schema = 'public' and table_name = m.name and column_name = m.col
    ) then 'OK'
    when m.kind = 'function' and exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = m.name
    ) then 'OK'
    when m.kind = 'comment' and exists (
      select 1 from pg_proc p join pg_description d on d.objoid = p.oid where p.proname = m.name and d.description like m.col || '%'
    ) then 'OK'
    when m.kind = 'table_comment' and exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = m.name and obj_description(c.oid, 'pg_class') like m.col || '%'
    ) then 'OK'
    when m.kind = 'no_table' and not exists (
      select 1 from information_schema.tables where table_schema = 'public' and table_name = m.name
    ) then 'OK'
    when m.kind = 'no_column' and not exists (
      select 1 from information_schema.columns where table_schema = 'public' and table_name = m.name and column_name = m.col
    ) then 'OK'
    else 'MISSING: run the migration named on this row'
  end as status
from markers m
order by m.migration;
