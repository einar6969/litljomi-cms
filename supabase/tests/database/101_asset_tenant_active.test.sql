-- supabase/tests/database/101_asset_tenant_active.test.sql
-- api.register_asset and api.update_asset refuse a tenant that is not active (spec §4.5, §4.6;
-- plan decisions 3 and 39.3; 20261102001600_asset_tenant_active.sql): tenant_inactive (P0001)
-- before any write, fail closed when the tenant row is invisible, membership still checked first.
-- The functions keep Task 10's signatures, SECURITY INVOKER, search_path = '' and EXECUTE grants.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   asset fa01 labak a.jpg, no focal point or alt text
--   assets fa02, fa03 labak: ids the tests try to register
begin;
\ir _helpers.sql
select plan(17);

create function tests.k(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[0-9a-f]{4}$' then
    raise exception 'unknown key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
-- The original path register_asset requires: {tenant_id}/{asset_id}/{filename}.
create function tests.asset_path(p_tenant uuid, p_asset uuid, p_filename text) returns text
language sql
set search_path = ''
as $$ select p_tenant::text || '/' || p_asset::text || '/' || p_filename $$;
grant execute on function tests.k(text), tests.asset_path(uuid, uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog: unchanged signatures, invoker, pinned search_path, EXECUTE for authenticated only.
create temporary table asset_functions (sig text primary key) on commit drop;
insert into asset_functions values
  ('api.register_asset(uuid,uuid,text,text,text,bigint,integer,integer,text)'),
  ('api.update_asset(uuid,real,real,text)');
select is_empty($$ select sig from asset_functions where to_regprocedure(sig) is null $$,
  'both functions exist with Task 10''s signatures');
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from asset_functions)
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'both are security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from asset_functions) $$,
  $$ select to_regprocedure(sig)::text as sig, g, 'EXECUTE' as privilege_type
     from asset_functions, (values ('postgres'), ('authenticated')) as v(g) $$,
  'EXECUTE for postgres (owner) and authenticated only; not PUBLIC, anon or service_role');

-- ---------------------------------------------------------------------------
-- Fixtures.
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by) values
  (tests.k('fa01'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('fa01'), 'a.jpg'),
   'a.jpg', 'image/jpeg', 1000, 800, 600, repeat('a', 64), tests.persona('editor_labak'));

-- ---------------------------------------------------------------------------
-- A suspended tenant: tenant_inactive, before any write.
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.register_asset(tests.k('fa02'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.k('fa02'), 'b.jpg'), 'b.jpg', 'image/jpeg', 1, 1, 1, repeat('b', 64)) $$,
  'P0001', 'tenant_inactive', 'register_asset in a suspended tenant: tenant_inactive');
select throws_ok($$ select api.register_asset(tests.k('fa02'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('demo'), tests.k('fa02'), 'b.jpg'), 'b.jpg', 'image/jpeg', 1, 1, 1, repeat('b', 64)) $$,
  'P0001', 'tenant_inactive', 'register_asset in a suspended tenant with a bad path: tenant_inactive, before the path check');
select throws_ok($$ select api.update_asset(tests.k('fa01'), 0.5, 0.5, 'Brauð') $$,
  'P0001', 'tenant_inactive', 'update_asset in a suspended tenant: tenant_inactive');
select throws_ok($$ select api.update_asset(gen_random_uuid(), 0.5, 0.5, 'x') $$,
  'P0001', 'not_found', 'update_asset on an asset that does not exist: still not_found');
select tests.act_as(tests.persona('outsider'));
select throws_ok($$ select api.register_asset(tests.k('fa02'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.k('fa02'), 'b.jpg'), 'b.jpg', 'image/jpeg', 1, 1, 1, repeat('b', 64)) $$,
  'P0001', 'not_found', 'a non-member registering in a suspended tenant: not_found (the status is not revealed)');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.update_asset(tests.k('fa01'), 0.5, 0.5, 'x') $$,
  'P0001', 'not_found', 'another tenant''s editor updating a suspended tenant''s asset: not_found');
select tests.act_as_owner();
select is_empty($$ select 1 from cms.assets where id = tests.k('fa02') $$,
  'refused registrations wrote no row');
select results_eq($$ select focal_x, focal_y, default_alt from cms.assets where id = tests.k('fa01') $$,
  $$ values (null::real, null::real, null::text) $$, 'refused updates changed nothing');

-- ---------------------------------------------------------------------------
-- Fail closed: an active tenant whose row the caller cannot see counts as inactive. A
-- restrictive policy, dropped again below, hides every tenant row from authenticated.
update cms.tenants set status = 'active' where id = tests.tenant('labak');
create policy zz_hide_tenants on cms.tenants as restrictive for select to authenticated using (false);
select tests.act_as(tests.persona('editor_labak'));
select is_empty($$ select 1 from cms.tenants $$, 'precondition: the tenant rows are hidden from the editor');
select throws_ok($$ select api.register_asset(tests.k('fa02'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.k('fa02'), 'b.jpg'), 'b.jpg', 'image/jpeg', 1, 1, 1, repeat('b', 64)) $$,
  'P0001', 'tenant_inactive', 'register_asset when the active tenant row is invisible: tenant_inactive');
select throws_ok($$ select api.update_asset(tests.k('fa01'), 0.5, 0.5, 'Brauð') $$,
  'P0001', 'tenant_inactive', 'update_asset when the active tenant row is invisible: tenant_inactive');
select tests.act_as_owner();
drop policy zz_hide_tenants on cms.tenants;

-- ---------------------------------------------------------------------------
-- An active tenant: both still work.
select tests.act_as(tests.persona('editor_labak'));
select is(api.register_asset(tests.k('fa03'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.k('fa03'), 'c.jpg'), 'c.jpg', 'image/jpeg', 2048, 640, 480, repeat('c', 64)),
  tests.k('fa03'), 'register_asset in an active tenant returns the asset id');
select lives_ok($$ select api.update_asset(tests.k('fa01'), 0.5, 0.25, 'Brauð') $$,
  'update_asset in an active tenant');
select tests.act_as_owner();
select results_eq($$ select a.tenant_id, a.filename, b.focal_x, b.focal_y, b.default_alt
     from cms.assets a, cms.assets b where a.id = tests.k('fa03') and b.id = tests.k('fa01') $$,
  $$ values (tests.tenant('labak'), 'c.jpg'::text, 0.5::real, 0.25::real, 'Brauð'::text) $$,
  'the registered row and the updated metadata are stored');

select * from finish();
rollback;
