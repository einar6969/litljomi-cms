-- supabase/tests/database/100_escalation.test.sql
-- Privilege escalation (spec §4.2, §4.5, §4.6, §8.1; plan Task 11): editors
-- and anon cannot reach the worker's or the CLI's functions, anon cannot reach
-- any api function or view, and an editor cannot move a row to another tenant
-- or publish another tenant's entry.
--
-- Every api function is called with null arguments of its parameter types
-- (tests.api_functions); EXECUTE is checked before the body runs, so a refused
-- call never runs it, and tests.sqlstate_of runs each call in its own
-- subtransaction, so nothing a call did survives it.
--
-- Fixtures (owner context): entry ca01 (labak) and ca02 (demo), each with a
-- draft at version 1.
begin;
\ir _helpers.sql
select plan(29);

-- Every function in api, with a call statement passing a typed null for each
-- parameter. Reads only pg_catalog, so any role can run it.
create function tests.api_functions() returns table (name text, call text)
language sql
set search_path = ''
as $$
  select p.proname::text,
         pg_catalog.format('select %I.%I(%s)', n.nspname, p.proname,
           coalesce((select pg_catalog.string_agg('null::' || pg_catalog.format_type(t.oid, null), ', ' order by t.ord)
                     from pg_catalog.unnest(p.proargtypes::oid[]) with ordinality as t (oid, ord)), ''))
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
$$;
-- Every view in api, with a select statement.
create function tests.api_views() returns table (name text, query text)
language sql
set search_path = ''
as $$
  select c.relname::text, pg_catalog.format('select * from %I.%I', n.nspname, c.relname)
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'api' and c.relkind = 'v'
$$;
-- The SQLSTATE a statement raises as the current role ('00000' if none).
create function tests.sqlstate_of(p_sql text) returns text
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return '00000';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.api_functions(), tests.api_views(), tests.sqlstate_of(text)
  to anon, authenticated, service_role;

-- The lists are not vacuous: 9 editor, 22 worker and 4 admin functions; 6 views.
-- A task that adds an api function or view updates these counts (and 010's 26).
select is((select count(*)::int from tests.api_functions()), 35, 'api holds 35 functions');
select is((select count(*)::int from tests.api_functions() where name ~ '^(worker|admin)_'), 26,
  '26 of them are worker_* or admin_*');
select is((select count(*)::int from tests.api_views()), 6, 'api holds 6 views');

select tests.seed();
insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('ca01'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('ca02'), tests.tenant('demo'), 'news', tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values
  (tests.entry('ca01'), tests.tenant('labak'), 1, tests.persona('editor_labak')),
  (tests.entry('ca02'), tests.tenant('demo'), 1, tests.persona('editor_demo'));

-- ---------------------------------------------------------------------------
-- An editor: 42501 on every worker_* and admin_* function.
select tests.act_as(tests.persona('editor_labak'));
select is_empty($$ select name, tests.sqlstate_of(call) from tests.api_functions()
                   where name ~ '^(worker|admin)_' and tests.sqlstate_of(call) <> '42501' $$,
  'editor_labak: every worker_* and admin_* function raises 42501');
-- The same, named, for the functions that matter most.
select throws_ok($$ select * from api.worker_claim_requests(1) $$, '42501', null,
  'editor_labak cannot claim requests');
select throws_ok($$ select api.worker_commit_publish(gen_random_uuid(), 1, 1, 'T', null) $$, '42501', null,
  'editor_labak cannot commit');
select throws_ok($$ select api.worker_claim_request(gen_random_uuid()) $$, '42501', null,
  'editor_labak cannot claim a request by id');
select throws_ok($$ select api.worker_record_alert(tests.tenant('labak'), 'probe', null) $$, '42501', null,
  'editor_labak cannot record an alert');
select throws_ok($$ select * from api.worker_sites(tests.tenant('labak')) $$, '42501', null,
  'editor_labak cannot read site secrets');
select throws_ok($$ select api.admin_create_site(tests.tenant('labak'), 'http://x', 'http://x/r', null, 'x') $$, '42501', null,
  'editor_labak cannot create a site');
select throws_ok($$ select * from api.worker_preview_sites(tests.tenant('labak')) $$, '42501', null,
  'editor_labak cannot read preview secrets (M3-10)');
select throws_ok($$ select api.admin_set_preview_secret(gen_random_uuid(), 'x') $$, '42501', null,
  'editor_labak cannot set a preview secret (M3-10)');
select throws_ok($$ select api.admin_add_membership(tests.tenant('demo'), tests.persona('editor_labak')) $$, '42501', null,
  'editor_labak cannot add itself to another tenant');
select throws_ok($$ select api.admin_create_tenant('ny', 'Ný') $$, '42501', null, 'editor_labak cannot create a tenant');

-- A platform admin at aal2 is an authenticated user too: no worker or admin functions.
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select name from tests.api_functions()
                   where name ~ '^(worker|admin)_' and tests.sqlstate_of(call) <> '42501' $$,
  'platform_admin at aal2: every worker_* and admin_* function raises 42501');

-- An editor cannot move a row to another tenant (§4.5 column grants).
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ update cms.entries set tenant_id = tests.tenant('demo') where id = tests.entry('ca01') $$,
  '42501', null, 'editor updating entries.tenant_id: 42501');
select throws_ok($$ update cms.drafts set tenant_id = tests.tenant('demo') where entry_id = tests.entry('ca01') $$,
  '42501', null, 'editor updating drafts.tenant_id: 42501');
-- An editor cannot publish another tenant's entry: the tenant comes from the
-- row, which RLS hides (§4.5, §4.6).
select throws_ok($$ select api.request_publish(tests.entry('ca02'), 1) $$, 'P0001', 'not_found',
  'editor_labak calling request_publish on a demo entry: not_found');
select throws_ok($$ select api.request_unpublish(tests.entry('ca02')) $$, 'P0001', 'not_found',
  'editor_labak calling request_unpublish on a demo entry: not_found');
select tests.act_as_owner();
select is((select count(*)::int from cms.publish_requests), 0, 'no request was created');

-- ---------------------------------------------------------------------------
-- anon: 42501 on every api function and view.
select tests.act_as_anon();
select is_empty($$ select name, tests.sqlstate_of(call) from tests.api_functions()
                   where tests.sqlstate_of(call) <> '42501' $$,
  'anon: every api function raises 42501');
select is_empty($$ select name, tests.sqlstate_of(query) from tests.api_views()
                   where tests.sqlstate_of(query) <> '42501' $$,
  'anon: every api view raises 42501');
select throws_ok($$ select api.request_publish(gen_random_uuid(), 1) $$, '42501', null,
  'anon cannot request publication');
select throws_ok($$ select * from api.worker_claim_requests(1) $$, '42501', null, 'anon cannot claim requests');
select throws_ok($$ select * from api.worker_sites(tests.tenant('labak')) $$, '42501', null, 'anon cannot read site secrets');
select throws_ok($$ select * from api.worker_preview_sites(tests.tenant('labak')) $$, '42501', null, 'anon cannot read preview secrets (M3-10)');

-- ---------------------------------------------------------------------------
-- service_role is the worker, not an editor: no editor function (they rely on
-- auth.uid() and RLS, which the secret key would bypass).
select tests.act_as_service();
select is_empty($$ select name from tests.api_functions()
                   where name !~ '^(worker|admin)_' and tests.sqlstate_of(call) <> '42501' $$,
  'service_role: every editor function raises 42501');
select is_empty($$ select name from tests.api_views() where tests.sqlstate_of(query) <> '42501' $$,
  'service_role: every editor view raises 42501');
select tests.act_as_owner();
select is((select count(*)::int from cms.tenants), 2, 'no refused call created a tenant');

select * from finish();
rollback;
