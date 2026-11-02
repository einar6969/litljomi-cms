-- supabase/tests/database/099_publication_status.test.sql
-- Task 25's api.publication_status (spec §4.5, §6.3, §7.1, §7.4; plan Task 25, decisions 35,
-- 36.1, 36.4 and 37.8): one row per entry's latest request, with whether its release left the
-- entry out (omitted), the missing images' filenames of an asset_missing failure, and counts over
-- the tenant's ACTIVE sites' deliveries of the request's release, so the editor shows "live" only
-- when every active site's live_status is 'ok'. Still security_invoker, SELECT for authenticated
-- only. 080_api_editor checks the column list with the other editor views.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   sites     5991, 5992 labak active; 5993 labak INACTIVE; 5994 demo active
--   assets    f991 a.jpg, f992 b.jpg labak; f993 c.png demo
--   releases  a991 labak #1 delivered, error.omitted = [c993]; a992 #2 delivered; a993 #3 delivered
--   deliveries a991: 5991 ok/not_confirmed; 5992 failed (10 attempts)/pending
--              a992: 5991 ok/ok; 5992 ok/ok; 5993 (inactive) failed (10 attempts)/pending
--              a993: none recorded yet
--   entries and requests (labak news):
--     c991  e991 committed in a991 two hours ago, then e992 pending (the latest)
--     c992  e993 committed in a992                       every active site live ok
--     c993  e994 committed in a991                       omitted; one site exhausted
--     c994  e995 committed in a991                       same release, not omitted
--     c995  e996 failed_validation asset_missing [f992, f991, f993]
--     c996  e997 unpublish committed, no release yet
--     c997  e998 superseded
--     c998  e999 committed in a993                       no delivery recorded yet
--   demo: c999 with e99a pending
begin;
\ir _helpers.sql
select plan(14);

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
  (tests.k('5991'), tests.tenant('labak'), 'http://localhost:3201', 'http://localhost:3201/r', tests.k('59f1'), true),
  (tests.k('5992'), tests.tenant('labak'), 'http://localhost:3202', 'http://localhost:3202/r', tests.k('59f2'), true),
  (tests.k('5993'), tests.tenant('labak'), 'http://localhost:3203', 'http://localhost:3203/r', tests.k('59f3'), false),
  (tests.k('5994'), tests.tenant('demo'), 'http://localhost:3204', 'http://localhost:3204/r', tests.k('59f4'), true);
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by) values
  (tests.k('f991'), tests.tenant('labak'), tests.tenant('labak') || '/' || tests.k('f991') || '/a.jpg', 'a.jpg',
   'image/jpeg', 1000, 800, 600, repeat('a', 64), tests.persona('editor_labak')),
  (tests.k('f992'), tests.tenant('labak'), tests.tenant('labak') || '/' || tests.k('f992') || '/b.jpg', 'b.jpg',
   'image/jpeg', 1000, 800, 600, repeat('b', 64), tests.persona('editor_labak')),
  (tests.k('f993'), tests.tenant('demo'), tests.tenant('demo') || '/' || tests.k('f993') || '/c.png', 'c.png',
   'image/png', 1000, 800, 600, repeat('c', 64), tests.persona('editor_demo'));
insert into cms.entries (id, tenant_id, type, slug, created_by)
select tests.entry(k), tests.tenant('labak'), 'news', null, tests.persona('editor_labak')
from unnest(array['c991', 'c992', 'c993', 'c994', 'c995', 'c996', 'c997', 'c998']) as k;
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c999'), tests.tenant('demo'), 'event', null, tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, delivered_at, error) values
  (tests.k('a991'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', now(),
   jsonb_build_object('omitted', jsonb_build_array(jsonb_build_object(
     'entryId', tests.entry('c993'), 'requestIds', jsonb_build_array(tests.k('e994')),
     'error', jsonb_build_object('code', 'projection_failed'))))),
  (tests.k('a992'), tests.tenant('labak'), 2, 'delivered', 'labak/releases/2.json', now(), null),
  (tests.k('a993'), tests.tenant('labak'), 3, 'delivered', 'labak/releases/3.json', now(), null);
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, live_status) values
  (tests.k('a991'), tests.k('5991'), tests.tenant('labak'), 'ok', 1, 'not_confirmed'),
  (tests.k('a991'), tests.k('5992'), tests.tenant('labak'), 'failed', 10, 'pending'),
  (tests.k('a992'), tests.k('5991'), tests.tenant('labak'), 'ok', 1, 'ok'),
  (tests.k('a992'), tests.k('5992'), tests.tenant('labak'), 'ok', 2, 'ok'),
  (tests.k('a992'), tests.k('5993'), tests.tenant('labak'), 'failed', 10, 'pending');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  error, release_id) values
  (tests.k('e991'), tests.tenant('labak'), tests.entry('c991'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '2 hours', 'committed', null, tests.k('a991')),
  (tests.k('e992'), tests.tenant('labak'), tests.entry('c991'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'pending', null, null),
  (tests.k('e993'), tests.tenant('labak'), tests.entry('c992'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'committed', null, tests.k('a992')),
  (tests.k('e994'), tests.tenant('labak'), tests.entry('c993'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'committed', null, tests.k('a991')),
  (tests.k('e995'), tests.tenant('labak'), tests.entry('c994'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'committed', null, tests.k('a991')),
  (tests.k('e996'), tests.tenant('labak'), tests.entry('c995'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'failed_validation',
   jsonb_build_object('code', 'asset_missing', 'assetIds', jsonb_build_array(tests.k('f992'), tests.k('f991'), tests.k('f993'))),
   null),
  (tests.k('e997'), tests.tenant('labak'), tests.entry('c996'), 'unpublish', null, tests.persona('editor_labak'),
   now(), 'committed', null, null),
  (tests.k('e998'), tests.tenant('labak'), tests.entry('c997'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'superseded', jsonb_build_object('code', 'superseded'), null),
  (tests.k('e999'), tests.tenant('labak'), tests.entry('c998'), 'publish', 1, tests.persona('editor_labak'),
   now(), 'committed', null, tests.k('a993')),
  (tests.k('e99a'), tests.tenant('demo'), tests.entry('c999'), 'publish', 1, tests.persona('editor_demo'),
   now(), 'pending', null, null);

-- ---------------------------------------------------------------------------
-- Catalog: an invoker view, SELECT for authenticated only (no new grant).
select is((select c.relkind::text from pg_catalog.pg_class c where c.oid = to_regclass('api.publication_status')), 'v',
  'api.publication_status is a view');
select ok((select coalesce(c.reloptions @> array['security_invoker=true'], false) from pg_catalog.pg_class c
           where c.oid = to_regclass('api.publication_status')),
  'api.publication_status is security_invoker');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = to_regclass('api.publication_status') and a.grantee <> c.relowner $$,
  $$ values ('authenticated', 'SELECT') $$,
  'publication_status: SELECT for authenticated, nothing else for anyone but the owner');
select ok(not has_table_privilege('anon', 'api.publication_status', 'SELECT')
          and not has_table_privilege('service_role', 'api.publication_status', 'SELECT')
          and not exists (select 1 from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
                          where c.oid = to_regclass('api.publication_status') and a.grantee = 0),
  'publication_status: no privilege for anon, service_role or PUBLIC');

-- ---------------------------------------------------------------------------
-- The states, as the labak editor.
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select entry_id, request_id, action, status, release_number, release_status, omitted, missing_assets,
            site_count, sites_notified, sites_live_ok, sites_not_confirmed, notify_attempts
     from api.publication_status order by entry_id $$,
  $$ values
     (tests.entry('c991'), tests.k('e992'), 'publish'::text, 'pending'::text, null::int, null::text, false, null::text[], 2, 0, 0, 0, 0),
     (tests.entry('c992'), tests.k('e993'), 'publish', 'committed', 2, 'delivered', false, null, 2, 2, 2, 0, 0),
     (tests.entry('c993'), tests.k('e994'), 'publish', 'committed', 1, 'delivered', true, null, 2, 1, 0, 1, 10),
     (tests.entry('c994'), tests.k('e995'), 'publish', 'committed', 1, 'delivered', false, null, 2, 1, 0, 1, 10),
     (tests.entry('c995'), tests.k('e996'), 'publish', 'failed_validation', null, null, false, array['b.jpg', 'a.jpg'], 2, 0, 0, 0, 0),
     (tests.entry('c996'), tests.k('e997'), 'unpublish', 'committed', null, null, false, null, 2, 0, 0, 0, 0),
     (tests.entry('c997'), tests.k('e998'), 'publish', 'superseded', null, null, false, null, 2, 0, 0, 0, 0),
     (tests.entry('c998'), tests.k('e999'), 'publish', 'committed', 3, 'delivered', false, null, 2, 0, 0, 0, 0) $$,
  'one row per entry''s latest request: omitted, missing images, and counts over the active sites only');
select is((select count(*)::int from api.publication_status where entry_id = tests.entry('c991')), 1,
  'an entry with two requests has one row (its latest)');
select is((select error from api.publication_status where entry_id = tests.entry('c995')),
  jsonb_build_object('code', 'asset_missing', 'assetIds', jsonb_build_array(tests.k('f992'), tests.k('f991'), tests.k('f993'))),
  'the request''s error is passed through unchanged');
-- Every active site live ok only for c992: the inactive site's exhausted delivery does not count.
select results_eq($$ select entry_id from api.publication_status
     where site_count > 0 and sites_live_ok = site_count order by entry_id $$,
  $$ values (tests.entry('c992')) $$,
  'every active site live ok: only the entry whose release every active site confirmed');
-- An active site added after the release has no delivery: the entry is no longer live everywhere.
select tests.act_as_owner();
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref, active) values
  (tests.k('5995'), tests.tenant('labak'), 'http://localhost:3205', 'http://localhost:3205/r', tests.k('59f5'), true);
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select site_count, sites_notified, sites_live_ok from api.publication_status where entry_id = tests.entry('c992') $$,
  $$ values (3, 2, 2) $$,
  'a new active site without a delivery counts as not yet live');

-- Tenant isolation.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select entry_id, request_id, site_count, missing_assets from api.publication_status $$,
  $$ values (tests.entry('c999'), tests.k('e99a'), 1, null::text[]) $$,
  'the demo editor sees only the demo entry, counted over the demo site');
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from api.publication_status $$, 'a user without membership sees no row');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from api.publication_status $$, 'a platform admin at aal2 without membership sees no row');
select tests.act_as_anon();
select throws_ok($$ select 1 from api.publication_status $$, '42501', null, 'anon cannot read publication_status');
select tests.act_as_service();
select throws_ok($$ select 1 from api.publication_status $$, '42501', null, 'service_role cannot read publication_status');

select * from finish();
rollback;
