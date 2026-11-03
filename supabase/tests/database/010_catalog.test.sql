-- supabase/tests/database/010_catalog.test.sql
-- Catalog tests (spec §8.5). Later tasks extend this file with the assertions
-- that need tables.
begin;
\ir _helpers.sql
select plan(40);

select has_schema('api');
select has_schema('cms');
select has_schema('private');
select ok(not has_schema_privilege('anon', 'cms', 'usage'), 'anon has no usage on cms');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
-- The reference triggers run as the invoking role and call private.extract_refs,
-- so authenticated and service_role have usage on private (spec §4.5
-- "Reference-extraction grant", plan decision 26); what they may execute there
-- is pinned below.
select ok(has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has usage on private (decision 26)');
select ok(has_schema_privilege('service_role', 'private', 'usage'), 'service_role has usage on private (decision 26)');
select ok(not has_schema_privilege('authenticated', 'private', 'create'), 'authenticated cannot create in private');
select ok(not has_schema_privilege('service_role', 'private', 'create'), 'service_role cannot create in private');
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
-- The SECURITY DEFINER and search_path checks below cover every function in
-- these schemas: the Auth hook, the trigger functions in private and the api
-- functions (Task 10 on).
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
-- ... and the check above is not vacuous.
select ok(exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api'),
  'api holds functions (so the anon check is not vacuous)');
-- No api function carries a PUBLIC grant, and none has a null ACL (a null ACL
-- means the built-in default, which includes EXECUTE for PUBLIC).
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) $$,
  'no api function is executable by PUBLIC');
-- worker_* and admin_* (§4.6, §8.1 item 2; plan Task 11): EXECUTE for
-- service_role only; the owner (postgres) is the only other grantee. 29 = 23
-- worker_* (11 from Task 11, worker_claim_request and worker_record_alert from
-- Task 19, worker_tenants_to_release and worker_deliveries_to_retry from
-- Task 21, worker_fail_stale_releases and worker_pointer_check from Task 30,
-- worker_next_attempt_at and worker_release_retry from M3-02, worker_asset_metadata and
-- worker_private_orphans from M3-07, worker_preview_sites from M3-10,
-- worker_claim_alert_email from M3-04)
-- + 6 admin_* functions (3 from Task 11, admin_set_preview_secret from M3-10,
-- admin_outdated_drafts and admin_migrate_draft from M2-13; the same counts as
-- 100_escalation); a task that adds
-- one updates both files.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname ~ '^(worker|admin)_'), 29,
  'api holds the 29 worker_* and admin_* functions (so the checks below are not vacuous)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname ~ '^(worker|admin)_'
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')) $$,
  'every worker_* and admin_* function is executable by service_role and not by authenticated or anon');
select is_empty($$ select p.oid::regprocedure::text, a.grantee::regrole::text from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace, aclexplode(p.proacl) a
  where n.nspname = 'api' and p.proname ~ '^(worker|admin)_'
    and (a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role')) $$,
  'worker_* and admin_* grantees: postgres (owner) and service_role only');
-- The editor's functions and the worker's never overlap: no api function is
-- executable by both authenticated and service_role.
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and has_function_privilege('authenticated', p.oid, 'execute')
    and has_function_privilege('service_role', p.oid, 'execute') $$,
  'no api function is executable by both authenticated and service_role');

-- Relations in api (§4.2): security_invoker views only, nothing for anon or PUBLIC.
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relkind <> 'v' $$, 'api holds no relation but views');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relkind = 'v'
    and not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'every api view is security_invoker');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api'
    and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
         or c.relacl is null
         or exists (select 1 from aclexplode(c.relacl) a where a.grantee = 0)) $$,
  'anon and PUBLIC have no privilege on any api relation');

-- The same rules for every function postgres owns, in any schema (§4.2 "no
-- SECURITY DEFINER anywhere"; Task 4 security r1, Minor 2). Supabase's
-- per-schema default ACLs still grant EXECUTE to anon, authenticated and
-- service_role on functions created in public and storage, so a function
-- created there by a migration would be reachable at once. Excluded:
-- extension members (pg_depend deptype 'e'), whose definitions come from the
-- extension's own scripts, not from our migrations (pgTAP, installed by the
-- test runner as postgres, is one). Functions owned by Supabase's roles
-- (supabase_admin, supabase_auth_admin, supabase_storage_admin, ...) are not
-- ours and are not checked.
create function tests.postgres_functions() returns setof oid
language sql
set search_path = ''
as $$
  select p.oid from pg_catalog.pg_proc p
  where p.proowner = 'postgres'::regrole
    and not exists (select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
$$;
select is_empty($$ select p.oid::regprocedure::text from pg_proc p
  where p.oid in (select tests.postgres_functions()) and p.prosecdef $$,
  'no security definer function owned by postgres, in any schema');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p
  where p.oid in (select tests.postgres_functions())
    and not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'every function owned by postgres, in any schema, pins search_path to ''''');
-- Our functions live in api, cms and private only (tests is this suite's own
-- schema, rolled back with it), never in public, storage or another schema
-- whose default ACLs grant EXECUTE to the API roles.
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.oid in (select tests.postgres_functions()) and n.nspname not in ('api', 'cms', 'private', 'tests') $$,
  'postgres owns no function outside api, cms, private (and the test schema)');
-- anon executes none of them (the test helpers in tests are granted to anon on
-- purpose and are excluded).
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.oid in (select tests.postgres_functions()) and n.nspname <> 'tests'
    and has_function_privilege('anon', p.oid, 'execute') $$,
  'anon executes no function owned by postgres');

-- Tables (§8.5): every cms table has RLS enabled; anon has no privilege on cms.
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p') and not c.relrowsecurity $$, 'RLS enabled on every cms table');
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p', 'v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
         or has_any_column_privilege('anon', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) $$,
  'anon has no privilege on any cms table');
-- Functions in private: triggers fire without an EXECUTE check, and the Auth hook
-- is granted to supabase_auth_admin only (012_auth_hook). The one exception is
-- private.extract_refs, which the reference triggers call as the invoking role
-- (decision 26): executable by authenticated and service_role, never by anon.
select is_empty($$ select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.oid <> 'private.extract_refs(jsonb)'::regprocedure
    and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('service_role', p.oid, 'execute')) $$,
  'anon, authenticated and service_role execute nothing in private except extract_refs');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'private.extract_refs(jsonb)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('authenticated', 'EXECUTE'), ('service_role', 'EXECUTE') $$,
  'extract_refs grantees are exactly postgres, authenticated and service_role (not PUBLIC, anon)');

-- Tenant tables: the definitive list in §4.3, in one place. Tables that later
-- tasks create are checked as soon as they exist.
create function tests.tenant_tables() returns text[]
language sql
set search_path = ''
as $$
  select array['memberships', 'entries', 'drafts', 'revisions', 'draft_refs', 'revision_refs', 'assets',
               'publish_requests', 'releases', 'sites', 'site_deliveries']
$$;
-- Every cms table with a tenant_id column is in the list, so a new table cannot
-- escape the checks below. audit_log is the one exception (§4.3: nullable
-- tenant_id, its own policies; Task 10).
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped
  where n.nspname = 'cms' and c.relkind in ('r', 'p')
    and c.relname <> all (tests.tenant_tables()) and c.relname <> 'audit_log' $$,
  'every cms table with a tenant_id column is a §4.3 tenant table');
-- Every tenant table that exists has tenant_id not null (§4.1 rule 3).
select is_empty($$ select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p') and c.relname = any (tests.tenant_tables())
    and not exists (select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'tenant_id' and a.attnotnull and not a.attisdropped) $$,
  'every existing tenant table has tenant_id not null');
-- The tenant tables created so far (this list grows with each task), so the two
-- checks above cannot pass because a table is missing.
select set_eq($$ select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'cms' and c.relkind in ('r', 'p') and c.relname = any (tests.tenant_tables()) $$,
  array['memberships', 'entries', 'drafts', 'revisions', 'draft_refs', 'revision_refs', 'assets',
        'publish_requests', 'releases', 'sites', 'site_deliveries'],
  'tenant tables created so far: all eleven of the §4.3 list');
-- Every foreign key between two tenant tables (§4.1 rule 3, the §4.3 list) pairs
-- tenant_id with tenant_id, so a cross-tenant reference cannot exist.
select is_empty($$ select c.conname from pg_constraint c
  join pg_class src on src.oid = c.conrelid join pg_namespace sn on sn.oid = src.relnamespace
  join pg_class dst on dst.oid = c.confrelid join pg_namespace dn on dn.oid = dst.relnamespace
  where c.contype = 'f' and sn.nspname = 'cms' and dn.nspname = 'cms'
    and src.relname = any (tests.tenant_tables()) and dst.relname = any (tests.tenant_tables())
    and not exists (
      select 1 from unnest(c.conkey, c.confkey) as k(src_att, dst_att)
      join pg_attribute sa on sa.attrelid = c.conrelid and sa.attnum = k.src_att
      join pg_attribute da on da.attrelid = c.confrelid and da.attnum = k.dst_att
      where sa.attname = 'tenant_id' and da.attname = 'tenant_id') $$,
  'every foreign key between tenant tables is composite with tenant_id');
-- History is append-only (§4.3, §4.5): no UPDATE (table or column), DELETE or
-- TRUNCATE on revisions and audit_log for anon, authenticated or service_role.
select is_empty($$ select r.rolname, t.tbl from pg_roles r
  cross join (values ('cms.revisions'), ('cms.audit_log')) as t(tbl)
  where r.rolname in ('anon', 'authenticated', 'service_role')
    and (has_table_privilege(r.rolname, t.tbl, 'UPDATE, DELETE, TRUNCATE')
         or has_any_column_privilege(r.rolname, t.tbl, 'UPDATE')) $$,
  'no UPDATE, DELETE or TRUNCATE on revisions or audit_log for anon, authenticated or service_role');

select * from finish();
rollback;
