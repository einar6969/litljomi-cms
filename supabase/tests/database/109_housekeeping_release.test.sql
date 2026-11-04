-- supabase/tests/database/109_housekeeping_release.test.sql
-- The housekeeping release (spec §5.6 "Withdrawal", §7.2 "Retention"; migration
-- 20261104153000_housekeeping_release): api.worker_tenants_to_release(p_now) also lists an active
-- tenant whose latest delivered release withdrew something from the delivered release before it
-- (an unpublish linked to it, or media the earlier release referenced and it does not), so the
-- sweep builds the next release at once and the release before the withdrawal expires an hour
-- later. The release-building selection without withdrawals is in 097_worker_sweep and
-- 102_retry_backoff; the end-to-end run on the local stack is housekeeping.integration.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): labak entry
-- c091; labak releases #1 and #2 delivered with the same media (f091, f092); demo has no release.
begin;
\ir _helpers.sql
select plan(17);

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

-- Whether labak is listed at p_now, as the sweep calls it.
create function tests.labak_listed(p_now timestamptz default now()) returns boolean
language sql
set search_path = ''
as $$
  select exists (select 1 from api.worker_tenants_to_release(p_now) as t where t.tenant_id = tests.tenant('labak'));
$$;
grant execute on function tests.labak_listed(timestamptz) to service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c091'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, public_assets) values
  (tests.k('a091'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now() - interval '2 hours', now() - interval '2 hours',
   array[tests.k('f091'), tests.k('f092')]),
  (tests.k('a092'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now() - interval '1 hour', now() - interval '1 hour',
   array[tests.k('f091'), tests.k('f092')]);

-- ---------------------------------------------------------------------------
-- The definition is replaced in place: same signature, invoker, search_path '', service_role only.
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'worker_tenants_to_release'), 1,
  'worker_tenants_to_release has one definition');
select is((select count(*)::int from pg_proc p
           where p.oid = 'api.worker_tenants_to_release(timestamptz)'::regprocedure
             and not p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']), 1,
  'it is still SECURITY INVOKER, stable, with search_path = ''''');
select is_empty($$ select 1 from pg_proc p
  where p.oid = 'api.worker_tenants_to_release(timestamptz)'::regprocedure
    and (not has_function_privilege('service_role', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute')
         or has_function_privilege('anon', p.oid, 'execute')
         or exists (select 1 from aclexplode(p.proacl) a
                    where a.grantee = 0 or a.grantee::regrole::text not in ('postgres', 'service_role'))) $$,
  'it is still executable by service_role only (and the owner)');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_tenants_to_release(now()) $$, '42501', null, 'an editor cannot list tenants to release');
select tests.act_as_owner();

-- ---------------------------------------------------------------------------
-- Nothing withdrawn: no build.
select tests.act_as_service();
select is(tests.labak_listed(), false, 'a delivered release that withdrew nothing needs no housekeeping release');
select tests.act_as_owner();
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e090'), tests.tenant('labak'), tests.entry('c091'), 'publish', 1, tests.persona('editor_labak'), 'committed', tests.k('a092'));
select tests.act_as_service();
select is(tests.labak_listed(), false, 'a linked publish that kept every image withdraws nothing');

-- An unpublish in the latest delivered release: the next release is built at once.
select tests.act_as_owner();
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e091'), tests.tenant('labak'), tests.entry('c091'), 'unpublish', null, tests.persona('editor_labak'), 'committed', tests.k('a092'));
select tests.act_as_service();
select is(tests.labak_listed(), true, 'a delivered release with an unpublish lists its tenant at once');
select is(tests.labak_listed(now() + interval '30 days'), true, 'and keeps listing it until the next release is delivered');

-- While the housekeeping release builds, the tenant is listed (the build is busy, as for requests);
-- once it is delivered, the selection stops.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, created_at) values
  (tests.k('a093'), tests.tenant('labak'), 3, 'building', now());
select tests.act_as_service();
select is(tests.labak_listed(), true, 'a building release does not end the withdrawal (it may fail)');
select tests.act_as_owner();
update cms.releases set status = 'delivered', bundle_path = 'labak/releases/3.json', delivered_at = now(),
                        public_assets = array[tests.k('f091'), tests.k('f092')]
where id = tests.k('a093');
select tests.act_as_service();
select is(tests.labak_listed(now() + interval '1 day'), false, 'the housekeeping release withdraws nothing, so there is exactly one');

-- Media that left the site (an image removed or replaced): also a withdrawal.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, public_assets) values
  (tests.k('a094'), tests.tenant('labak'), 4, 'delivered', 'labak/releases/4.json', now(), now(), array[tests.k('f091'), tests.k('f093')]);
select tests.act_as_service();
select is(tests.labak_listed(), true, 'a delivered release without an image its predecessor referenced lists its tenant');

-- A failed housekeeping build waits for its next attempt, then is built again.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, created_at, next_attempt_at) values
  (tests.k('a095'), tests.tenant('labak'), 5, 'failed', now(), now() + interval '1 minute');
select tests.act_as_service();
select is(tests.labak_listed(), false, 'after a failed build, not before its next attempt is due');
select is(tests.labak_listed(now() + interval '1 minute'), true, 'built again when the next attempt is due');

-- A suspended tenant is not built (§8.4).
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as_service();
select is(tests.labak_listed(now() + interval '1 minute'), false, 'a suspended tenant gets no housekeeping release');
select tests.act_as_owner();
update cms.tenants set status = 'active' where id = tests.tenant('labak');

-- Nothing public to withdraw from: the first delivered release, or an earlier one whose media was
-- never recorded (null public_assets, before M3-06) next to a release without media.
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c092'), tests.tenant('demo'), 'event', 'b', tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, public_assets) values
  (tests.k('a096'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now(), now(), '{}');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, release_id) values
  (tests.k('e092'), tests.tenant('demo'), tests.entry('c092'), 'unpublish', null, tests.persona('editor_demo'), 'committed', tests.k('a096'));
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now()) where tenant_id = tests.tenant('demo') $$,
  'the first delivered release has nothing earlier to withdraw from');
select tests.act_as_owner();
delete from cms.publish_requests where id = tests.k('e092');
update cms.releases set number = 2 where id = tests.k('a096');
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at, public_assets) values
  (tests.k('a097'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now() - interval '1 hour', now() - interval '1 hour', null);
select tests.act_as_service();
select is_empty($$ select * from api.worker_tenants_to_release(now()) where tenant_id = tests.tenant('demo') $$,
  'unrecorded media on the earlier release is not a withdrawal');
select tests.act_as_owner();
update cms.releases set public_assets = array[tests.k('f099')] where id = tests.k('a097');
select tests.act_as_service();
select is((select count(*)::int from api.worker_tenants_to_release(now()) where tenant_id = tests.tenant('demo')), 1,
  'recorded media the later release dropped is');

select * from finish();
rollback;
