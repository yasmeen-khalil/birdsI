-- Server access only. With "automatically expose new tables" off, Supabase
-- grants nothing on new tables; the server role still needs full access,
-- and anon and authenticated keep none (every table has RLS on with no
-- policies as well). Future tables inherit the same grants.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
