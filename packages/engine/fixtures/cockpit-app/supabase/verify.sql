-- Which migrations have run on this database.
with markers (migration, kind, name, col) as (
  values
    ('0001 init: users',          'table',  'users',    null),
    ('0002 social: profiles',     'table',  'profiles', null),
    ('0002 social: users.handle', 'column', 'users',    'handle')
)
select m.migration from markers m;
