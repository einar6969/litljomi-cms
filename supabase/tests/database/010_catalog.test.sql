-- supabase/tests/database/010_catalog.test.sql
-- Catalog tests (spec §8.5). Later tasks extend this file with the assertions
-- that need tables.
begin;
\ir _helpers.sql
select plan(19);

select has_schema('api');
select has_schema('cms');
select has_schema('private');
select ok(not has_schema_privilege('anon', 'cms', 'usage'), 'anon has no usage on cms');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no usage on private');
select ok(not has_schema_privilege('service_role', 'private', 'usage'), 'service_role has no usage on private');
select ok(has_schema_privilege('authenticated', 'api', 'usage'), 'authenticated has usage on api');
select ok(has_schema_privilege('authenticated', 'cms', 'usage'), 'authenticated has usage on cms');
select ok(has_schema_privilege('service_role', 'api', 'usage'), 'service_role has usage on api');
select ok(has_schema_privilege('service_role', 'cms', 'usage'), 'service_role has usage on cms');
select is_empty($$ select 1 from pg_extension where extname = 'pg_graphql' $$, 'pg_graphql is disabled');
-- EXECUTE is revoked from PUBLIC globally (§4.5): postgres's default ACL for
-- functions in all schemas (defaclnamespace 0) exists and has no PUBLIC entry.
select ok(exists (select 1 from pg_default_acl d
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
    and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
  'global default privileges revoke EXECUTE on functions from PUBLIC');
-- The three function checks below are vacuous for a schema until it holds
-- functions: private has the Auth hook and trigger functions; api has none
-- until Task 10, so the anon-execute check proves nothing before then.
-- no SECURITY DEFINER anywhere in our schemas
select is_empty($$ select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api','cms','private') and p.prosecdef $$, 'no security definer functions');
-- every function in our schemas pins search_path to ''
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api','cms','private')
    and not coalesce(p.proconfig @> array['search_path=""'], false) $$, 'search_path pinned');
-- nothing in api is executable by anon (hence PUBLIC)
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'execute') $$, 'anon executes nothing in api');

-- Tables (§8.5): every cms table has RLS enabled; anon has no privilege on cms.
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p') and not c.relrowsecurity $$, 'RLS enabled on every cms table');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) $$,
  'anon has no privilege on any cms table');
-- Tenant tables (§4.3) have tenant_id not null; later tasks add the others.
select col_not_null('cms', 'memberships', 'tenant_id', 'memberships.tenant_id is not null');

select * from finish();
rollback;
