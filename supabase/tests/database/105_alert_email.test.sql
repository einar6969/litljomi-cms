-- supabase/tests/database/105_alert_email.test.sql
-- M3-04: one alert email per incident (spec §8.4; 20261103200000_alert_email.sql).
-- api.worker_claim_alert_email returns true for the first claim of an incident key, records the
-- system event system.alert_email, and returns false (recording nothing) for every later claim of
-- the same key. Executable by service_role only; the grant counts are also in 010_catalog and
-- 100_escalation.
begin;
\ir _helpers.sql
select plan(23);

select tests.seed();

-- ---------------------------------------------------------------------------
-- Catalog.
select isnt(to_regprocedure('api.worker_claim_alert_email(uuid,text,text)'), null,
  'api.worker_claim_alert_email(uuid, text, text) exists');
select is((select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'api.worker_claim_alert_email(uuid,text,text)'::regprocedure),
  false, 'it is SECURITY INVOKER');
select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
           where p.oid = 'api.worker_claim_alert_email(uuid,text,text)'::regprocedure),
  'it pins search_path to the empty string');
select results_eq($$ select a.grantee::regrole::text from pg_catalog.pg_proc p, aclexplode(p.proacl) a
                     where p.oid = 'api.worker_claim_alert_email(uuid,text,text)'::regprocedure order by 1 $$,
  $$ values ('postgres'), ('service_role') $$, 'EXECUTE is held by the owner and service_role only');
select ok(exists (select 1 from pg_catalog.pg_indexes where schemaname = 'cms' and tablename = 'audit_log'
                  and indexname = 'audit_log_alert_email_incident' and indexdef like 'CREATE UNIQUE INDEX%'),
  'the incident index on cms.audit_log is unique');
select is_empty($$ select privilege_type from information_schema.role_table_grants
                   where table_schema = 'cms' and table_name = 'audit_log' and grantee = 'service_role'
                     and privilege_type <> 'INSERT' $$,
  'service_role still holds no privilege on cms.audit_log but INSERT (no SELECT, UPDATE or DELETE)');

-- ---------------------------------------------------------------------------
-- One claim per incident.
select tests.act_as_service();
select is(api.worker_claim_alert_email(tests.tenant('labak'), 'release.failed', 'release.failed:r1'), true,
  'the first claim of an incident returns true');
select is(api.worker_claim_alert_email(tests.tenant('labak'), 'release.failed', 'release.failed:r1'), false,
  'a second claim of the same incident returns false');
select is(api.worker_claim_alert_email(tests.tenant('labak'), 'release.stale_failed', 'release.failed:r1'), false,
  'the incident key alone decides: another event under the same key returns false');
select is(api.worker_claim_alert_email(tests.tenant('labak'), 'release.failed', 'release.failed:r2'), true,
  'another incident is claimed on its own');
select is(api.worker_claim_alert_email(null, 'sweep.failed', 'sweep.failed'), true,
  'a platform incident (no tenant) is claimed');
select is(api.worker_claim_alert_email(tests.tenant('demo'), 'sweep.failed', 'sweep.failed'), false,
  'and the same key under another tenant is the same incident');

select tests.act_as_owner();
select results_eq($$ select tenant_id, actor_id, target_type, target_id, details, at from cms.audit_log
                     where action = 'system.alert_email' order by id $$,
  $$ values (tests.tenant('labak'), null::uuid, 'alert', null::uuid,
             jsonb_build_object('event', 'release.failed', 'incident', 'release.failed:r1'), now()),
            (tests.tenant('labak'), null::uuid, 'alert', null::uuid,
             jsonb_build_object('event', 'release.failed', 'incident', 'release.failed:r2'), now()),
            (null::uuid, null::uuid, 'alert', null::uuid,
             jsonb_build_object('event', 'sweep.failed', 'incident', 'sweep.failed'), now()) $$,
  'each first claim is one system.alert_email row: tenant, null actor, event and incident, the database clock');
select throws_ok($$ insert into cms.audit_log (action, target_type, details)
                    values ('system.alert_email', 'alert', jsonb_build_object('incident', 'release.failed:r1')) $$,
  '23505', null, 'the unique index refuses a second row for an incident, whoever writes it');
select lives_ok($$ insert into cms.audit_log (action, target_type, details)
                   values ('system.alert.release.failed', 'alert', jsonb_build_object('incident', 'release.failed:r1')) $$,
  'the index covers system.alert_email rows only: other audit rows may repeat an incident key');

-- ---------------------------------------------------------------------------
-- Refused arguments (service_role).
select tests.act_as_service();
select throws_ok($$ select api.worker_claim_alert_email(null, 'Bad Event', 'x') $$, '22023',
  'p_event must be a dotted lowercase name of at most 100 characters', 'an event that is not a dotted lowercase name: 22023');
select throws_ok($$ select api.worker_claim_alert_email(null, null, 'x') $$, '22023', null, 'a null event: 22023');
select throws_ok($$ select api.worker_claim_alert_email(null, 'x', null) $$, '22023',
  'p_incident must be 1-200 characters of a-z, 0-9, _ . : -', 'a null incident: 22023');
select throws_ok($$ select api.worker_claim_alert_email(null, 'x', '') $$, '22023', null, 'an empty incident: 22023');
select throws_ok($$ select api.worker_claim_alert_email(null, 'x', 'a' || repeat('b', 200)) $$, '22023', null,
  'an incident over 200 characters: 22023');
select throws_ok($$ select api.worker_claim_alert_email(null, 'x', 'Release:R1 <b>') $$, '22023', null,
  'an incident outside [a-z0-9_.:-] (upper case, spaces, markup): 22023');
select throws_ok($$ select api.worker_claim_alert_email(gen_random_uuid(), 'x', 'x') $$, 'P0001', 'not_found',
  'an unknown tenant: not_found');

-- ---------------------------------------------------------------------------
-- Personas other than service_role cannot call it.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.worker_claim_alert_email(tests.tenant('labak'), 'x', 'x') $$, '42501', null,
  'an editor cannot claim an alert email');

select * from finish();
rollback;
