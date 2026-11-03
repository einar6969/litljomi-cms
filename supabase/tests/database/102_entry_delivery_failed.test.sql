-- supabase/tests/database/102_entry_delivery_failed.test.sql
-- M3-05's api.publication_status.omitted (spec §7.1, §7.4; plan M3-05): true when the request's
-- release, or the tenant's latest delivered release if newer, recorded the entry in
-- releases.error under `omitted` (left out) or `fallback` (previous projection reused), so the
-- editor sees "delivery failed" and never "live". A later release that builds the entry clears a
-- failure recorded only by an older one; a release that is not delivered never counts as latest.
-- The column set and grants are 099's (unchanged).
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   site      5a01 labak active
--   releases  b001 labak #1 delivered (no error)
--             b002 #2 delivered, error.fallback = [ca01], error.omitted = [ca02]
--             b003 #3 failed, error.omitted = [ca03]   (not delivered: never "latest")
--   entries and requests (labak news), all published once in b001 unless stated:
--     ca01  ea01 in b001   b002 reused its previous projection     -> true
--     ca02  ea02 in b001   b002 left it out                        -> true
--     ca03  ea03 in b001   only the failed b003 records it         -> false
--     ca04  ea04 in b001   nothing recorded                        -> false
--     ca05  ea05 in b002   b002 reused it (its own release)        -> true
--     ca06  ea06 unpublish in b001; b002 records it as omitted     -> true (the editor ignores it for an unpublish)
--   demo: cb01 eb01 in demo release b101 #1, error.fallback names ca04 (another tenant's entry id)
begin;
\ir _helpers.sql
select plan(5);

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

create function tests.failed(p_entries text[]) returns jsonb
language sql
set search_path = ''
as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
           'entryId', tests.entry(k), 'requestIds', '[]'::jsonb, 'error', pg_catalog.jsonb_build_object('code', 'projection_failed')))
  from pg_catalog.unnest(p_entries) as k;
$$;

select tests.seed();
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('5a01'), tests.tenant('labak'), 'http://localhost:3201', 'http://localhost:3201/r', tests.k('5af1'), true);
insert into cms.entries (id, tenant_id, type, slug, created_by)
select tests.entry(k), tests.tenant('labak'), 'news', null, tests.persona('editor_labak')
from unnest(array['ca01', 'ca02', 'ca03', 'ca04', 'ca05', 'ca06']) as k;
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('cb01'), tests.tenant('demo'), 'event', null, tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at, error) values
  (tests.k('b001'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now(), null),
  (tests.k('b002'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now(),
   jsonb_build_object('fallback', tests.failed(array['ca01', 'ca05']), 'omitted', tests.failed(array['ca02', 'ca06']))),
  (tests.k('b003'), tests.tenant('labak'), 3, 'failed', null, null,
   jsonb_build_object('code', 'build_failed', 'omitted', tests.failed(array['ca03']))),
  (tests.k('b101'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now(),
   jsonb_build_object('fallback', tests.failed(array['ca04'])));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  error, release_id)
select tests.k('ea0' || n), tests.tenant('labak'), tests.entry('ca0' || n), 'publish', 1, tests.persona('editor_labak'),
       now() - interval '1 hour', 'committed', null, tests.k(case when n = 5 then 'b002' else 'b001' end)
from unnest(array[1, 2, 3, 4, 5]) as n;
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  error, release_id) values
  (tests.k('ea06'), tests.tenant('labak'), tests.entry('ca06'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, tests.k('b001')),
  (tests.k('eb01'), tests.tenant('demo'), tests.entry('cb01'), 'publish', 1, tests.persona('editor_demo'),
   now(), 'committed', null, tests.k('b101'));

-- ---------------------------------------------------------------------------
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select entry_id, release_number, omitted from api.publication_status order by entry_id $$,
  $$ values
     (tests.entry('ca01'), 1, true),
     (tests.entry('ca02'), 1, true),
     (tests.entry('ca03'), 1, false),
     (tests.entry('ca04'), 1, false),
     (tests.entry('ca05'), 2, true),
     (tests.entry('ca06'), 1, true) $$,
  'a fallback or an omission in the request''s release or a newer delivered one is "delivery failed"; a failed release is not');

-- A newer delivered release that builds the entries again clears what only an older one recorded.
select tests.act_as_owner();
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at, error) values
  (tests.k('b004'), tests.tenant('labak'), 4, 'delivered', 'labak/releases/4.json', now(),
   jsonb_build_object('fallback', tests.failed(array['ca04'])));
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select entry_id, omitted from api.publication_status order by entry_id $$,
  $$ values
     (tests.entry('ca01'), false),
     (tests.entry('ca02'), false),
     (tests.entry('ca03'), false),
     (tests.entry('ca04'), true),
     (tests.entry('ca05'), true),
     (tests.entry('ca06'), false) $$,
  'only the latest delivered release counts beyond the request''s own; the request''s own release still counts');

-- Malformed error values never raise or count.
select tests.act_as_owner();
update cms.releases set error = jsonb_build_object('fallback', 'x', 'omitted', jsonb_build_object('entryId', tests.entry('ca04')))
where id = tests.k('b004');
select tests.act_as(tests.persona('editor_labak'));
select is((select omitted from api.publication_status where entry_id = tests.entry('ca04')), false,
  'a fallback or omitted key that is not an array counts as nothing');

-- Tenant isolation: the demo release naming a labak entry id changes nothing for either tenant.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select entry_id, omitted from api.publication_status $$,
  $$ values (tests.entry('cb01'), false) $$,
  'the demo editor sees only the demo entry, which its release did not record');

-- Grants unchanged by create or replace.
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner $$,
  $$ values ('authenticated', 'SELECT') $$,
  'publication_status: still SELECT for authenticated only');

select * from finish();
rollback;
