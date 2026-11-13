-- supabase/tests/database/118_nothing_checked.test.sql
-- A7's api.publication_status.nothing_checked (spec §7.4): true when the request's own release is
-- delivered and recorded the entry in releases.error under `nothingChecked` (no page check: its type has
-- no site integration, or the module's checks were empty), so the editor sees "published, not
-- confirmed" and never "Birt á vef ✓". Only the request's own release counts: a newer release
-- checked other requests. The column is appended last; the grants are 099's (unchanged).
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   site      5a01 labak active
--   releases  b001 labak #1 delivered, error.nothingChecked = [ca01, ca03], error.omitted = [ca05]
--             b002 #2 failed, error.nothingChecked = [ca02]                (not delivered)
--             b003 #3 delivered, error.nothingChecked = [ca04]             (newer than ca04's request's release)
--   entries and requests (labak news):
--     ca01  ea01 publish in b001     recorded                   -> true
--     ca02  ea02 publish, no release (b002 failed links none) -> false
--     ca03  ea03 unpublish in b001   recorded                   -> true
--     ca04  ea04 publish in b001     only the newer b003        -> false
--     ca05  ea05 publish in b001     omitted, not nothing-checked -> false
--   demo: cb01 eb01 in demo release b101 #1, error.nothingChecked names ca01 and cb01
begin;
\ir _helpers.sql
select plan(6);

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

create function tests.listed(p_entries text[]) returns jsonb
language sql
set search_path = ''
as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('entryId', tests.entry(k)))
  from pg_catalog.unnest(p_entries) as k;
$$;

select tests.seed();
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('5a01'), tests.tenant('labak'), 'http://localhost:3201', 'http://localhost:3201/r', tests.k('5af1'), true);
insert into cms.entries (id, tenant_id, type, slug, created_by)
select tests.entry(k), tests.tenant('labak'), 'news', null, tests.persona('editor_labak')
from unnest(array['ca01', 'ca02', 'ca03', 'ca04', 'ca05']) as k;
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('cb01'), tests.tenant('demo'), 'event', null, tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at, error) values
  (tests.k('b001'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now(),
   jsonb_build_object('nothingChecked', tests.listed(array['ca01', 'ca03']),
                      'omitted', jsonb_build_array(jsonb_build_object('entryId', tests.entry('ca05'), 'requestIds', '[]'::jsonb)))),
  (tests.k('b002'), tests.tenant('labak'), 2, 'failed', null, null,
   jsonb_build_object('code', 'build_failed', 'nothingChecked', tests.listed(array['ca02']))),
  (tests.k('b003'), tests.tenant('labak'), 3, 'delivered', 'labak/releases/3.json', now(),
   jsonb_build_object('nothingChecked', tests.listed(array['ca04']))),
  (tests.k('b101'), tests.tenant('demo'), 1, 'delivered', 'demo/releases/1.json', now(),
   jsonb_build_object('nothingChecked', tests.listed(array['ca01', 'cb01'])));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  error, release_id) values
  (tests.k('ea01'), tests.tenant('labak'), tests.entry('ca01'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, tests.k('b001')),
  (tests.k('ea02'), tests.tenant('labak'), tests.entry('ca02'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, null),
  (tests.k('ea03'), tests.tenant('labak'), tests.entry('ca03'), 'unpublish', null, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, tests.k('b001')),
  (tests.k('ea04'), tests.tenant('labak'), tests.entry('ca04'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, tests.k('b001')),
  (tests.k('ea05'), tests.tenant('labak'), tests.entry('ca05'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', null, tests.k('b001')),
  (tests.k('eb01'), tests.tenant('demo'), tests.entry('cb01'), 'publish', 1, tests.persona('editor_demo'),
   now(), 'committed', null, tests.k('b101'));

-- ---------------------------------------------------------------------------
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select entry_id, nothing_checked from api.publication_status order by entry_id $$,
  $$ values
     (tests.entry('ca01'), true),
     (tests.entry('ca02'), false),
     (tests.entry('ca03'), true),
     (tests.entry('ca04'), false),
     (tests.entry('ca05'), false) $$,
  'nothing_checked only when the request''s own delivered release recorded the entry so; a failed or newer release does not count');

select is((select omitted from api.publication_status where entry_id = tests.entry('ca05')), true,
  'an omission is still "delivery failed", beside entries with nothing checked of the same release');

-- Malformed values never raise or count.
select tests.act_as_owner();
update cms.releases set error = jsonb_build_object('nothingChecked', jsonb_build_object('entryId', tests.entry('ca01')))
where id = tests.k('b001');
select tests.act_as(tests.persona('editor_labak'));
select is((select nothing_checked from api.publication_status where entry_id = tests.entry('ca01')), false,
  'a nothingChecked key that is not an array counts as nothing');

-- Tenant isolation: the demo release naming a labak entry id changes nothing for the labak entry,
-- and the demo editor sees only the demo entry.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select entry_id, nothing_checked from api.publication_status $$,
  $$ values (tests.entry('cb01'), true) $$,
  'the demo editor sees only the demo entry, which its own release recorded');

-- The column is appended after the existing ones (create or replace view keeps their order).
select is((select pg_catalog.array_agg(a.attname::text order by a.attnum)
           from pg_catalog.pg_attribute a
           where a.attrelid = to_regclass('api.publication_status') and a.attnum > 0 and not a.attisdropped),
  array['request_id', 'tenant_id', 'entry_id', 'action', 'status', 'error', 'requested_at', 'release_number',
        'release_status', 'omitted', 'missing_assets', 'site_count', 'sites_notified', 'sites_live_ok',
        'sites_not_confirmed', 'retries_exhausted', 'live_retrying', 'latest_request_id', 'latest_action', 'nothing_checked'],
  'publication_status: nothing_checked is appended last');

-- Grants unchanged by create or replace.
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner $$,
  $$ values ('authenticated', 'SELECT') $$,
  'publication_status: still SELECT for authenticated only');

select * from finish();
rollback;
