-- supabase/tests/database/060_publishing.test.sql
-- Publish requests, releases, sites, site deliveries (spec §4.1 rule 3, §4.3,
-- §4.5, §6.3, §7.1, §8.2; plan Task 9, decision 11).
--
-- Personas and tenants come from tests.seed() (_helpers.sql): editor_labak and
-- editor_demo are members of labak and demo; outsider, revoked and
-- platform_admin are members of nothing; platform_admin is in
-- cms.platform_admins.
--
-- Fixture rows (inserted below in owner context; tests.pub('e301') gives
-- 00000000-0000-4000-8000-00000000e301, also inside pgTAP's $$ strings):
--   entry    c301  labak  news  draft {}, revision d301
--   entry    c302  demo   news  draft {}, revision d302
--   request  e302  demo   publish c302 v1, requested by editor_demo
--   release  e321  labak  number 1  delivered
--   release  e322  demo   number 1  delivered
--   site     e341  labak  webhook secret ref e3f1
--   site     e342  demo   webhook secret ref e3f2
--   delivery (e321, e341) labak; (e322, e342) demo
--
-- Later assertions depend on earlier mutations, in this order: editor_labak
-- inserts a publish request for c301 naming outsider as requester (renamed
-- e301 by the owner) and an unpublish request for c301 with no requester; service_role claims and commits e301,
-- inserts release e323 (labak, number 2, building), records a delivery
-- (e323, e341) and inserts site e343 (labak).
begin;
\ir _helpers.sql
select plan(189);

-- Request, release, site and secret-reference UUIDs: 'e' followed by three hex
-- digits, like tests.entry().
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
-- Tables, keys and constraints (§4.3; plan Task 9 Interfaces).
select has_table('cms', 'publish_requests', 'cms.publish_requests exists');
select has_table('cms', 'releases', 'cms.releases exists');
select has_table('cms', 'sites', 'cms.sites exists');
select has_table('cms', 'site_deliveries', 'cms.site_deliveries exists');

select columns_are('cms', 'publish_requests', array['id', 'tenant_id', 'entry_id', 'action', 'draft_version',
    'requested_by', 'requested_at', 'status', 'claimed_at', 'attempts', 'error', 'revision_id', 'release_id'],
  'publish_requests columns');
select columns_are('cms', 'releases', array['id', 'tenant_id', 'number', 'status', 'bundle_path', 'created_at',
    'delivered_at', 'error'],
  'releases columns');
select columns_are('cms', 'sites', array['id', 'tenant_id', 'base_url', 'revalidate_url', 'preview_url',
    'webhook_secret_ref', 'preview_secret_ref', 'active'],
  'sites columns');
select columns_are('cms', 'site_deliveries', array['release_id', 'site_id', 'tenant_id', 'notify_status',
    'notify_attempts', 'notified_at', 'live_status', 'live_confirmed_at', 'last_error'],
  'site_deliveries columns');

select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.publish_requests'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull $$,
  array['id', 'tenant_id', 'entry_id', 'action', 'requested_by', 'requested_at', 'status', 'attempts'],
  'publish_requests not-null columns');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.releases'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull $$,
  array['id', 'tenant_id', 'number', 'status', 'created_at'],
  'releases not-null columns');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.sites'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull $$,
  array['id', 'tenant_id', 'base_url', 'revalidate_url', 'webhook_secret_ref', 'active'],
  'sites not-null columns');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.site_deliveries'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull $$,
  array['release_id', 'site_id', 'tenant_id', 'notify_status', 'notify_attempts', 'live_status'],
  'site_deliveries not-null columns');

select col_is_pk('cms', 'publish_requests', array['id'], 'publish_requests key is id');
select col_is_pk('cms', 'releases', array['id'], 'releases key is id');
select col_is_pk('cms', 'sites', array['id'], 'sites key is id');
select col_is_pk('cms', 'site_deliveries', array['release_id', 'site_id'], 'site_deliveries key is (release_id, site_id)');
select col_is_unique('cms', 'releases', array['tenant_id', 'number'], 'release number is unique per tenant');
select col_is_unique('cms', 'releases', array['tenant_id', 'id'], 'releases has unique (tenant_id, id), a composite FK target');
select col_is_unique('cms', 'sites', array['tenant_id', 'id'], 'sites has unique (tenant_id, id), a composite FK target');

select col_default_is('cms', 'publish_requests', 'requested_by', 'auth.uid()', 'publish_requests.requested_by defaults to auth.uid()');
select col_default_is('cms', 'publish_requests', 'status', 'pending'::text, 'publish_requests.status defaults to pending');
select col_default_is('cms', 'publish_requests', 'attempts', 0, 'publish_requests.attempts defaults to 0');
select col_default_is('cms', 'publish_requests', 'requested_at', 'now()', 'publish_requests.requested_at defaults to now()');
select col_default_is('cms', 'sites', 'active', true, 'sites.active defaults to true');
select col_default_is('cms', 'site_deliveries', 'notify_status', 'pending'::text, 'site_deliveries.notify_status defaults to pending');
select col_default_is('cms', 'site_deliveries', 'live_status', 'pending'::text, 'site_deliveries.live_status defaults to pending');
select col_default_is('cms', 'site_deliveries', 'notify_attempts', 0, 'site_deliveries.notify_attempts defaults to 0');

-- Composite tenant foreign keys (§4.1 rule 3). 010_catalog checks every FK
-- between tenant tables generically; these pin the exact keys.
select fk_ok('cms', 'publish_requests', array['tenant_id', 'entry_id'], 'cms', 'entries', array['tenant_id', 'id'],
  'publish_requests (tenant_id, entry_id) references entries (tenant_id, id)');
select fk_ok('cms', 'publish_requests', array['tenant_id', 'entry_id', 'revision_id'],
  'cms', 'revisions', array['tenant_id', 'entry_id', 'id'],
  'publish_requests (tenant_id, entry_id, revision_id) references revisions (tenant_id, entry_id, id)');
select fk_ok('cms', 'publish_requests', array['tenant_id', 'release_id'], 'cms', 'releases', array['tenant_id', 'id'],
  'publish_requests (tenant_id, release_id) references releases (tenant_id, id)');
select fk_ok('cms', 'site_deliveries', array['tenant_id', 'release_id'], 'cms', 'releases', array['tenant_id', 'id'],
  'site_deliveries (tenant_id, release_id) references releases (tenant_id, id)');
select fk_ok('cms', 'site_deliveries', array['tenant_id', 'site_id'], 'cms', 'sites', array['tenant_id', 'id'],
  'site_deliveries (tenant_id, site_id) references sites (tenant_id, id)');
select fk_ok('cms', 'releases', array['tenant_id'], 'cms', 'tenants', array['id'], 'releases.tenant_id references tenants');
select fk_ok('cms', 'sites', array['tenant_id'], 'cms', 'tenants', array['id'], 'sites.tenant_id references tenants');
-- Exactly these foreign keys and no others on the four tables.
select set_eq($$ select c.conrelid::regclass::text, c.confrelid::regclass::text,
       (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality as k(att, ord)
          join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.att)
     from pg_catalog.pg_constraint c
     where c.contype = 'f' and c.conrelid in ('cms.publish_requests'::regclass, 'cms.releases'::regclass,
                                               'cms.sites'::regclass, 'cms.site_deliveries'::regclass) $$,
  $$ values ('cms.publish_requests', 'cms.entries', array['tenant_id', 'entry_id']),
            ('cms.publish_requests', 'cms.revisions', array['tenant_id', 'entry_id', 'revision_id']),
            ('cms.publish_requests', 'cms.releases', array['tenant_id', 'release_id']),
            ('cms.releases', 'cms.tenants', array['tenant_id']),
            ('cms.sites', 'cms.tenants', array['tenant_id']),
            ('cms.site_deliveries', 'cms.releases', array['tenant_id', 'release_id']),
            ('cms.site_deliveries', 'cms.sites', array['tenant_id', 'site_id']) $$,
  'the four tables have exactly the expected foreign keys');

-- Indexes: the worker's claim order, and one building release per tenant.
select has_index('cms', 'publish_requests', 'publish_requests_status_requested_at_idx', array['status', 'requested_at'],
  'publish_requests has an index on (status, requested_at)');
select has_index('cms', 'releases', 'releases_one_building_per_tenant', array['tenant_id'],
  'releases has an index on tenant_id for building releases');
select index_is_unique('cms', 'releases', 'releases_one_building_per_tenant', 'the building-release index is unique');
select is((select pg_catalog.pg_get_expr(i.indpred, i.indrelid) from pg_catalog.pg_index i
           where i.indexrelid = 'cms.releases_one_building_per_tenant'::regclass),
  '(status = ''building''::text)', 'the building-release index is partial: where status = ''building''');

-- RLS enabled on all four.
select ok((select bool_and(c.relrowsecurity) from pg_catalog.pg_class c
           where c.oid in ('cms.publish_requests'::regclass, 'cms.releases'::regclass,
                           'cms.sites'::regclass, 'cms.site_deliveries'::regclass)),
  'RLS enabled on publish_requests, releases, sites, site_deliveries');

-- ---------------------------------------------------------------------------
-- Grants exactly as §4.5 (authenticated) and Task 11's needs (service_role).
select table_privs_are('cms', 'publish_requests', 'authenticated', array['SELECT'],
  'authenticated: table-level select only on publish_requests');
select table_privs_are('cms', 'releases', 'authenticated', array['SELECT'], 'authenticated: select only on releases');
select table_privs_are('cms', 'site_deliveries', 'authenticated', array['SELECT'], 'authenticated: select only on site_deliveries');
select table_privs_are('cms', 'sites', 'authenticated', array[]::text[],
  'authenticated: no table-level privilege on sites (column select only)');
select set_eq($$ select * from tests.column_privs('authenticated', 'cms.publish_requests') $$,
  $$ values ('tenant_id', 'INSERT'), ('entry_id', 'INSERT'), ('action', 'INSERT'), ('draft_version', 'INSERT'),
            ('requested_by', 'INSERT') $$,
  'authenticated: insert (tenant_id, entry_id, action, draft_version, requested_by) on publish_requests, nothing else');
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.releases') $$,
  'authenticated: no column insert/update on releases');
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.sites') $$,
  'authenticated: no column insert/update on sites');
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.site_deliveries') $$,
  'authenticated: no column insert/update on site_deliveries');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.sites'::regclass and a.attnum > 0 and not a.attisdropped
       and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT') $$,
  array['id', 'tenant_id', 'base_url', 'preview_url', 'active'],
  'authenticated: select (id, tenant_id, base_url, preview_url, active) on sites exactly');
select ok(not has_column_privilege('authenticated', 'cms.sites', 'webhook_secret_ref', 'select'),
  'authenticated cannot select sites.webhook_secret_ref');
select ok(not has_column_privilege('authenticated', 'cms.sites', 'preview_secret_ref', 'select'),
  'authenticated cannot select sites.preview_secret_ref');

select table_privs_are('cms', 'publish_requests', 'service_role', array['SELECT'],
  'service_role: table-level select only on publish_requests');
select table_privs_are('cms', 'releases', 'service_role', array['SELECT', 'INSERT'],
  'service_role: select, insert on releases');
select table_privs_are('cms', 'sites', 'service_role', array['SELECT', 'INSERT'],
  'service_role: select, insert on sites');
select table_privs_are('cms', 'site_deliveries', 'service_role', array['SELECT', 'INSERT'],
  'service_role: select, insert on site_deliveries');
-- column_privs reports INSERT for every column where insert is table-level.
select set_eq($$ select * from tests.column_privs('service_role', 'cms.publish_requests') $$,
  $$ values ('status', 'UPDATE'), ('claimed_at', 'UPDATE'), ('attempts', 'UPDATE'), ('error', 'UPDATE'),
            ('revision_id', 'UPDATE'), ('release_id', 'UPDATE') $$,
  'service_role: update the worker-owned columns of publish_requests only');
select set_eq($$ select * from tests.column_privs('service_role', 'cms.releases') where priv <> 'INSERT' $$,
  $$ values ('status', 'UPDATE'), ('bundle_path', 'UPDATE'), ('delivered_at', 'UPDATE'), ('error', 'UPDATE') $$,
  'service_role: update (status, bundle_path, delivered_at, error) on releases only');
select is_empty($$ select * from tests.column_privs('service_role', 'cms.sites') where priv <> 'INSERT' $$,
  'service_role: no update on sites');
select set_eq($$ select * from tests.column_privs('service_role', 'cms.site_deliveries') where priv <> 'INSERT' $$,
  $$ values ('notify_status', 'UPDATE'), ('notify_attempts', 'UPDATE'), ('notified_at', 'UPDATE'),
            ('live_status', 'UPDATE'), ('live_confirmed_at', 'UPDATE'), ('last_error', 'UPDATE') $$,
  'service_role: update the status columns of site_deliveries only');

select table_privs_are('cms', 'publish_requests', 'anon', array[]::text[], 'anon: nothing on publish_requests');
select table_privs_are('cms', 'releases', 'anon', array[]::text[], 'anon: nothing on releases');
select table_privs_are('cms', 'sites', 'anon', array[]::text[], 'anon: nothing on sites');
select table_privs_are('cms', 'site_deliveries', 'anon', array[]::text[], 'anon: nothing on site_deliveries');
select ok(not exists (select 1 from pg_catalog.pg_attribute a
           where a.attrelid in ('cms.publish_requests'::regclass, 'cms.releases'::regclass,
                                'cms.sites'::regclass, 'cms.site_deliveries'::regclass)
             and a.attnum > 0 and not a.attisdropped
             and has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT, INSERT, UPDATE, REFERENCES')),
  'anon: no column privilege on the four tables');

-- ---------------------------------------------------------------------------
-- Policies (§4.5): tenant policies for each command granted to authenticated,
-- plus a SELECT-only console policy for platform admins.
select policies_are('cms', 'publish_requests',
  array['publish_requests_select_member', 'publish_requests_insert_member', 'publish_requests_select_console'],
  'publish_requests policies: member select and insert, console select');
select policies_are('cms', 'releases', array['releases_select_member', 'releases_select_console'],
  'releases policies: member select, console select');
select policies_are('cms', 'sites', array['sites_select_member', 'sites_select_console'],
  'sites policies: member select, console select');
select policies_are('cms', 'site_deliveries', array['site_deliveries_select_member', 'site_deliveries_select_console'],
  'site_deliveries policies: member select, console select');
select results_eq($$ select tablename::text collate "default", policyname::text collate "default", cmd collate "default", roles::text[] collate "default" from pg_catalog.pg_policies
     where schemaname = 'cms' and tablename in ('publish_requests', 'releases', 'sites', 'site_deliveries')
     order by 1, 2 $$,
  $$ values ('publish_requests', 'publish_requests_insert_member', 'INSERT', array['authenticated']),
            ('publish_requests', 'publish_requests_select_console', 'SELECT', array['authenticated']),
            ('publish_requests', 'publish_requests_select_member', 'SELECT', array['authenticated']),
            ('releases', 'releases_select_console', 'SELECT', array['authenticated']),
            ('releases', 'releases_select_member', 'SELECT', array['authenticated']),
            ('site_deliveries', 'site_deliveries_select_console', 'SELECT', array['authenticated']),
            ('site_deliveries', 'site_deliveries_select_member', 'SELECT', array['authenticated']),
            ('sites', 'sites_select_console', 'SELECT', array['authenticated']),
            ('sites', 'sites_select_member', 'SELECT', array['authenticated']) $$,
  'every policy on the four tables: command and role (authenticated only)');
-- Every console policy carries the same predicate as tenants_select_console.
select is_empty($$ select p.tablename from pg_catalog.pg_policies p
     where p.schemaname = 'cms' and p.policyname like '%\_select\_console'
       and p.qual is distinct from (select t.qual from pg_catalog.pg_policies t
                                    where t.schemaname = 'cms' and t.policyname = 'tenants_select_console') $$,
  'every console policy has exactly tenants_select_console''s predicate (platform_admins and aal2)');
-- No platform-admin clause gives write access, and none is on a content table.
select is_empty($$ select tablename, policyname from pg_catalog.pg_policies
     where schemaname = 'cms'
       and (coalesce(qual, '') like '%platform_admins%' or coalesce(with_check, '') like '%platform_admins%')
       and cmd <> 'SELECT' $$,
  'no platform-admin policy grants anything but select');
select is_empty($$ select tablename, policyname from pg_catalog.pg_policies
     where schemaname = 'cms'
       and tablename in ('memberships', 'entries', 'drafts', 'revisions', 'draft_refs', 'revision_refs', 'assets')
       and (coalesce(qual, '') like '%platform_admins%' or coalesce(with_check, '') like '%platform_admins%') $$,
  'no platform-admin clause on content tables or memberships');

select triggers_are('cms', 'publish_requests', array['publish_requests_force_actor', 'publish_requests_check_actor'],
  'publish_requests triggers: force_actor and check_actor on requested_by (decision 11)');

-- ---------------------------------------------------------------------------
-- Fixtures (owner context: auth.uid() is null, so requested_by keeps the given value).
select tests.seed();
insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('c301'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c302'), tests.tenant('demo'), 'news', tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c301'), tests.tenant('labak'), 1, '{}', tests.persona('editor_labak')),
  (tests.entry('c302'), tests.tenant('demo'), 1, '{}', tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by) values
  (tests.revision('d301'), tests.tenant('labak'), tests.entry('c301'), 1, 1, '{}', tests.persona('editor_labak')),
  (tests.revision('d302'), tests.tenant('demo'), tests.entry('c302'), 1, 1, '{}', tests.persona('editor_demo'));
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by) values
  (tests.pub('e302'), tests.tenant('demo'), tests.entry('c302'), 'publish', 1, tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status) values
  (tests.pub('e321'), tests.tenant('labak'), 1, 'delivered'),
  (tests.pub('e322'), tests.tenant('demo'), 1, 'delivered');
insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref) values
  (tests.pub('e341'), tests.tenant('labak'), 'http://localhost:3100', 'http://localhost:3100/api/cms/revalidate', tests.pub('e3f1')),
  (tests.pub('e342'), tests.tenant('demo'), 'http://localhost:3101', 'http://localhost:3101/api/cms/revalidate', tests.pub('e3f2'));
insert into cms.site_deliveries (release_id, site_id, tenant_id) values
  (tests.pub('e321'), tests.pub('e341'), tests.tenant('labak')),
  (tests.pub('e322'), tests.pub('e342'), tests.tenant('demo'));

select is((select requested_by from cms.publish_requests where id = tests.pub('e302')), tests.persona('editor_demo'),
  'owner context keeps the given requested_by (auth.uid() is null)');
select results_eq($$ select notify_status, notify_attempts, live_status from cms.site_deliveries
     where release_id = tests.pub('e321') $$,
  $$ values ('pending'::text, 0, 'pending'::text) $$, 'a new delivery is pending with no attempts');

-- ---------------------------------------------------------------------------
-- The editor requests publication (§6.1; Task 10's request_publish inserts this row).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, tests.persona('outsider')) $$,
  'editor inserts a publish request for its own entry (naming another user as requester)');
-- The editor cannot choose the id (no insert grant on it, tested below); the
-- owner renames the new row to e301 so later assertions can name it.
select tests.act_as_owner();
update cms.publish_requests set id = tests.pub('e301') where entry_id = tests.entry('c301') and action = 'publish';
select tests.act_as(tests.persona('editor_labak'));
-- Actor columns cannot be spoofed (decision 11).
select is((select requested_by from cms.publish_requests where id = tests.pub('e301')), tests.persona('editor_labak'),
  'publish_requests.requested_by forced to auth.uid(): outsider''s ID is replaced by editor_labak''s');
select results_eq($$ select status, attempts, claimed_at, error, revision_id, release_id, requested_at
     from cms.publish_requests where id = tests.pub('e301') $$,
  $$ values ('pending'::text, 0, null::timestamptz, null::jsonb, null::uuid, null::uuid, now()) $$,
  'a new request is pending, unclaimed, with no error, revision or release, requested now');
-- id is not in the insert grant: the editor cannot choose it either. The
-- default fills it, and requested_by defaults to the editor.
select throws_ok($$ insert into cms.publish_requests (id, tenant_id, entry_id, action)
  values (gen_random_uuid(), tests.tenant('labak'), tests.entry('c301'), 'unpublish') $$,
  '42501', null, 'editor cannot choose the request id');
select lives_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action)
  values (tests.tenant('labak'), tests.entry('c301'), 'unpublish') $$,
  'editor inserts an unpublish request without draft_version or requester');
select is((select requested_by from cms.publish_requests where entry_id = tests.entry('c301') and action = 'unpublish'),
  tests.persona('editor_labak'), 'requested_by defaults to the editor');

-- Worker-owned columns (§4.5): status, claim, error, revision, release, time.
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, status)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, 'committed') $$,
  '42501', null, 'editor cannot set status on insert (42501)');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, revision_id)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, tests.revision('d301')) $$,
  '42501', null, 'editor cannot set revision_id on insert');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, release_id)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, tests.pub('e321')) $$,
  '42501', null, 'editor cannot set release_id on insert');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, claimed_at, attempts)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, now(), 5) $$,
  '42501', null, 'editor cannot set claimed_at or attempts on insert');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, error)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, '{}') $$,
  '42501', null, 'editor cannot set error on insert');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_at)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, now() - interval '1 day') $$,
  '42501', null, 'editor cannot set requested_at on insert');
select throws_ok($$ update cms.publish_requests set status = 'committed' where id = tests.pub('e301') $$,
  '42501', null, 'editor cannot update status (only the worker updates, §4.3)');
select throws_ok($$ update cms.publish_requests set draft_version = 2 where id = tests.pub('e301') $$,
  '42501', null, 'editor cannot update any request column');
select throws_ok($$ delete from cms.publish_requests where id = tests.pub('e301') $$,
  '42501', null, 'editor cannot delete a request');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'delete', 1) $$,
  '23514', null, 'action must be publish or unpublish');
-- Isolation on insert: another tenant's row is refused by RLS; another
-- tenant's entry under the editor's own tenant id is refused by the composite key.
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('demo'), tests.entry('c302'), 'publish', 1) $$,
  '42501', null, 'editor cannot request publication in another tenant');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c302'), 'publish', 1) $$,
  '23503', null, 'editor cannot request publication of another tenant''s entry under its own tenant (composite FK)');

-- check_actor (decision 11): a BEFORE trigger whose name sorts after
-- publish_requests_force_actor cannot spoof requested_by.
select tests.act_as_owner();
create trigger zz_probe_spoof_actor before insert on cms.publish_requests
  for each row execute function tests.probe_set_column('requested_by', '00000000-0000-4000-8000-00000000b003');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1) $$,
  '23514', 'publish_requests.requested_by must equal auth.uid()',
  'a later BEFORE trigger cannot spoof publish_requests.requested_by');
select tests.act_as_owner();
drop trigger zz_probe_spoof_actor on cms.publish_requests;

-- ---------------------------------------------------------------------------
-- Editor reads: own tenant's operational data (§4.5).
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select action from cms.publish_requests order by action $$,
  $$ values ('publish'::text), ('unpublish') $$, 'labak editor sees exactly the labak requests');
select results_eq($$ select id from cms.releases $$, $$ values (tests.pub('e321')) $$,
  'labak editor sees exactly the labak release');
select results_eq($$ select id, tenant_id, base_url, preview_url, active from cms.sites $$,
  $$ values (tests.pub('e341'), tests.tenant('labak'), 'http://localhost:3100'::text, null::text, true) $$,
  'labak editor reads the non-secret columns of the labak site only');
select results_eq($$ select release_id, site_id from cms.site_deliveries $$,
  $$ values (tests.pub('e321'), tests.pub('e341')) $$, 'labak editor sees exactly the labak delivery');
select throws_ok($$ select webhook_secret_ref from cms.sites $$, '42501', null,
  'editor cannot select sites.webhook_secret_ref (42501)');
select throws_ok($$ select preview_secret_ref from cms.sites $$, '42501', null,
  'editor cannot select sites.preview_secret_ref');
select throws_ok($$ select revalidate_url from cms.sites $$, '42501', null,
  'editor cannot select sites.revalidate_url (not in the §4.5 column list)');
select throws_ok($$ select * from cms.sites $$, '42501', null, 'editor cannot select * from sites');
select throws_ok($$ select 1 from cms.sites where webhook_secret_ref is not null $$, '42501', null,
  'editor cannot filter on webhook_secret_ref either');
-- No writes on releases, sites, site_deliveries.
select throws_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 9, 'building') $$,
  '42501', null, 'editor cannot insert a release');
select throws_ok($$ update cms.releases set status = 'failed' $$, '42501', null, 'editor cannot update a release');
select throws_ok($$ delete from cms.releases $$, '42501', null, 'editor cannot delete a release');
select throws_ok($$ insert into cms.sites (tenant_id, base_url, revalidate_url, webhook_secret_ref)
  values (tests.tenant('labak'), 'http://x', 'http://x/r', gen_random_uuid()) $$,
  '42501', null, 'editor cannot insert a site');
select throws_ok($$ update cms.sites set active = false $$, '42501', null, 'editor cannot update a site');
select throws_ok($$ delete from cms.sites $$, '42501', null, 'editor cannot delete a site');
select throws_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id)
  values (tests.pub('e321'), tests.pub('e341'), tests.tenant('labak')) $$,
  '42501', null, 'editor cannot insert a delivery');
select throws_ok($$ update cms.site_deliveries set live_status = 'ok' $$, '42501', null, 'editor cannot update a delivery');
select throws_ok($$ delete from cms.site_deliveries $$, '42501', null, 'editor cannot delete a delivery');

-- The demo editor sees no labak requests, releases, sites or deliveries.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select id from cms.publish_requests $$, $$ values (tests.pub('e302')) $$,
  'demo editor sees only the demo request, no labak request');
select results_eq($$ select id from cms.releases $$, $$ values (tests.pub('e322')) $$,
  'demo editor sees only the demo release, no labak release');
select results_eq($$ select id from cms.sites $$, $$ values (tests.pub('e342')) $$,
  'demo editor sees only the demo site');
select results_eq($$ select release_id from cms.site_deliveries $$, $$ values (tests.pub('e322')) $$,
  'demo editor sees only the demo delivery');
select is_empty($$ select 1 from cms.publish_requests where tenant_id = tests.tenant('labak') $$,
  'demo editor: no labak request, even when asked for by tenant');
select is_empty($$ select 1 from cms.releases where tenant_id = tests.tenant('labak') $$,
  'demo editor: no labak release, even when asked for by tenant');

-- Outsider and revoked member: nothing.
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from cms.publish_requests $$, 'user without membership sees no request');
select is_empty($$ select 1 from cms.releases $$, 'user without membership sees no release');
select is_empty($$ select 1 from cms.sites $$, 'user without membership sees no site');
select is_empty($$ select 1 from cms.site_deliveries $$, 'user without membership sees no delivery');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1) $$,
  '42501', null, 'user without membership cannot request publication');
select tests.act_as(tests.persona('revoked'));
select is_empty($$ select 1 from cms.publish_requests $$, 'revoked member sees no request');
select is_empty($$ select 1 from cms.releases $$, 'revoked member sees no release');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1) $$,
  '42501', null, 'revoked member cannot request publication (membership checked per request)');

-- ---------------------------------------------------------------------------
-- Console reads (§4.5): platform admins at aal2 read every tenant's rows,
-- select only; at aal1 nothing.
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select is_empty($$ select 1 from cms.publish_requests $$, 'platform admin at aal1 sees no request');
select is_empty($$ select 1 from cms.releases $$, 'platform admin at aal1 sees no release');
select is_empty($$ select 1 from cms.sites $$, 'platform admin at aal1 sees no site');
select is_empty($$ select 1 from cms.site_deliveries $$, 'platform admin at aal1 sees no delivery');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is((select count(*)::int from cms.publish_requests), 3, 'platform admin at aal2 sees every request');
select results_eq($$ select id from cms.releases order by id $$,
  $$ values (tests.pub('e321')), (tests.pub('e322')) $$, 'platform admin at aal2 sees every tenant''s release');
select results_eq($$ select id, base_url from cms.sites order by id $$,
  $$ values (tests.pub('e341'), 'http://localhost:3100'::text), (tests.pub('e342'), 'http://localhost:3101') $$,
  'platform admin at aal2 reads every site''s non-secret columns');
select is((select count(*)::int from cms.site_deliveries), 2, 'platform admin at aal2 sees every delivery');
select throws_ok($$ select webhook_secret_ref from cms.sites $$, '42501', null,
  'platform admin at aal2 cannot read webhook_secret_ref (column grant)');
select throws_ok($$ select preview_secret_ref from cms.sites $$, '42501', null,
  'platform admin at aal2 cannot read preview_secret_ref');
-- No write through the console clause.
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1) $$,
  '42501', null, 'platform admin at aal2 cannot insert a request (no membership)');
select throws_ok($$ update cms.publish_requests set status = 'failed' $$, '42501', null,
  'platform admin at aal2 cannot update a request');
select throws_ok($$ update cms.releases set status = 'failed' $$, '42501', null,
  'platform admin at aal2 cannot update a release');
select throws_ok($$ delete from cms.site_deliveries $$, '42501', null,
  'platform admin at aal2 cannot delete a delivery');
-- aal2 alone (any user can enrol TOTP) grants no extra rows.
select tests.act_as(tests.persona('editor_labak'), 'aal2');
select results_eq($$ select id from cms.releases $$, $$ values (tests.pub('e321')) $$,
  'editor at aal2 still sees only its own tenant''s release');
select is((select count(*)::int from cms.publish_requests where tenant_id = tests.tenant('demo')), 0,
  'editor at aal2 sees no demo request');
select tests.act_as(tests.persona('outsider'), 'aal2');
select is_empty($$ select 1 from cms.sites $$, 'user without membership at aal2 sees no site');
select is_empty($$ select 1 from cms.site_deliveries $$, 'user without membership at aal2 sees no delivery');

-- anon: no privilege at all.
select tests.act_as_anon();
select throws_ok($$ select 1 from cms.publish_requests $$, '42501', null, 'anon cannot read publish_requests');
select throws_ok($$ select 1 from cms.releases $$, '42501', null, 'anon cannot read releases');
select throws_ok($$ select id from cms.sites $$, '42501', null, 'anon cannot read sites');
select throws_ok($$ select 1 from cms.site_deliveries $$, '42501', null, 'anon cannot read site_deliveries');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1) $$,
  '42501', null, 'anon cannot insert a request');

-- ---------------------------------------------------------------------------
-- The worker (service_role): what Task 11's functions need, nothing more.
select tests.act_as_service();
select is((select count(*)::int from cms.publish_requests), 3, 'service_role reads every request');
select lives_ok($$ update cms.publish_requests set status = 'validating', claimed_at = now(), attempts = attempts + 1
  where id = tests.pub('e301') $$, 'service_role claims a request');
select lives_ok($$ update cms.publish_requests set status = 'committed', revision_id = tests.revision('d301'),
  release_id = tests.pub('e321'), error = null where id = tests.pub('e301') $$,
  'service_role commits a request with its revision and release');
select results_eq($$ select status, attempts, revision_id, release_id from cms.publish_requests where id = tests.pub('e301') $$,
  $$ values ('committed'::text, 1, tests.revision('d301'), tests.pub('e321')) $$, 'the worker''s update is stored');
select throws_ok($$ update cms.publish_requests set status = 'done' where id = tests.pub('e301') $$,
  '23514', null, 'status must be one of the §6.3 states');
select throws_ok($$ update cms.publish_requests set revision_id = tests.revision('d302') where id = tests.pub('e301') $$,
  '23503', null, 'a request cannot point at another tenant''s revision');
select throws_ok($$ update cms.publish_requests set release_id = tests.pub('e322') where id = tests.pub('e301') $$,
  '23503', null, 'a request cannot point at another tenant''s release');
select throws_ok($$ update cms.publish_requests set requested_by = tests.persona('editor_demo') where id = tests.pub('e301') $$,
  '42501', null, 'service_role cannot change requested_by');
select throws_ok($$ update cms.publish_requests set tenant_id = tests.tenant('demo') where id = tests.pub('e301') $$,
  '42501', null, 'service_role cannot change a request''s tenant');
select throws_ok($$ update cms.publish_requests set draft_version = 7 where id = tests.pub('e301') $$,
  '42501', null, 'service_role cannot change the requested draft version');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', 1, tests.persona('editor_labak')) $$,
  '42501', null, 'service_role cannot insert requests (editors create them)');
select throws_ok($$ delete from cms.publish_requests $$, '42501', null, 'service_role cannot delete requests');

-- Releases: one building release per tenant (§7.1).
select lives_ok($$ insert into cms.releases (id, tenant_id, number, status)
  values (tests.pub('e323'), tests.tenant('labak'), 2, 'building') $$, 'service_role begins a labak release');
select throws_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 3, 'building') $$,
  '23505', null, 'a second building release for the same tenant is refused (23505)');
select lives_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('demo'), 2, 'building') $$,
  'another tenant may build at the same time');
select throws_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 2, 'failed') $$,
  '23505', null, 'release numbers are unique per tenant');
select throws_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 4, 'queued') $$,
  '23514', null, 'release status must be building, delivered or failed');
select lives_ok($$ update cms.releases set status = 'delivered', bundle_path = 'labak/releases/2.json',
  delivered_at = now(), error = null where id = tests.pub('e323') $$, 'service_role finishes a release');
select lives_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 3, 'building') $$,
  'a new building release is allowed once the previous one finished');
select throws_ok($$ update cms.releases set number = 99 where id = tests.pub('e323') $$,
  '42501', null, 'service_role cannot renumber a release');
select throws_ok($$ update cms.releases set tenant_id = tests.tenant('demo') where id = tests.pub('e323') $$,
  '42501', null, 'service_role cannot move a release to another tenant');
select throws_ok($$ delete from cms.releases $$, '42501', null, 'service_role cannot delete releases');

-- Sites: read every column (Vault lookup by reference); insert; nothing else.
select is((select webhook_secret_ref from cms.sites where id = tests.pub('e341')), tests.pub('e3f1'),
  'service_role reads webhook_secret_ref');
select lives_ok($$ insert into cms.sites (id, tenant_id, base_url, revalidate_url, webhook_secret_ref)
  values (tests.pub('e343'), tests.tenant('labak'), 'http://localhost:3102', 'http://localhost:3102/r', tests.pub('e3f3')) $$,
  'service_role inserts a site');
select throws_ok($$ insert into cms.sites (tenant_id, base_url, revalidate_url) values (tests.tenant('labak'), 'http://x', 'http://x/r') $$,
  '23502', null, 'a site needs a webhook secret reference');
select throws_ok($$ update cms.sites set webhook_secret_ref = gen_random_uuid() where id = tests.pub('e343') $$,
  '42501', null, 'service_role cannot update sites');
select throws_ok($$ delete from cms.sites where id = tests.pub('e343') $$, '42501', null, 'service_role cannot delete sites');

-- Deliveries: insert and update the status columns.
select lives_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id)
  values (tests.pub('e323'), tests.pub('e341'), tests.tenant('labak')) $$, 'service_role records a delivery');
select lives_ok($$ update cms.site_deliveries set notify_status = 'ok', notify_attempts = 1, notified_at = now(),
  live_status = 'ok', live_confirmed_at = now(), last_error = null
  where release_id = tests.pub('e323') and site_id = tests.pub('e341') $$, 'service_role updates a delivery''s status');
select lives_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status)
  values (tests.pub('e323'), tests.pub('e343'), tests.tenant('labak'), 'pending')
  on conflict (release_id, site_id) do update set notify_status = excluded.notify_status $$,
  'service_role upserts a delivery');
select throws_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id)
  values (tests.pub('e323'), tests.pub('e342'), tests.tenant('labak')) $$,
  '23503', null, 'a labak release cannot be delivered to a demo site (composite FK)');
select throws_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id)
  values (tests.pub('e322'), tests.pub('e341'), tests.tenant('labak')) $$,
  '23503', null, 'a delivery''s tenant must be its release''s tenant (a demo release under labak)');
select throws_ok($$ update cms.site_deliveries set site_id = tests.pub('e343') where release_id = tests.pub('e321') $$,
  '42501', null, 'service_role cannot move a delivery to another site');
select throws_ok($$ delete from cms.site_deliveries $$, '42501', null, 'service_role cannot delete deliveries');

-- ---------------------------------------------------------------------------
-- Integrity for every writer (owner context).
select tests.act_as_owner();
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, requested_by)
  values (tests.tenant('labak'), tests.entry('c302'), 'publish', tests.persona('editor_labak')) $$,
  '23503', null, 'even the owner cannot pair a labak request with a demo entry');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, requested_by, revision_id)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish', tests.persona('editor_labak'), tests.revision('d302')) $$,
  '23503', null, 'even the owner cannot point a request at another entry''s revision');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action)
  values (tests.tenant('labak'), tests.entry('c301'), 'publish') $$,
  '23502', null, 'requested_by is not null (no auth.uid() in owner context)');
select throws_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, requested_by)
  values (null, tests.entry('c301'), 'publish', tests.persona('editor_labak')) $$,
  '23502', null, 'publish_requests.tenant_id is not null');
select throws_ok($$ insert into cms.releases (tenant_id, number, status) values (tests.tenant('labak'), 4, 'building') $$,
  '23505', null, 'the one-building rule holds for the owner too');
select throws_ok($$ insert into cms.site_deliveries (release_id, site_id, tenant_id)
  values (tests.pub('e321'), tests.pub('e342'), tests.tenant('labak')) $$,
  '23503', null, 'even the owner cannot deliver a labak release to a demo site');

select * from finish();
rollback;
