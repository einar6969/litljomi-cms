-- supabase/tests/database/109_publish_state.test.sql
-- 20261104150000_publish_state.sql (security fixes, Thread A):
--   * worker_commit_publish marks an older publish superseded when a newer request exists for the
--     entry, so it never commits over a newer withdrawal (§7.1, §6.2);
--   * both claims fail, instead of claiming, a request that used its 5 attempts or is past its
--     one-hour deadline (§6.3), and the batch claims at most 3 per tenant.
-- tests/integration/src/concurrency.test.ts runs the commit race with two real sessions.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak c109 published (revision r109), draft v1
--         c110 never published, draft v1
begin;
\ir _helpers.sql
select plan(22);

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
update cms.publish_requests set status = 'failed' where status in ('pending', 'validating');
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c109'), tests.tenant('labak'), 'news', 'birt', tests.persona('editor_labak')),
  (tests.entry('c110'), tests.tenant('labak'), 'news', 'ny', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c109'), tests.tenant('labak'), 1, '{"title": "Birt"}', tests.persona('editor_labak')),
  (tests.entry('c110'), tests.tenant('labak'), 1, '{"title": "Ný"}', tests.persona('editor_labak'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  (tests.k('0109'), tests.tenant('labak'), tests.entry('c109'), 1, 1, '{"title": "Birt"}', 'Birt', tests.persona('editor_labak'));
update cms.entries set published_rev_id = tests.k('0109'), published_draft_version = 1,
  first_published_at = now(), last_published_at = now()
  where id = tests.entry('c109');

-- ---------------------------------------------------------------------------
-- 1. P1 (publish, older) validating; U1 (unpublish, newer) commits first; P1 must not commit.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  claimed_at, attempts) values
  (tests.k('e101'), tests.tenant('labak'), tests.entry('c109'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '2 minutes', 'validating', now() - interval '2 minutes', 1),
  (tests.k('e102'), tests.tenant('labak'), tests.entry('c109'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '1 minute', 'validating', now() - interval '1 minute', 1);

select tests.act_as_service();
select is(api.worker_commit_unpublish(tests.k('e102')), 'committed', 'U1, the newer unpublish, commits');
select is(api.worker_commit_publish(tests.k('e101'), 1, 1, 'Birt', null), 'superseded',
  'P1, the older publish, is superseded: it does not commit over the withdrawal');
select tests.act_as_owner();
select is((select row(status, revision_id, error)::text from cms.publish_requests where id = tests.k('e101')),
  row('superseded', null::uuid, jsonb_build_object('code', 'superseded', 'newer_request_id', tests.k('e102')))::text,
  'P1 records the newer request that superseded it, and no revision');
select is((select published_rev_id from cms.entries where id = tests.entry('c109')), null::uuid,
  'the entry stays withdrawn');
select is((select count(*)::int from cms.revisions where entry_id = tests.entry('c109')), 1, 'no revision was inserted');

-- A newer request in any state supersedes the older publish, even one that did not commit.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  claimed_at, attempts) values
  (tests.k('e103'), tests.tenant('labak'), tests.entry('c110'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '2 minutes', 'validating', now() - interval '2 minutes', 1),
  (tests.k('e104'), tests.tenant('labak'), tests.entry('c110'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 minute', 'pending', null, 0);
select tests.act_as_service();
select is(api.worker_commit_publish(tests.k('e103'), 1, 1, 'Ný', null), 'superseded',
  'a newer pending publish of the same entry supersedes the older one');

-- A request for another entry, or an older one, does not: the newest publish commits.
select tests.act_as_owner();
update cms.publish_requests set status = 'validating', claimed_at = now(), attempts = 1 where id = tests.k('e104');
select tests.act_as_service();
select is(api.worker_commit_publish(tests.k('e104'), 1, 1, 'Ný', null), 'committed',
  'the newest request commits: older requests of the entry and requests of other entries do not supersede it');
select tests.act_as_owner();
select isnt((select published_rev_id from cms.entries where id = tests.entry('c110')), null::uuid, 'c110 is published');

-- ---------------------------------------------------------------------------
-- 2. The claims: attempts and deadline (§6.3).
update cms.publish_requests set status = 'failed' where status in ('pending', 'validating');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  claimed_at, attempts) values
  -- A worker died on the 5th attempt: validating, claim stale.
  (tests.k('e111'), tests.tenant('labak'), tests.entry('c110'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '30 minutes', 'validating', now() - interval '6 minutes', 5),
  -- The 4th attempt died: one more claim is allowed.
  (tests.k('e112'), tests.tenant('labak'), tests.entry('c110'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '29 minutes', 'validating', now() - interval '6 minutes', 4),
  -- Pending past its deadline.
  (tests.k('e113'), tests.tenant('labak'), tests.entry('c110'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '61 minutes', 'pending', null, 0);

select tests.act_as_service();
select is((select row(id, status, attempts, error)::text from api.worker_claim_request(tests.k('e111'))),
  row(tests.k('e111'), 'failed', 5, jsonb_build_object('code', 'attempts_exhausted', 'attempts', 5))::text,
  'claim by id: a request that used its 5 attempts is failed (attempts_exhausted), not claimed');
select is((select row(status, attempts)::text from api.worker_claim_request(tests.k('e112'))),
  row('validating', 5)::text, 'claim by id: below the limit it is claimed, for its 5th attempt');
select is((select row(status, error)::text from api.worker_claim_request(tests.k('e113'))),
  row('failed', jsonb_build_object('code', 'deadline_exceeded', 'attempts', 0))::text,
  'claim by id: a request past its one-hour deadline is failed (deadline_exceeded)');
select is((select id from api.worker_claim_request(tests.k('e111'))), null::uuid,
  'a request failed at the claim is not claimable again');
select tests.act_as_owner();
select is((select row(status, attempts, claimed_at < now() - interval '5 minutes')::text from cms.publish_requests where id = tests.k('e111')),
  row('failed', 5, true)::text, 'the failed request keeps its attempts and its old claim time');

-- The batch claim does the same, oldest first.
update cms.publish_requests set status = 'validating', claimed_at = now() - interval '6 minutes', error = null
  where id in (tests.k('e111'), tests.k('e113'));
update cms.publish_requests set attempts = 5, claimed_at = now() - interval '6 minutes' where id = tests.k('e112');
select tests.act_as_service();
select results_eq($$ select id, status, error ->> 'code' from api.worker_claim_requests(10) $$,
  $$ values (tests.k('e113'), 'failed'::text, 'deadline_exceeded'::text),
            (tests.k('e111'), 'failed', 'attempts_exhausted'),
            (tests.k('e112'), 'failed', 'attempts_exhausted') $$,
  'batch claim: requests past their deadline or their attempts are returned failed, oldest first');
select is_empty($$ select 1 from api.worker_claim_requests(10) $$, 'and none of them is claimed again');

-- ---------------------------------------------------------------------------
-- 3. The batch claims at most 3 per tenant (of p_limit in all).
select tests.act_as_owner();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c111'), tests.tenant('demo'), 'event', 'x', tests.persona('editor_demo'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status)
select tests.k('e12' || i::text), tests.tenant('labak'), tests.entry('c110'), 'unpublish', null, tests.persona('editor_labak'),
       now() - interval '10 minutes' + pg_catalog.make_interval(secs => i), 'pending'
from pg_catalog.generate_series(1, 5) as i;
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status) values
  (tests.k('e131'), tests.tenant('demo'), tests.entry('c111'), 'unpublish', null, tests.persona('editor_demo'),
   now() - interval '5 minutes', 'pending');
select tests.act_as_service();
select results_eq($$ select id, status from api.worker_claim_requests(10) $$,
  $$ values (tests.k('e121'), 'validating'::text), (tests.k('e122'), 'validating'), (tests.k('e123'), 'validating'),
            (tests.k('e131'), 'validating') $$,
  'labak''s three oldest and demo''s one: another tenant is not starved by a backlog');
select results_eq($$ select id from api.worker_claim_requests(10) $$,
  $$ values (tests.k('e124')), (tests.k('e125')) $$, 'the next call claims labak''s remaining two');
select tests.act_as_owner();
update cms.publish_requests set status = 'pending', claimed_at = null where id in (tests.k('e124'), tests.k('e125'), tests.k('e131'));
select tests.act_as_service();
select results_eq($$ select id from api.worker_claim_requests(2) $$,
  $$ values (tests.k('e124')), (tests.k('e125')) $$, 'p_limit still bounds the whole batch, oldest first');

-- ---------------------------------------------------------------------------
-- 4. Catalog: signatures, SECURITY INVOKER, search_path and grants unchanged.
select tests.act_as_owner();
select is_empty($$ select p.oid::regprocedure::text from pg_proc p
  where p.oid in ('api.worker_claim_requests(integer)'::regprocedure, 'api.worker_claim_request(uuid)'::regprocedure,
                  'api.worker_commit_publish(uuid,integer,integer,text,timestamptz)'::regprocedure)
    and (p.prosecdef or p.proconfig is distinct from array['search_path=""']
         or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
         or not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'the claims and the commit: still SECURITY INVOKER, search_path '''', service_role only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname in ('worker_claim_requests', 'worker_claim_request', 'worker_commit_publish')),
  3, 'no overload was added');
select ok((select c.reloptions @> array['security_invoker=true'] from pg_class c where c.oid = 'api.publication_status'::regclass),
  'api.publication_status is still security_invoker');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner $$,
  $$ values ('authenticated', 'SELECT') $$,
  'api.publication_status: still SELECT for authenticated only');

select * from finish();
rollback;
