-- supabase/tests/database/097_worker_sweep.test.sql
-- Task 21's sweep functions (spec §6.1, §6.3, §7.4, §8.4; plan Task 21, decision 34.2), as M3-02
-- replaced them: api.worker_tenants_to_release(p_now) and api.worker_deliveries_to_retry(p_now),
-- selecting by next_attempt_at (the schedule itself is in 102_retry_backoff). Their grants are also
-- counted in 010_catalog and 100_escalation.
--
-- Fixtures (owner context): labak entries c971/c972 with committed requests e971 (in release 2)
-- and e972 (in no release), demo entry c973 with a committed request e973 (in no release); labak
-- releases 1 and 2 delivered and 3 building; labak sites (active s1, s2, s3; inactive s4), a demo
-- site s5 and a demo release 1 delivered.
-- The labak requests are publishes: an unpublish linked to labak's latest delivered release would
-- list labak for a housekeeping release (20261104153000; tested in 109_housekeeping_release).
begin;
\ir _helpers.sql
select plan(31);

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
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c971'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak')),
  (tests.entry('c972'), tests.tenant('labak'), 'news', 'b', tests.persona('editor_labak')),
  (tests.entry('c973'), tests.tenant('demo'), 'event', 'c', tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at) values
  (tests.k('a971'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '1 hour'),
  (tests.k('a972'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now()),
  (tests.k('a973'), tests.tenant('labak'), 3, 'building', null, null),
  (tests.k('a974'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now() - interval '1 hour');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id)
values
  (tests.k('e971'), tests.tenant('labak'), tests.entry('c971'), 'publish', 1, tests.persona('editor_labak'), 'committed', tests.k('a972')),
  (tests.k('e972'), tests.tenant('labak'), tests.entry('c972'), 'publish', 1, tests.persona('editor_labak'), 'committed', null),
  (tests.k('e974'), tests.tenant('labak'), tests.entry('c972'), 'publish', 1, tests.persona('editor_labak'), 'pending', null),
  (tests.k('e973'), tests.tenant('demo'), tests.entry('c973'), 'unpublish', null, tests.persona('editor_demo'), 'committed', null);
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b971'), tests.tenant('labak'), 'http://s1', 'http://s1/r', gen_random_uuid(), true),
  (tests.k('b972'), tests.tenant('labak'), 'http://s2', 'http://s2/r', gen_random_uuid(), true),
  (tests.k('b973'), tests.tenant('labak'), 'http://s3', 'http://s3/r', gen_random_uuid(), true),
  (tests.k('b974'), tests.tenant('labak'), 'http://s4', 'http://s4/r', gen_random_uuid(), false),
  (tests.k('b975'), tests.tenant('demo'), 'http://s5', 'http://s5/r', gen_random_uuid(), true);

-- ---------------------------------------------------------------------------
-- Definitions: invoker, search_path '', service_role only.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('worker_tenants_to_release', 'worker_deliveries_to_retry')
             and not p.prosecdef and p.proconfig = array['search_path=""']), 2,
  'both sweep functions are SECURITY INVOKER with search_path = ''''');
select is_empty($$ select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'api' and p.proname in ('worker_tenants_to_release', 'worker_deliveries_to_retry')
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'both are executable by service_role only (and the owner)');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_tenants_to_release(now()) $$, '42501', null, 'an editor cannot list tenants to release');
select throws_ok($$ select * from api.worker_deliveries_to_retry(now()) $$, '42501', null, 'an editor cannot list deliveries');
select tests.act_as_anon();
select throws_ok($$ select * from api.worker_deliveries_to_retry(now()) $$, '42501', null, 'anon cannot list deliveries');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- worker_tenants_to_release.
select tests.act_as_service();
select results_eq($$ select tenant_id from api.worker_tenants_to_release(now()) $$,
  $$ values (tests.tenant('labak')), (tests.tenant('demo')) $$,
  'both tenants have a committed request without a release (ordered by tenant id)');
select tests.act_as_owner();
update cms.publish_requests set release_id = tests.k('a972') where id = tests.k('e972');
select tests.act_as_service();
select results_eq($$ select tenant_id from api.worker_tenants_to_release(now()) $$, $$ values (tests.tenant('demo')) $$,
  'a linked request and a pending one do not count');
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('demo');
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now()) $$, 'a suspended tenant is not released');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('demo');
update cms.publish_requests set status = 'failed' where id = tests.k('e973');
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now()) $$, 'only committed requests count');

-- ---------------------------------------------------------------------------
-- Parameters: the clock is required.
select throws_ok($$ select * from api.worker_deliveries_to_retry(null) $$, '22023', 'p_now is required',
  'worker_deliveries_to_retry: a null clock is refused (22023)');
select throws_ok($$ select * from api.worker_tenants_to_release(null) $$, '22023', 'p_now is required',
  'worker_tenants_to_release: a null clock is refused (22023)');

-- No rows yet: labak's release 2 was delivered just now (within 5 minutes), demo's an hour ago.
select results_eq($$ select release_id, site_id, notify_status, notify_attempts, live_status from api.worker_deliveries_to_retry(now()) $$,
  $$ values (tests.k('a974'), tests.k('b975'), 'pending'::text, 0, 'pending'::text) $$,
  'without a delivery row: only a release delivered more than 5 minutes ago is returned, for its active site');

-- Labak rows for release 2: s1 failed (3 attempts), s2 ok/pending (just notified), s3 ok/ok.
select tests.act_as_owner();
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status, last_error,
                                 first_failed_at, next_attempt_at) values
  (tests.k('a972'), tests.k('b971'), tests.tenant('labak'), 'failed', 3, null, 'pending', '{"code":"notify_failed"}',
   now() - interval '7 minutes', now()),
  (tests.k('a972'), tests.k('b972'), tests.tenant('labak'), 'ok', 1, now(), 'pending', null, null, null),
  (tests.k('a972'), tests.k('b973'), tests.tenant('labak'), 'ok', 1, now(), 'ok', null, null, null),
  -- Release 1 is superseded by release 2: its failed delivery is never retried, though due.
  (tests.k('a971'), tests.k('b971'), tests.tenant('labak'), 'failed', 1, null, 'pending', null, now() - interval '1 hour', now()),
  -- The demo site's delivery is final (not confirmed).
  (tests.k('a974'), tests.k('b975'), tests.tenant('demo'), 'ok', 1, now() - interval '1 hour', 'not_confirmed', null, null, null);
select tests.act_as_service();
select results_eq($$ select release_id, site_id, notify_status, notify_attempts, live_status from api.worker_deliveries_to_retry(now()) $$,
  $$ values (tests.k('a972'), tests.k('b971'), 'failed'::text, 3, 'pending'::text) $$,
  'a failed notification of the latest release is returned; ok/ok, a fresh ok/pending, a superseded release and not_confirmed are not');
select is((select row(tenant_id, tenant_slug, release_number, bundle_path, previous_bundle_path)::text
           from api.worker_deliveries_to_retry(now())),
  row(tests.tenant('labak'), 'labak'::text, 2, 'labak/releases/2.json'::text, 'labak/releases/1.json'::text)::text,
  'the row names the tenant, the release, its bundle and the previous delivered release''s bundle');
select is((select requests from api.worker_deliveries_to_retry(now())),
  jsonb_build_array(
    jsonb_build_object('id', tests.k('e971'), 'entry_id', tests.entry('c971'), 'action', 'publish', 'was_delivered', false),
    jsonb_build_object('id', tests.k('e972'), 'entry_id', tests.entry('c972'), 'action', 'publish', 'was_delivered', false)),
  'with the requests linked to the release, in request order');

-- The schedule (M3-02): a failed notification is returned once its next attempt is due at p_now.
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = now() + interval '4 minutes' where release_id = tests.k('a972') and site_id = tests.k('b971');
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry(now()) $$, 'a failed notification whose next attempt is not due is not returned');
select is((select count(*)::int from api.worker_deliveries_to_retry(now() + interval '4 minutes')), 1,
  'it is returned at its next attempt (the clock parameter)');
-- Exhausted: failed with no next attempt. Never returned, however late the clock.
select tests.act_as_owner();
update cms.site_deliveries set notify_attempts = 12, next_attempt_at = null where release_id = tests.k('a972') and site_id = tests.k('b971');
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry(now() + interval '30 days') where site_id = tests.k('b971') $$,
  'a delivery whose retries are exhausted is never returned');

-- A live check left pending for more than 5 minutes after an ok notification.
select tests.act_as_owner();
update cms.site_deliveries set notified_at = now() - interval '6 minutes'
  where release_id = tests.k('a972') and site_id = tests.k('b972');
select tests.act_as_service();
select results_eq($$ select site_id, notify_status, live_status from api.worker_deliveries_to_retry(now()) $$,
  $$ values (tests.k('b972'), 'ok'::text, 'pending'::text) $$,
  'an ok notification whose live check stayed pending for over 5 minutes is returned');
-- ... unless the delivery's 24 hours since its first failure ran out before it was notified (M5-01:
-- one notified before they ended gets one more run, 115_withdrawal_safety).
select tests.act_as_owner();
update cms.site_deliveries set first_failed_at = now() - interval '24 hours 10 minutes' where release_id = tests.k('a972') and site_id = tests.k('b972');
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry(now()) $$,
  'a pending live check notified after the 24 hours since the delivery''s first failure is not retried');
select tests.act_as_owner();
update cms.site_deliveries set first_failed_at = now() - interval '23 hours' where release_id = tests.k('a972') and site_id = tests.k('b972');
select tests.act_as_service();

-- A site without a row once the release is more than 5 minutes old.
select tests.act_as_owner();
delete from cms.site_deliveries where release_id = tests.k('a972') and site_id = tests.k('b973');
update cms.releases set delivered_at = now() - interval '6 minutes' where id = tests.k('a972');
select tests.act_as_service();
select results_eq($$ select site_id, notify_status, notify_attempts, live_status from api.worker_deliveries_to_retry(now()) $$,
  $$ values (tests.k('b972'), 'ok'::text, 1, 'pending'::text), (tests.k('b973'), 'pending'::text, 0, 'pending'::text) $$,
  'a site without a delivery row is returned once the release is over 5 minutes old');

-- An inactive site is never returned.
select tests.act_as_owner();
update cms.sites set active = false where id = tests.k('b973');
select tests.act_as_service();
select is((select count(*)::int from api.worker_deliveries_to_retry(now()) where site_id = tests.k('b973')), 0,
  'an inactive site is not returned');
select is((select count(*)::int from api.worker_deliveries_to_retry(now()) where site_id = tests.k('b974')), 0,
  'nor the site that was inactive from the start');

-- A building release does not replace the latest delivered one.
select is((select count(*)::int from api.worker_deliveries_to_retry(now()) where release_id = tests.k('a973')), 0,
  'a building release is never returned');

-- A newer delivered release supersedes: the retry moves to it.
select tests.act_as_owner();
update cms.releases set status = 'delivered', bundle_path = 'labak/releases/3.json', delivered_at = now() - interval '6 minutes'
  where id = tests.k('a973');
select tests.act_as_service();
select results_eq($$ select release_id, previous_bundle_path, site_id, requests from api.worker_deliveries_to_retry(now()) $$,
  $$ values (tests.k('a973'), 'labak/releases/2.json'::text, tests.k('b971'), '[]'::jsonb),
            (tests.k('a973'), 'labak/releases/2.json'::text, tests.k('b972'), '[]'::jsonb) $$,
  'after a newer delivered release, only its deliveries are returned (release 2''s are superseded)');

-- A suspended tenant's deliveries are not retried.
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as_service();
select is_empty($$ select * from api.worker_deliveries_to_retry(now()) $$, 'a suspended tenant''s deliveries are not returned');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('labak');

-- Read only: nothing changed through the calls.
select is((select count(*)::int from cms.site_deliveries), 4, 'the functions changed no delivery row');
select is((select notify_attempts from cms.site_deliveries where release_id = tests.k('a972') and site_id = tests.k('b971')), 12,
  'and no attempt count');

-- The functions return no secret column.
select is_empty($$ select a.attname from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                     unnest(p.proargnames) as a(attname)
                   where n.nspname = 'api' and p.proname = 'worker_deliveries_to_retry' and a.attname ~ 'secret' $$,
  'worker_deliveries_to_retry returns no secret column');
select is((select provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'worker_deliveries_to_retry'), 's', 'worker_deliveries_to_retry is stable');
select is((select provolatile::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'worker_tenants_to_release'), 's', 'worker_tenants_to_release is stable');

select * from finish();
rollback;
