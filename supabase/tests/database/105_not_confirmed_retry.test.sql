-- supabase/tests/database/105_not_confirmed_retry.test.sql
-- M3-03: retries after not_confirmed (spec §7.4; plan M3-03). The new transitions of
-- api.worker_record_delivery (a missed live check is scheduled on M3-02's schedule, a retry's
-- notification keeps it, a passing check clears it, 24 hours exhaust it), the selection of a due
-- not_confirmed delivery by api.worker_deliveries_to_retry (never a superseded release's), and
-- api.publication_status's live_retrying and retries_exhausted. The schedule itself is in
-- 102_retry_backoff; the other selections in 097_worker_sweep.
--
-- Time is simulated through the functions' clock parameter (p_now) from a fixed t0.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak   a031 #1 delivered (an hour ago); site b031 active
--           entry c031 with request e031 committed in a031
begin;
\ir _helpers.sql
select plan(30);

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

-- t0 and minutes after it.
create function tests.t(p_minutes int default 0) returns timestamptz
language sql immutable set search_path = ''
as $$ select '2026-11-03 12:00:00+00'::timestamptz + pg_catalog.make_interval(mins => p_minutes) $$;
grant execute on function tests.t(int) to anon, authenticated, service_role;

-- The delivery of release p_release to site b031 as (live_status, notify_attempts, first_failed_at
-- minutes after t0, next_attempt_at minutes after t0) text, for compact assertions.
create function tests.d(p_release uuid) returns text
language sql stable set search_path = ''
as $$
  select pg_catalog.concat_ws(' ', sd.notify_status, sd.live_status, sd.notify_attempts,
                              coalesce((extract(epoch from sd.first_failed_at - tests.t()) / 60)::int::text, '-'),
                              coalesce((extract(epoch from sd.next_attempt_at - tests.t()) / 60)::int::text, '-'))
  from cms.site_deliveries sd
  where sd.release_id = p_release and sd.site_id = tests.k('b031')
$$;
grant execute on function tests.d(uuid) to service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c031'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a031'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '1 hour', now() - interval '1 hour');
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b031'), tests.tenant('labak'), 'http://s1', 'http://s1/r', gen_random_uuid(), true);
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e031'), tests.tenant('labak'), tests.entry('c031'), 'publish', 1, tests.persona('editor_labak'), 'committed', tests.k('a031'));

-- ---------------------------------------------------------------------------
-- Definitions: still invoker, search_path '', service_role only.
select is((select count(*)::int from pg_proc p
           where p.oid in ('api.worker_record_delivery(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure,
                           'api.worker_deliveries_to_retry(timestamptz)'::regprocedure)
             and not p.prosecdef and p.proconfig = array['search_path=""']), 2,
  'worker_record_delivery and worker_deliveries_to_retry stay SECURITY INVOKER with search_path = ''''');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p
  where p.oid in ('api.worker_record_delivery(uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure,
                  'api.worker_deliveries_to_retry(timestamptz)'::regprocedure)
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'both stay executable by service_role only (and the owner)');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), null, 'ok', null, now()) $$,
  '42501', null, 'an editor cannot record a live status');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- The transitions.
select tests.act_as_service();
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), 'ok', null, null, tests.t(0)) $$,
  $$ values (1, null::timestamptz, false) $$, 'the first notification is ok: nothing scheduled');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), null, 'not_confirmed',
                                                               '{"code":"live_not_confirmed"}', tests.t(0)) $$,
  $$ values (1, tests.t(1), false) $$, 'a missed live check is scheduled 1 minute later, not exhausted');
select is(tests.d(tests.k('a031')), 'ok not_confirmed 1 0 1', 'not_confirmed, its first failure at t0, next attempt at t0 + 1');

-- The selection: due at its next attempt, not before.
select is_empty($$ select * from api.worker_deliveries_to_retry(tests.t(0) + interval '59 seconds') $$,
  'a not_confirmed delivery whose next attempt is not due is not returned');
select results_eq($$ select release_id, site_id, notify_status, notify_attempts, live_status from api.worker_deliveries_to_retry(tests.t(1)) $$,
  $$ values (tests.k('a031'), tests.k('b031'), 'ok'::text, 1, 'not_confirmed'::text) $$,
  'a not_confirmed delivery of the latest release is returned when its next attempt is due');

-- The retry: notified again (keeps the schedule while not_confirmed), then the live check misses again.
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), 'ok', null, null, tests.t(1)) $$,
  $$ values (2, tests.t(1), false) $$, 'the retry''s notification keeps the attempt (a worker dying here leaves it due)');
select is(tests.d(tests.k('a031')), 'ok not_confirmed 2 0 1', 'still not_confirmed, two notifications');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), null, 'not_confirmed',
                                                               '{"code":"live_not_confirmed"}', tests.t(1)) $$,
  $$ values (2, tests.t(3), false) $$, 'a second miss is scheduled 2 minutes later (exponential)');
select is(tests.d(tests.k('a031')), 'ok not_confirmed 2 0 3', 'the first failure is kept');

-- A notification failing during a live retry is scheduled as a failed notification.
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), 'failed', null,
                                                               '{"code":"notify_failed"}', tests.t(3)) $$,
  $$ values (3, tests.t(7), false) $$, 'a failed notification on a retry: next attempt 4 minutes later');
select results_eq($$ select release_id from api.worker_deliveries_to_retry(tests.t(7)) $$,
  $$ values (tests.k('a031')) $$, 'and it is returned then');

-- The live check passes: ok, schedule cleared.
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), 'ok', null, null, tests.t(7)) $$,
  $$ values (4, tests.t(7), false) $$, 'the next notification is ok (the attempt kept until its live check)');
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), null, 'ok', null, tests.t(7)) $$,
  $$ values (4, null::timestamptz, false) $$, 'the live check passes: no next attempt, not exhausted');
select is(tests.d(tests.k('a031')), 'ok ok 4 0 -', 'ok/ok, the schedule cleared');
select is((select live_confirmed_at from cms.site_deliveries where release_id = tests.k('a031') and site_id = tests.k('b031')),
  tests.t(7), 'live_confirmed_at is the clock of the passing check');
select is_empty($$ select * from api.worker_deliveries_to_retry(tests.t(60 * 48)) $$, 'a live ok delivery is never returned again');

-- ---------------------------------------------------------------------------
-- The editor's view (as the labak editor).
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'not_confirmed', next_attempt_at = tests.t(15), first_failed_at = tests.t(0)
  where release_id = tests.k('a031') and site_id = tests.k('b031');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_not_confirmed, retries_exhausted, live_retrying from api.publication_status
                     where entry_id = tests.entry('c031') $$,
  $$ values (1, false, true) $$, 'not_confirmed with a next attempt: live_retrying, not exhausted');

-- 24 hours: a miss at or after first_failed_at + 24 hours exhausts the retries.
select tests.act_as_service();
select results_eq($$ select * from api.worker_record_delivery(tests.k('a031'), tests.k('b031'), null, 'not_confirmed',
                                                               '{"code":"live_not_confirmed"}', tests.t(60 * 24)) $$,
  $$ values (4, null::timestamptz, true) $$, 'a miss 24 hours after the first failure exhausts the retries');
select is_empty($$ select * from api.worker_deliveries_to_retry(tests.t(60 * 72)) $$,
  'an exhausted not_confirmed delivery is never returned, however late the clock');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_not_confirmed, retries_exhausted, live_retrying from api.publication_status
                     where entry_id = tests.entry('c031') $$,
  $$ values (1, true, false) $$, 'exhausted: retries_exhausted, no longer retrying (the editor sees delivery failed)');

-- A not_confirmed delivery from before M3-03 (no first failure, no next attempt) stays final, not exhausted.
select tests.act_as_owner();
update cms.site_deliveries set first_failed_at = null where release_id = tests.k('a031') and site_id = tests.k('b031');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select retries_exhausted, live_retrying from api.publication_status where entry_id = tests.entry('c031') $$,
  $$ values (false, false) $$, 'a not_confirmed delivery without a recorded first failure is neither exhausted nor retrying');

-- ---------------------------------------------------------------------------
-- Supersession: a newer delivered release stops the retries of the older.
select tests.act_as_owner();
update cms.site_deliveries set first_failed_at = tests.t(0), next_attempt_at = tests.t(15)
  where release_id = tests.k('a031') and site_id = tests.k('b031');
select tests.act_as_service();
select results_eq($$ select release_id from api.worker_deliveries_to_retry(tests.t(15)) $$,
  $$ values (tests.k('a031')) $$, 'before a newer release: the due not_confirmed delivery is returned');
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a032'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now(), now());
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status) values
  (tests.k('a032'), tests.k('b031'), tests.tenant('labak'), 'ok', 1, now(), 'ok');
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry(tests.t(15)) $$,
  'a newer delivered release supersedes it: the older not_confirmed delivery is not returned, though due');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_not_confirmed, retries_exhausted, live_retrying from api.publication_status
                     where entry_id = tests.entry('c031') $$,
  $$ values (1, false, false) $$, 'the superseded request is not retrying any more (the editor sees not confirmed, final)');

-- The view's grants are unchanged by the appended column.
select tests.act_as_owner();
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner $$,
  $$ values ('authenticated', 'SELECT') $$,
  'publication_status: still SELECT for authenticated only');
select ok((select coalesce(c.reloptions @> array['security_invoker=true'], false) from pg_catalog.pg_class c
           where c.oid = to_regclass('api.publication_status')),
  'publication_status is still security_invoker');
select tests.act_as(tests.persona('editor_demo'));
select is_empty($$ select 1 from api.publication_status where entry_id = tests.entry('c031') $$,
  'another tenant''s editor sees no row for it');

select * from finish();
rollback;
