-- supabase/tests/database/110_housekeeping_retry_hold.test.sql
-- The housekeeping hold (spec §7.2 "Housekeeping release", §7.4; migration
-- 20261104160000_housekeeping_retry_hold): api.worker_tenants_to_release(p_now) does not list a
-- tenant for its housekeeping release while a site's delivery of the withdrawing release is
-- unsettled (first live check not recorded, or a retry scheduled), for at most one hour after that
-- release's delivery. A newly committed request still lists the tenant at once. When the hour ends
-- with sites unsettled, the row names the release and those sites, for the sweep's alert. The
-- listing without sites is in 109_housekeeping_release; the end-to-end runs on the local stack are
-- in housekeeping.integration.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): labak entry
-- c101; labak release #1 delivered two hours ago with media f101, #2 (D) delivered at T = now()
-- with an unpublish of c101 linked; active sites b101, b102 and an inactive site b103.
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

-- Labak's row at T + p_minutes (null columns when not listed: see tests.labak_listed).
create function tests.labak_row(p_minutes int)
returns table (tenant_id uuid, unconfirmed_release_id uuid, unconfirmed_release_number int, unconfirmed_site_ids uuid[])
language sql
set search_path = ''
as $$
  select * from api.worker_tenants_to_release(now() + pg_catalog.make_interval(mins => p_minutes)) as t
  where t.tenant_id = tests.tenant('labak');
$$;
grant execute on function tests.labak_row(int) to service_role;

create function tests.labak_listed(p_minutes int) returns boolean
language sql
set search_path = ''
as $$
  select exists (select 1 from tests.labak_row(p_minutes));
$$;
grant execute on function tests.labak_listed(int) to service_role;

-- Records a delivery as the worker does, at T + p_minutes.
create function tests.record(p_site text, p_notify text, p_live text, p_minutes int) returns void
language sql
set search_path = ''
as $$
  select null from api.worker_record_delivery(tests.k('a102'), tests.k(p_site), p_notify, p_live, null,
                                               now() + pg_catalog.make_interval(mins => p_minutes));
$$;
grant execute on function tests.record(text, text, text, int) to service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c101'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak'));
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('b101'), tests.tenant('labak'), 'https://a.example', 'https://a.example/api/cms/revalidate', tests.k('bf01'), true),
  (tests.k('b102'), tests.tenant('labak'), 'https://b.example', 'https://b.example/api/cms/revalidate', tests.k('bf02'), true),
  (tests.k('b103'), tests.tenant('labak'), 'https://c.example', 'https://c.example/api/cms/revalidate', tests.k('bf03'), false);
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, public_assets) values
  (tests.k('a101'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '2 hours', now() - interval '2 hours',
   array[tests.k('f101')]),
  (tests.k('a102'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now(), now(), array[tests.k('f101')]);
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e101'), tests.tenant('labak'), tests.entry('c101'), 'unpublish', null, tests.persona('editor_labak'), 'committed', tests.k('a102'));

-- ---------------------------------------------------------------------------
-- The definition: created again with the new columns, still invoker, stable, search_path '',
-- service_role only.
select is((select count(*)::int from pg_proc p
           where p.oid = 'api.worker_tenants_to_release(timestamptz)'::regprocedure
             and not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']), 1,
  'worker_tenants_to_release is SECURITY INVOKER, stable, with search_path = ''''');
select is_empty($$ select 1 from pg_proc p
  where p.oid = 'api.worker_tenants_to_release(timestamptz)'::regprocedure
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'it is executable by service_role only (and the owner)');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_tenants_to_release(now()) $$, '42501', null, 'an editor cannot list tenants to release');
select tests.act_as_service();
select throws_ok($$ select * from api.worker_tenants_to_release(null) $$, '22023', 'p_now is required', 'p_now is required');

-- ---------------------------------------------------------------------------
-- The first live check is not recorded yet: held.
select is(tests.labak_listed(1), false, 'no delivery recorded for an active site yet: the housekeeping release waits');
select tests.record('b101', 'ok', null, 0);
select tests.record('b102', 'ok', null, 0);
select is(tests.labak_listed(1), false, 'notified, first live check still running: it waits');
select tests.record('b101', null, 'ok', 1);
select is(tests.labak_listed(1), false, 'one site confirmed, the other still checking: it waits');

-- The first live check missed: M3-03's retry is scheduled, and the hold keeps it alive.
select tests.record('b102', null, 'not_confirmed', 1);
select isnt((select next_attempt_at from cms.site_deliveries where release_id = tests.k('a102') and site_id = tests.k('b102')), null,
  'the miss scheduled a retry');
select is(tests.labak_listed(2), false, 'a not_confirmed delivery with a retry scheduled holds the housekeeping release');
select is(tests.labak_listed(59), false, 'and keeps holding it within the hour after the delivery');

-- The sweep's retry selection still lists the delivery while it is held: D is the latest delivered release.
select is((select array_agg(r.site_id) from api.worker_deliveries_to_retry(now() + interval '2 minutes') as r
           where r.release_id = tests.k('a102')), array[tests.k('b102')],
  'the held release''s missed site is retried when its attempt is due');

-- A newly committed request still builds at once, hold or not; the row names nothing to alert.
select tests.act_as_owner();
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status) values
  (tests.k('e102'), tests.tenant('labak'), tests.entry('c101'), 'publish', 1, tests.persona('editor_labak'), 'committed');
select tests.act_as_service();
select is(tests.labak_listed(2), true, 'a committed request lists the tenant during the hold');
select is((select r.unconfirmed_release_id from tests.labak_row(2) as r), null, 'with no unconfirmed release named');
select tests.act_as_owner();
delete from cms.publish_requests where id = tests.k('e102');
select tests.act_as_service();

-- The hour runs out with the site still unconfirmed: the housekeeping release is built, and the row
-- names the release and the site for the alert.
select is(tests.labak_listed(60), true, 'an hour after the delivery the hold ends, retry or not');
select results_eq($$ select r.unconfirmed_release_id, r.unconfirmed_release_number, r.unconfirmed_site_ids from tests.labak_row(60) as r $$,
  $$ values (tests.k('a102'), 2, array[tests.k('b102')]) $$,
  'the row names the withdrawing release and the site left unconfirmed (not the confirmed one, not the inactive one)');
select is(tests.labak_listed(30 * 24 * 60), true, 'the hold cannot block the build however late the clock');

-- The retry passes: settled, so the housekeeping release is built at once, with nothing to alert.
select tests.record('b102', 'ok', null, 2);
select is(tests.labak_listed(3), false, 'the retry''s notification succeeded, its live check is running: it waits');
select tests.record('b102', null, 'ok', 3);
select is(tests.labak_listed(3), true, 'every active site confirmed: the housekeeping release is built at once');
select is((select r.unconfirmed_site_ids from tests.labak_row(3) as r), null, 'with nothing to alert');
select is((select r.unconfirmed_site_ids from tests.labak_row(90) as r), null, 'nor after the hour, once confirmed');

-- Retries that ran out are settled too (M3-02 and M3-03 alerted for them).
select tests.act_as_owner();
update cms.site_deliveries set live_status = 'not_confirmed', first_failed_at = now(), next_attempt_at = null
where release_id = tests.k('a102') and site_id = tests.k('b102');
select tests.act_as_service();
select is(tests.labak_listed(5), true, 'a not_confirmed delivery whose retries are exhausted does not hold');

-- A failed notification with a retry scheduled holds; with none left it does not.
select tests.act_as_owner();
update cms.site_deliveries set notify_status = 'failed', live_status = 'pending', next_attempt_at = now() + interval '4 minutes'
where release_id = tests.k('a102') and site_id = tests.k('b102');
select tests.act_as_service();
select is(tests.labak_listed(5), false, 'a failed notification with a retry scheduled holds');
select results_eq($$ select r.unconfirmed_site_ids from tests.labak_row(61) as r $$, $$ values (array[tests.k('b102')]) $$,
  'and is named when the hour runs out');
select tests.act_as_owner();
update cms.site_deliveries set next_attempt_at = null where release_id = tests.k('a102') and site_id = tests.k('b102');
select tests.act_as_service();
select is(tests.labak_listed(5), true, 'a failed notification with its retries exhausted does not hold');

-- An image-replacing publish (media withdrawn, no unpublish) is held the same way.
select tests.act_as_owner();
delete from cms.publish_requests where id = tests.k('e101');
update cms.releases set public_assets = array[tests.k('f102')] where id = tests.k('a102');
update cms.site_deliveries set notify_status = 'ok', live_status = 'not_confirmed', next_attempt_at = now() + interval '1 minute'
where release_id = tests.k('a102') and site_id = tests.k('b102');
select tests.act_as_service();
select is(tests.labak_listed(2), false, 'a release that replaced an image holds while its missed check is retried');
select results_eq($$ select r.unconfirmed_release_id, r.unconfirmed_site_ids from tests.labak_row(60) as r $$,
  $$ values (tests.k('a102'), array[tests.k('b102')]) $$, 'and builds and names the site after the hour');

-- A release that withdrew nothing is never listed, sites unsettled or not (no hold applies).
select tests.act_as_owner();
update cms.releases set public_assets = array[tests.k('f101')] where id = tests.k('a102');
select tests.act_as_service();
select is(tests.labak_listed(120), false, 'a release that withdrew nothing needs no housekeeping release');

-- A housekeeping release that failed waits for its next build attempt, after the hold as before.
select tests.act_as_owner();
update cms.releases set public_assets = array[tests.k('f102')] where id = tests.k('a102');
insert into cms.releases (id, tenant_id, number, status, created_at, next_attempt_at) values
  (tests.k('a103'), tests.tenant('labak'), 3, 'failed', now() + interval '60 minutes', now() + interval '62 minutes');
select tests.act_as_service();
select is(tests.labak_listed(61), false, 'a failed housekeeping build waits for its next attempt');
select is(tests.labak_listed(62), true, 'and is built again when it is due');

-- A suspended tenant is not built (§8.4).
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as_service();
select is(tests.labak_listed(120), false, 'a suspended tenant gets no housekeeping release');

select * from finish();
rollback;
