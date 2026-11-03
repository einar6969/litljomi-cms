-- supabase/tests/database/102_retry_backoff.test.sql
-- M3-02: exponential retries for 24 hours (spec §6.3, §7.4, §8.4). The schedule
-- (api.worker_next_attempt_at), the delivery record that keeps it (api.worker_record_delivery with
-- the worker's clock), the build-retry trigger on cms.releases and api.worker_release_retry, and
-- the build path's selection (api.worker_tenants_to_release). The delivery selection is in
-- 097_worker_sweep; the editor's retries_exhausted in 099_publication_status. Grants are also
-- counted in 010_catalog, 090_api_worker and 100_escalation.
--
-- Time is simulated through the functions' clock parameter (p_now); the trigger uses now(), which
-- is fixed inside this transaction, so its fixtures set created_at instead.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak   a021 #1 delivered (an hour ago); site b021 active
--   demo    no release yet
--   gamla   (a third tenant) for the build path
begin;
\ir _helpers.sql
select plan(52);

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

-- A notification failing at every attempt, each made exactly when the previous one scheduled it,
-- from p_t0: the minutes after p_t0 of every next attempt, until the retries are exhausted (the
-- last element is null). Runs as the current role (service_role below).
create function tests.fail_until_exhausted(p_release uuid, p_site uuid, p_t0 timestamptz)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_at timestamptz := p_t0;
  v_next timestamptz;
  v_out text[] := '{}';
  v_exhausted boolean;
begin
  for i in 1..30 loop
    select d.next_attempt_at, d.retries_exhausted into v_next, v_exhausted
    from api.worker_record_delivery(p_release, p_site, 'failed', null, '{"code":"notify_failed"}', v_at) as d;
    v_out := v_out || (extract(epoch from v_next - p_t0)::int / 60)::text;
    if v_exhausted then
      return v_out;
    end if;
    v_at := v_next;
  end loop;
  raise exception 'not exhausted after 30 attempts';
end;
$$;
grant execute on function tests.fail_until_exhausted(uuid, uuid, timestamptz) to service_role;

select tests.seed();
insert into cms.tenants (id, slug, name) values (tests.k('d023'), 'gamla', 'Gamla');
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a021'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '1 hour', now() - interval '1 hour');
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b021'), tests.tenant('labak'), 'http://s1', 'http://s1/r', gen_random_uuid(), true),
  (tests.k('b022'), tests.tenant('labak'), 'http://s2', 'http://s2/r', gen_random_uuid(), true);

-- ---------------------------------------------------------------------------
-- Definitions: invoker, search_path '', service_role only (catalog).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api'
             and p.oid in ('api.worker_next_attempt_at(timestamptz,int,timestamptz)'::regprocedure,
                           'api.worker_record_delivery(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure,
                           'api.worker_release_retry(uuid)'::regprocedure,
                           'api.worker_tenants_to_release(timestamptz)'::regprocedure,
                           'api.worker_deliveries_to_retry(timestamptz)'::regprocedure)
             and not p.prosecdef and p.proconfig = array['search_path=""']), 5,
  'the five M3-02 functions are SECURITY INVOKER with search_path = ''''');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and p.proname in ('worker_next_attempt_at', 'worker_record_delivery', 'worker_release_retry',
                      'worker_tenants_to_release', 'worker_deliveries_to_retry')
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'all five are executable by service_role only (and the owner)');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api'
    and p.proname in ('worker_record_delivery', 'worker_tenants_to_release', 'worker_deliveries_to_retry')
    and p.oid not in ('api.worker_record_delivery(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure,
                      'api.worker_tenants_to_release(timestamptz)'::regprocedure,
                      'api.worker_deliveries_to_retry(timestamptz)'::regprocedure) $$,
  'the M1 signatures are gone (no overload without the clock)');
select ok(not exists (select 1 from pg_proc p where p.oid = 'private.releases_schedule_retry()'::regprocedure and p.prosecdef)
          and (select proconfig from pg_proc where oid = 'private.releases_schedule_retry()'::regprocedure) = array['search_path=""']
          and not has_function_privilege('service_role', 'private.releases_schedule_retry()', 'execute')
          and not has_function_privilege('authenticated', 'private.releases_schedule_retry()', 'execute'),
  'the trigger function is invoker, pins search_path and is granted to no API role');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.worker_next_attempt_at(now(), 1, now()) $$, '42501', null, 'an editor cannot call the schedule');
select throws_ok($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), 'ok', null, null, now()) $$,
  '42501', null, 'an editor cannot record a delivery');
select throws_ok($$ select * from api.worker_release_retry(tests.k('a021')) $$, '42501', null, 'an editor cannot read a build retry');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select * from api.worker_release_retry(tests.k('a021')) $$, '42501', null,
  'a platform admin at aal2 cannot read a build retry');
select tests.act_as_anon();
select throws_ok($$ select api.worker_next_attempt_at(now(), 1, now()) $$, '42501', null, 'anon cannot call the schedule');
select throws_ok($$ select * from api.worker_tenants_to_release(now()) $$, '42501', null, 'anon cannot list tenants to release');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- The schedule: 1, 2, 4 … minutes after the n-th failed attempt, capped at 24 hours after the
-- first failure; null (exhausted) at or past it.
select tests.act_as_service();
select results_eq($$ select n, extract(epoch from api.worker_next_attempt_at('2026-11-03 12:00+00', n, '2026-11-03 12:00+00')
                                          - '2026-11-03 12:00+00'::timestamptz)::int / 60
                     from generate_series(1, 11) as n order by n $$,
  $$ values (1, 1), (2, 2), (3, 4), (4, 8), (5, 16), (6, 32), (7, 64), (8, 128), (9, 256), (10, 512), (11, 1024) $$,
  'the delay after the n-th failed attempt is 2^(n-1) minutes');
select is(api.worker_next_attempt_at('2026-11-03 12:00+00', 11, '2026-11-04 05:03+00'), '2026-11-04 12:00+00'::timestamptz,
  'capped: never later than 24 hours after the first failure');
select is(api.worker_next_attempt_at('2026-11-03 12:00+00', 40, '2026-11-03 12:05+00'), '2026-11-04 12:00+00'::timestamptz,
  'a large attempt count is capped too (no overflow)');
select is(api.worker_next_attempt_at('2026-11-03 12:00+00', 12, '2026-11-04 11:59:59+00'), '2026-11-04 12:00+00'::timestamptz,
  'a failure just before the 24 hours still gets the attempt at the 24-hour mark');
select is(api.worker_next_attempt_at('2026-11-03 12:00+00', 12, '2026-11-04 12:00+00'), null::timestamptz,
  'exhausted: a failure at 24 hours after the first has no next attempt');
select is(api.worker_next_attempt_at('2026-11-03 12:00+00', 3, '2026-11-05 12:00+00'), null::timestamptz,
  'exhausted: and none after it');
select throws_ok($$ select api.worker_next_attempt_at(null, 1, now()) $$, '22023', null, 'a null first failure is refused (22023)');
select throws_ok($$ select api.worker_next_attempt_at(now(), 0, now()) $$, '22023', null, 'an attempt count below 1 is refused (22023)');
select throws_ok($$ select api.worker_next_attempt_at(now(), null, now()) $$, '22023', null, 'a null attempt count is refused (22023)');
select throws_ok($$ select api.worker_next_attempt_at(now(), 1, null) $$, '22023', null, 'a null clock is refused (22023)');

-- ---------------------------------------------------------------------------
-- worker_record_delivery keeps the schedule.
select throws_ok($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), 'ok', null, null, null) $$,
  '22023', 'p_now is required', 'worker_record_delivery: a null clock is refused (22023)');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), 'failed', null,
                      '{"code":"notify_failed","status":500}', '2026-11-03 12:00+00') $$,
  $$ values (1, '2026-11-03 12:01+00'::timestamptz, false) $$,
  'a first failed notification: one attempt, the next in 1 minute, not exhausted');
select is((select row(first_failed_at, next_attempt_at, notify_status, live_status)::text from cms.site_deliveries
           where release_id = tests.k('a021') and site_id = tests.k('b021')),
  row('2026-11-03 12:00+00'::timestamptz, '2026-11-03 12:01+00'::timestamptz, 'failed', 'pending')::text,
  'the row keeps the first failure and the next attempt');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), 'failed', null, null,
                      '2026-11-03 12:01+00') $$,
  $$ values (2, '2026-11-03 12:03+00'::timestamptz, false) $$,
  'the second failure: the next in 2 minutes');
select is((select first_failed_at from cms.site_deliveries where release_id = tests.k('a021') and site_id = tests.k('b021')),
  '2026-11-03 12:00+00'::timestamptz, 'the first failure is kept');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), 'ok', null, null,
                      '2026-11-03 12:03+00') $$,
  $$ values (3, null::timestamptz, false) $$,
  'an ok notification clears the next attempt');
select is((select row(notified_at, first_failed_at)::text from cms.site_deliveries
           where release_id = tests.k('a021') and site_id = tests.k('b021')),
  row('2026-11-03 12:03+00'::timestamptz, '2026-11-03 12:00+00'::timestamptz)::text,
  'notified_at is the clock; the first failure stays');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b021'), null, 'ok', null,
                      '2026-11-03 12:04+00') $$,
  $$ values (3, null::timestamptz, false) $$,
  'a live record changes neither attempts nor schedule');
select is((select live_confirmed_at from cms.site_deliveries where release_id = tests.k('a021') and site_id = tests.k('b021')),
  '2026-11-03 12:04+00'::timestamptz, 'live_confirmed_at is the clock');

-- Exhaustion after 24 hours: every attempt fails, each made when the previous one scheduled it.
select is(tests.fail_until_exhausted(tests.k('a021'), tests.k('b022'), '2026-11-03 12:00+00'),
  array['1', '3', '7', '15', '31', '63', '127', '255', '511', '1023', '1440', null],
  'attempts at 0, 1, 3, 7 … 1023 minutes and at 24 hours (1440); the failure at 24 hours exhausts the retries');
select is((select row(notify_status, notify_attempts, next_attempt_at, first_failed_at)::text from cms.site_deliveries
           where release_id = tests.k('a021') and site_id = tests.k('b022')),
  row('failed', 12, null::timestamptz, '2026-11-03 12:00+00'::timestamptz)::text,
  'the exhausted delivery: failed, 12 attempts, no next attempt');
select is_empty($$ select * from api.worker_deliveries_to_retry('2026-11-10 12:00+00') where site_id = tests.k('b022') $$,
  'an exhausted delivery is never selected again');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a021'), tests.k('b022'), 'failed', null, null,
                      '2026-11-05 12:00+00') $$,
  $$ values (13, null::timestamptz, true) $$,
  'a later failure stays exhausted');

-- Supersession: a newer delivered release is retried instead; the older's due retry is not.
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = '2026-11-03 12:30+00' where release_id = tests.k('a021') and site_id = tests.k('b022');
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a022'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now(), now());
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry('2026-11-03 13:00+00') where release_id = tests.k('a021') $$,
  'a newer delivered release supersedes: the older release''s due retry is not selected');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a022'), tests.k('b022'), 'failed', null, null,
                      '2026-11-03 13:00+00') $$,
  $$ values (1, '2026-11-03 13:01+00'::timestamptz, false) $$,
  'the newer release''s delivery has its own schedule, from its own first failure');

-- ---------------------------------------------------------------------------
-- Builds: the trigger schedules the tenant's next build when a release becomes failed.
select tests.act_as_owner();
-- demo: no delivered release; a first build fails.
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a031'), tests.tenant('demo'), 1, 'building', now() - interval '1 minute');
update cms.releases set status = 'failed' where id = tests.k('a031');
select is((select next_attempt_at from cms.releases where id = tests.k('a031')), now() + interval '1 minute',
  'a first failed build: the next build in 1 minute');
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a032'), tests.tenant('demo'), 2, 'building', now());
update cms.releases set status = 'failed' where id = tests.k('a032');
select is((select next_attempt_at from cms.releases where id = tests.k('a032')), now() + interval '2 minutes',
  'a second failed build in a row: in 2 minutes');
-- A failure 24 hours after the first failed build of the run exhausts the build retries.
update cms.releases set created_at = now() - interval '24 hours' where id = tests.k('a031');
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a033'), tests.tenant('demo'), 3, 'building', now());
update cms.releases set status = 'failed' where id = tests.k('a033');
select is((select next_attempt_at from cms.releases where id = tests.k('a033')), null::timestamptz,
  'a failed build 24 hours after the run''s first failure: no next build (exhausted)');
select tests.act_as_service();
select results_eq($$ select * from api.worker_release_retry(tests.k('a033')) $$,
  $$ values ('failed'::text, null::timestamptz, true) $$,
  'worker_release_retry: failed, exhausted');
select results_eq($$ select * from api.worker_release_retry(tests.k('a032')) $$,
  $$ values ('failed'::text, now() + interval '2 minutes', false) $$,
  'worker_release_retry: an earlier failed release with its next attempt');
select results_eq($$ select * from api.worker_release_retry(tests.k('a022')) $$,
  $$ values ('delivered'::text, null::timestamptz, false) $$,
  'worker_release_retry: a delivered release is not exhausted');
select throws_ok($$ select * from api.worker_release_retry(gen_random_uuid()) $$, 'P0001', 'not_found',
  'worker_release_retry: an unknown release is not_found');
-- A delivered release ends the run: the next failure starts over.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a034'), tests.tenant('demo'), 4, 'delivered', 'demo/releases/4.json', now(), now()),
  (tests.k('a035'), tests.tenant('demo'), 5, 'building', null, now(), null);
update cms.releases set status = 'failed' where id = tests.k('a035');
select is((select next_attempt_at from cms.releases where id = tests.k('a035')), now() + interval '1 minute',
  'after a delivered release the next failed build starts a new run (1 minute)');
-- The sweep's stale failure goes through the same trigger.
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a036'), tests.k('d023'), 1, 'building', now() - interval '421 seconds');
select tests.act_as_service();
select is((select count(*)::int from api.worker_fail_stale_releases() where release_id = tests.k('a036')), 1,
  'a stale building release is failed by the sweep');
select is((select next_attempt_at from cms.releases where id = tests.k('a036')), now() + interval '1 minute',
  'and its tenant''s next build is scheduled in 1 minute');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where target_id = tests.k('a036') and action = 'system.release.failed'), 1,
  'the failure is still audited once');
select tests.act_as_service();
select throws_ok($$ update cms.releases set next_attempt_at = null where id = tests.k('a036') $$, '42501', null,
  'service_role cannot write next_attempt_at on releases directly');

-- ---------------------------------------------------------------------------
-- The build path: api.worker_tenants_to_release(p_now).
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c031'), tests.k('d023'), 'news', 'a', tests.persona('editor_labak'));
-- gamla's request was made before its failed build (a036) began.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e031'), tests.k('d023'), tests.entry('c031'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null);
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now()) where tenant_id = tests.k('d023') $$,
  'a tenant whose latest build failed is not built before its next attempt');
select is((select count(*)::int from api.worker_tenants_to_release(now() + interval '1 minute') where tenant_id = tests.k('d023')), 1,
  'it is built once the next attempt is due (the clock parameter)');
select tests.act_as_owner();
update cms.releases set next_attempt_at = null where id = tests.k('a036');
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now() + interval '30 days') where tenant_id = tests.k('d023') $$,
  'a tenant whose build retries are exhausted is not built again');
-- New work: a request made after the failed build began gets its own attempt at once.
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c032'), tests.k('d023'), 'news', 'b', tests.persona('editor_labak'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e032'), tests.k('d023'), tests.entry('c032'), 'unpublish', null, tests.persona('editor_labak'),
   now(), 'committed', null);
select tests.act_as_service();
select is((select count(*)::int from api.worker_tenants_to_release(now()) where tenant_id = tests.k('d023')), 1,
  'a request made after the failed build began is built at once, even when the retries are exhausted');
-- A tenant whose latest release is delivered is built as in M1.
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c033'), tests.tenant('labak'), 'news', 'c', tests.persona('editor_labak'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e033'), tests.tenant('labak'), tests.entry('c033'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null);
select tests.act_as_service();
select is((select count(*)::int from api.worker_tenants_to_release(now()) where tenant_id = tests.tenant('labak')), 1,
  'a tenant whose latest release is delivered is built');

select * from finish();
rollback;
