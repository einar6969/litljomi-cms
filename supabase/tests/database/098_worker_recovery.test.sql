-- supabase/tests/database/098_worker_recovery.test.sql
-- Task 30's recovery functions (spec §4.6, §7.1; plan Task 30, decisions 36.2 and 37.1):
-- api.worker_fail_stale_releases() fails every building release older than 420 s (the worker's
-- maxDuration of 300 s plus a 120 s margin), and api.worker_pointer_check(p_release_id) tells the
-- worker, right before it writes a pointer, whether its release is still building and the tenant's
-- highest delivered release number. A release the sweep failed can never be finished (revived) by a
-- late worker. Their grants are also counted in 010_catalog, 090_api_worker and 100_escalation.
--
-- Wording correction for 20261102001400_worker_recovery.sql (an applied migration, so its comment
-- cannot be edited): there, "UPDATE of status and error" names the columns the two functions use.
-- The grant service_role holds on cms.releases (20261102000600_publishing.sql line 223) is UPDATE of
-- status, bundle_path, delivered_at and error.
--
-- Fixtures (owner context): two more tenants, gamla and fjordi, next to labak and demo.
--   labak   a981 #1 delivered, a982 #2 failed (both an hour old), a983 #3 building, 421 s old
--   demo    a984 #1 building, 419 s old
--   gamla   a985 #1 building, exactly 420 s old (not older than 420 s)
--   fjordi  a986 #1 building, two hours old
--   labak   entry c981 with a committed request e981 in no release
begin;
\ir _helpers.sql
select plan(32);

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

select tests.seed();
insert into cms.tenants (id, slug, name) values
  (tests.k('d985'), 'gamla', 'Gamla'),
  (tests.k('d986'), 'fjordi', 'Fjórði');
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, error) values
  (tests.k('a981'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '1 hour', now() - interval '1 hour', null),
  (tests.k('a982'), tests.tenant('labak'), 2, 'failed', null, now() - interval '1 hour', null, '{"code":"build_failed"}'),
  (tests.k('a983'), tests.tenant('labak'), 3, 'building', null, now() - interval '421 seconds', null, null),
  (tests.k('a984'), tests.tenant('demo'), 1, 'building', null, now() - interval '419 seconds', null, null),
  (tests.k('a985'), tests.k('d985'), 1, 'building', null, now() - interval '420 seconds', null, null),
  (tests.k('a986'), tests.k('d986'), 1, 'building', null, now() - interval '2 hours', null, null);
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c981'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e981'), tests.tenant('labak'), tests.entry('c981'), 'unpublish', null, tests.persona('editor_labak'), 'committed', null);

-- ---------------------------------------------------------------------------
-- Definitions: invoker, search_path '', service_role only.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('worker_fail_stale_releases', 'worker_pointer_check')
             and not p.prosecdef and p.proconfig = array['search_path=""']), 2,
  'both recovery functions are SECURITY INVOKER with search_path = ''''');
select is_empty($$ select s from unnest(array['api.worker_fail_stale_releases()', 'api.worker_pointer_check(uuid)']) as s
                   where to_regprocedure(s) is null $$,
  'both exist with their signatures');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('worker_fail_stale_releases', 'worker_pointer_check')
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'both are executable by service_role only (and the owner)');
select is((select provolatile::text from pg_proc where oid = 'api.worker_pointer_check(uuid)'::regprocedure), 's',
  'worker_pointer_check is read only (stable)');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_fail_stale_releases() $$, '42501', null, 'an editor cannot fail releases');
select throws_ok($$ select * from api.worker_pointer_check(tests.k('a983')) $$, '42501', null, 'an editor cannot check a release');
select tests.act_as_anon();
select throws_ok($$ select * from api.worker_fail_stale_releases() $$, '42501', null, 'anon cannot fail releases');
select throws_ok($$ select * from api.worker_pointer_check(tests.k('a983')) $$, '42501', null, 'anon cannot check a release');
select tests.act_as_owner();
select is((select row(status, error)::text from cms.releases where id = tests.k('a983')), row('building', null::jsonb)::text,
  'the refused calls changed nothing');

-- ---------------------------------------------------------------------------
-- worker_fail_stale_releases.
select tests.act_as_service();
create temporary table stale_failed on commit drop as select * from api.worker_fail_stale_releases();
select set_eq($$ select release_id, tenant_id, number from stale_failed $$,
  $$ values (tests.k('a983'), tests.tenant('labak'), 3), (tests.k('a986'), tests.k('d986'), 1) $$,
  'it fails the building releases older than 420 s and returns them');
select is((select created_at from stale_failed where release_id = tests.k('a983')), now() - interval '421 seconds',
  'each row carries the release''s created_at');
select tests.act_as_owner();
select results_eq($$ select id, status from cms.releases where id in
                     (tests.k('a981'), tests.k('a982'), tests.k('a983'), tests.k('a984'), tests.k('a985'), tests.k('a986'))
                   order by id $$,
  $$ values (tests.k('a981'), 'delivered'::text), (tests.k('a982'), 'failed'::text), (tests.k('a983'), 'failed'::text),
            (tests.k('a984'), 'building'::text), (tests.k('a985'), 'building'::text), (tests.k('a986'), 'failed'::text) $$,
  'only building releases older than 420 s are failed: 419 s and exactly 420 s stay building; delivered and failed are untouched');
select is((select error from cms.releases where id = tests.k('a983')), '{"code": "stale_building", "maxAgeSeconds": 420}'::jsonb,
  'the failed release records why');
select is((select row(bundle_path, delivered_at)::text from cms.releases where id = tests.k('a983')),
  row(null::text, null::timestamptz)::text, 'it has no bundle path and no delivery time');
select is((select error from cms.releases where id = tests.k('a982')), '{"code": "build_failed"}'::jsonb,
  'an already failed release keeps its own error');
select is((select count(*)::int from cms.audit_log where target_id = tests.k('a983') and action = 'system.release.failed'
             and actor_id is null and tenant_id = tests.tenant('labak')
             and details -> 'error' ->> 'code' = 'stale_building' and details ->> 'from' = 'building'), 1,
  'the failure is audited as a system event with the error');
select is((select count(*)::int from cms.audit_log where target_id = tests.k('a984')), 0,
  'a release left building is not audited');
select tests.act_as_service();
select is_empty($$ select * from api.worker_fail_stale_releases() $$, 'a second call finds nothing to fail');

-- A late worker cannot revive what the sweep failed (decision 36.2): its finish is refused and
-- changes nothing.
select throws_ok($$ select api.worker_finish_release(tests.k('a983'), 'delivered', 'labak/releases/3.json', null,
                      array[tests.k('e981')], null) $$,
  'P0001', 'forbidden', 'a late finish(delivered) of a release the sweep failed is refused');
select throws_ok($$ select api.worker_finish_release(tests.k('a983'), 'failed', null, '{"code":"late"}', null, null) $$,
  'P0001', 'forbidden', 'a late finish(failed) of a release the sweep failed is refused');
select tests.act_as_owner();
select is((select row(status, bundle_path, delivered_at, error)::text from cms.releases where id = tests.k('a983')),
  row('failed', null::text, null::timestamptz, '{"code": "stale_building", "maxAgeSeconds": 420}'::jsonb)::text,
  'the late finishes changed nothing on the release');
select is((select release_id from cms.publish_requests where id = tests.k('e981')), null::uuid,
  'the request stays in no release, for the next build');
select is((select count(*)::int from cms.audit_log where target_id = tests.k('a983')), 1,
  'and nothing more was audited');

-- The tenant's next build proceeds: the stale release no longer blocks it, and it is number 4.
select tests.act_as_service();
select is((select row(r.number, r.status)::text from api.worker_begin_release(tests.tenant('labak')) as r),
  row(4, 'building')::text, 'labak''s next release begins as number 4');

-- ---------------------------------------------------------------------------
-- worker_pointer_check.
select is((select row(building, latest_delivered)::text
           from api.worker_pointer_check((select id from cms.releases where tenant_id = tests.tenant('labak') and number = 4))),
  row(true, 1)::text, 'a building release, and the tenant''s highest delivered number (1)');
select is((select row(building, latest_delivered)::text from api.worker_pointer_check(tests.k('a983'))),
  row(false, 1)::text, 'a failed release is not building');
select is((select row(building, latest_delivered)::text from api.worker_pointer_check(tests.k('a981'))),
  row(false, 1)::text, 'a delivered release is not building');
select is((select row(building, latest_delivered)::text from api.worker_pointer_check(tests.k('a984'))),
  row(true, null::int)::text, 'a tenant with no delivered release: null (demo''s, not labak''s)');
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at) values
  (tests.k('a987'), tests.tenant('labak'), 5, 'delivered', 'labak/releases/5.json', now());
select tests.act_as_service();
select is((select latest_delivered
           from api.worker_pointer_check((select id from cms.releases where tenant_id = tests.tenant('labak') and number = 4))),
  5, 'a newer delivered release is reported, so the worker does not write an older pointer');
select is((select count(*)::int from api.worker_pointer_check(tests.k('a983'))), 1, 'exactly one row');
select throws_ok($$ select * from api.worker_pointer_check(gen_random_uuid()) $$, 'P0001', 'not_found',
  'an unknown release is not_found');
select throws_ok($$ select * from api.worker_pointer_check(null) $$, 'P0001', 'not_found',
  'a null release is not_found');
select tests.act_as_owner();

select * from finish();
rollback;
