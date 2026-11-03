-- supabase/tests/database/107_pointer_lag.test.sql
-- M3-08 (20261103203000_pointer_lag.sql; spec §7.4, §11.1 A6; decision 49.1): the pointer lag per
-- release.
--   cms.releases.pointer_lag_ms, pointer_fresh   both or neither; the lag is at least 0
--   api.worker_record_pointer_lag                service_role only; a delivered release, once
--   api.release_pointer_lag                      security_invoker view; RLS decides the rows
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak 7b01 #1 delivered, 7b02 #2 delivered, 7b03 #3 building, 7b04 #4 failed
--   demo  7b11 #1 delivered
begin;
\ir _helpers.sql
select plan(37);

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
grant execute on function tests.k(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The columns.
select has_column('cms', 'releases', 'pointer_lag_ms', 'releases.pointer_lag_ms exists');
select col_type_is('cms', 'releases', 'pointer_lag_ms', 'integer', 'pointer_lag_ms is an integer (milliseconds)');
select col_is_null('cms', 'releases', 'pointer_lag_ms', 'pointer_lag_ms is nullable (not measured yet)');
select has_column('cms', 'releases', 'pointer_fresh', 'releases.pointer_fresh exists');
select col_type_is('cms', 'releases', 'pointer_fresh', 'boolean', 'pointer_fresh is a boolean');
select col_is_null('cms', 'releases', 'pointer_fresh', 'pointer_fresh is nullable (not measured yet)');

-- Column privileges: service_role may update the two columns; authenticated and anon may not.
select ok(has_column_privilege('service_role', 'cms.releases', 'pointer_lag_ms', 'UPDATE')
          and has_column_privilege('service_role', 'cms.releases', 'pointer_fresh', 'UPDATE'),
  'service_role may update pointer_lag_ms and pointer_fresh');
select ok(not has_column_privilege('authenticated', 'cms.releases', 'pointer_lag_ms', 'UPDATE')
          and not has_column_privilege('authenticated', 'cms.releases', 'pointer_fresh', 'UPDATE')
          and not has_column_privilege('anon', 'cms.releases', 'pointer_lag_ms', 'UPDATE')
          and not has_column_privilege('anon', 'cms.releases', 'pointer_fresh', 'UPDATE'),
  'authenticated and anon may not update them');
select ok(has_column_privilege('authenticated', 'cms.releases', 'pointer_lag_ms', 'SELECT')
          and not has_column_privilege('anon', 'cms.releases', 'pointer_lag_ms', 'SELECT'),
  'authenticated reads them (under RLS), as every releases column; anon does not');

-- ---------------------------------------------------------------------------
-- The function's catalog.
select ok(to_regprocedure('api.worker_record_pointer_lag(uuid,integer,boolean)') is not null,
  'api.worker_record_pointer_lag(uuid, integer, boolean) exists');
select is_empty($$ select p.oid from pg_catalog.pg_proc p
     where p.oid = 'api.worker_record_pointer_lag(uuid,integer,boolean)'::regprocedure
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'security invoker with search_path pinned to ''''');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'api.worker_record_pointer_lag(uuid,integer,boolean)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('service_role', 'EXECUTE') $$,
  'EXECUTE: service_role only; postgres owns it');

-- ---------------------------------------------------------------------------
-- Fixtures.
select tests.seed();
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at) values
  (tests.k('7b01'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now()),
  (tests.k('7b02'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now()),
  (tests.k('7b03'), tests.tenant('labak'), 3, 'building', null, null),
  (tests.k('7b11'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now());
insert into cms.releases (id, tenant_id, number, status, error) values
  (tests.k('7b04'), tests.tenant('labak'), 4, 'failed', '{"step":"bundle_upload"}');

-- The constraints hold for every writer, the owner included.
select throws_ok($$ update cms.releases set pointer_lag_ms = 10 where id = tests.k('7b01') $$, '23514', null,
  'a lag without pointer_fresh is refused (both or neither)');
select throws_ok($$ update cms.releases set pointer_fresh = true where id = tests.k('7b01') $$, '23514', null,
  'pointer_fresh without a lag is refused (both or neither)');
select throws_ok($$ update cms.releases set pointer_lag_ms = -1, pointer_fresh = true where id = tests.k('7b01') $$, '23514', null,
  'a negative lag is refused');

-- ---------------------------------------------------------------------------
-- The worker records the lag.
select tests.act_as_service();
select is(api.worker_record_pointer_lag(tests.k('7b01'), 0, true), true, 'a fresh pointer at once: recorded (0 ms)');
select is(api.worker_record_pointer_lag(tests.k('7b02'), 120000, false), true, 'the bound reached: recorded as not fresh');
select is(api.worker_record_pointer_lag(tests.k('7b11'), 53300, true), true, 'a fresh pointer after a delay: recorded');
select is(api.worker_record_pointer_lag(tests.k('7b01'), 999, false), false, 'a second record of the same release: false');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b03'), 1, true) $$, 'P0001', 'forbidden',
  'a building release: forbidden');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b04'), 1, true) $$, 'P0001', 'forbidden',
  'a failed release: forbidden');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7bff'), 1, true) $$, 'P0001', 'not_found',
  'an unknown release: not_found');
select throws_ok($$ select api.worker_record_pointer_lag(null, 1, true) $$, '22023', null, 'a null release: 22023');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b02'), null, true) $$, '22023', null, 'a null lag: 22023');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b02'), -5, true) $$, '22023', null, 'a negative lag: 22023');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b02'), 5, null) $$, '22023', null, 'a null pointer_fresh: 22023');
select tests.act_as_owner();
select results_eq($$ select number, pointer_lag_ms, pointer_fresh from cms.releases
                     where tenant_id = tests.tenant('labak') order by number $$,
  $$ values (1, 0, true), (2, 120000, false), (3, null::int, null::boolean), (4, null, null) $$,
  'stored per release; the first measurement stands; building and failed releases have none');

-- Neither an editor nor anon may record a lag.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b03'), 1, true) $$, '42501', null,
  'editor_labak cannot record a lag');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b03'), 1, true) $$, '42501', null,
  'a platform admin at aal2 cannot record a lag');
select tests.act_as_anon();
select throws_ok($$ select api.worker_record_pointer_lag(tests.k('7b03'), 1, true) $$, '42501', null,
  'anon cannot record a lag');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- The platform view.
select ok(coalesce((select c.reloptions @> array['security_invoker=true'] from pg_catalog.pg_class c
                    where c.oid = 'api.release_pointer_lag'::regclass), false),
  'api.release_pointer_lag is security_invoker');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = 'api.release_pointer_lag'::regclass and a.grantee <> 'postgres'::regrole $$,
  $$ values ('authenticated', 'SELECT') $$,
  'release_pointer_lag: SELECT for authenticated only (besides the owner)');

select tests.act_as(tests.persona('platform_admin'), 'aal2');
select results_eq($$ select tenant_slug, number, status, pointer_lag_ms, pointer_fresh from api.release_pointer_lag
                     order by tenant_slug, number $$,
  $$ values ('demo', 1, 'delivered', 53300, true),
            ('labak', 1, 'delivered', 0, true), ('labak', 2, 'delivered', 120000, false),
            ('labak', 3, 'building', null::int, null::boolean), ('labak', 4, 'failed', null, null) $$,
  'a platform admin at aal2 sees every tenant''s releases with their lag');
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select is_empty($$ select 1 from api.release_pointer_lag $$, 'a platform admin at aal1 sees nothing');
select tests.act_as(tests.persona('editor_labak'));
select set_eq($$ select distinct tenant_slug from api.release_pointer_lag $$, $$ values ('labak') $$,
  'editor_labak sees only labak''s releases');
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from api.release_pointer_lag $$, 'an outsider sees nothing');
select tests.act_as_anon();
select throws_ok($$ select 1 from api.release_pointer_lag $$, '42501', null, 'anon cannot read the view');
select tests.act_as_owner();

select * from finish();
rollback;
