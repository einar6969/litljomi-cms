-- supabase/tests/database/106_claim_order.test.sql
-- api.worker_claim_requests returns the claimed requests oldest first (20261103193100_claim_order.sql).
-- The rows are inserted newest first, so their physical order is the reverse of request order.
begin;
\ir _helpers.sql
select plan(4);

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  ('00000000-0000-4000-8000-00000000c051', tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak'));
update cms.publish_requests set status = 'failed' where status in ('pending', 'validating');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status)
select ('00000000-0000-4000-8000-0000000' || pg_catalog.lpad(i::text, 5, '0'))::uuid, tests.tenant('labak'),
       '00000000-0000-4000-8000-00000000c051', 'unpublish', null, tests.persona('editor_labak'),
       '2026-11-03 12:00:00+00'::timestamptz + pg_catalog.make_interval(secs => i), 'pending'
from pg_catalog.generate_series(20, 1, -1) as i;

select tests.act_as_service();
create temporary table claimed on commit drop as
  select row_number() over () as n, c.id, c.requested_at, c.status from api.worker_claim_requests(5) as c;
select tests.act_as_owner();
select is((select count(*)::int from claimed), 5, 'five requests are claimed');
select results_eq($$ select requested_at from claimed order by n $$,
  $$ select '2026-11-03 12:00:00+00'::timestamptz + pg_catalog.make_interval(secs => i) from pg_catalog.generate_series(1, 5) as i $$,
  'the five oldest, returned oldest first');
select is((select pg_catalog.count(*)::int from claimed where status = 'validating'), 5, 'each is now validating');
select is_empty($$ select p.oid from pg_proc p where p.oid = 'api.worker_claim_requests(integer)'::regprocedure
  and (p.prosecdef or p.proconfig is distinct from array['search_path=""']
       or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
       or not has_function_privilege('service_role', p.oid, 'execute')) $$,
  'still SECURITY INVOKER, search_path '''', service_role only');

select * from finish();
rollback;
