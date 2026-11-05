-- supabase/tests/database/115_withdrawal_safety.test.sql
-- M5-01 (findings 1 and 2 of docs/verification/m5-review.md; spec §6.2, §7.4; decision 65;
-- migration 20261105130000_withdrawal_safety):
--   1. api.request_unpublish refuses an entry that is not published and has no publish in flight
--      (`not_published`, no request row).
--   2. api.worker_commit_unpublish ends a repeat unpublish as `superseded`: nothing is linked to a
--      release.
--   3. api.worker_deliveries_to_retry stops a stored withdrawal only on the entry's latest committed
--      request: a pending, failed or superseded request stops nothing.
--   4. The requests the worker live-checks (the snapshot's and the retry's) carry the entry's
--      first_published_at, so a withdrawal with no check record is never confirmed (deliver.ts).
--   5. api.worker_record_delivery with notify status 'pending' stores a delivery's withdrawal state
--      before the run's pointer poll and live window: the row outlives a killed run, is retried and
--      alerted, and is left alone while the run can still be alive.
-- The end-to-end runs through the worker are in pipeline.integration.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): labak entries
-- c301 (never published), c302 (published), c303 (withdrawn: first_published_at set, D's unpublish
-- e301 linked); releases #9101 (a301), #9102 D (a302, the withdrawal, ten minutes ago), #9103 H
-- (a303, five minutes ago); active site b301.
begin;
\ir _helpers.sql
select plan(42);

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

-- What the worker stores before its pointer poll, at now() + p_minutes.
create function tests.hold(p_release text, p_entry text, p_minutes int) returns void
language sql
set search_path = ''
as $$
  select null from api.worker_record_delivery(tests.k(p_release), tests.k('b301'), 'pending', null,
    pg_catalog.jsonb_build_object('withdrawals', pg_catalog.jsonb_build_array(tests.w(p_entry)), 'withdrawals_others', false),
    now() + pg_catalog.make_interval(mins => p_minutes));
$$;
grant execute on function tests.hold(text, text, int) to service_role;

-- A delivery's row, whoever asks.
create function tests.row_of(p_release text)
returns table (notify_status text, live_status text, notify_attempts int, first_failed_at timestamptz, next_attempt_at timestamptz, last_error jsonb)
language sql
security definer
set search_path = ''
as $$
  select sd.notify_status, sd.live_status, sd.notify_attempts, sd.first_failed_at, sd.next_attempt_at, sd.last_error
  from cms.site_deliveries sd where sd.release_id = tests.k(p_release) and sd.site_id = tests.k('b301');
$$;
grant execute on function tests.row_of(text) to service_role;

-- Whether a release's delivery is in the retry selection at now() + p_minutes.
create function tests.listed(p_release text, p_minutes int) returns boolean
language sql
set search_path = ''
as $$
  select exists (select 1 from api.worker_deliveries_to_retry(now() + pg_catalog.make_interval(mins => p_minutes)) as r
                 where r.release_id = tests.k(p_release));
$$;
grant execute on function tests.listed(text, int) to service_role;

select tests.seed();
update cms.publish_requests set status = 'failed' where status in ('pending', 'validating');
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c301'), tests.tenant('labak'), 'news', 'c301', tests.persona('editor_labak')),
  (tests.entry('c302'), tests.tenant('labak'), 'news', 'c302', tests.persona('editor_labak')),
  (tests.entry('c303'), tests.tenant('labak'), 'news', 'c303', tests.persona('editor_labak'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  (tests.revision('d302'), tests.tenant('labak'), tests.entry('c302'), 1, 1, '{}', 'Birt', tests.persona('editor_labak')),
  (tests.revision('d303'), tests.tenant('labak'), tests.entry('c303'), 1, 1, '{}', 'Dregin', tests.persona('editor_labak'));
update cms.entries set published_rev_id = tests.revision('d302'), published_draft_version = 1,
                       first_published_at = now(), last_published_at = now()
  where id = tests.entry('c302');
update cms.entries set published_rev_id = tests.revision('d303'), published_draft_version = 1,
                       first_published_at = now(), last_published_at = now()
  where id = tests.entry('c303');
update cms.entries set published_rev_id = null, published_draft_version = null where id = tests.entry('c303');
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b301'), tests.tenant('labak'), 'https://a.example', 'https://a.example/api/cms/revalidate', tests.k('bf01'), true);
update cms.sites set active = false where tenant_id = tests.tenant('labak') and id <> tests.k('b301');
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('a301'), tests.tenant('labak'), 9101, 'delivered', 'labak/releases/9101.json', now() - interval '3 hours', now() - interval '3 hours'),
  (tests.k('a302'), tests.tenant('labak'), 9102, 'delivered', 'labak/releases/9102.json', now() - interval '10 minutes', now() - interval '10 minutes'),
  (tests.k('a303'), tests.tenant('labak'), 9103, 'delivered', 'labak/releases/9103.json', now() - interval '5 minutes', now() - interval '5 minutes');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, release_id) values
  (tests.k('e301'), tests.tenant('labak'), tests.entry('c303'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '11 minutes', 'committed', tests.k('a302'));

-- ---------------------------------------------------------------------------
-- 1. api.request_unpublish.
select is((select count(*)::int from pg_proc p
           where p.oid in ('api.request_unpublish(uuid)'::regprocedure, 'api.worker_commit_unpublish(uuid)'::regprocedure,
                           'api.worker_release_snapshot(uuid)'::regprocedure, 'api.worker_deliveries_to_retry(timestamptz)'::regprocedure,
                           'api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz)'::regprocedure)
             and not p.prosecdef and p.proconfig = array['search_path=""']), 5,
  'the changed functions are SECURITY INVOKER with search_path = ''''');
select ok(has_function_privilege('authenticated', 'api.request_unpublish(uuid)', 'execute')
          and not has_function_privilege('anon', 'api.request_unpublish(uuid)', 'execute'),
  'request_unpublish keeps its grants');

select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.request_unpublish(tests.entry('c303')) $$, 'P0001', 'not_published',
  'a repeat unpublish of a withdrawn entry is refused');
select throws_ok($$ select api.request_unpublish(tests.entry('c301')) $$, 'P0001', 'not_published',
  'an unpublish of an entry that was never published is refused');
select tests.act_as_owner();
select is((select count(*)::int from cms.publish_requests where entry_id in (tests.entry('c301'), tests.entry('c303'))), 1,
  'a refused unpublish adds no request');

-- A publish that is not in flight (each final status) still refuses; an unpublish in flight is no publish.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status)
select gen_random_uuid(), tests.tenant('labak'), tests.entry('c301'), a, case when a = 'publish' then 1 end, tests.persona('editor_labak'), s
from (values ('publish', 'failed_validation'), ('publish', 'superseded'), ('publish', 'rejected'), ('publish', 'failed'),
             ('unpublish', 'pending'), ('unpublish', 'validating')) as x(a, s);
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.request_unpublish(tests.entry('c301')) $$, 'P0001', 'not_published',
  'finished publishes and an unpublish in flight are no publish in flight');
select tests.act_as_owner();
delete from cms.publish_requests where entry_id = tests.entry('c301');

-- A publish in flight: the unpublish is accepted, in both non-final statuses.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status) values
  (tests.k('e311'), tests.tenant('labak'), tests.entry('c301'), 'publish', 1, tests.persona('editor_labak'), 'pending');
select tests.act_as(tests.persona('editor_labak'));
select isnt(api.request_unpublish(tests.entry('c301')), null::uuid, 'accepted while a publish is pending');
select tests.act_as_owner();
update cms.publish_requests set status = 'validating' where id = tests.k('e311');
select tests.act_as(tests.persona('editor_labak'));
select isnt(api.request_unpublish(tests.entry('c301')), null::uuid, 'accepted while a publish is validating');
select isnt(api.request_unpublish(tests.entry('c302')), null::uuid, 'a published entry is accepted');
select throws_ok($$ select api.request_unpublish(gen_random_uuid()) $$, 'P0001', 'not_found', 'an unknown entry is still not_found');
select tests.act_as_owner();
delete from cms.publish_requests where entry_id in (tests.entry('c301'), tests.entry('c302'));

-- ---------------------------------------------------------------------------
-- 2. api.worker_commit_unpublish: only the first of two commits.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status, claimed_at, attempts) values
  (tests.k('e321'), tests.tenant('labak'), tests.entry('c302'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '2 minutes', 'validating', now(), 1),
  (tests.k('e322'), tests.tenant('labak'), tests.entry('c302'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '1 minute', 'validating', now(), 1),
  (tests.k('e323'), tests.tenant('labak'), tests.entry('c301'), 'unpublish', null, tests.persona('editor_labak'), now() - interval '1 minute', 'validating', now(), 1);
select tests.act_as_service();
select is(api.worker_commit_unpublish(tests.k('e321')), 'committed', 'the first unpublish commits');
select is(api.worker_commit_unpublish(tests.k('e322')), 'superseded', 'the repeat ends superseded');
select is(api.worker_commit_unpublish(tests.k('e323')), 'superseded', 'an unpublish of a never-published entry ends superseded');
select tests.act_as_owner();
select is((select row(status, revision_id, release_id, error)::text from cms.publish_requests where id = tests.k('e322')),
  row('superseded', null::uuid, null::uuid, jsonb_build_object('code', 'not_published'))::text,
  'the repeat records why, and no release');
select is((select pg_catalog.count(*)::int from cms.publish_requests where id in (tests.k('e321'), tests.k('e322'), tests.k('e323')) and status = 'committed'), 1,
  'only the first commit is left for a release to link');

-- A suspended tenant still rejects first, as worker_commit_publish's step 4.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts) values
  (tests.k('e324'), tests.tenant('labak'), tests.entry('c302'), 'unpublish', null, tests.persona('editor_labak'), 'validating', now(), 1);
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as_service();
select is(api.worker_commit_unpublish(tests.k('e324')), 'rejected', 'a suspended tenant rejects before the repeat check');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('labak');
delete from cms.publish_requests where id in (tests.k('e321'), tests.k('e322'), tests.k('e323'), tests.k('e324'));

-- ---------------------------------------------------------------------------
-- 3. The checks stop only on the latest committed request (decision 65). D's delivery missed; H
-- supersedes it.
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status, last_error,
                                 first_failed_at, next_attempt_at) values
  (tests.k('a302'), tests.k('b301'), tests.tenant('labak'), 'ok', 1, now() - interval '10 minutes', 'not_confirmed',
   jsonb_build_object('code', 'live_not_confirmed', 'failures', jsonb_build_array(), 'withdrawals', jsonb_build_array(tests.w('c303')),
                      'withdrawn', jsonb_build_array(), 'withdrawals_others', false),
   now() - interval '10 minutes', now() - interval '9 minutes');
select tests.act_as_service();
select ok(tests.listed('a302', 0), 'D''s stored withdrawal is checked');
select tests.act_as_owner();

insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status)
select tests.k('e33' || n), tests.tenant('labak'), tests.entry('c303'), a, case when a = 'publish' then 1 end, tests.persona('editor_labak'),
       now() - interval '1 minute', s
from (values ('1', 'unpublish', 'superseded'), ('2', 'unpublish', 'failed'), ('3', 'publish', 'failed_validation'),
             ('4', 'publish', 'superseded'), ('5', 'publish', 'rejected'), ('6', 'publish', 'failed')) as x(n, a, s);
select tests.act_as_service();
select ok(tests.listed('a302', 0), 'a superseded unpublish, or a failed or refused publish, stops nothing');
select tests.act_as_owner();
delete from cms.publish_requests where id in (tests.k('e331'), tests.k('e332'), tests.k('e333'), tests.k('e334'), tests.k('e335'), tests.k('e336'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status) values
  (tests.k('e337'), tests.tenant('labak'), tests.entry('c303'), 'publish', 1, tests.persona('editor_labak'), now() - interval '1 minute', 'pending');
select tests.act_as_service();
select ok(tests.listed('a302', 0), 'nor does a publish still in flight');
select tests.act_as_owner();
update cms.publish_requests set status = 'committed' where id = tests.k('e337');
select tests.act_as_service();
select ok(not tests.listed('a302', 0), 'a committed publish stops the checks at once');
select tests.act_as_owner();
delete from cms.publish_requests where id = tests.k('e337');

-- ---------------------------------------------------------------------------
-- 4. The requests the worker checks carry first_published_at.
update cms.publish_requests set release_id = null where id = tests.k('e301');
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a304'), tests.tenant('labak'), 9104, 'building', now());
select tests.act_as_service();
select is((select (r -> 'first_published_at') is not null and r ->> 'first_published_at' is not null
           from jsonb_array_elements(api.worker_release_snapshot(tests.k('a304')) -> 'requests') r
           where r ->> 'id' = tests.k('e301')::text), true,
  'the snapshot''s request carries the entry''s first_published_at');
select tests.act_as_owner();
delete from cms.releases where id = tests.k('a304');
update cms.publish_requests set release_id = tests.k('a303') where id = tests.k('e301');
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, live_status, first_failed_at, next_attempt_at) values
  (tests.k('a303'), tests.k('b301'), tests.tenant('labak'), 'failed', 1, 'pending', now(), now());
select tests.act_as_service();
select is((select r.requests -> 0 ->> 'first_published_at' is not null from api.worker_deliveries_to_retry(now() + interval '1 minute') r
           where r.release_id = tests.k('a303')), true,
  'and so does the retry''s');
select tests.act_as_owner();
delete from cms.site_deliveries where release_id in (tests.k('a302'), tests.k('a303'));
update cms.publish_requests set release_id = tests.k('a302') where id = tests.k('e301');

-- ---------------------------------------------------------------------------
-- 5. The state stored before the poll. H is the latest; the state is stored on it first, then on
-- D, the superseded release.
select tests.act_as_service();
select tests.hold('a303', 'c303', 0);
select is((select row(r.notify_status, r.live_status, r.notify_attempts, r.first_failed_at)::text from tests.row_of('a303') r),
  row('pending', 'pending', 0, null::timestamptz)::text, 'the record starts a pending delivery: no attempt, no failure');
select ok((select r.next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes' from tests.row_of('a303') r),
  'with its first attempt five minutes on');
select is((select r.last_error from tests.row_of('a303') r),
  jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c303')), 'withdrawals_others', false), 'and the state as given');
select ok(not tests.listed('a303', 4), 'the latest release: left alone while the run can be alive');
select ok(tests.listed('a303', 6), 'and retried once it cannot be');
select ok((select r.withdrawal is null from api.worker_deliveries_to_retry(now() + interval '6 minutes') r where r.release_id = tests.k('a303')),
  'as a full retry of the latest release');

select is((select r.notify_attempts from api.worker_record_delivery(tests.k('a303'), tests.k('b301'), 'ok', null, null, now() + interval '2 minutes') r), 1,
  'the notification is recorded');
select ok((select r.next_attempt_at between now() + interval '6 minutes' and now() + interval '8 minutes' from tests.row_of('a303') r),
  'and keeps a next attempt, five minutes on, for a run killed in the live window');
select is((select r.last_error from tests.row_of('a303') r),
  jsonb_build_object('withdrawals', jsonb_build_array(tests.w('c303')), 'withdrawals_others', false), 'and the state');
select ok(tests.listed('a303', 8), 'a run killed in the live window is retried');

select is((select count(*)::int from api.worker_record_delivery(tests.k('a303'), tests.k('b301'), null, 'ok', null, now() + interval '2 minutes') r
           where r.next_attempt_at is null), 1, 'a live ok ends the schedule');
select is((select r.last_error from tests.row_of('a303') r), null::jsonb, 'and clears the state');

-- A delivery with a record already: the state record changes nothing.
select tests.hold('a303', 'c303', 3);
select is((select row(r.notify_status, r.live_status, r.last_error)::text from tests.row_of('a303') r),
  row('ok', 'ok', null::jsonb)::text, 'a settled delivery is left as it is');
select tests.act_as_owner();
delete from cms.site_deliveries where release_id = tests.k('a303');
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, live_status, last_error, first_failed_at, next_attempt_at) values
  (tests.k('a303'), tests.k('b301'), tests.tenant('labak'), 'failed', 2, 'pending',
   jsonb_build_object('code', 'notify_failed', 'status', 500, 'withdrawals', jsonb_build_array(), 'withdrawn', jsonb_build_array(tests.entry('c303'))),
   now() - interval '1 minute', now() + interval '1 minute');
select tests.act_as_service();
select tests.hold('a303', 'c303', 0);
select is((select row(r.notify_status, r.notify_attempts, r.last_error -> 'withdrawn', r.last_error ->> 'code')::text from tests.row_of('a303') r),
  row('failed', 2, jsonb_build_array(tests.entry('c303')), 'notify_failed')::text,
  'a retry''s stored state and statuses stay');
select tests.act_as_owner();
delete from cms.site_deliveries where release_id = tests.k('a303');

-- The run of D, killed: superseded by H, with the state stored.
select tests.act_as_service();
select tests.hold('a302', 'c303', -10);
select ok(tests.listed('a302', 0), 'a killed run''s superseded delivery is checked again');
select is((select r.withdrawal -> 'pending' from api.worker_deliveries_to_retry(now()) r where r.release_id = tests.k('a302')),
  jsonb_build_array(tests.w('c303')), 'from the stored checks');
select ok(not tests.listed('a302', -8), 'not while the run can be alive');
select is((select r.withdrawal ->> 'hourOver' from api.worker_deliveries_to_retry(now() + interval '51 minutes') r where r.release_id = tests.k('a302')), 'true',
  'and the hour ending lists it for the alert');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select site_count, sites_notified, sites_live_ok, sites_not_confirmed from api.publication_status where entry_id = tests.entry('c303') $$,
  $$ values (1, 0, 0, 0) $$, 'the editor sees it in progress, never confirmed');
select tests.act_as_owner();

-- The console reads it as a pending delivery with no error yet.
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select results_eq($$ select notify_status, live_status, last_error_code, last_error_status from api.console_deliveries where release_id = tests.k('a302') $$,
  $$ values ('pending', 'pending', null::text, null::text) $$, 'the console''s delivery view reads the stored state as no error');
select tests.act_as_owner();

select * from finish();
rollback;
