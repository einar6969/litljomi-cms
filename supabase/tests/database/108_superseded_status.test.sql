-- supabase/tests/database/108_superseded_status.test.sql
-- M3-15 (deferred Minor Task 25 security r1), corrected by 20261104150000_publish_state.sql: once
-- a newer delivered release supersedes the request's release, the sweep no longer retries it, so
-- an entry must not stay "Í birtingu…" / "Bíður eftir vefnum". But a release live-checks only its
-- own linked requests, so the newer release's deliveries prove nothing about this entry (§7.4:
-- "Success is never shown before its proof exists"). M3-15 took them; this test pinned that.
-- Now: a site that confirmed the request's own release live stays live; any other site counts as
-- not confirmed, final (not retrying, not exhausted), except within 420 s of the request
-- release's delivery, while its own pending check may still pass. The newer release's deliveries
-- are never read. A request release that is not superseded keeps its own deliveries;
-- release_number and release_status stay the request's own.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak   sites 5b01, 5b02 active
--           d001 #1 delivered: 5b01 notified, live pending; 5b02 notify failed with a next attempt
--           entry cc01, request ec01 committed in d001
--           entry cc02, request ec02 committed in no release yet
begin;
\ir _helpers.sql
select plan(13);

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
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('5b01'), tests.tenant('labak'), 'http://s1', 'http://s1/r', gen_random_uuid(), true),
  (tests.k('5b02'), tests.tenant('labak'), 'http://s2', 'http://s2/r', gen_random_uuid(), true);
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('cc01'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak')),
  (tests.entry('cc02'), tests.tenant('labak'), 'news', 'b', tests.persona('editor_labak'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('d001'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '1 hour', now() - interval '1 hour');
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status,
                                 first_failed_at, next_attempt_at) values
  (tests.k('d001'), tests.k('5b01'), tests.tenant('labak'), 'ok', 1, now(), 'pending', null, null),
  (tests.k('d001'), tests.k('5b02'), tests.tenant('labak'), 'failed', 1, null, 'pending', now(), now() + interval '1 minute');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('ec01'), tests.tenant('labak'), tests.entry('cc01'), 'publish', 1, tests.persona('editor_labak'), 'committed', tests.k('d001')),
  (tests.k('ec02'), tests.tenant('labak'), tests.entry('cc02'), 'publish', 1, tests.persona('editor_labak'), 'committed', null);

-- ---------------------------------------------------------------------------
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select release_number, site_count, sites_notified, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying
                     from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (1, 2, 1, 0, 0, false, false) $$,
  'not superseded: the request''s own release''s deliveries (in progress)');

-- A newer release that is still building supersedes nothing yet.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('d002'), tests.tenant('labak'), 2, 'building', now());
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select site_count, sites_notified, sites_live_ok from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (2, 1, 0) $$,
  'a newer release that is only building: still the request''s own deliveries');

-- The newer release is delivered and live on one site, notified on the other. The request's
-- release (delivered an hour ago) is superseded: its sites that were not live count as not
-- confirmed, whatever the newer release shows.
select tests.act_as_owner();
update cms.releases set status = 'delivered', bundle_path = 'labak/releases/2.json', delivered_at = now() where id = tests.k('d002');
update cms.publish_requests set release_id = tests.k('d002') where id = tests.k('ec02');
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status) values
  (tests.k('d002'), tests.k('5b01'), tests.tenant('labak'), 'ok', 1, now(), 'ok'),
  (tests.k('d002'), tests.k('5b02'), tests.tenant('labak'), 'ok', 1, now(), 'pending');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select release_number, release_status, site_count, sites_notified, sites_live_ok, retries_exhausted
                     from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (1, 'delivered', 2, 1, 0, false) $$,
  'superseded: its own deliveries only (one site notified, none live); release_number stays the request''s own');
select results_eq($$ select sites_not_confirmed, live_retrying from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (2, false) $$,
  'superseded: both sites that were not live count as not confirmed, final (no retry will come)');

-- A site that confirmed the request's own release live keeps it, whatever the newer one shows.
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'ok' where release_id = tests.k('d001') and site_id = tests.k('5b01');
update cms.site_deliveries set live_status = 'pending' where release_id = tests.k('d002') and site_id = tests.k('5b01');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_notified, sites_live_ok from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (1, 1) $$,
  'superseded: a site live for the request''s own release stays live; the other site is not confirmed');
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'pending' where release_id = tests.k('d001') and site_id = tests.k('5b01');
update cms.site_deliveries set live_status = 'ok' where release_id = tests.k('d002') and site_id = tests.k('5b01');

-- Live on every site in the newer release: the superseded request's entry is live too.
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'ok' where release_id = tests.k('d002') and site_id = tests.k('5b02');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select entry_id, site_count, sites_live_ok from api.publication_status
                     where entry_id in (tests.entry('cc01'), tests.entry('cc02')) order by entry_id $$,
  $$ values (tests.entry('cc01'), 2, 0), (tests.entry('cc02'), 2, 2) $$,
  'live on every site in the newer release: the newer request is live, the superseded one is not shown live');

-- The newer release's exhausted or retrying delivery is what the superseded entry shows.
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'not_confirmed', first_failed_at = now(), next_attempt_at = now() + interval '2 minutes'
  where release_id = tests.k('d002') and site_id = tests.k('5b02');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying
                     from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (0, 2, false, false) $$,
  'superseded: the newer release''s retrying delivery is not the older entry''s; its own show not confirmed, not retrying');
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = null where release_id = tests.k('d002') and site_id = tests.k('5b02');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select retries_exhausted, live_retrying from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (false, false) $$,
  'superseded: the newer release''s exhausted delivery is not the older entry''s either');

-- Within 420 s of the request release's delivery, its own pending check may still pass: a site
-- not recorded yet, or notified and pending, keeps its own state (in progress), not not_confirmed.
select tests.act_as_owner();
update cms.releases set delivered_at = now() - interval '2 minutes' where id = tests.k('d001');
update cms.site_deliveries set notify_status = 'ok', next_attempt_at = null where release_id = tests.k('d001') and site_id = tests.k('5b02');
delete from cms.site_deliveries where release_id = tests.k('d001') and site_id = tests.k('5b01');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_notified, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying
                     from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (1, 0, 0, false, false) $$,
  'superseded within its run: its own pending checks stay in progress, not confirmed by the newer release');
select tests.act_as_owner();
update cms.releases set delivered_at = now() - interval '8 minutes' where id = tests.k('d001');
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_live_ok, sites_not_confirmed, live_retrying from api.publication_status where entry_id = tests.entry('cc01') $$,
  $$ values (0, 2, false) $$,
  'superseded after its run: the same pending checks are not confirmed, final');

-- The reproduction (security review, Thread A): an unpublish whose own check failed, then an
-- unrelated delivered release live on every site, must not show removed.
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('cc03'), tests.tenant('labak'), 'news', 'c', tests.persona('editor_labak')),
  (tests.entry('cc04'), tests.tenant('labak'), 'news', 'd', tests.persona('editor_labak'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('d003'), tests.tenant('labak'), 3, 'delivered', 'labak/releases/3.json', now() - interval '30 minutes', now() - interval '30 minutes');
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status,
                                 first_failed_at, next_attempt_at) values
  (tests.k('d003'), tests.k('5b01'), tests.tenant('labak'), 'ok', 1, now(), 'not_confirmed', now() - interval '30 minutes', now() + interval '1 minute'),
  (tests.k('d003'), tests.k('5b02'), tests.tenant('labak'), 'ok', 1, now(), 'not_confirmed', now() - interval '30 minutes', now() + interval '1 minute');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('ec03'), tests.tenant('labak'), tests.entry('cc03'), 'unpublish', null, tests.persona('editor_labak'), 'committed', tests.k('d003'));
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select sites_live_ok, sites_not_confirmed, live_retrying from api.publication_status where entry_id = tests.entry('cc03') $$,
  $$ values (0, 2, true) $$,
  'reproduction: the unpublish''s own check failed and is retrying');
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('d004'), tests.tenant('labak'), 4, 'delivered', 'labak/releases/4.json', now(), now());
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status) values
  (tests.k('d004'), tests.k('5b01'), tests.tenant('labak'), 'ok', 1, now(), 'ok'),
  (tests.k('d004'), tests.k('5b02'), tests.tenant('labak'), 'ok', 1, now(), 'ok');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('ec04'), tests.tenant('labak'), tests.entry('cc04'), 'publish', 1, tests.persona('editor_labak'), 'committed', tests.k('d004'));
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select action, site_count, sites_live_ok, sites_not_confirmed, retries_exhausted, live_retrying
                     from api.publication_status where entry_id = tests.entry('cc03') $$,
  $$ values ('unpublish'::text, 2, 0, 2, false, false) $$,
  'reproduction: after an unrelated delivered release, live on every site, the unpublish is not shown removed (not confirmed)');

-- Grants and security_invoker unchanged; another tenant sees nothing.
select tests.act_as(tests.persona('editor_demo'));
select is_empty($$ select 1 from api.publication_status where entry_id in (tests.entry('cc01'), tests.entry('cc02'), tests.entry('cc03')) $$,
  'another tenant''s editor sees no row for either entry');

select * from finish();
rollback;
