-- supabase/tests/database/070_audit.test.sql
-- Audit log (spec §4.3, §4.5, §4.7; plan Task 10, decisions 11 and 12).
--
-- Personas and tenants come from tests.seed() (_helpers.sql): editor_labak and
-- editor_demo are members of labak and demo; outsider, revoked and
-- platform_admin are members of nothing; platform_admin is in
-- cms.platform_admins.
--
-- Fixture rows (inserted below in owner context; tests.asset('f701') and
-- tests.pub('e721') give 00000000-0000-4000-8000-00000000f701 and ...e721):
--   entry    c701  labak  news  slug owner-frett  draft {}, revision d701
--   entry    c702  demo   news                    draft {}
--   release  e721  labak  number 1  building
--
-- Later assertions depend on earlier mutations, in this order: editor_labak
-- writes an audit event directly, creates an entry (slug audit-a, renamed
-- audit-b, then archived), registers, edits and archives asset f701, and
-- requests publication of c701; service_role claims and commits that request,
-- delivers release e721, publishes c701, sets f701's public_path, and adds and
-- removes outsider's membership in demo.
begin;
\ir _helpers.sql
select plan(83);

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
grant execute on function tests.asset(text), tests.pub(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Table (§4.3; plan Task 10 Interfaces).
select has_table('cms', 'audit_log', 'cms.audit_log exists');
select columns_are('cms', 'audit_log',
  array['id', 'tenant_id', 'actor_id', 'action', 'target_type', 'target_id', 'at', 'details'],
  'audit_log columns');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.audit_log'::regclass and a.attnum > 0 and not a.attisdropped and a.attnotnull $$,
  array['id', 'action', 'target_type', 'at'],
  'audit_log not-null columns: tenant_id, actor_id, target_id and details are nullable');
select col_type_is('cms', 'audit_log', 'id', 'bigint', 'audit_log.id is bigint');
select is((select a.attidentity::text from pg_catalog.pg_attribute a
           where a.attrelid = 'cms.audit_log'::regclass and a.attname = 'id'),
  'a', 'audit_log.id is generated always as identity');
select col_is_pk('cms', 'audit_log', array['id'], 'audit_log key is id');
select col_default_is('cms', 'audit_log', 'actor_id', 'auth.uid()', 'audit_log.actor_id defaults to auth.uid()');
select col_default_is('cms', 'audit_log', 'at', 'now()', 'audit_log.at defaults to now()');
select ok((select c.relrowsecurity from pg_catalog.pg_class c where c.oid = 'cms.audit_log'::regclass),
  'RLS enabled on audit_log');

-- Grants (§4.5): authenticated insert (for the triggers) and select (console
-- policy only); service_role insert (the worker's and CLI's writes fire the
-- triggers); never update or delete; anon nothing. INSERT is per column, every
-- column except id, so nobody can name id even with OVERRIDING SYSTEM VALUE.
select table_privs_are('cms', 'audit_log', 'authenticated', array['SELECT'],
  'authenticated: table-level select only on audit_log (insert is per column)');
select table_privs_are('cms', 'audit_log', 'service_role', array[]::text[],
  'service_role: no table-level privilege on audit_log (insert is per column)');
select table_privs_are('cms', 'audit_log', 'anon', array[]::text[], 'anon: nothing on audit_log');
select set_eq($$ select r, c.col, c.priv from (values ('anon'), ('authenticated'), ('service_role')) as v(r)
     cross join lateral tests.column_privs(v.r, 'cms.audit_log') as c $$,
  $$ select r, col, 'INSERT' from (values ('authenticated'), ('service_role')) as v(r)
     cross join unnest(array['tenant_id', 'actor_id', 'action', 'target_type', 'target_id', 'at', 'details']) as col $$,
  'authenticated and service_role insert every audit_log column except id; no update or references; anon nothing');
select is_empty($$ select r from (values ('anon'), ('authenticated'), ('service_role')) as v(r)
     where has_table_privilege(v.r, 'cms.audit_log', 'UPDATE, DELETE, TRUNCATE') $$,
  'audit_log is append-only for anon, authenticated and service_role');

-- Policies (§4.5, §4.7).
select policies_are('cms', 'audit_log', array['audit_log_insert_member', 'audit_log_select_console'],
  'audit_log policies: member insert, console select');
select results_eq($$ select policyname::text collate "default", cmd collate "default", roles::text[] collate "default"
     from pg_catalog.pg_policies where schemaname = 'cms' and tablename = 'audit_log' order by 1 $$,
  $$ values ('audit_log_insert_member', 'INSERT', array['authenticated']),
            ('audit_log_select_console', 'SELECT', array['authenticated']) $$,
  'audit_log policies: commands and role (authenticated only)');
select is((select qual from pg_catalog.pg_policies where schemaname = 'cms' and policyname = 'audit_log_select_console'),
  (select qual from pg_catalog.pg_policies where schemaname = 'cms' and policyname = 'tenants_select_console'),
  'audit_log console policy has exactly tenants_select_console''s predicate (platform_admins and aal2)');

-- Triggers (plan Task 10): the actor trigger on audit_log and the audit
-- triggers. 050 and 060 pin the full trigger lists of assets and publish_requests.
select triggers_are('cms', 'audit_log', array['audit_log_force_actor'], 'audit_log triggers: audit_force_actor');
-- entries_lock_first_published_at is Task 11's (first_published_at is write-once);
-- entries_check_singleton is M2-09's (one live entry per singleton type, 104).
select triggers_are('cms', 'entries', array['entries_force_actor', 'entries_check_actor', 'entries_lock_slug',
    'entries_audit_insert', 'entries_audit_update', 'entries_lock_first_published_at', 'entries_check_singleton'],
  'entries triggers: actor, slug lock, first_published_at lock, audit and singleton check');
select triggers_are('cms', 'releases', array['releases_audit_update', 'releases_schedule_retry'],
  'releases triggers: audit on status change, and the retry schedule on failure (M3-02)');
select triggers_are('cms', 'memberships', array['memberships_audit'], 'memberships triggers: audit on insert and delete');
select triggers_are('cms', 'drafts', array['drafts_bump_version', 'drafts_check_version', 'drafts_force_actor',
    'drafts_check_actor', 'drafts_sync_refs_on_insert', 'drafts_sync_refs_on_update'],
  'drafts have no audit trigger (autosaves are not audited, §4.7)');
select set_eq($$ select t.trigger_name::text, t.event_manipulation::text, t.action_timing::text, t.action_orientation::text,
            t.action_statement::text
     from information_schema.triggers t
     where t.trigger_schema = 'cms' and t.trigger_name::text like '%audit%' $$,
  $$ values ('audit_log_force_actor', 'INSERT', 'BEFORE', 'ROW', 'EXECUTE FUNCTION private.audit_force_actor()'),
            ('entries_audit_insert', 'INSERT', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_entries()'),
            ('entries_audit_update', 'UPDATE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_entries()'),
            ('assets_audit_insert', 'INSERT', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_assets()'),
            ('assets_audit_update', 'UPDATE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_assets()'),
            ('publish_requests_audit_insert', 'INSERT', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_publish_requests()'),
            ('publish_requests_audit_update', 'UPDATE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_publish_requests()'),
            ('releases_audit_update', 'UPDATE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_releases()'),
            ('memberships_audit', 'INSERT', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_memberships()'),
            ('memberships_audit', 'DELETE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_memberships()'),
            ('tenants_audit_update', 'UPDATE', 'AFTER', 'ROW', 'EXECUTE FUNCTION private.audit_tenants()') $$,
  'audit triggers: events, timing and functions');

-- ---------------------------------------------------------------------------
-- System events (decision 12): seed() adds three memberships and removes one in
-- owner context, where auth.uid() is null: no actor, action prefixed system.
select tests.seed();
select results_eq($$ select action, tenant_id, target_type, target_id, actor_id, details, at
     from cms.audit_log where target_type = 'membership' order by id $$,
  $$ values ('system.membership.added'::text, tests.tenant('labak'), 'membership'::text, tests.persona('editor_labak'),
             null::uuid, '{"role": "editor"}'::jsonb, now()),
            ('system.membership.added', tests.tenant('demo'), 'membership', tests.persona('editor_demo'),
             null, '{"role": "editor"}', now()),
            ('system.membership.added', tests.tenant('labak'), 'membership', tests.persona('revoked'),
             null, '{"role": "editor"}', now()),
            ('system.membership.removed', tests.tenant('labak'), 'membership', tests.persona('revoked'),
             null, '{"role": "editor"}', now()) $$,
  'membership changes in owner context are system events with no actor');

-- Fixtures (owner context).
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c701'), tests.tenant('labak'), 'news', 'owner-frett', tests.persona('editor_labak')),
  (tests.entry('c702'), tests.tenant('demo'), 'news', null, tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c701'), tests.tenant('labak'), 1, '{}', tests.persona('editor_labak')),
  (tests.entry('c702'), tests.tenant('demo'), 1, '{}', tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by) values
  (tests.revision('d701'), tests.tenant('labak'), tests.entry('c701'), 1, 1, '{}', tests.persona('editor_labak'));
insert into cms.releases (id, tenant_id, number, status) values
  (tests.pub('e721'), tests.tenant('labak'), 1, 'building');

select results_eq($$ select action, actor_id, tenant_id, target_type, details from cms.audit_log
     where target_id = tests.entry('c701') order by id $$,
  $$ values ('system.entry.created'::text, null::uuid, tests.tenant('labak'), 'entry'::text,
             '{"type": "news", "slug": "owner-frett"}'::jsonb) $$,
  'an entry created in owner context is a system event; created_by is not taken as the actor');
select is_empty($$ select 1 from cms.audit_log where target_id in (tests.revision('d701'), tests.pub('e721'))
     or target_type in ('draft', 'revision') $$,
  'drafts, revisions and a new building release are not audited');
select set_config('tests.audit_before_editor', (select coalesce(max(id), 0) from cms.audit_log)::text, true);

-- ---------------------------------------------------------------------------
-- The editor: actor and time are set by the database (§4.7, decision 11).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ insert into cms.audit_log (tenant_id, actor_id, action, target_type, at)
  values (tests.tenant('labak'), tests.persona('editor_demo'), 'test.spoof', 'test', '2000-01-01') $$,
  'editor_labak inserts an audit row naming editor_demo as actor and a past time');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type)
  values (tests.tenant('demo'), 'test.other_tenant', 'test') $$,
  '42501', null, 'editor cannot write an event for another tenant');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (null, 'test.platform', 'test') $$,
  '42501', null, 'editor cannot write a platform event (null tenant)');
select throws_ok($$ insert into cms.audit_log (id, tenant_id, action, target_type)
  values (1, tests.tenant('labak'), 'test.id', 'test') $$,
  '428C9', null, 'an ordinary INSERT cannot name audit_log.id (generated always)');
select throws_ok($$ insert into cms.audit_log (id, tenant_id, action, target_type) overriding system value
  values (1, tests.tenant('labak'), 'test.id', 'test') $$,
  '42501', 'permission denied for table audit_log', 'editor cannot choose audit_log.id with OVERRIDING SYSTEM VALUE');
select is_empty($$ select 1 from cms.audit_log $$, 'editor reads no audit rows, not even its own');
select throws_ok($$ update cms.audit_log set action = 'x' $$, '42501', null, 'editor cannot update audit_log');
select throws_ok($$ delete from cms.audit_log $$, '42501', null, 'editor cannot delete from audit_log');

-- Audited editor actions (§4.7): entry creation, slug change, archive; asset
-- registration, metadata change, archive; publish requests.
select lives_ok($$ insert into cms.entries (tenant_id, type, slug) values (tests.tenant('labak'), 'news', 'audit-a') $$,
  'editor creates an entry');
select set_config('tests.audit_entry', (select id::text from cms.entries where slug = 'audit-a'), true);
select lives_ok($$ insert into cms.drafts (entry_id, tenant_id, schema_version)
  values (current_setting('tests.audit_entry')::uuid, tests.tenant('labak'), 1) $$, 'editor creates its draft');
select lives_ok($$ update cms.drafts set data = '{"title": "x"}' where entry_id = current_setting('tests.audit_entry')::uuid $$,
  'editor saves the draft');
select lives_ok($$ update cms.entries set slug = 'audit-b' where id = current_setting('tests.audit_entry')::uuid $$,
  'editor changes the slug');
select lives_ok($$ update cms.entries set archived_at = now() where id = current_setting('tests.audit_entry')::uuid $$,
  'editor archives the entry');
select lives_ok($$ insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256)
  values (tests.asset('f701'), tests.tenant('labak'), tests.tenant('labak') || '/' || tests.asset('f701') || '/a.jpg',
          'a.jpg', 'image/jpeg', 1000, 800, 600, repeat('a', 64)) $$,
  'editor registers an asset');
select lives_ok($$ update cms.assets set default_alt = 'Brauð' where id = tests.asset('f701') $$,
  'editor changes the default alt text');
select lives_ok($$ update cms.assets set focal_x = 0.5, focal_y = 0.25 where id = tests.asset('f701') $$,
  'editor changes the focal point');
select lives_ok($$ update cms.assets set archived_at = now() where id = tests.asset('f701') $$, 'editor archives the asset');
select lives_ok($$ insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by)
  values (tests.tenant('labak'), tests.entry('c701'), 'publish', 1, tests.persona('outsider')) $$,
  'editor requests publication');

select tests.act_as_owner();
select results_eq($$ select action, actor_id, tenant_id, target_type, target_id, at from cms.audit_log
     where id > current_setting('tests.audit_before_editor')::bigint order by id $$,
  $$ values ('test.spoof'::text, tests.persona('editor_labak'), tests.tenant('labak'), 'test'::text, null::uuid, now()),
            ('entry.created', tests.persona('editor_labak'), tests.tenant('labak'), 'entry',
             current_setting('tests.audit_entry')::uuid, now()),
            ('entry.slug_changed', tests.persona('editor_labak'), tests.tenant('labak'), 'entry',
             current_setting('tests.audit_entry')::uuid, now()),
            ('entry.archived', tests.persona('editor_labak'), tests.tenant('labak'), 'entry',
             current_setting('tests.audit_entry')::uuid, now()),
            ('asset.registered', tests.persona('editor_labak'), tests.tenant('labak'), 'asset', tests.asset('f701'), now()),
            ('asset.updated', tests.persona('editor_labak'), tests.tenant('labak'), 'asset', tests.asset('f701'), now()),
            ('asset.updated', tests.persona('editor_labak'), tests.tenant('labak'), 'asset', tests.asset('f701'), now()),
            ('asset.archived', tests.persona('editor_labak'), tests.tenant('labak'), 'asset', tests.asset('f701'), now()),
            ('publish_request.created', tests.persona('editor_labak'), tests.tenant('labak'), 'publish_request',
             (select id from cms.publish_requests where entry_id = tests.entry('c701')), now()) $$,
  'every editor event, in order, with actor editor_labak (not the actor named) and the database time; no draft event');
select is((select details from cms.audit_log where action = 'entry.slug_changed'),
  '{"from": "audit-a", "to": "audit-b"}'::jsonb, 'slug change details: from and to');
select is((select details from cms.audit_log where action = 'entry.created' and target_id = current_setting('tests.audit_entry')::uuid),
  '{"type": "news", "slug": "audit-a"}'::jsonb, 'entry creation details: type and slug');
select is((select details from cms.audit_log where action = 'asset.registered'),
  '{"filename": "a.jpg", "mime": "image/jpeg", "bytes": 1000}'::jsonb, 'asset registration details');
select results_eq($$ select details from cms.audit_log where action = 'asset.updated' order by id $$,
  $$ values ('{"focal_x": null, "focal_y": null, "default_alt": "Brauð"}'::jsonb),
            ('{"focal_x": 0.5, "focal_y": 0.25, "default_alt": "Brauð"}') $$,
  'asset metadata change details: the new focal point and default alt');
select is((select details from cms.audit_log where action = 'publish_request.created'),
  pg_catalog.jsonb_build_object('entry_id', tests.entry('c701'), 'action', 'publish', 'draft_version', 1),
  'publish request details: entry, action, draft version');

-- check_actor equivalent for audit_log: a BEFORE trigger whose name sorts after
-- audit_log_force_actor cannot make an editor's row name another actor; the
-- insert policy's WITH CHECK refuses it.
create trigger zz_probe_spoof_actor before insert on cms.audit_log
  for each row execute function tests.probe_set_column('actor_id', '00000000-0000-4000-8000-00000000b003');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (tests.tenant('labak'), 'test.x', 'test') $$,
  '42501', null, 'a later BEFORE trigger cannot make an editor''s audit row name another actor');
select tests.act_as_owner();
drop trigger zz_probe_spoof_actor on cms.audit_log;

-- ---------------------------------------------------------------------------
-- Owner context: at is the database clock; no actor means a system event.
select lives_ok($$ insert into cms.audit_log (tenant_id, action, target_type, at)
  values (null, 'owner.event', 'test', '2000-01-01') $$, 'owner inserts an event with a past time and no actor');
select results_eq($$ select action, actor_id, at from cms.audit_log where target_type = 'test' and tenant_id is null $$,
  $$ values ('system.owner.event'::text, null::uuid, now()) $$,
  'owner event: at is now(), action prefixed system. (no actor)');
select set_config('tests.audit_before_worker', (select max(id) from cms.audit_log)::text, true);

-- ---------------------------------------------------------------------------
-- The worker (service_role): its events take the requester from the row
-- (§4.7); events with no requester are system events (decision 12).
select tests.act_as_service();
select throws_ok($$ insert into cms.audit_log (id, tenant_id, action, target_type) overriding system value
  values (1, tests.tenant('labak'), 'test.id', 'test') $$,
  '42501', 'permission denied for table audit_log', 'service_role cannot choose audit_log.id with OVERRIDING SYSTEM VALUE');
select lives_ok($$ update cms.publish_requests set status = 'validating', claimed_at = now(), attempts = attempts + 1
  where entry_id = tests.entry('c701') $$, 'worker claims the request');
select lives_ok($$ update cms.publish_requests set attempts = attempts + 1 where entry_id = tests.entry('c701') $$,
  'worker changes a request without changing its status');
select lives_ok($$ update cms.publish_requests set status = 'committed', revision_id = tests.revision('d701')
  where entry_id = tests.entry('c701') $$, 'worker commits the request');
select lives_ok($$ update cms.entries set published_rev_id = tests.revision('d701'), published_draft_version = 1,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c701') $$,
  'worker moves the publish pointer');
select lives_ok($$ update cms.assets set public_path = 'labak/' || tests.asset('f701') || '/a.jpg'
  where id = tests.asset('f701') $$, 'worker sets an asset''s public path');
select lives_ok($$ update cms.releases set status = 'delivered', delivered_at = now(), bundle_path = 'labak/releases/1.json'
  where id = tests.pub('e721') $$, 'worker delivers the release');
select lives_ok($$ insert into cms.memberships (tenant_id, user_id) values (tests.tenant('demo'), tests.persona('outsider')) $$,
  'the CLI adds a membership');
select lives_ok($$ delete from cms.memberships where tenant_id = tests.tenant('demo') and user_id = tests.persona('outsider') $$,
  'the CLI removes a membership');
select lives_ok($$ insert into cms.audit_log (tenant_id, actor_id, action, target_type, at)
  values (tests.tenant('labak'), tests.persona('editor_labak'), 'worker.event', 'test', '2000-01-01') $$,
  'worker writes an event with a requester as actor');
select lives_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (null, 'alert', 'test') $$,
  'worker writes an event with no actor');
select lives_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (null, 'system.alert', 'test') $$,
  'worker writes an event already prefixed system.');
select throws_ok($$ select 1 from cms.audit_log $$, '42501', null, 'service_role cannot read audit_log');
select throws_ok($$ update cms.audit_log set action = 'x' $$, '42501', null, 'service_role cannot update audit_log');
select throws_ok($$ delete from cms.audit_log $$, '42501', null, 'service_role cannot delete from audit_log');

select tests.act_as_owner();
select results_eq($$ select action, actor_id, tenant_id, target_type, target_id, at from cms.audit_log
     where id > current_setting('tests.audit_before_worker')::bigint order by id $$,
  $$ values ('publish_request.validating'::text, tests.persona('editor_labak'), tests.tenant('labak'), 'publish_request'::text,
             (select id from cms.publish_requests where entry_id = tests.entry('c701')), now()),
            ('publish_request.committed', tests.persona('editor_labak'), tests.tenant('labak'), 'publish_request',
             (select id from cms.publish_requests where entry_id = tests.entry('c701')), now()),
            ('system.release.delivered', null, tests.tenant('labak'), 'release', tests.pub('e721'), now()),
            ('system.membership.added', null, tests.tenant('demo'), 'membership', tests.persona('outsider'), now()),
            ('system.membership.removed', null, tests.tenant('demo'), 'membership', tests.persona('outsider'), now()),
            ('worker.event', tests.persona('editor_labak'), tests.tenant('labak'), 'test', null, now()),
            ('system.alert', null, null, 'test', null, now()),
            ('system.alert', null, null, 'test', null, now()) $$,
  'worker events: request status changes by the requester, release and membership changes as system events; '
  'no event for the pointer, public_path or a change without a status change');
select is((select details from cms.audit_log where action = 'publish_request.committed'),
  pg_catalog.jsonb_build_object('entry_id', tests.entry('c701'), 'action', 'publish', 'draft_version', 1,
    'from', 'validating', 'to', 'committed', 'revision_id', tests.revision('d701'), 'error', null),
  'request status change details: from, to, revision and error');
select is((select details from cms.audit_log where action = 'system.release.delivered'),
  '{"number": 1, "from": "building", "to": "delivered", "bundle_path": "labak/releases/1.json", "error": null}'::jsonb,
  'release status change details');
select set_config('tests.audit_count', (select count(*) from cms.audit_log)::text, true);

-- ---------------------------------------------------------------------------
-- Readers (§4.5): platform admins at aal2 read every event; nobody else.
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select is_empty($$ select 1 from cms.audit_log $$, 'platform admin at aal1 reads no audit rows');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is((select count(*) from cms.audit_log), current_setting('tests.audit_count')::bigint,
  'platform admin at aal2 reads every audit row, of every tenant and the platform');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (tests.tenant('labak'), 'x', 'test') $$,
  '42501', null, 'platform admin at aal2 cannot write events for a tenant it is not a member of');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (null, 'x', 'test') $$,
  '42501', null, 'platform admin at aal2 cannot write platform events');
select throws_ok($$ update cms.audit_log set action = 'x' $$, '42501', null, 'platform admin at aal2 cannot update audit_log');
select throws_ok($$ delete from cms.audit_log $$, '42501', null, 'platform admin at aal2 cannot delete from audit_log');
select tests.act_as(tests.persona('editor_labak'), 'aal2');
select is_empty($$ select 1 from cms.audit_log $$, 'an editor at aal2 still reads no audit rows');
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from cms.audit_log $$, 'a user without membership reads no audit rows');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (tests.tenant('labak'), 'x', 'test') $$,
  '42501', null, 'a user without membership cannot write events');
select tests.act_as(tests.persona('revoked'));
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (tests.tenant('labak'), 'x', 'test') $$,
  '42501', null, 'a revoked member cannot write events');
select tests.act_as_anon();
select throws_ok($$ select 1 from cms.audit_log $$, '42501', null, 'anon cannot read audit_log');
select throws_ok($$ insert into cms.audit_log (tenant_id, action, target_type) values (null, 'x', 'test') $$,
  '42501', null, 'anon cannot write audit_log');

select * from finish();
rollback;
