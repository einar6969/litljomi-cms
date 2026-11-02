-- supabase/tests/database/010_catalog.test.sql
-- Catalog tests (spec §8.5). Later tasks extend this file with the assertions
-- that need tables.
begin;
\ir _helpers.sql
select plan(10);

select has_schema('api');
select has_schema('cms');
select has_schema('private');
select ok(not has_schema_privilege('anon', 'cms', 'usage'), 'anon has no usage on cms');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no usage on private');
select is_empty($$ select 1 from pg_extension where extname = 'pg_graphql' $$, 'pg_graphql is disabled');
-- no SECURITY DEFINER anywhere in our schemas
select is_empty($$ select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api','cms','private') and p.prosecdef $$, 'no security definer functions');
-- every function in our schemas pins search_path to ''
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('api','cms','private')
    and not coalesce(p.proconfig @> array['search_path=""'], false) $$, 'search_path pinned');
-- nothing in api is executable by anon or PUBLIC
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and has_function_privilege('anon', p.oid, 'execute') $$, 'anon executes nothing in api');

select * from finish();
rollback;
