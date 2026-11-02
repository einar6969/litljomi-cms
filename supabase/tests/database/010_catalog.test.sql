-- supabase/tests/database/010_catalog.test.sql
-- Catalog tests (spec §8.5). Later tasks extend this file with the assertions
-- that need tables.
begin;
\ir _helpers.sql
select plan(25);

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
-- Assumes the migrations run as postgres (the local stack's migration role and
-- the role Task 4's `alter default privileges for role postgres` names); if they
-- ran as another role, this check would have to name that role.
select ok(exists (select 1 from pg_default_acl d
  where d.defaclrole = 'postgres'::regrole and d.defaclnamespace = 0 and d.defaclobjtype = 'f'
    and not exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = 0)),
  'global default privileges revoke EXECUTE on functions from PUBLIC');
-- The SECURITY DEFINER and search_path checks below already cover functions
-- (the Auth hook and the trigger functions in private). The anon-execute check
-- on api is vacuous until api holds functions (Task 10).
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
-- Trigger functions and helpers in private are executed by no API role: triggers
-- fire without an EXECUTE check, and the Auth hook is granted to
-- supabase_auth_admin only (012_auth_hook).
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'anon, authenticated and service_role execute nothing in private');

-- Tenant tables (§4.3) have tenant_id not null; later tasks add the others.
select col_not_null('cms', 'memberships', 'tenant_id', 'memberships.tenant_id is not null');
select col_not_null('cms', 'entries', 'tenant_id', 'entries.tenant_id is not null');
select col_not_null('cms', 'drafts', 'tenant_id', 'drafts.tenant_id is not null');
select col_not_null('cms', 'revisions', 'tenant_id', 'revisions.tenant_id is not null');
-- Every foreign key between two tenant tables (§4.1 rule 3, the §4.3 list) pairs
-- tenant_id with tenant_id, so a cross-tenant reference cannot exist.
select is_empty($$ with tenant_tables(names) as (values (array['memberships', 'entries', 'drafts', 'revisions',
    'draft_refs', 'revision_refs', 'assets', 'publish_requests', 'releases', 'sites', 'site_deliveries']))
  select c.conname from pg_constraint c cross join tenant_tables t
  join pg_class src on src.oid = c.conrelid join pg_namespace sn on sn.oid = src.relnamespace
  join pg_class dst on dst.oid = c.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
  where c.contype = 'f' and sn.nspname = 'cms' and dn.nspname = 'cms'
    and src.relname = any (t.names) and dst.relname = any (t.names)
    and not exists (
      select 1 from unnest(c.conkey, c.confkey) as k(src_att, dst_att)
      join pg_attribute sa on sa.attrelid = c.conrelid and sa.attnum = k.src_att
      join pg_attribute da on da.attrelid = c.confrelid and da.attnum = k.dst_att
      where sa.attname = 'tenant_id' and da.attname = 'tenant_id') $$,
  'every foreign key between tenant tables is composite with tenant_id');
-- History is append-only (§4.3, §4.5): no UPDATE or DELETE on revisions for
-- anon, authenticated or service_role (Task 10 adds audit_log).
select is_empty($$ select r.rolname, t.tbl from pg_roles r
  cross join (values ('cms.revisions')) as t(tbl)
  where r.rolname in ('anon', 'authenticated', 'service_role')
    and has_table_privilege(r.rolname, t.tbl, 'UPDATE, DELETE') $$,
  'no UPDATE or DELETE on revisions for anon, authenticated or service_role');

select * from finish();
rollback;
