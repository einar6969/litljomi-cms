-- supabase/tests/database/103_asset_trust.test.sql
-- M3-07 (20261103000700_asset_trust.sql; spec §4.5, §4.6, §5.6; decision 50.5):
--   1. register_asset and update_asset lock the tenant row FOR SHARE: the lock-only grant
--      (UPDATE (name) to authenticated) and policy (tenants_lock_member, WITH CHECK false) let an
--      editor lock their own tenant's row and change nothing; persona cells for both functions.
--      That a suspension waits for the lock is proven with two connections in
--      tests/integration (asset-trust.test.ts).
--   2. api.worker_asset_metadata: a tenant's stored metadata, service_role only.
--   3. api.worker_private_orphans: media-private objects without an assets row, older than the
--      grace period, service_role only.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   assets fb01 labak a.jpg, fb02 demo b.png; ids fb1x are registered by the persona cells.
begin;
\ir _helpers.sql
select plan(47);

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
create function tests.asset_path(p_tenant uuid, p_asset uuid, p_filename text) returns text
language sql
set search_path = ''
as $$ select p_tenant::text || '/' || p_asset::text || '/' || p_filename $$;
grant execute on function tests.k(text), tests.asset_path(uuid, uuid, text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog.
select set_eq($$ select tablename::text collate "default", policyname::text collate "default", cmd collate "default",
                        roles::text[] collate "default", with_check collate "default"
     from pg_catalog.pg_policies where schemaname = 'cms' and tablename = 'tenants' and cmd = 'UPDATE' $$,
  $$ values ('tenants', 'tenants_lock_member', 'UPDATE', array['authenticated'], 'false') $$,
  'tenants has one UPDATE policy: tenants_lock_member, for authenticated, WITH CHECK false');
select is((select qual from pg_catalog.pg_policies where schemaname = 'cms' and policyname = 'tenants_lock_member'),
  (select qual from pg_catalog.pg_policies where schemaname = 'cms' and policyname = 'tenants_select_member'),
  'tenants_lock_member admits exactly the rows tenants_select_member does (the member predicate)');
select set_eq($$ select col, priv from tests.column_privs('authenticated', 'cms.tenants') $$,
  $$ values ('name', 'UPDATE') $$, 'authenticated: UPDATE on tenants (name) only');

create temporary table trust_functions (sig text primary key, editor boolean) on commit drop;
insert into trust_functions values
  ('api.register_asset(uuid,uuid,text,text,text,bigint,integer,integer,text)', true),
  ('api.update_asset(uuid,real,real,text)', true),
  ('api.worker_asset_metadata(uuid,uuid[])', false),
  ('api.worker_private_orphans(integer,integer)', false);
select is_empty($$ select sig from trust_functions where to_regprocedure(sig) is null $$,
  'the four functions exist with these signatures');
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from trust_functions)
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'all four are security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from trust_functions) $$,
  $$ select to_regprocedure(sig)::text, g, 'EXECUTE'
     from trust_functions, (values ('postgres')) as o(g)
     union all
     select to_regprocedure(sig)::text, case when editor then 'authenticated' else 'service_role' end, 'EXECUTE'
     from trust_functions $$,
  'EXECUTE: the editor functions for authenticated, the worker functions for service_role; postgres owns all');
select is(pg_catalog.pg_get_function_arguments('api.worker_private_orphans(integer,integer)'::regprocedure),
  'p_grace_seconds integer, p_limit integer DEFAULT 100', 'worker_private_orphans: p_limit defaults to 100');

-- ---------------------------------------------------------------------------
-- Fixtures.
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by) values
  (tests.k('fb01'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('fb01'), 'a.jpg'),
   'a.jpg', 'image/jpeg', 1000, 800, 600, repeat('a', 64), tests.persona('editor_labak')),
  (tests.k('fb02'), tests.tenant('demo'), tests.asset_path(tests.tenant('demo'), tests.k('fb02'), 'b.png'),
   'b.png', 'image/png', 2000, 40, 30, repeat('b', 64), tests.persona('editor_demo'));

-- ---------------------------------------------------------------------------
-- 1. The lock-only grant: an editor locks their own tenant's row and changes nothing.
select tests.act_as(tests.persona('editor_labak'));
select is((select count(*)::int from (select 1 from cms.tenants t where t.id = tests.tenant('labak') for share) s), 1,
  'an editor can lock their own tenant row FOR SHARE');
select is((select count(*)::int from (select 1 from cms.tenants t where t.id = tests.tenant('demo') for share) s), 0,
  'an editor cannot lock (or see) another tenant''s row');
select throws_ok($$ update cms.tenants set name = 'Annað' where id = tests.tenant('labak') $$,
  '42501', null, 'an editor updating their own tenant''s name: refused by WITH CHECK false');
select throws_ok($$ update cms.tenants set status = 'suspended' where id = tests.tenant('labak') $$,
  '42501', null, 'an editor updating their own tenant''s status: no column privilege');
select lives_ok($$ update cms.tenants set name = 'Annað' where id = tests.tenant('demo') $$,
  'an editor updating another tenant''s name reaches no row');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is((select count(*)::int from (select 1 from cms.tenants t for share) s), 0,
  'a platform admin at aal2 sees every tenant but can lock none (no membership)');
select tests.act_as_owner();
select is((select name from cms.tenants where id = tests.tenant('demo')), 'Demo', 'the other tenant''s name is unchanged');
select is((select status from cms.tenants where id = tests.tenant('labak')), 'active', 'the editor''s tenant is unchanged');

-- ---------------------------------------------------------------------------
-- Persona cells: register_asset into labak (each persona registers its own id) and update_asset
-- on labak's fb01. editor_labak succeeds; other signed-in personas get not_found (nothing about
-- labak is revealed); anon and service_role have no EXECUTE.
create function tests.register_cell(p_key text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.register_asset(tests.k(p_key), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.k(p_key), 'c.jpg'), 'c.jpg', 'image/jpeg', 10, 1, 1, pg_catalog.repeat('c', 64));
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function tests.update_cell() returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.update_asset(tests.k('fb01'), 0.5, 0.5, 'Brauð');
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
grant execute on function tests.register_cell(text), tests.update_cell() to anon, authenticated, service_role;

select tests.act_as(tests.persona('editor_labak'));
select is(tests.register_cell('fb11'), 'ok', 'register_asset: editor_labak registers in labak');
select is(tests.update_cell(), 'ok', 'update_asset: editor_labak updates a labak asset');
select tests.act_as(tests.persona('editor_demo'));
select is(tests.register_cell('fb12'), 'P0001 not_found', 'register_asset: editor_demo in labak: not_found');
select is(tests.update_cell(), 'P0001 not_found', 'update_asset: editor_demo on a labak asset: not_found');
select tests.act_as(tests.persona('outsider'));
select is(tests.register_cell('fb13'), 'P0001 not_found', 'register_asset: outsider: not_found');
select is(tests.update_cell(), 'P0001 not_found', 'update_asset: outsider: not_found');
select tests.act_as(tests.persona('revoked'));
select is(tests.register_cell('fb14'), 'P0001 not_found', 'register_asset: revoked member: not_found');
select is(tests.update_cell(), 'P0001 not_found', 'update_asset: revoked member: not_found');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is(tests.register_cell('fb15'), 'P0001 not_found', 'register_asset: platform admin at aal2 (no membership): not_found');
select is(tests.update_cell(), 'P0001 not_found', 'update_asset: platform admin at aal2: not_found');
select tests.act_as_anon();
select matches(tests.register_cell('fb16'), '^42501 ', 'register_asset: anon has no EXECUTE');
select matches(tests.update_cell(), '^42501 ', 'update_asset: anon has no EXECUTE');
select tests.act_as_service();
select matches(tests.register_cell('fb17'), '^42501 ', 'register_asset: service_role has no EXECUTE');
select matches(tests.update_cell(), '^42501 ', 'update_asset: service_role has no EXECUTE');
select tests.act_as_owner();
select set_eq($$ select id from cms.assets where id::text like '00000000-0000-4000-8000-00000000fb1%' $$,
  $$ values (tests.k('fb11')) $$, 'only editor_labak''s registration wrote a row');

-- A suspended tenant: both refused with tenant_inactive after the lock.
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as(tests.persona('editor_labak'));
select is(tests.register_cell('fb18'), 'P0001 tenant_inactive', 'register_asset in a suspended tenant: tenant_inactive');
select is(tests.update_cell(), 'P0001 tenant_inactive', 'update_asset in a suspended tenant: tenant_inactive');
select tests.act_as(tests.persona('outsider'));
select is(tests.register_cell('fb19'), 'P0001 not_found', 'an outsider still learns nothing about the suspension');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('labak');

-- ---------------------------------------------------------------------------
-- 2. worker_asset_metadata.
select tests.act_as_service();
select results_eq($$ select id, original_path, mime, bytes, width, height, sha256
     from api.worker_asset_metadata(tests.tenant('labak'), array[tests.k('fb01'), tests.k('fb02'), tests.k('ffff')]) $$,
  $$ values (tests.k('fb01'), tests.asset_path(tests.tenant('labak'), tests.k('fb01'), 'a.jpg'), 'image/jpeg'::text,
             1000::bigint, 800, 600, repeat('a', 64)) $$,
  'worker_asset_metadata: the tenant''s assets only (another tenant''s and unknown ids are absent)');
select is_empty($$ select * from api.worker_asset_metadata(tests.tenant('labak'), array[]::uuid[]) $$,
  'worker_asset_metadata: no ids, no rows');
select throws_ok($$ select * from api.worker_asset_metadata(null, array[tests.k('fb01')]) $$, '22023', null,
  'worker_asset_metadata: a null tenant is refused');
select throws_ok($$ select * from api.worker_asset_metadata(tests.tenant('labak'), null) $$, '22023', null,
  'worker_asset_metadata: null ids are refused');
select throws_ok($$ select * from api.worker_asset_metadata(tests.tenant('labak'),
     array(select gen_random_uuid() from generate_series(1, 1001))) $$, '22023', null,
  'worker_asset_metadata: more than 1000 ids are refused');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_asset_metadata(tests.tenant('labak'), array[tests.k('fb01')]) $$, '42501', null,
  'worker_asset_metadata: an editor has no EXECUTE');

-- ---------------------------------------------------------------------------
-- 3. worker_private_orphans. Objects are inserted as the owner with backdated created_at.
select tests.act_as_owner();
insert into storage.objects (bucket_id, name, created_at) values
  -- registered (fb01): kept whatever its age
  ('media-private', tests.asset_path(tests.tenant('labak'), tests.k('fb01'), 'a.jpg'), now() - interval '3 days'),
  -- unregistered, old: listed, oldest first
  ('media-private', tests.asset_path(tests.tenant('labak'), tests.k('fc01'), 'x.jpg'), now() - interval '3 days'),
  ('media-private', tests.asset_path(tests.tenant('demo'), tests.k('fc02'), 'y.png'), now() - interval '2 days'),
  -- unregistered, inside the grace period: not listed
  ('media-private', tests.asset_path(tests.tenant('labak'), tests.k('fc03'), 'z.jpg'), now() - interval '10 minutes'),
  -- another bucket with an unregistered name: never listed
  ('media-public', 'labak/' || tests.k('fc04')::text || '/w.jpg', now() - interval '3 days');
-- An archived asset keeps its original.
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by, archived_at) values
  (tests.k('fc05'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('fc05'), 'v.jpg'),
   'v.jpg', 'image/jpeg', 1000, 8, 6, repeat('d', 64), tests.persona('editor_labak'), now());
insert into storage.objects (bucket_id, name, created_at) values
  ('media-private', tests.asset_path(tests.tenant('labak'), tests.k('fc05'), 'v.jpg'), now() - interval '3 days');

select tests.act_as_service();
select results_eq($$ select name from api.worker_private_orphans(86400) $$,
  $$ values (tests.asset_path(tests.tenant('labak'), tests.k('fc01'), 'x.jpg')),
            (tests.asset_path(tests.tenant('demo'), tests.k('fc02'), 'y.png')) $$,
  'worker_private_orphans: unregistered media-private objects past a day, oldest first');
select results_eq($$ select name from api.worker_private_orphans(3600, 1) $$,
  $$ values (tests.asset_path(tests.tenant('labak'), tests.k('fc01'), 'x.jpg')) $$,
  'worker_private_orphans: at most p_limit');
select throws_ok($$ select * from api.worker_private_orphans(3599) $$, '22023', null,
  'worker_private_orphans: a grace period under an hour is refused');
select throws_ok($$ select * from api.worker_private_orphans(null) $$, '22023', null,
  'worker_private_orphans: a null grace period is refused');
select throws_ok($$ select * from api.worker_private_orphans(3600, 0) $$, '22023', null,
  'worker_private_orphans: p_limit 0 is refused');
select throws_ok($$ select * from api.worker_private_orphans(3600, 1001) $$, '22023', null,
  'worker_private_orphans: p_limit over 1000 is refused');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_private_orphans(86400) $$, '42501', null,
  'worker_private_orphans: an editor has no EXECUTE');
select tests.act_as_anon();
select throws_ok($$ select * from api.worker_private_orphans(86400) $$, '42501', null,
  'worker_private_orphans: anon has no EXECUTE');
select tests.act_as_owner();

select * from finish();
rollback;
