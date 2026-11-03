-- supabase/tests/database/105_retention.test.sql
-- M3-06 (20261103200000_retention.sql; spec §5.6 "Withdrawal", §7.2 "Retention"):
--   api.worker_record_release_media   records a building release's media before the worker copies
--   api.worker_claim_release_cleanup  claims expired releases: their bundle, and the media no
--                                     unexpired release references (public_path cleared)
--   api.worker_finish_release_cleanup marks claimed releases cleaned, or releases the claim
-- service_role only. The Storage side (objects really gone, 404) runs in
-- retention.integration.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx); the worker's
-- clock is T = 2026-11-03 12:00 UTC:
--   labak assets 5a01..5a05 (a1.jpg .. a5.jpg); 5a01, 5a02 and 5a04 are public
--   labak releases
--     5b01 #1 delivered T-3h      media 5a01, 5a02
--     5b02 #2 failed              media 5a03 (copied by the failed build; never public_path)
--     5b03 #3 delivered T-2h      media 5a02
--     5b04 #4 delivered T-30min   media 5a02, 5a04
--     5b05 #5 building            no media recorded yet
--   demo asset 5a09; demo releases 5b11 #1, 5b12 #2, 5b13 #3 delivered T-5h, T-4h, T-3h (#1 media 5a09)
-- #1 and #2 of labak expire an hour after #4's delivery (the second delivered release above them):
-- at T+30min. demo's #1 expired at T-2h.
begin;
\ir _helpers.sql
select plan(58);

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
-- The worker's clock, T plus an interval.
create function tests.t(p_offset text) returns timestamptz
language sql
set search_path = ''
as $$ select '2026-11-03 12:00+00'::timestamptz + p_offset::interval $$;
grant execute on function tests.k(text), tests.t(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog.
create temporary table retention_functions (sig text primary key) on commit drop;
insert into retention_functions values
  ('api.worker_record_release_media(uuid,uuid[])'),
  ('api.worker_claim_release_cleanup(timestamp with time zone,integer)'),
  ('api.worker_finish_release_cleanup(uuid[],boolean)');
select is_empty($$ select sig from retention_functions where to_regprocedure(sig) is null $$,
  'the three functions exist with these signatures');
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from retention_functions)
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'all three are security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from retention_functions) $$,
  $$ select to_regprocedure(sig)::text, g, 'EXECUTE'
     from retention_functions, (values ('postgres'), ('service_role')) as o(g) $$,
  'EXECUTE: service_role only; postgres owns all three');
select is(pg_catalog.pg_get_function_arguments('api.worker_claim_release_cleanup(timestamp with time zone,integer)'::regprocedure),
  'p_now timestamp with time zone, p_limit integer DEFAULT 20', 'worker_claim_release_cleanup: p_limit defaults to 20');

-- ---------------------------------------------------------------------------
-- Fixtures.
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, public_path)
select tests.k('5a0' || n), tests.tenant('labak'),
       tests.tenant('labak')::text || '/' || tests.k('5a0' || n)::text || '/a' || n || '.jpg', 'a' || n || '.jpg',
       'image/jpeg', 1000, 8, 6, repeat('a', 64),
       case when n in (1, 2, 4) then 'labak/' || tests.k('5a0' || n)::text || '/a' || n || '.jpg' end
from generate_series(1, 5) as n;
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, public_path) values
  (tests.k('5a09'), tests.tenant('demo'), tests.tenant('demo')::text || '/' || tests.k('5a09')::text || '/d.png', 'd.png',
   'image/png', 1000, 8, 6, repeat('d', 64), 'demo/' || tests.k('5a09')::text || '/d.png');
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at, public_assets) values
  (tests.k('5b01'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', tests.t('-3 hours'), array[tests.k('5a01'), tests.k('5a02')]),
  (tests.k('5b02'), tests.tenant('labak'), 2, 'failed', null, null, array[tests.k('5a03')]),
  (tests.k('5b03'), tests.tenant('labak'), 3, 'delivered', 'labak/releases/3.json', tests.t('-2 hours'), array[tests.k('5a02')]),
  (tests.k('5b04'), tests.tenant('labak'), 4, 'delivered', 'labak/releases/4.json', tests.t('-30 minutes'), array[tests.k('5a02'), tests.k('5a04')]),
  (tests.k('5b05'), tests.tenant('labak'), 5, 'building', null, null, null),
  (tests.k('5b11'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', tests.t('-5 hours'), array[tests.k('5a09')]),
  (tests.k('5b12'), tests.tenant('demo'), 2, 'delivered', 'demo/releases/2.json', tests.t('-4 hours'), '{}'),
  (tests.k('5b13'), tests.tenant('demo'), 3, 'delivered', 'demo/releases/3.json', tests.t('-3 hours'), '{}');

-- ---------------------------------------------------------------------------
-- Personas: nobody but service_role may call them.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01')]) $$, '42501', null,
  'an editor cannot record media');
select throws_ok($$ select * from api.worker_claim_release_cleanup(tests.t('1 day')) $$, '42501', null,
  'an editor cannot claim a cleanup');
select throws_ok($$ select api.worker_finish_release_cleanup(array[tests.k('5b01')], true) $$, '42501', null,
  'an editor cannot finish a cleanup');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select * from api.worker_claim_release_cleanup(tests.t('1 day')) $$, '42501', null,
  'a platform admin at aal2 cannot claim a cleanup');
select tests.act_as_anon();
select throws_ok($$ select * from api.worker_claim_release_cleanup(tests.t('1 day')) $$, '42501', null,
  'anon cannot claim a cleanup');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01')]) $$, '42501', null,
  'anon cannot record media');

-- ---------------------------------------------------------------------------
-- Parameters (service_role).
select tests.act_as_service();
select throws_ok($$ select * from api.worker_record_release_media(null, '{}') $$, '22023', null, 'record: a null release is refused');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), null) $$, '22023', null, 'record: null ids are refused');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), array[null]::uuid[]) $$, '22023', null,
  'record: a null id is refused');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'),
                     array(select gen_random_uuid() from generate_series(1, 10001))) $$, '22023', null,
  'record: more than 10,000 ids are refused');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5bff'), '{}') $$, 'P0001', 'not_found',
  'record: an unknown release is not_found');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b04'), array[tests.k('5a01')]) $$, 'P0001', 'forbidden',
  'record: a delivered release cannot record media');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b02'), array[tests.k('5a01')]) $$, 'P0001', 'forbidden',
  'record: a failed release cannot record media');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01'), tests.k('5a09')]) $$,
  'P0001', 'forbidden', 'record: another tenant''s asset is refused');
select throws_ok($$ select * from api.worker_record_release_media(tests.k('5b05'), array[gen_random_uuid()]) $$,
  'P0001', 'forbidden', 'record: an unknown asset is refused');
select throws_ok($$ select * from api.worker_claim_release_cleanup(null) $$, '22023', null, 'claim: a null clock is refused');
select throws_ok($$ select * from api.worker_claim_release_cleanup(tests.t('0'), 0) $$, '22023', null, 'claim: p_limit 0 is refused');
select throws_ok($$ select * from api.worker_claim_release_cleanup(tests.t('0'), 101) $$, '22023', null, 'claim: p_limit 101 is refused');
select throws_ok($$ select api.worker_finish_release_cleanup(null, true) $$, '22023', null, 'finish: null ids are refused');
select throws_ok($$ select api.worker_finish_release_cleanup(array[tests.k('5b01')], null) $$, '22023', null,
  'finish: a null p_deleted is refused');
select throws_ok($$ select api.worker_finish_release_cleanup(array[null]::uuid[], true) $$, '22023', null,
  'finish: a null id is refused');
select throws_ok($$ select api.worker_finish_release_cleanup(array(select gen_random_uuid() from generate_series(1, 101)), true) $$,
  '22023', null, 'finish: more than 100 ids are refused');
select tests.act_as_owner();
select is((select public_assets from cms.releases where id = tests.k('5b05')), null::uuid[],
  'a refused record changes nothing');

-- ---------------------------------------------------------------------------
-- The record.
select tests.act_as_service();
select results_eq($$ select asset_id, copy, deleting
                     from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a05'), tests.k('5a02'), tests.k('5a05')]) $$,
  $$ values (tests.k('5a02'), false, false), (tests.k('5a05'), true, false) $$,
  'record: one row per asset in id order; copy when there is no public path; nothing is being deleted');
select tests.act_as_owner();
select is((select public_assets from cms.releases where id = tests.k('5b05')), array[tests.k('5a02'), tests.k('5a05')],
  'record: public_assets holds the distinct ids, sorted');
select tests.act_as_service();
select results_eq($$ select asset_id from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a05')]) $$,
  $$ values (tests.k('5a05')) $$, 'record: a later call for the same release ...');
select tests.act_as_owner();
select is((select public_assets from cms.releases where id = tests.k('5b05')), array[tests.k('5a05')],
  '... replaces what it recorded');

-- ---------------------------------------------------------------------------
-- What has expired (§7.2): the release before the previous one, an hour after the newer delivery.
create temporary table audit_before on commit drop as select count(*) as n from cms.audit_log;
grant select on audit_before to service_role;
select tests.act_as_service();
select is_empty($$ select * from api.worker_claim_release_cleanup(tests.t('0')) where tenant_id = tests.tenant('labak') $$,
  'at T nothing of labak has expired: #4, which makes #1 and #2 older than the previous, is not an hour old');
select is_empty($$ select * from api.worker_claim_release_cleanup(tests.t('29 minutes 59 seconds')) where tenant_id = tests.tenant('labak') $$,
  'a second before the hour, still nothing of labak');
-- demo's #1 expired at T-2h; it was claimed by the first call above (p_limit 20).
select tests.act_as_owner();
select ok((select cleanup_claimed_at is not null and cleanup_assets = array[tests.k('5a09')]
           from cms.releases where id = tests.k('5b11')),
  'demo #1 (expired at T-2h) was claimed by the first call, with its media, which no newer demo release references');
select tests.act_as_service();
select results_eq($$ select release_id, tenant_slug, release_number, asset_id, filename
                     from api.worker_claim_release_cleanup(tests.t('30 minutes')) $$,
  $$ values (tests.k('5b01'), 'labak', 1, null::uuid, null::text),
            (tests.k('5b01'), 'labak', 1, tests.k('5a01'), 'a1.jpg'),
            (tests.k('5b02'), 'labak', 2, null::uuid, null::text),
            (tests.k('5b02'), 'labak', 2, tests.k('5a03'), 'a3.jpg') $$,
  'at T+30min: labak #1 (bundle and 5a01) and the failed #2 (bundle and 5a03); 5a02 is kept for #3 and #4');
select tests.act_as_owner();
select set_eq($$ select id, cleanup_assets from cms.releases
                 where cleanup_claimed_at is not null and tenant_id = tests.tenant('labak') $$,
  $$ values (tests.k('5b01'), array[tests.k('5a01')]), (tests.k('5b02'), array[tests.k('5a03')]) $$,
  'the claims record the media they delete; no other labak release is claimed');
select set_eq($$ select id from cms.assets where tenant_id = tests.tenant('labak') and public_path is not null $$,
  $$ values (tests.k('5a02')), (tests.k('5a04')) $$,
  'the claimed media''s public_path is cleared; media still referenced keeps it');
select is((select count(*) from cms.audit_log), (select n from audit_before),
  'claims write no audit event (no status changes)');
select results_eq($$ select status from cms.releases where tenant_id = tests.tenant('labak') order by number $$,
  $$ values ('delivered'), ('failed'), ('delivered'), ('delivered'), ('building') $$, 'no status changed');

select tests.act_as_service();
select is_empty($$ select * from api.worker_claim_release_cleanup(tests.t('1 day')) $$,
  'a running sweep''s claims are not claimed again; #3 has only one delivered release above it');

-- ---------------------------------------------------------------------------
-- A build recording media a sweep is deleting is told to wait; the claim never takes what a
-- building release recorded.
select results_eq($$ select asset_id, copy, deleting
                     from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01'), tests.k('5a02'), tests.k('5a03')]) $$,
  $$ values (tests.k('5a01'), true, true), (tests.k('5a02'), false, false), (tests.k('5a03'), true, true) $$,
  'record: media under a running claim is deleting (and to copy, its public_path being cleared)');
select tests.act_as_owner();
update cms.releases set cleanup_claimed_at = now() - interval '421 seconds' where id = tests.k('5b02');
select tests.act_as_service();
select results_eq($$ select asset_id, deleting
                     from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01'), tests.k('5a03')]) $$,
  $$ values (tests.k('5a01'), true), (tests.k('5a03'), false) $$,
  'record: a claim older than 420 s is stale and ignored');

-- ---------------------------------------------------------------------------
-- Finishing.
select is(api.worker_finish_release_cleanup(array[tests.k('5b01'), tests.k('5b03')], true), 1,
  'finish deleted: only the claimed release changes (#3 was never claimed)');
select tests.act_as_owner();
select ok((select cleaned_at is not null from cms.releases where id = tests.k('5b01')), '#1 is cleaned');
select ok((select cleaned_at is null from cms.releases where id = tests.k('5b03')), '#3 is not');
select tests.act_as_service();
select results_eq($$ select asset_id, deleting
                     from api.worker_record_release_media(tests.k('5b05'), array[tests.k('5a01'), tests.k('5a03')]) $$,
  $$ values (tests.k('5a01'), false), (tests.k('5a03'), false) $$, 'record: once the sweep finished, nothing is deleting');
select is(api.worker_finish_release_cleanup(array[tests.k('5b01')], true), 0, 'finish again: a cleaned release does not change');
-- The stale claim on #2 is claimed again, and 5a03 is now recorded by the building #5: kept.
select results_eq($$ select release_id, asset_id from api.worker_claim_release_cleanup(tests.t('30 minutes')) $$,
  $$ values (tests.k('5b02'), null::uuid) $$,
  'a stale claim is claimed again; media a building release recorded meanwhile is not taken');
select is(api.worker_finish_release_cleanup(array[tests.k('5b02')], false), 1, 'finish not deleted: the claim is released');
select tests.act_as_owner();
select ok((select cleanup_claimed_at is null and cleaned_at is null from cms.releases where id = tests.k('5b02')),
  '#2 is unclaimed and not cleaned');
select tests.act_as_service();
select results_eq($$ select release_id from api.worker_claim_release_cleanup(tests.t('30 minutes'), 1) $$,
  $$ values (tests.k('5b02')) $$, 'a released claim is claimed by the next sweep');
select is(api.worker_finish_release_cleanup(array[tests.k('5b02'), tests.k('5b11')], true), 2, 'and finished');
select is_empty($$ select * from api.worker_claim_release_cleanup(tests.t('1 day')) $$, 'nothing is left to claim');

-- ---------------------------------------------------------------------------
-- A newer delivery expires #3 an hour later; media #4 and the building #5 reference is kept.
select tests.act_as_owner();
update cms.releases set status = 'delivered', bundle_path = 'labak/releases/5.json', delivered_at = tests.t('2 hours')
where id = tests.k('5b05');
select tests.act_as_service();
select is_empty($$ select * from api.worker_claim_release_cleanup(tests.t('2 hours 59 minutes')) $$,
  'an hour has not passed since #5 was delivered');
select results_eq($$ select release_id, asset_id from api.worker_claim_release_cleanup(tests.t('3 hours')) $$,
  $$ values (tests.k('5b03'), null::uuid) $$,
  '#3 expires an hour after #5''s delivery; 5a02, which #4 references, is kept');
select tests.act_as_owner();
select is((select public_path from cms.assets where id = tests.k('5a02')), 'labak/' || tests.k('5a02')::text || '/a2.jpg',
  '5a02 keeps its public path');
select tests.act_as_service();
select is(api.worker_finish_release_cleanup(array[tests.k('5b03')], true), 1, '#3 is cleaned');
select tests.act_as_owner();
select results_eq($$ select number from cms.releases where tenant_id = tests.tenant('labak') and cleaned_at is null order by number $$,
  $$ values (4), (5) $$, 'only labak''s current and previous releases remain');

select * from finish();
rollback;
