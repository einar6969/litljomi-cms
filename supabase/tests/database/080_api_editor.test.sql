-- supabase/tests/database/080_api_editor.test.sql
-- The editor's api functions and views (spec §4.1 rule 4, §4.2, §4.3, §4.5,
-- §4.6, §5.5, §5.6, §6.1; plan Task 10, decisions 3, 11 and 30; "Review
-- focus" items 3 and 5).
--
-- Personas and tenants come from tests.seed() (_helpers.sql): editor_labak and
-- editor_demo are members of labak and demo; outsider, revoked and
-- platform_admin are members of nothing; platform_admin is in
-- cms.platform_admins.
--
-- Fixture rows (inserted below in owner context; tests.asset('f801') and
-- tests.pub('e801') give 00000000-0000-4000-8000-00000000f801 and ...e801):
--   entry    c801  labak  news  slug fyrsta  draft v1 {}                   status draft
--                                            revision d801 (not published) references f804
--   entry    c802  demo   news               draft v1 {}                   status draft
--   entry    c803  labak  news  slug birt    published d803 (v1), draft v1 status published; d803 references f801
--   entry    c804  labak  news  slug breytt  published d804 (v1), draft v2 status changed
--   entry    c805  labak  news  slug gomul   archived, draft v1            status archived
--   asset    f801  labak  referenced by the published revision d803
--   asset    f802  labak  unreferenced
--   asset    f803  demo
--   asset    f804  labak  referenced only by the unpublished revision d801
--   asset    f806  labak  already archived
--   request  e801  labak  c803 publish committed, release e821, two hours ago
--   request  e802  labak  c803 publish committed, release e822, one hour ago (c803's latest)
--   request  e803  labak  c804 publish pending, no release
--   request  e804  demo   c802 publish pending
--   release  e821  labak  number 1 delivered; e822 labak number 2 delivered
--   site     e841, e842 labak; e843 demo
--   delivery (e822, e841) ok/ok; (e822, e842) failed/pending; (e821, e841) ok/ok
--
-- Rows the function tests create along the way (not fixtures): the entries
-- tests.new_entry (create_entry with defaults) and tests.slug_entry (slug
-- 'annad', schema version 3), the asset f805 (register_asset), and the publish
-- and unpublish requests tests.request and tests.unpublish.
--
-- The views are checked first, against these fixtures. The function tests then
-- change them, in file order.
begin;
\ir _helpers.sql
select plan(164);

create function tests.asset(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^f[0-9a-f]{3}$' then
    raise exception 'unknown asset key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
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
-- The original path register_asset requires: {tenant_id}/{asset_id}/{filename}.
create function tests.asset_path(p_tenant uuid, p_asset uuid, p_filename text) returns text
language sql
set search_path = ''
as $$ select p_tenant::text || '/' || p_asset::text || '/' || p_filename $$;
grant execute on function tests.asset(text), tests.pub(text), tests.asset_path(uuid, uuid, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Catalog (§4.2, §4.5, §4.6): the nine editor functions.
create temporary table editor_functions (sig text primary key) on commit drop;
insert into editor_functions values
  ('api.create_entry(uuid,text,text,integer)'),
  ('api.save_draft(uuid,integer,jsonb,integer,text,timestamp with time zone)'),
  ('api.set_slug(uuid,text)'),
  ('api.archive_entry(uuid)'),
  ('api.register_asset(uuid,uuid,text,text,text,bigint,integer,integer,text)'),
  ('api.update_asset(uuid,real,real,text)'),
  ('api.archive_asset(uuid)'),
  ('api.request_publish(uuid,integer)'),
  ('api.request_unpublish(uuid)');

select is_empty($$ select sig from editor_functions where to_regprocedure(sig) is null $$,
  'all nine editor functions exist with the Interfaces'' signatures');
select set_eq($$ select p.proname::text, pg_catalog.pg_get_function_result(p.oid) from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from editor_functions) $$,
  $$ values ('create_entry', 'uuid'), ('save_draft', 'integer'), ('set_slug', 'void'), ('archive_entry', 'void'),
            ('register_asset', 'uuid'), ('update_asset', 'void'), ('archive_asset', 'void'),
            ('request_publish', 'uuid'), ('request_unpublish', 'uuid') $$,
  'editor functions: return types');
select is((select pg_catalog.pg_get_function_arguments('api.create_entry(uuid,text,text,integer)'::regprocedure)),
  'p_tenant_id uuid, p_type text, p_slug text DEFAULT NULL::text, p_schema_version integer DEFAULT 1',
  'create_entry: slug defaults to null, schema version to 1');
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from editor_functions)
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'every editor function is security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from editor_functions) $$,
  $$ select to_regprocedure(sig)::text as sig, g, 'EXECUTE' as privilege_type from editor_functions, (values ('postgres'), ('authenticated')) as v(g) $$,
  'editor functions: EXECUTE for postgres (owner) and authenticated only; not PUBLIC, anon or service_role');
select is_empty($$ select sig from editor_functions
     where has_function_privilege('anon', to_regprocedure(sig), 'execute')
        or has_function_privilege('service_role', to_regprocedure(sig), 'execute')
        or not has_function_privilege('authenticated', to_regprocedure(sig), 'execute') $$,
  'authenticated executes every editor function; anon and service_role none');

-- The seven views: security_invoker, select for authenticated only.
create temporary table editor_views (name text primary key, cols text[]) on commit drop;
insert into editor_views values
  ('my_tenants', array['id', 'slug', 'name', 'status']),
  ('entry_list', array['id', 'tenant_id', 'type', 'slug', 'title', 'sort_at', 'draft_version', 'published_draft_version',
                       'status', 'archived_at', 'updated_at', 'first_published_at']), -- M2-10 appended first_published_at
  ('entry_detail', array['id', 'tenant_id', 'type', 'slug', 'data', 'schema_version', 'draft_version',
                         'published_draft_version', 'first_published_at', 'status']),
  ('asset_list', array['id', 'tenant_id', 'filename', 'mime', 'width', 'height', 'focal_x', 'focal_y', 'default_alt',
                       'original_path', 'archived_at']),
  -- Task 25 replaced this view (20261102001500_publication_status.sql; 099_publication_status).
  ('publication_status', array['request_id', 'tenant_id', 'entry_id', 'action', 'status', 'error', 'requested_at',
                               'release_number', 'release_status', 'omitted', 'missing_assets', 'site_count',
                               'sites_notified', 'sites_live_ok', 'sites_not_confirmed', 'retries_exhausted',
                               'live_retrying']), -- M3-03 appended live_retrying
  ('tenant_sites', array['id', 'tenant_id', 'base_url', 'preview_url', 'active']),
  -- M2-16 added revision_list (20261103210500_revision_list.sql; 107_revision_list).
  ('revision_list', array['id', 'tenant_id', 'entry_id', 'draft_version', 'schema_version', 'data', 'title',
                          'requested_by', 'committed_at', 'is_published']);

select is_empty($$ select v.name from editor_views v
     where not exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                       where n.nspname = 'api' and c.relname = v.name and c.relkind = 'v') $$,
  'all seven editor views exist in api');
select is_empty($$ select v.name from editor_views v
     where v.cols is distinct from (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
                                   where a.attrelid = to_regclass('api.' || v.name) and a.attnum > 0 and not a.attisdropped) $$,
  'every editor view has exactly the Interfaces'' columns, in order');
select is_empty($$ select v.name from editor_views v join pg_catalog.pg_class c on c.oid = to_regclass('api.' || v.name)
     where not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'every editor view is security_invoker');
select set_eq($$ select c.relname::text, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
            a.privilege_type
     from editor_views v join pg_catalog.pg_class c on c.oid = to_regclass('api.' || v.name),
          pg_catalog.aclexplode(c.relacl) a
     where a.grantee <> c.relowner $$,
  $$ select name, 'authenticated' as grantee, 'SELECT' as privilege_type from editor_views $$,
  'editor views: SELECT for authenticated only (besides the owner); nothing for PUBLIC, anon or service_role');
select is_empty($$ select v.name from editor_views v, (values ('anon'), ('service_role')) as r(role)
     where has_table_privilege(r.role, to_regclass('api.' || v.name), 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') $$,
  'anon and service_role have no privilege on the editor views');
-- tenant_sites never exposes the secret columns (§4.5, §8.2).
select is_empty($$ select a.attname from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('api.tenant_sites')
       and a.attname in ('revalidate_url', 'webhook_secret_ref', 'preview_secret_ref') $$,
  'tenant_sites has no revalidate_url or secret reference column');

-- ---------------------------------------------------------------------------
-- Fixtures (owner context).
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by, archived_at) values
  (tests.asset('f801'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.asset('f801'), 'a.jpg'),
   'a.jpg', 'image/jpeg', 1000, 800, 600, repeat('a', 64), tests.persona('editor_labak'), null),
  (tests.asset('f802'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.asset('f802'), 'b.jpg'),
   'b.jpg', 'image/jpeg', 1000, 800, 600, repeat('b', 64), tests.persona('editor_labak'), null),
  (tests.asset('f803'), tests.tenant('demo'), tests.asset_path(tests.tenant('demo'), tests.asset('f803'), 'c.png'),
   'c.png', 'image/png', 1000, 400, 300, repeat('c', 64), tests.persona('editor_demo'), null),
  (tests.asset('f804'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.asset('f804'), 'd.webp'),
   'd.webp', 'image/webp', 1000, 400, 300, repeat('d', 64), tests.persona('editor_labak'), null),
  (tests.asset('f806'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.asset('f806'), 'f.jpg'),
   'f.jpg', 'image/jpeg', 1000, 400, 300, repeat('f', 64), tests.persona('editor_labak'), now());
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c801'), tests.tenant('labak'), 'news', 'fyrsta', tests.persona('editor_labak')),
  (tests.entry('c802'), tests.tenant('demo'), 'news', null, tests.persona('editor_demo')),
  (tests.entry('c803'), tests.tenant('labak'), 'news', 'birt', tests.persona('editor_labak')),
  (tests.entry('c804'), tests.tenant('labak'), 'news', 'breytt', tests.persona('editor_labak')),
  (tests.entry('c805'), tests.tenant('labak'), 'news', 'gomul', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, sort_at, updated_by) values
  (tests.entry('c801'), tests.tenant('labak'), 1, '{}', 'Fyrsta', '2025-01-01', tests.persona('editor_labak')),
  (tests.entry('c802'), tests.tenant('demo'), 1, '{}', null, null, tests.persona('editor_demo')),
  (tests.entry('c803'), tests.tenant('labak'), 1, '{}', 'Birt', '2025-01-03', tests.persona('editor_labak')),
  (tests.entry('c804'), tests.tenant('labak'), 1, '{}', 'Breytt', '2025-01-04', tests.persona('editor_labak')),
  (tests.entry('c805'), tests.tenant('labak'), 1, '{}', 'Gömul', '2025-01-05', tests.persona('editor_labak'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by) values
  (tests.revision('d801'), tests.tenant('labak'), tests.entry('c801'), 1, 1,
   jsonb_build_object('image', jsonb_build_object('_ref', tests.asset('f804'), '_kind', 'asset')), tests.persona('editor_labak')),
  (tests.revision('d803'), tests.tenant('labak'), tests.entry('c803'), 1, 1,
   jsonb_build_object('image', jsonb_build_object('_ref', tests.asset('f801'), '_kind', 'asset')), tests.persona('editor_labak')),
  (tests.revision('d804'), tests.tenant('labak'), tests.entry('c804'), 1, 1, '{}', tests.persona('editor_labak'));
update cms.entries set published_rev_id = tests.revision('d803'), published_draft_version = 1,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c803');
update cms.entries set published_rev_id = tests.revision('d804'), published_draft_version = 1,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c804');
update cms.drafts set title = 'Breytt aftur' where entry_id = tests.entry('c804');
update cms.entries set archived_at = now() where id = tests.entry('c805');
insert into cms.releases (id, tenant_id, number, status, delivered_at) values
  (tests.pub('e821'), tests.tenant('labak'), 1, 'delivered', now()),
  (tests.pub('e822'), tests.tenant('labak'), 2, 'delivered', now());
insert into cms.sites (id, tenant_id, base_url, revalidate_url, preview_url, webhook_secret_ref) values
  (tests.pub('e841'), tests.tenant('labak'), 'http://localhost:3100', 'http://localhost:3100/r', 'http://localhost:3100/p', tests.pub('e8f1')),
  (tests.pub('e842'), tests.tenant('labak'), 'http://localhost:3102', 'http://localhost:3102/r', null, tests.pub('e8f2')),
  (tests.pub('e843'), tests.tenant('demo'), 'http://localhost:3101', 'http://localhost:3101/r', null, tests.pub('e8f3'));
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, live_status, live_confirmed_at,
                                 first_failed_at, next_attempt_at) values
  (tests.pub('e821'), tests.pub('e841'), tests.tenant('labak'), 'ok', 'ok', now(), null, null),
  (tests.pub('e822'), tests.pub('e841'), tests.tenant('labak'), 'ok', 'ok', now(), null, null),
  -- A failed notification still being retried (M3-02: its next attempt is scheduled).
  (tests.pub('e822'), tests.pub('e842'), tests.tenant('labak'), 'failed', 'pending', null, now(), now() + interval '1 minute');
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  revision_id, release_id) values
  (tests.pub('e801'), tests.tenant('labak'), tests.entry('c803'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '2 hours', 'committed', tests.revision('d803'), tests.pub('e821')),
  (tests.pub('e802'), tests.tenant('labak'), tests.entry('c803'), 'publish', 1, tests.persona('editor_labak'),
   now() - interval '1 hour', 'committed', tests.revision('d803'), tests.pub('e822')),
  (tests.pub('e803'), tests.tenant('labak'), tests.entry('c804'), 'publish', 2, tests.persona('editor_labak'),
   now() - interval '1 hour', 'pending', null, null),
  (tests.pub('e804'), tests.tenant('demo'), tests.entry('c802'), 'publish', 1, tests.persona('editor_demo'),
   now() - interval '1 hour', 'pending', null, null);

-- ---------------------------------------------------------------------------
-- Views, as the labak editor.
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select id, slug, name, status from api.my_tenants $$,
  $$ values (tests.tenant('labak'), 'labak'::text, 'Landssamband bakarameistara'::text, 'active'::text) $$,
  'my_tenants: the labak editor''s one tenant');
-- Status derivation (§4.3), all four states.
select results_eq($$ select id, status from api.entry_list order by id $$,
  $$ values (tests.entry('c801'), 'draft'::text), (tests.entry('c803'), 'published'), (tests.entry('c804'), 'changed'),
            (tests.entry('c805'), 'archived') $$,
  'entry_list: draft, published, changed and archived, and only labak entries');
select results_eq($$ select id, tenant_id, type, slug, title, sort_at, draft_version, published_draft_version, archived_at,
            updated_at from api.entry_list where id = tests.entry('c804') $$,
  $$ select e.id, e.tenant_id, 'news'::text, 'breytt'::text, 'Breytt aftur'::text, '2025-01-04'::timestamptz, 2, 1,
            null::timestamptz, d.updated_at
     from cms.entries e join cms.drafts d on d.entry_id = e.id where e.id = tests.entry('c804') $$,
  'entry_list columns for a changed entry: draft version 2, published version 1');
-- M2-10 (20261103180000_entry_list_first_published.sql): the status filter tells "unpublished"
-- from "draft" by first_published_at, which stays set once an entry has been published.
select results_eq($$ select id, first_published_at is not null from api.entry_list order by id $$,
  $$ values (tests.entry('c801'), false), (tests.entry('c803'), true), (tests.entry('c804'), true),
            (tests.entry('c805'), false) $$,
  'entry_list.first_published_at: set for the entries that have been published');
select results_eq($$ select id, status from api.entry_detail order by id $$,
  $$ select id, status from api.entry_list order by id $$,
  'entry_detail derives the same status as entry_list');
select results_eq($$ select id, tenant_id, type, slug, data, schema_version, draft_version, published_draft_version,
            first_published_at, status from api.entry_detail where id = tests.entry('c803') $$,
  $$ values (tests.entry('c803'), tests.tenant('labak'), 'news'::text, 'birt'::text, '{}'::jsonb, 1, 1, 1, now(),
             'published'::text) $$,
  'entry_detail columns for a published entry');
select results_eq($$ select id from api.asset_list order by id $$,
  $$ values (tests.asset('f801')), (tests.asset('f802')), (tests.asset('f804')), (tests.asset('f806')) $$,
  'asset_list: only labak assets');
select results_eq($$ select id, tenant_id, filename, mime, width, height, focal_x, focal_y, default_alt, original_path,
            archived_at from api.asset_list where id = tests.asset('f802') $$,
  $$ values (tests.asset('f802'), tests.tenant('labak'), 'b.jpg'::text, 'image/jpeg'::text, 800, 600, null::real, null::real,
             null::text, tests.asset_path(tests.tenant('labak'), tests.asset('f802'), 'b.jpg'), null::timestamptz) $$,
  'asset_list columns');
-- The latest request per entry, with its release and counts over the tenant's two active sites
-- (Task 25's shape; its states are tested in 099_publication_status).
select results_eq($$ select request_id, tenant_id, entry_id, action, status, error, requested_at, release_number,
            release_status, omitted, missing_assets, site_count, sites_notified, sites_live_ok, sites_not_confirmed,
            retries_exhausted
     from api.publication_status order by entry_id $$,
  $$ values (tests.pub('e802'), tests.tenant('labak'), tests.entry('c803'), 'publish'::text, 'committed'::text, null::jsonb,
             now() - interval '1 hour', 2, 'delivered'::text, false, null::text[], 2, 1, 1, 0, false),
            (tests.pub('e803'), tests.tenant('labak'), tests.entry('c804'), 'publish', 'pending', null,
             now() - interval '1 hour', null, null, false, null, 2, 0, 0, 0, false) $$,
  'publication_status: the latest labak request per entry, its release and the counts over its sites');
select results_eq($$ select id, tenant_id, base_url, preview_url, active from api.tenant_sites order by id $$,
  $$ values (tests.pub('e841'), tests.tenant('labak'), 'http://localhost:3100'::text, 'http://localhost:3100/p'::text, true),
            (tests.pub('e842'), tests.tenant('labak'), 'http://localhost:3102', null, true) $$,
  'tenant_sites: the labak sites'' non-secret columns');

-- The demo editor sees only demo rows.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select id from api.my_tenants $$, $$ values (tests.tenant('demo')) $$, 'my_tenants: demo only');
select results_eq($$ select id, status from api.entry_list $$, $$ values (tests.entry('c802'), 'draft'::text) $$,
  'entry_list: demo only');
select results_eq($$ select id from api.entry_detail $$, $$ values (tests.entry('c802')) $$, 'entry_detail: demo only');
select results_eq($$ select id from api.asset_list $$, $$ values (tests.asset('f803')) $$, 'asset_list: demo only');
select results_eq($$ select request_id, release_number from api.publication_status $$,
  $$ values (tests.pub('e804'), null::int) $$, 'publication_status: demo only');
select results_eq($$ select id from api.tenant_sites $$, $$ values (tests.pub('e843')) $$, 'tenant_sites: demo only');

-- A platform admin at aal2 has console reads on tenants, requests and sites,
-- but these are the editor's views: only tenants it is a member of (none).
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from api.my_tenants $$, 'platform admin at aal2: my_tenants is empty (no membership)');
select is_empty($$ select 1 from api.entry_list $$, 'platform admin at aal2: no entries (no content access)');
select is_empty($$ select 1 from api.entry_detail $$, 'platform admin at aal2: no entry details');
select is_empty($$ select 1 from api.asset_list $$, 'platform admin at aal2: no assets');
select is_empty($$ select 1 from api.publication_status $$, 'platform admin at aal2: publication_status is empty');
select is_empty($$ select 1 from api.tenant_sites $$, 'platform admin at aal2: tenant_sites is empty');

select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from api.my_tenants union all select 1 from api.entry_list union all select 1 from api.entry_detail
     union all select 1 from api.asset_list union all select 1 from api.publication_status union all select 1 from api.tenant_sites $$,
  'a user without membership sees nothing in any editor view');
select tests.act_as(tests.persona('revoked'));
select is_empty($$ select 1 from api.my_tenants union all select 1 from api.entry_list union all select 1 from api.entry_detail
     union all select 1 from api.asset_list union all select 1 from api.publication_status union all select 1 from api.tenant_sites $$,
  'a revoked member sees nothing in any editor view');

select tests.act_as_anon();
select throws_ok($$ select 1 from api.my_tenants $$, '42501', null, 'anon cannot read my_tenants');
select throws_ok($$ select 1 from api.entry_list $$, '42501', null, 'anon cannot read entry_list');
select throws_ok($$ select 1 from api.entry_detail $$, '42501', null, 'anon cannot read entry_detail');
select throws_ok($$ select 1 from api.asset_list $$, '42501', null, 'anon cannot read asset_list');
select throws_ok($$ select 1 from api.publication_status $$, '42501', null, 'anon cannot read publication_status');
select throws_ok($$ select 1 from api.tenant_sites $$, '42501', null, 'anon cannot read tenant_sites');
select tests.act_as_service();
select throws_ok($$ select 1 from api.entry_list $$, '42501', null, 'service_role cannot read entry_list (authenticated only)');
select throws_ok($$ select 1 from api.tenant_sites $$, '42501', null, 'service_role cannot read tenant_sites');

-- ---------------------------------------------------------------------------
-- No function for anon or service_role (§4.6: authenticated only).
select tests.act_as_anon();
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news') $$, '42501', null, 'anon cannot call create_entry');
select throws_ok($$ select api.save_draft(tests.entry('c801'), 1, '{}', 1, null, null) $$, '42501', null, 'anon cannot call save_draft');
select throws_ok($$ select api.set_slug(tests.entry('c801'), 'x') $$, '42501', null, 'anon cannot call set_slug');
select throws_ok($$ select api.archive_entry(tests.entry('c801')) $$, '42501', null, 'anon cannot call archive_entry');
select throws_ok($$ select api.register_asset(gen_random_uuid(), tests.tenant('labak'), 'x', 'x', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  '42501', null, 'anon cannot call register_asset');
select throws_ok($$ select api.update_asset(tests.asset('f802'), null, null, null) $$, '42501', null, 'anon cannot call update_asset');
select throws_ok($$ select api.archive_asset(tests.asset('f802')) $$, '42501', null, 'anon cannot call archive_asset');
select throws_ok($$ select api.request_publish(tests.entry('c801'), 1) $$, '42501', null, 'anon cannot call request_publish');
select throws_ok($$ select api.request_unpublish(tests.entry('c803')) $$, '42501', null, 'anon cannot call request_unpublish');
select tests.act_as_service();
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news') $$, '42501', null, 'service_role cannot call create_entry');
select throws_ok($$ select api.save_draft(tests.entry('c801'), 1, '{}', 1, null, null) $$, '42501', null,
  'service_role cannot call save_draft');
select throws_ok($$ select api.request_publish(tests.entry('c801'), 1) $$, '42501', null, 'service_role cannot call request_publish');

-- ---------------------------------------------------------------------------
-- create_entry (§4.6): inserts the entry and an empty draft; the id is generated.
select tests.act_as_owner();
select set_config('tests.audit_max', (select max(id) from cms.audit_log)::text, true);
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select set_config('tests.new_entry', api.create_entry(tests.tenant('labak'), 'news')::text, true) $$,
  'editor_labak creates an entry');
select results_eq($$ select tenant_id, type, slug, created_by, published_rev_id, archived_at from cms.entries
     where id = current_setting('tests.new_entry')::uuid $$,
  $$ values (tests.tenant('labak'), 'news'::text, null::text, tests.persona('editor_labak'), null::uuid, null::timestamptz) $$,
  'the new entry: labak, news, no slug, created by the editor, unpublished');
select results_eq($$ select tenant_id, version, data, schema_version, title, sort_at, updated_by from cms.drafts
     where entry_id = current_setting('tests.new_entry')::uuid $$,
  $$ values (tests.tenant('labak'), 1, '{}'::jsonb, 1, null::text, null::timestamptz, tests.persona('editor_labak')) $$,
  'its draft: version 1, empty data, schema version 1');
select results_eq($$ select status from api.entry_list where id = current_setting('tests.new_entry')::uuid $$,
  $$ values ('draft'::text) $$, 'a new entry is a draft');
select tests.act_as_owner();
select results_eq($$ select action, actor_id, tenant_id, target_type, target_id from cms.audit_log
     where id > current_setting('tests.audit_max')::bigint $$,
  $$ values ('entry.created'::text, tests.persona('editor_labak'), tests.tenant('labak'), 'entry'::text,
             current_setting('tests.new_entry')::uuid) $$,
  'creating an entry writes exactly one audit row, entry.created, by the editor');
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select set_config('tests.slug_entry', api.create_entry(tests.tenant('labak'), 'news', 'annad', 3)::text, true) $$,
  'create_entry with a slug and a schema version');
select results_eq($$ select e.slug, d.schema_version from cms.entries e join cms.drafts d on d.entry_id = e.id
     where e.id = current_setting('tests.slug_entry')::uuid $$,
  $$ values ('annad'::text, 3) $$, 'slug and schema version stored');
-- Slugs (review focus 5): unique per tenant and type among live entries.
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news', 'fyrsta') $$, 'P0001', 'slug_taken',
  'create_entry with a live slug of the same type: slug_taken');
select lives_ok($$ select api.create_entry(tests.tenant('labak'), 'page', 'fyrsta') $$, 'the same slug in another type is allowed');
select lives_ok($$ select api.create_entry(tests.tenant('labak'), 'news', 'gomul') $$,
  'an archived entry''s slug is free again');
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news', 'Brauð ársins') $$, '23514', null,
  'create_entry with a malformed slug: 23514');
select throws_ok($$ select api.create_entry(tests.tenant('demo'), 'news') $$, 'P0001', 'not_found',
  'create_entry in another tenant: not_found');
select throws_ok($$ select api.create_entry(gen_random_uuid(), 'news') $$, 'P0001', 'not_found',
  'create_entry in a tenant that does not exist: not_found');
select tests.act_as(tests.persona('editor_demo'));
select lives_ok($$ select api.create_entry(tests.tenant('demo'), 'news', 'fyrsta') $$,
  'the same slug in another tenant is allowed');
select tests.act_as(tests.persona('outsider'));
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news') $$, 'P0001', 'not_found',
  'a user without membership: not_found');
select tests.act_as(tests.persona('revoked'));
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news') $$, 'P0001', 'not_found',
  'a revoked member: not_found');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news') $$, 'P0001', 'not_found',
  'a platform admin at aal2 without membership: not_found');

-- ---------------------------------------------------------------------------
-- save_draft (§4.6, §5.5).
select tests.act_as(tests.persona('editor_labak'));
select is(api.save_draft(tests.entry('c801'), 1, '{"title": "Ný"}', 2, 'Ný', '2025-02-01'), 2,
  'save_draft at the current version returns the new version');
select results_eq($$ select version, data, schema_version, title, sort_at, updated_by from cms.drafts
     where entry_id = tests.entry('c801') $$,
  $$ values (2, '{"title": "Ný"}'::jsonb, 2, 'Ný'::text, '2025-02-01'::timestamptz, tests.persona('editor_labak')) $$,
  'the draft holds the saved data, schema version, title and sort_at');
select throws_ok($$ select api.save_draft(tests.entry('c801'), 1, '{"title": "Önnur"}', 2, 'Önnur', null) $$,
  'P0001', 'version_conflict', 'a second save with the same expected version: version_conflict');
select is((select data from cms.drafts where entry_id = tests.entry('c801')), '{"title": "Ný"}'::jsonb,
  'the stale save changed nothing');
select throws_ok($$ select api.save_draft(tests.entry('c801'), null, '{}', 2, null, null) $$,
  'P0001', 'version_conflict', 'a save with no expected version: version_conflict');
select is(api.save_draft(tests.entry('c801'), 2,
    jsonb_build_object('image', jsonb_build_object('_ref', tests.asset('f802'), '_kind', 'asset')), 2, 'Ný', null),
  3, 'a save with a reference');
select results_eq($$ select path, target_asset_id from cms.draft_refs where entry_id = tests.entry('c801') $$,
  $$ values ('$."image"'::text, tests.asset('f802')) $$, 'the reference is extracted by the trigger');
select throws_ok($$ select api.save_draft(tests.entry('c801'), 3,
    jsonb_build_object('image', jsonb_build_object('_ref', tests.asset('f803'), '_kind', 'asset')), 2, null, null) $$,
  '23503', null, 'a reference to another tenant''s asset fails the save');
select throws_ok($$ select api.save_draft(tests.entry('c801'), 3, '[]', 2, null, null) $$, '23514', null,
  'draft data must be an object');
select throws_ok($$ select api.save_draft(tests.entry('c802'), 1, '{}', 1, null, null) $$, 'P0001', 'not_found',
  'save_draft on another tenant''s entry: not_found');
select throws_ok($$ select api.save_draft(gen_random_uuid(), 1, '{}', 1, null, null) $$, 'P0001', 'not_found',
  'save_draft on an entry that does not exist: not_found');
-- The tenant is derived from the row: the demo editor cannot reach a labak entry.
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.save_draft(tests.entry('c801'), 3, '{"x": 1}', 1, null, null) $$, 'P0001', 'not_found',
  'the demo editor''s save_draft on a labak entry: not_found');
select tests.act_as(tests.persona('revoked'));
select throws_ok($$ select api.save_draft(tests.entry('c801'), 3, '{"x": 1}', 1, null, null) $$, 'P0001', 'not_found',
  'a revoked member''s save_draft: not_found');
select tests.act_as_owner();
select results_eq($$ select version, data from cms.drafts where entry_id = tests.entry('c801') $$,
  $$ values (3, jsonb_build_object('image', jsonb_build_object('_ref', tests.asset('f802'), '_kind', 'asset'))) $$,
  'refused saves left the draft at version 3');

-- ---------------------------------------------------------------------------
-- set_slug (§4.6).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select api.set_slug(tests.entry('c801'), 'nytt-heiti') $$, 'set_slug before first publish');
select is((select slug from cms.entries where id = tests.entry('c801')), 'nytt-heiti', 'the slug is changed');
select throws_ok($$ select api.set_slug(tests.entry('c801'), 'annad') $$, 'P0001', 'slug_taken',
  'set_slug to a live slug of the same type: slug_taken');
select throws_ok($$ select api.set_slug(tests.entry('c803'), 'nytt') $$, 'P0001', 'slug_locked',
  'set_slug after first publish: slug_locked');
select throws_ok($$ select api.set_slug(tests.entry('c803'), 'annad') $$, 'P0001', 'slug_locked',
  'set_slug after first publish to a taken slug: slug_locked, checked first');
select throws_ok($$ select api.set_slug(tests.entry('c801'), 'Nýtt') $$, '23514', null, 'set_slug with a malformed slug: 23514');
select lives_ok($$ select api.set_slug(tests.entry('c801'), null) $$, 'set_slug clears the slug');
select throws_ok($$ select api.set_slug(tests.entry('c802'), 'x') $$, 'P0001', 'not_found',
  'set_slug on another tenant''s entry: not_found');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.set_slug(tests.entry('c801'), 'x') $$, 'P0001', 'not_found',
  'the demo editor''s set_slug on a labak entry: not_found');
select tests.act_as_owner();
select is((select slug from cms.entries where id = tests.entry('c801')), null::text, 'refused calls left the slug cleared');
select is((select slug from cms.entries where id = tests.entry('c803')), 'birt', 'the published entry''s slug is unchanged');

-- ---------------------------------------------------------------------------
-- archive_entry (§4.6): only when not published.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.archive_entry(tests.entry('c803')) $$, 'P0001', 'forbidden',
  'archive_entry on a published entry: forbidden');
select throws_ok($$ select api.archive_entry(tests.entry('c804')) $$, 'P0001', 'forbidden',
  'archive_entry on a published entry with changes: forbidden');
select lives_ok($$ select api.archive_entry(current_setting('tests.new_entry')::uuid) $$, 'archive_entry on a draft');
select results_eq($$ select status, archived_at from api.entry_list where id = current_setting('tests.new_entry')::uuid $$,
  $$ values ('archived'::text, now()) $$, 'the entry is archived now');
select lives_ok($$ select api.archive_entry(current_setting('tests.new_entry')::uuid) $$,
  'archive_entry on an archived entry changes nothing');
select throws_ok($$ select api.archive_entry(tests.entry('c802')) $$, 'P0001', 'not_found',
  'archive_entry on another tenant''s entry: not_found');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.archive_entry(tests.entry('c801')) $$, 'P0001', 'not_found',
  'the demo editor''s archive_entry on a labak entry: not_found');
select tests.act_as_owner();
select is((select count(*)::int from cms.audit_log where action = 'entry.archived'
           and target_id = current_setting('tests.new_entry')::uuid), 1,
  'archiving twice writes one entry.archived event');
select results_eq($$ select id from cms.entries where archived_at is not null order by id $$,
  $$ values (tests.entry('c805')), (current_setting('tests.new_entry')::uuid) $$,
  'refused calls archived nothing');

-- ---------------------------------------------------------------------------
-- register_asset (§4.6, §5.6): path {tenant_id}/{asset_id}/{filename}.
select tests.act_as(tests.persona('editor_labak'));
select is(api.register_asset(tests.asset('f805'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f805'), 'mynd.jpg'), 'mynd.jpg', 'image/jpeg', 2048, 640, 480,
    repeat('e', 64)),
  tests.asset('f805'), 'register_asset returns the asset id');
select results_eq($$ select tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by, public_path,
            archived_at from cms.assets where id = tests.asset('f805') $$,
  $$ values (tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.asset('f805'), 'mynd.jpg'),
             'mynd.jpg'::text, 'image/jpeg'::text, 2048::bigint, 640, 480, repeat('e', 64), tests.persona('editor_labak'),
             null::text, null::timestamptz) $$,
  'the asset row as registered, created by the editor');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('demo'), tests.asset('f810'), 'a.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'a path under another tenant: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f811'), 'a.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'a path naming another asset id: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), 'b.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'a path whose last segment is not the filename: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.tenant('labak')::text || '/' || tests.asset('f810')::text || '/x/a.jpg', 'x/a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'a filename with a slash (an extra segment): forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), '..'), '..', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'filename ..: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), '.'), '.', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'filename .: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), ''), '', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'an empty filename: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.tenant('labak')::text || '/' || tests.asset('f810')::text || '//a.jpg', '/a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'an empty segment: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    upper(tests.asset_path(tests.tenant('labak'), tests.asset('f810'), 'a.jpg')), 'A.JPG', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'ids not in canonical lowercase form: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.tenant('labak')::text || '/a.jpg', 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'forbidden', 'a path without the asset id: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'), null, 'a.jpg', 'image/jpeg', 1, 1, 1,
    repeat('a', 64)) $$, 'P0001', 'forbidden', 'no path: forbidden');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), 'a.heic'), 'a.heic', 'image/heic', 1, 1, 1, repeat('a', 64)) $$,
  '23514', null, 'an unsupported MIME type: 23514 (review focus 4)');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), 'a.jpg'), 'a.jpg', 'image/jpeg', 20971521, 1, 1, repeat('a', 64)) $$,
  '23514', null, 'over 20 MB: 23514');
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('demo'),
    tests.asset_path(tests.tenant('demo'), tests.asset('f810'), 'a.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'not_found', 'register_asset in another tenant: not_found');
-- Decision 30: an asset id already in use keeps its 23505 (accepted limitation).
select throws_ok($$ select api.register_asset(tests.asset('f803'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f803'), 'a.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  '23505', null, 'an asset id already in use: 23505 (decision 30)');
select tests.act_as(tests.persona('outsider'));
select throws_ok($$ select api.register_asset(tests.asset('f810'), tests.tenant('labak'),
    tests.asset_path(tests.tenant('labak'), tests.asset('f810'), 'a.jpg'), 'a.jpg', 'image/jpeg', 1, 1, 1, repeat('a', 64)) $$,
  'P0001', 'not_found', 'a user without membership: not_found');
select tests.act_as_owner();
select is_empty($$ select 1 from cms.assets where id = tests.asset('f810') $$, 'refused registrations wrote no row');

-- ---------------------------------------------------------------------------
-- update_asset (§4.6).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select api.update_asset(tests.asset('f805'), 0.5, 0.25, 'Brauð') $$, 'update_asset');
select results_eq($$ select focal_x, focal_y, default_alt from cms.assets where id = tests.asset('f805') $$,
  $$ values (0.5::real, 0.25::real, 'Brauð'::text) $$, 'focal point and default alt stored');
select throws_ok($$ select api.update_asset(tests.asset('f805'), 2, 0.5, null) $$, '23514', null,
  'a focal point outside 0..1: 23514');
select throws_ok($$ select api.update_asset(tests.asset('f803'), 0.5, 0.5, 'x') $$, 'P0001', 'not_found',
  'update_asset on another tenant''s asset: not_found');
select throws_ok($$ select api.update_asset(gen_random_uuid(), 0.5, 0.5, 'x') $$, 'P0001', 'not_found',
  'update_asset on an asset that does not exist: not_found');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.update_asset(tests.asset('f805'), 0, 0, 'x') $$, 'P0001', 'not_found',
  'the demo editor''s update_asset on a labak asset: not_found');
select tests.act_as_owner();
select results_eq($$ select focal_x, focal_y, default_alt from cms.assets where id = tests.asset('f805') $$,
  $$ values (0.5::real, 0.25::real, 'Brauð'::text) $$, 'refused calls changed nothing');
select results_eq($$ select focal_x, focal_y, default_alt from cms.assets where id = tests.asset('f803') $$,
  $$ values (null::real, null::real, null::text) $$, 'the demo asset is unchanged');

-- ---------------------------------------------------------------------------
-- archive_asset (§4.6, §5.6): refused while a currently published revision
-- references the asset.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.archive_asset(tests.asset('f801')) $$, 'P0001', 'published_reference',
  'archive_asset on an asset a published revision references: published_reference');
select lives_ok($$ select api.archive_asset(tests.asset('f804')) $$,
  'archive_asset on an asset only an unpublished revision references');
select lives_ok($$ select api.archive_asset(tests.asset('f802')) $$,
  'archive_asset on an asset only a draft references');
select throws_ok($$ select api.archive_asset(tests.asset('f803')) $$, 'P0001', 'not_found',
  'archive_asset on another tenant''s asset: not_found');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.archive_asset(tests.asset('f805')) $$, 'P0001', 'not_found',
  'the demo editor''s archive_asset on a labak asset: not_found');
select tests.act_as_owner();
select results_eq($$ select id from cms.assets where archived_at = now() order by id $$,
  $$ values (tests.asset('f802')), (tests.asset('f804')), (tests.asset('f806')) $$,
  'f802 and f804 archived (f806 was already); f801 and the demo asset are not');
-- The asset row is locked FOR UPDATE before the check (serialising with the
-- worker's FOR SHARE locks, §6.2; the concurrent case is in Task 12). Calling
-- it on the already archived f806 takes the lock without updating: the row's
-- xmax becomes the id of this transaction or, when the test runner wraps each
-- statement in a savepoint, of one of its subtransactions, whose ids are
-- assigned after the top-level one. The comparison is modulo 2^32 (xmax is a
-- 32-bit xid, pg_current_xact_id an epoch-extended one) and assumes no xid
-- wraparound between this transaction's start and the call, which holds on the
-- short-lived local stack. The function-text regex below is only a backstop
-- for this behavioural check.
select is((select xmax::text from cms.assets where id = tests.asset('f806')), '0',
  'f806 is not locked before the call');
select tests.act_as(tests.persona('editor_labak'));
select api.archive_asset(tests.asset('f806'));
select tests.act_as_owner();
select ok((select xmax::text::bigint from cms.assets where id = tests.asset('f806'))
          >= pg_catalog.pg_current_xact_id()::text::bigint % 4294967296,
  'archive_asset locks the asset row even when it changes nothing (xmax set by this transaction)');
select ok((select pg_catalog.pg_get_functiondef('api.archive_asset(uuid)'::regprocedure)
           ~ 'from cms\.assets a\s+where a\.id = p_asset_id\s+for update;'),
  'archive_asset selects the asset row FOR UPDATE');

-- ---------------------------------------------------------------------------
-- request_publish and request_unpublish (§6.1).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select set_config('tests.request', api.request_publish(tests.entry('c801'), 3)::text, true) $$,
  'request_publish at the current draft version');
select results_eq($$ select tenant_id, entry_id, action, draft_version, requested_by, status from cms.publish_requests
     where id = current_setting('tests.request')::uuid $$,
  $$ values (tests.tenant('labak'), tests.entry('c801'), 'publish'::text, 3, tests.persona('editor_labak'), 'pending'::text) $$,
  'the request: labak, publish, the expected version, by the editor, pending');
select results_eq($$ select request_id, status, release_number from api.publication_status where entry_id = tests.entry('c801') $$,
  $$ values (current_setting('tests.request')::uuid, 'pending'::text, null::int) $$,
  'publication_status shows the new request as the entry''s latest');
-- Review focus 3: the draft moved on after the editor last saw it.
select throws_ok($$ select api.request_publish(tests.entry('c801'), 2) $$, 'P0001', 'version_conflict',
  'request_publish with a stale version: version_conflict');
select throws_ok($$ select api.request_publish(tests.entry('c801'), 4) $$, 'P0001', 'version_conflict',
  'request_publish with a version the draft has not reached: version_conflict');
select throws_ok($$ select api.request_publish(tests.entry('c802'), 1) $$, 'P0001', 'not_found',
  'request_publish on another tenant''s entry: not_found');
select throws_ok($$ select api.request_publish(tests.entry('c801'), null) $$, 'P0001', 'version_conflict',
  'request_publish with a null expected version: version_conflict');
select lives_ok($$ select set_config('tests.unpublish', api.request_unpublish(tests.entry('c803'))::text, true) $$,
  'request_unpublish');
select results_eq($$ select tenant_id, entry_id, action, draft_version, requested_by, status from cms.publish_requests
     where id = current_setting('tests.unpublish')::uuid $$,
  $$ values (tests.tenant('labak'), tests.entry('c803'), 'unpublish'::text, null::int, tests.persona('editor_labak'),
             'pending'::text) $$,
  'the unpublish request: no draft version, by the editor, pending');
select throws_ok($$ select api.request_unpublish(tests.entry('c802')) $$, 'P0001', 'not_found',
  'request_unpublish on another tenant''s entry: not_found');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.request_publish(tests.entry('c801'), 3) $$, 'P0001', 'not_found',
  'the demo editor''s request_publish on a labak entry: not_found');
select throws_ok($$ select api.request_unpublish(tests.entry('c803')) $$, 'P0001', 'not_found',
  'the demo editor''s request_unpublish on a labak entry: not_found');
select tests.act_as(tests.persona('revoked'));
select throws_ok($$ select api.request_publish(tests.entry('c801'), 3) $$, 'P0001', 'not_found',
  'a revoked member''s request_publish: not_found');
select tests.act_as_owner();
select results_eq($$ select action, count(*)::int from cms.publish_requests where tenant_id = tests.tenant('labak')
     and requested_at = now() group by action order by action $$,
  $$ values ('publish'::text, 1), ('unpublish', 1) $$, 'refused calls inserted no request');
select results_eq($$ select action, target_id from cms.audit_log
     where target_id in (current_setting('tests.request')::uuid, current_setting('tests.unpublish')::uuid) order by id $$,
  $$ values ('publish_request.created'::text, current_setting('tests.request')::uuid),
            ('publish_request.created', current_setting('tests.unpublish')::uuid) $$,
  'each request is audited once');

-- A suspended tenant (§6.2 step 4): tenant_inactive, before the version check.
update cms.tenants set status = 'suspended' where id = tests.tenant('demo');
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select status from api.my_tenants $$, $$ values ('suspended'::text) $$,
  'my_tenants shows the suspension');
select throws_ok($$ select api.request_publish(tests.entry('c802'), 1) $$, 'P0001', 'tenant_inactive',
  'request_publish in a suspended tenant: tenant_inactive');
select throws_ok($$ select api.request_publish(tests.entry('c802'), 9) $$, 'P0001', 'tenant_inactive',
  'request_publish in a suspended tenant with a stale version: tenant_inactive');
select tests.act_as_owner();
select is((select count(*)::int from cms.publish_requests where tenant_id = tests.tenant('demo')), 1,
  'no request was inserted for the suspended tenant');

-- Fail closed (Task 10 quality r1, Minor 4): an active tenant whose row the
-- caller cannot see counts as inactive. A restrictive policy, dropped again
-- below, hides every tenant row from authenticated.
update cms.tenants set status = 'active' where id = tests.tenant('demo');
create policy zz_hide_tenants on cms.tenants as restrictive for select to authenticated using (false);
select tests.act_as(tests.persona('editor_demo'));
select is_empty($$ select 1 from cms.tenants $$, 'precondition: the tenant rows are hidden from the editor');
select throws_ok($$ select api.request_publish(tests.entry('c802'), 1) $$, 'P0001', 'tenant_inactive',
  'request_publish when the active tenant row is invisible: tenant_inactive');
select tests.act_as_owner();
drop policy zz_hide_tenants on cms.tenants;

select * from finish();
rollback;
