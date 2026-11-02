-- supabase/tests/database/095_worker_phase3.test.sql
-- Task 19's database changes (spec §4.5, §4.7, §6.1–6.3; plan Task 19,
-- decisions 10, 12, 33 and 34): the service_role statement timeout,
-- api.worker_claim_request, api.worker_record_alert, and the tenant row lock
-- in both commit functions. worker_read_request's extended shape is pinned in
-- 090_api_worker; grants on every worker_* function in 010_catalog and
-- 100_escalation; decision 33's column grant in 020_tenancy. The timeout as
-- PostgREST applies it is proven over HTTP in
-- tests/integration/src/service-role-timeout.test.ts.
--
-- Fixtures (owner context): entries c951 (labak, draft v1), c952 (labak,
-- published, draft v1) and c953 (demo, draft v1); requests:
--   e951 pending      c951 publish v1
--   e952 validating   c951 publish v1, claimed 1 minute ago
--   e953 validating   c951 publish v1, claimed 10 minutes ago (stale), 3 attempts
--   e954 committed    c951 publish v1
--   e955 validating   c952 publish v1 (for the tenant lock of the publish commit)
--   e956 validating   c953 unpublish (demo; for the tenant lock of the unpublish commit)
begin;
\ir _helpers.sql
select plan(35);

create function tests.pub(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^e[0-9a-f]{3}$' then
    raise exception 'unknown publishing key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
grant execute on function tests.pub(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Decision 34.1: the role setting PostgREST applies to every secret-key request.
select is((select s.setconfig from pg_catalog.pg_db_role_setting s
           where s.setrole = 'service_role'::regrole and s.setdatabase = 0),
  array['statement_timeout=10s'], 'service_role has statement_timeout = 10s as a role setting, in every database');

-- ---------------------------------------------------------------------------
-- The new functions: invoker, search_path pinned, service_role only.
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
  where p.oid in ('api.worker_claim_request(uuid)'::regprocedure, 'api.worker_record_alert(uuid,text,jsonb)'::regprocedure)
    and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'worker_claim_request and worker_record_alert are SECURITY INVOKER with search_path pinned');
select set_eq($$ select p.oid::regprocedure::text, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in ('api.worker_claim_request(uuid)'::regprocedure,
                     'api.worker_record_alert(uuid,text,jsonb)'::regprocedure) $$,
  $$ values ('api.worker_claim_request(uuid)', 'postgres'), ('api.worker_claim_request(uuid)', 'service_role'),
            ('api.worker_record_alert(uuid,text,jsonb)', 'postgres'),
            ('api.worker_record_alert(uuid,text,jsonb)', 'service_role') $$,
  'their grantees are exactly postgres (owner) and service_role');

-- ---------------------------------------------------------------------------
-- Fixtures (owner context).
create extension pgrowlocks with schema extensions;
select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c951'), tests.tenant('labak'), 'news', null, tests.persona('editor_labak')),
  (tests.entry('c952'), tests.tenant('labak'), 'news', 'birt', tests.persona('editor_labak')),
  (tests.entry('c953'), tests.tenant('demo'), 'news', null, tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, updated_by) values
  (tests.entry('c951'), tests.tenant('labak'), 1, tests.persona('editor_labak')),
  (tests.entry('c952'), tests.tenant('labak'), 1, tests.persona('editor_labak')),
  (tests.entry('c953'), tests.tenant('demo'), 1, tests.persona('editor_demo'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts)
select tests.pub(r), tests.tenant(t), tests.entry(e), a, v, tests.persona(p), s, c, n
from (values
  ('e951', 'labak', 'c951', 'publish', 1, 'editor_labak', 'pending', null::timestamptz, 0),
  ('e952', 'labak', 'c951', 'publish', 1, 'editor_labak', 'validating', now() - interval '1 minute', 1),
  ('e953', 'labak', 'c951', 'publish', 1, 'editor_labak', 'validating', now() - interval '10 minutes', 3),
  ('e954', 'labak', 'c951', 'publish', 1, 'editor_labak', 'committed', now() - interval '20 minutes', 1),
  ('e955', 'labak', 'c952', 'publish', 1, 'editor_labak', 'validating', now(), 1),
  ('e956', 'demo', 'c953', 'unpublish', null, 'editor_demo', 'validating', now(), 1)) as x(r, t, e, a, v, p, s, c, n);

-- ---------------------------------------------------------------------------
-- worker_claim_request (decision 34.2): worker_claim_requests' rule for one request.
select tests.act_as_service();
select is((select row(r.id, r.status, r.attempts, r.claimed_at)::text from api.worker_claim_request(tests.pub('e951')) as r),
  row(tests.pub('e951'), 'validating', 1, now())::text,
  'a pending request is claimed: validating, claimed now, one attempt; the row is returned');
select is((select row(status, attempts, claimed_at)::text from cms.publish_requests where id = tests.pub('e951')),
  row('validating', 1, now())::text, 'the claim is stored');
select is((select r.id from api.worker_claim_request(tests.pub('e951')) as r), null,
  'a request just claimed is not claimed again (a row of nulls)');
select is((select row(r.id, r.status, r.attempts)::text from api.worker_claim_request(tests.pub('e952')) as r),
  row(null::uuid, null::text, null::int)::text, 'a claim under 5 minutes old is left alone: every column null');
select is((select row(status, attempts, claimed_at)::text from cms.publish_requests where id = tests.pub('e952')),
  row('validating', 1, now() - interval '1 minute')::text, 'and the request is unchanged');
select is((select row(r.id, r.status, r.attempts, r.claimed_at)::text from api.worker_claim_request(tests.pub('e953')) as r),
  row(tests.pub('e953'), 'validating', 4, now())::text,
  'a stale claim (over 5 minutes) is renewed: claimed now, one more attempt');
select is((select r.id from api.worker_claim_request(tests.pub('e954')) as r), null, 'a committed request is never claimed');
select is((select status from cms.publish_requests where id = tests.pub('e954')), 'committed', 'it stays committed');
select is((select r.id from api.worker_claim_request(gen_random_uuid()) as r), null, 'an unknown request gives a row of nulls');
select is((select r.id from api.worker_claim_request(null) as r), null, 'a null id gives a row of nulls');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where target_id = tests.pub('e951')
           and action = 'publish_request.validating' and actor_id = tests.persona('editor_labak')), 1,
  'a claim by id is audited with the requester as actor');

-- ---------------------------------------------------------------------------
-- worker_record_alert (decisions 10 and 12).
select tests.act_as_service();
select lives_ok($$ select api.worker_record_alert(tests.tenant('labak'), 'publish_request.failed',
                    jsonb_build_object('requestId', tests.pub('e951'), 'message', 'boom')) $$,
  'an alert about a tenant is recorded');
select tests.act_as_owner();
select is((select row(tenant_id, actor_id, target_type, target_id, details, at)::text from cms.audit_log
           where action = 'system.alert.publish_request.failed'),
  row(tests.tenant('labak'), null::uuid, 'alert', null::uuid,
      jsonb_build_object('requestId', tests.pub('e951'), 'message', 'boom'), now())::text,
  'it is the system event system.alert.<event>: the tenant, a null actor, the details, the database clock');
select tests.act_as_service();
select lives_ok($$ select api.worker_record_alert(null, 'sweep.failed', null) $$, 'a platform alert has no tenant and may have no details');
select tests.act_as_owner();
select is((select row(tenant_id, actor_id, details)::text from cms.audit_log where action = 'system.alert.sweep.failed'),
  row(null::uuid, null::uuid, null::jsonb)::text, 'the platform alert is recorded with a null tenant');
select tests.act_as_service();
select throws_ok($$ select api.worker_record_alert(null, 'Bad Event', null) $$, '22023',
  'p_event must be a dotted lowercase name of at most 100 characters', 'an event that is not a dotted lowercase name: 22023');
select throws_ok($$ select api.worker_record_alert(null, 'release..failed', null) $$, '22023', null, 'an empty segment: 22023');
select throws_ok($$ select api.worker_record_alert(null, null, null) $$, '22023', null, 'a null event: 22023');
select throws_ok($$ select api.worker_record_alert(null, 'a' || repeat('b', 100), null) $$, '22023', null,
  'an event over 100 characters: 22023');
select throws_ok($$ select api.worker_record_alert(null, 'x', '[1]') $$, '22023',
  'p_details must be a JSON object of at most 64 KB', 'details that are not an object: 22023');
select throws_ok($$ select api.worker_record_alert(null, 'x', jsonb_build_object('m', repeat('a', 65536))) $$, '22023',
  'p_details must be a JSON object of at most 64 KB', 'details over 64 KB: 22023');
select throws_ok($$ select api.worker_record_alert(gen_random_uuid(), 'x', null) $$, 'P0001', 'not_found',
  'an unknown tenant: not_found');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where action like 'system.alert.%'), 2, 'the refused calls recorded nothing');

-- ---------------------------------------------------------------------------
-- Decision 33: both commit functions lock the tenant row FOR SHARE before the
-- status re-check; the membership row is not locked (the accepted race).
-- Read with pgrowlocks as in 090. The fixture inserts above (entries and
-- memberships reference tenants) already hold FOR KEY SHARE on both tenant
-- rows in this transaction; the commit's FOR SHARE outranks it, so 'For Share'
-- appears only if the commit took it. Each commit is on a different tenant, so
-- each lock is told apart.
select is((select array_agg(row(t.slug, l.modes)::text order by t.slug) from cms.tenants t
           join extensions.pgrowlocks('cms.tenants') l on l.locked_row = t.ctid),
  array[row('demo', array['For Key Share'])::text, row('labak', array['For Key Share'])::text],
  'before the commits, both tenant rows hold only the fixtures'' foreign-key FOR KEY SHARE');
select tests.act_as_service();
select is(api.worker_commit_publish(tests.pub('e955'), 1, 1, 'T', null), 'committed', 'the labak publish commits');
select tests.act_as_owner();
select is((select l.modes from cms.tenants t join extensions.pgrowlocks('cms.tenants') l on l.locked_row = t.ctid
           where t.id = tests.tenant('labak')),
  array['For Share'], 'worker_commit_publish locked its tenant row FOR SHARE');
select is((select l.modes from cms.tenants t join extensions.pgrowlocks('cms.tenants') l on l.locked_row = t.ctid
           where t.id = tests.tenant('demo')),
  array['For Key Share'], 'another tenant''s row is not share-locked by it');
select is_empty($$ select 1 from cms.memberships m join extensions.pgrowlocks('cms.memberships') l on l.locked_row = m.ctid
                   where m.user_id = tests.persona('editor_labak') $$,
  'the requester''s membership row is not locked (accepted race, decision 33)');
select tests.act_as_service();
select is(api.worker_commit_unpublish(tests.pub('e956')), 'committed', 'the demo unpublish commits');
select tests.act_as_owner();
select is((select l.modes from cms.tenants t join extensions.pgrowlocks('cms.tenants') l on l.locked_row = t.ctid
           where t.id = tests.tenant('demo')),
  array['For Share'], 'worker_commit_unpublish locked its tenant row FOR SHARE');
select is_empty($$ select 1 from cms.memberships m join extensions.pgrowlocks('cms.memberships') l on l.locked_row = m.ctid
                   where m.user_id = tests.persona('editor_demo') $$,
  'nor is the unpublish requester''s membership row');
-- service_role still has no UPDATE on memberships (decision 33: no grant added).
select ok(not has_any_column_privilege('service_role', 'cms.memberships', 'UPDATE'),
  'service_role has no update privilege on any memberships column');

select * from finish();
rollback;
