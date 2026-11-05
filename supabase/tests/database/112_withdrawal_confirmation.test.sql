-- supabase/tests/database/112_withdrawal_confirmation.test.sql
-- W1 (spec §5.6 "Withdrawal", §7.2, §7.4; migration 20261104180000_withdrawal_confirmation): an
-- unconfirmed withdrawal is checked again after its release is superseded.
--   1. api.worker_record_delivery keeps a delivery's withdrawal state in last_error (withdrawals,
--      withdrawn, withdrawals_others, withdrawal_alerted) across records until the delivery is live
--      ok; a record with neither status only merges p_error into an existing row's last_error.
--   2. api.worker_deliveries_to_retry also lists a superseded release's delivery whose stored
--      withdrawals are still unconfirmed, for entries whose latest committed request is still that release's
--      unpublish, when its next attempt is due or when the hour after the release ended and no
--      withdrawal alert was raised yet. It names the latest delivered release (notify_release_number)
--      and the state (withdrawal); never the old bundles.
--   3. api.worker_tenants_to_release leaves out of unconfirmed_site_ids a site already alerted.
--   4. api.publication_status: an unpublish confirmed on a site (withdrawn) counts live there; one
--      still pending keeps its own schedule within the hour after its release, and shows not
--      confirmed (no retry) after it, even once superseded.
-- The end-to-end runs on the local stack are in pipeline.integration.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): labak entries
-- c201, c202 (both withdrawn in D); releases #1 (a201, three hours ago), #2 D (a202, ten minutes
-- ago, unpublishes of c201 and c202 linked), #3 H (a203, five minutes ago, nothing linked); active
-- sites b201, b202, inactive b203.
begin;
\ir _helpers.sql
select plan(39);

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

-- Records D's delivery to a site as the worker does, at now() + p_minutes.
create function tests.rec(p_site text, p_notify text, p_live text, p_error jsonb, p_minutes int) returns void
language sql
set search_path = ''
as $$
  select null from api.worker_record_delivery(tests.k('a202'), tests.k(p_site), p_notify, p_live, p_error,
                                               now() + pg_catalog.make_interval(mins => p_minutes));
$$;
grant execute on function tests.rec(text, text, text, jsonb, int) to service_role;

create function tests.last_error(p_site text) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select sd.last_error from cms.site_deliveries sd where sd.release_id = tests.k('a202') and sd.site_id = tests.k(p_site);
$$;
grant execute on function tests.last_error(text) to service_role;

-- D's rows in the retry selection at now() + p_minutes.
create function tests.d_rows(p_minutes int)
returns table (site_id uuid, notify_release_number int, bundle_path text, withdrawal jsonb)
language sql
set search_path = ''
as $$
  select r.site_id, r.notify_release_number, r.bundle_path, r.withdrawal
  from api.worker_deliveries_to_retry(now() + pg_catalog.make_interval(mins => p_minutes)) as r
  where r.release_id = tests.k('a202')
  order by r.site_id;
$$;
grant execute on function tests.d_rows(int) to service_role;

-- A stored withdrawal check for an entry (what deliver.ts writes).
create function tests.w(p_entry text) returns jsonb
language sql
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object('entryId', tests.entry(p_entry)::text, 'requestIds', pg_catalog.jsonb_build_array(),
                                       'checks', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('path', '/frettir/' || p_entry, 'expect', 'absent')),
                                       'ownPath', '/frettir/' || p_entry);
$$;
grant execute on function tests.w(text) to service_role;

select tests.seed();
update cms.publish_requests set status = 'failed' where status in ('pending', 'validating');
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c201'), tests.tenant('labak'), 'news', 'c201', tests.persona('editor_labak')),
  (tests.entry('c202'), tests.tenant('labak'), 'news', 'c202', tests.persona('editor_labak'));
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b201'), tests.tenant('labak'), 'https://a.example', 'https://a.example/api/cms/revalidate', tests.k('bf01'), true),
  (tests.k('b202'), tests.tenant('labak'), 'https://b.example', 'https://b.example/api/cms/revalidate', tests.k('bf02'), true),
  (tests.k('b203'), tests.tenant('labak'), 'https://c.example', 'https://c.example/api/cms/revalidate', tests.k('bf03'), false);
-- Other fixtures' labak sites take no part.
update cms.sites set active = false where tenant_id = tests.tenant('labak') and id not in (tests.k('b201'), tests.k('b202'), tests.k('b203'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a201'), tests.tenant('labak'), 9001, 'delivered', 'labak/releases/9001.json', now() - interval '3 hours', now() - interval '3 hours'),
  (tests.k('a202'), tests.tenant('labak'), 9002, 'delivered', 'labak/releases/9002.json', now() - interval '10 minutes', now() - interval '10 minutes'),
  (tests.k('a203'), tests.tenant('labak'), 9003, 'delivered', 'labak/releases/9003.json', now() - interval '5 minutes', now() - interval '5 minutes');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e201'), tests.tenant('labak'), tests.entry('c201'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '11 minutes', 'committed', tests.k('a202')),
  (tests.k('e202'), tests.tenant('labak'), tests.entry('c202'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '11 minutes', 'committed', tests.k('a202'));

-- ---------------------------------------------------------------------------
-- Definitions: the retry selection gains two columns; all three functions stay invoker,
-- search_path '', service_role only; the view stays security_invoker, SELECT for authenticated.
select is(pg_get_function_result('api.worker_deliveries_to_retry(timestamptz)'::regprocedure),
  'TABLE(release_id uuid, tenant_id uuid, tenant_slug text, release_number integer, bundle_path text, previous_bundle_path text, site_id uuid, notify_status text, notify_attempts integer, live_status text, requests jsonb, notify_release_number integer, withdrawal jsonb)',
  'worker_deliveries_to_retry returns the latest release number to notify and the withdrawal state');
select is((select count(*)::int from pg_proc p
           where p.oid in ('api.worker_deliveries_to_retry(timestamptz)'::regprocedure,
                           'api.worker_tenants_to_release(timestamptz)'::regprocedure,
                           'api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz)'::regprocedure)
             and not p.prosecdef and p.proconfig = array['search_path=""']), 3,
  'the three functions are SECURITY INVOKER with search_path = ''''');
select is_empty($$ select p.oid from pg_proc p
  where p.oid in ('api.worker_deliveries_to_retry(timestamptz)'::regprocedure,
                  'api.worker_tenants_to_release(timestamptz)'::regprocedure,
                  'api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz)'::regprocedure)
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'they are executable by service_role only (and the owner)');
select is((select provolatile from pg_proc where oid = 'api.worker_deliveries_to_retry(timestamptz)'::regprocedure), 's',
  'worker_deliveries_to_retry is still stable');
select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'api.publication_status'::regclass),
  'api.publication_status is still security_invoker');
select is_empty($$ select a.privilege_type, a.grantee::regrole::text
     from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner
       and not (a.grantee::regrole::text = 'authenticated' and a.privilege_type = 'SELECT') $$,
  'api.publication_status: still SELECT for authenticated only');

-- ---------------------------------------------------------------------------
-- 1. The withdrawal state survives the records that do not settle the delivery.
select tests.act_as_service();
select tests.rec('b201', 'ok', null, null, -10);
select tests.rec('b201', null, 'not_confirmed',
  jsonb_build_object('code', 'live_not_confirmed', 'failures', jsonb_build_array(),
                     'withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')),
                     'withdrawn', jsonb_build_array(), 'withdrawals_others', false), -10);
select is(tests.last_error('b201') -> 'withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')),
  'a miss stores the withdrawal checks it could not confirm');
select tests.rec('b201', 'ok', null, null, -9);
select is(tests.last_error('b201'),
  jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')), 'withdrawn', jsonb_build_array(),
                     'withdrawals_others', false),
  'a retry''s notification keeps the withdrawal state and nothing else of the old error');
select tests.rec('b201', null, 'not_confirmed', jsonb_build_object('code', 'live_not_confirmed', 'failures', jsonb_build_array()), -9);
select is(tests.last_error('b201') -> 'withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')),
  'a later miss that does not name the withdrawals keeps them');
select tests.rec('b201', 'failed', null, jsonb_build_object('code', 'notify_failed', 'status', 500), -9);
select is(tests.last_error('b201') ->> 'code', 'notify_failed', 'a failed notification replaces the rest of the error');
select is(tests.last_error('b201') -> 'withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')), 'and keeps the withdrawals');

-- A record with neither status only merges into an existing row; none is created.
select tests.rec('b201', null, null, jsonb_build_object('withdrawal_alerted', '2026-11-04T12:00:00Z'), -9);
select is(tests.last_error('b201') ->> 'withdrawal_alerted', '2026-11-04T12:00:00Z', 'an annotation merges into last_error');
select is(tests.last_error('b201') ->> 'code', 'notify_failed', 'and leaves the rest as it was');
select is((select row(notify_status, live_status, notify_attempts)::text from cms.site_deliveries
           where release_id = tests.k('a202') and site_id = tests.k('b201')), row('failed', 'not_confirmed', 3)::text,
  'and records no status or attempt');
select tests.rec('b202', null, null, jsonb_build_object('withdrawal_alerted', 'x'), -9);
select is((select count(*)::int from cms.site_deliveries where release_id = tests.k('a202') and site_id = tests.k('b202')), 0,
  'an annotation of a delivery that has no row creates none');
select throws_ok($$ select tests.rec('b201', null, null, null, 0) $$, '22023', null, 'an annotation needs an object');

-- Live ok clears the state.
select tests.rec('b202', 'ok', null, null, -10);
select tests.rec('b202', null, 'not_confirmed', jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c201'))), -10);
select tests.rec('b202', null, 'ok', null, -8);
select is(tests.last_error('b202'), null, 'a live ok delivery keeps no withdrawal state');

-- Back to the scenario: b201 missed both withdrawals ten minutes ago (retry 1 minute later, due
-- now); b202 confirmed.
select tests.act_as_owner();
update cms.site_deliveries
set notify_status = 'ok', live_status = 'not_confirmed', notify_attempts = 1,
    first_failed_at = now() - interval '10 minutes', next_attempt_at = now() - interval '1 minute',
    last_error = jsonb_build_object('code', 'live_not_confirmed', 'failures', jsonb_build_array(),
                                    'withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')),
                                    'withdrawn', jsonb_build_array(), 'withdrawals_others', false)
where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as_service();

-- ---------------------------------------------------------------------------
-- 2. The retry selection.
select results_eq($$ select site_id, notify_release_number, bundle_path, withdrawal from tests.d_rows(0) $$,
  $$ values (tests.k('b201'), 9003, null::text,
             jsonb_build_object('pending', jsonb_build_array(tests.w('c201'), tests.w('c202')), 'withdrawn', jsonb_build_array(),
                                'others', false, 'alerted', false, 'hourOver', false)) $$,
  'a superseded release''s unconfirmed withdrawal is retried when due: the latest release is notified, no bundle is named');
select is((select count(*)::int from api.worker_deliveries_to_retry(now()) where release_id = tests.k('a202') and site_id = tests.k('b202')), 0,
  'a site that confirmed is not checked again');
select is((select r.withdrawal from api.worker_deliveries_to_retry(now()) as r where r.release_id = tests.k('a203')), null,
  'a latest release''s rows carry no withdrawal state');
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = now() + interval '4 minutes' where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as_service();
select is_empty($$ select * from tests.d_rows(0) $$, 'not before its next attempt is due, within the hour');
select is((select count(*)::int from tests.d_rows(4)), 1, 'listed once it is due');
select is((select (withdrawal ->> 'hourOver')::boolean from tests.d_rows(51)), true,
  'once the hour after the release ended, listed at once, due or not, for the alert');
select tests.act_as_owner();
update cms.site_deliveries set last_error = last_error || jsonb_build_object('withdrawal_alerted', 'x'), next_attempt_at = now() + interval '60 minutes'
where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as_service();
select is_empty($$ select * from tests.d_rows(51) $$, 'once alerted, only when its next attempt is due');
select is((select (withdrawal ->> 'alerted')::boolean from tests.d_rows(60)), true, 'and the row says it was alerted');

-- Republishing stops the checks at once: only the entries whose latest committed request is D's
-- unpublish (decision 65; a request still in flight stops nothing, 115_withdrawal_safety).
select tests.act_as_owner();
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status) values
  (tests.k('e203'), tests.tenant('labak'), tests.entry('c202'), 'publish', 1, tests.persona('editor_labak'), now() - interval '1 minute', 'committed');
select tests.act_as_service();
select is((select withdrawal -> 'pending' from tests.d_rows(60)), jsonb_build_array(tests.w('c201')),
  'an entry published again is no longer checked');
select tests.act_as_owner();
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status) values
  (tests.k('e204'), tests.tenant('labak'), tests.entry('c201'), 'publish', 1, tests.persona('editor_labak'), now() - interval '1 minute', 'committed');
select tests.act_as_service();
select is_empty($$ select * from tests.d_rows(60) $$, 'with every withdrawn entry published again, the delivery is not retried at all');
select tests.act_as_owner();
delete from cms.publish_requests where id in (tests.k('e203'), tests.k('e204'));
select tests.act_as_service();

-- Exhausted, deactivated or suspended: never.
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = null where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as_service();
select is_empty($$ select * from tests.d_rows(24 * 60) $$, 'a delivery whose retries ran out is not retried');
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = now() - interval '1 minute' where release_id = tests.k('a202') and site_id = tests.k('b201');
update cms.sites set active = false where id = tests.k('b201');
select tests.act_as_service();
select is_empty($$ select * from tests.d_rows(0) $$, 'a deactivated site is not retried');
select tests.act_as_owner();
update cms.sites set active = true where id = tests.k('b201');
select tests.act_as_service();
select is((select count(*)::int from tests.d_rows(0)), 1, 'reactivated, it is retried again');

-- ---------------------------------------------------------------------------
-- 3. The hold's alert list leaves out a site already alerted. D' (a204, #9004) withdraws c201 again
-- and is the latest; its hour is over, both sites unsettled, b201 alerted.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a204'), tests.tenant('labak'), 9004, 'delivered', 'labak/releases/9004.json', now() - interval '2 hours', now() - interval '2 hours');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e205'), tests.tenant('labak'), tests.entry('c201'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '2 hours', 'committed', tests.k('a204'));
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, live_status, last_error, first_failed_at, next_attempt_at) values
  (tests.k('a204'), tests.k('b201'), tests.tenant('labak'), 'ok', 3, 'not_confirmed',
   jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c201')), 'withdrawal_alerted', 'x'), now() - interval '2 hours', now() + interval '1 hour'),
  (tests.k('a204'), tests.k('b202'), tests.tenant('labak'), 'ok', 3, 'not_confirmed',
   jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c201'))), now() - interval '2 hours', now() + interval '1 hour');
select tests.act_as_service();
select results_eq($$ select r.unconfirmed_release_id, r.unconfirmed_site_ids from api.worker_tenants_to_release(now()) as r
                    where r.tenant_id = tests.tenant('labak') $$,
  $$ values (tests.k('a204'), array[tests.k('b202')]) $$,
  'the hold''s alert names only the site not alerted yet');
select tests.act_as_owner();
update cms.site_deliveries set last_error = last_error || jsonb_build_object('withdrawal_alerted', 'x') where release_id = tests.k('a204');
select tests.act_as_service();
select results_eq($$ select r.unconfirmed_release_id, r.unconfirmed_site_ids from api.worker_tenants_to_release(now()) as r
                    where r.tenant_id = tests.tenant('labak') $$,
  $$ values (null::uuid, null::uuid[]) $$,
  'every site alerted: the housekeeping release is still built, with nothing more to alert');
select tests.act_as_owner();
delete from cms.site_deliveries where release_id = tests.k('a204');
delete from cms.publish_requests where id = tests.k('e205');
delete from cms.releases where id = tests.k('a204');

-- ---------------------------------------------------------------------------
-- 4. What the editor sees for c201's unpublish (e201, D superseded by H).
create function tests.c201_status()
returns table (sites_live_ok int, sites_not_confirmed int, live_retrying boolean, retries_exhausted boolean)
language sql
set search_path = ''
as $$
  select s.sites_live_ok, s.sites_not_confirmed, s.live_retrying, s.retries_exhausted
  from api.publication_status s where s.entry_id = tests.entry('c201');
$$;
grant execute on function tests.c201_status() to authenticated;

update cms.site_deliveries
set live_status = 'not_confirmed', next_attempt_at = now() + interval '2 minutes', first_failed_at = now() - interval '10 minutes',
    last_error = jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c201'), tests.w('c202')), 'withdrawn', jsonb_build_array())
where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select * from tests.c201_status() $$, $$ values (1, 1, true, false) $$,
  'superseded within the hour, a withdrawal still checked shows its retry (not a final "not confirmed")');

-- The second site confirms c201 (but not c202): "Tekið af vef" for c201 only.
select tests.act_as_owner();
update cms.site_deliveries
set last_error = jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c202')), 'withdrawn', jsonb_build_array(tests.entry('c201')::text))
where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select * from tests.c201_status() $$, $$ values (2, 0, false, false) $$,
  'a withdrawal confirmed on every active site counts live there, though the delivery is still not_confirmed for another entry');
select results_eq($$ select s.sites_live_ok, s.sites_not_confirmed, s.live_retrying from api.publication_status s where s.entry_id = tests.entry('c202') $$,
  $$ values (1, 1, true) $$, 'the other entry still waits for its own confirmation');

-- The hour after D ended: the retries go on, but the editor sees a failure.
select tests.act_as_owner();
update cms.releases set delivered_at = now() - interval '61 minutes' where id = tests.k('a202');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select s.sites_live_ok, s.sites_not_confirmed, s.live_retrying, s.retries_exhausted
                    from api.publication_status s where s.entry_id = tests.entry('c202') $$,
  $$ values (1, 1, false, false) $$, 'after the hour: not confirmed, no retry shown, not exhausted ("Ekki staðfest á vef")');
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = null where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as(tests.persona('editor_labak'));
select is((select s.retries_exhausted from api.publication_status s where s.entry_id = tests.entry('c202')), true,
  'retries that ran out show the delivery failed');
select is((select s.sites_live_ok from tests.c201_status() s), 2, 'and a withdrawal confirmed before stays confirmed');

-- A delivery without withdrawal state (recorded before this migration) keeps the old display.
select tests.act_as_owner();
update cms.site_deliveries set last_error = jsonb_build_object('code', 'live_not_confirmed'), next_attempt_at = now() + interval '5 minutes'
where release_id = tests.k('a202') and site_id = tests.k('b201');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select * from tests.c201_status() $$, $$ values (1, 1, false, false) $$,
  'an older delivery without withdrawal state shows a superseded withdrawal as not confirmed, as before');

select * from finish();
rollback;
