-- supabase/tests/database/114_console_views.test.sql
-- M4-03: the console's read surface (spec §4.5 "Console reads", §4.6, §8.4, §8.5 persona matrix;
-- 20261105110000_console_views.sql). Seven security_invoker views in api, SELECT for authenticated
-- only. console_admin is the caller's own platform_admins row at any aal. The other six return rows
-- only to a platform admin at aal2, so an editor's own rows don't appear. Review focus 3: the wrong
-- person gets no rows, whatever a page does. tests/integration/src/console-views.test.ts runs the
-- same matrix over the Data API with real sessions.
--
-- Fixtures (tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx), one of each per tenant:
--   site     1411 labak, 1412 demo (secret references 14f1, 14f2)
--   entry    c141 labak, c142 demo
--   release  1421 labak (delivered), 1422 demo (failed)
--   request  1431 labak (committed), 1432 demo (failed_validation, with an error)
--   delivery (1421, 1411) labak ok, (1422, 1412) demo failed, with a last error
--   audit    the seed's and these inserts' events, and one platform event with no tenant
--   demo is suspended.
begin;
\ir _helpers.sql
select plan(134);

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

-- One pgTAP line per view, as the role and claims the caller set, so every cell of the matrix is
-- its own assertion.
create function tests.console_empty(p_who text, p_views text[]) returns setof text
language plpgsql
as $$
declare
  v_view text;
begin
  foreach v_view in array p_views loop
    return next is_empty(format('select * from api.%I', v_view), format('%s: %s has no rows', p_who, v_view));
  end loop;
end;
$$;

create function tests.console_refused(p_who text, p_sql text, p_views text[]) returns setof text
language plpgsql
as $$
declare
  v_view text;
begin
  foreach v_view in array p_views loop
    return next throws_ok(format(p_sql, v_view), '42501', null, format('%s: refused on %s', p_who, v_view));
  end loop;
end;
$$;

create function tests.console_operational() returns text[]
language sql immutable
as $$ select array['console_tenants', 'console_requests', 'console_releases', 'console_sites',
                   'console_deliveries', 'console_audit'] $$;

create function tests.console_all() returns text[]
language sql immutable
as $$ select array['console_admin'] || tests.console_operational() $$;

grant execute on function tests.console_empty(text, text[]), tests.console_refused(text, text, text[]),
  tests.console_operational(), tests.console_all() to anon, authenticated, service_role;

select tests.seed();

insert into cms.sites (id, tenant_id, base_url, revalidate_url, preview_url, webhook_secret_ref, preview_secret_ref, active) values
  (tests.k('1411'), tests.tenant('labak'), 'http://localhost:3411', 'http://localhost:3411/r', 'http://localhost:3411/p',
   tests.k('14f1'), tests.k('14f3'), true),
  (tests.k('1412'), tests.tenant('demo'), 'http://localhost:3412', 'http://localhost:3412/r', null,
   tests.k('14f2'), null, false);
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c141'), tests.tenant('labak'), 'news', null, tests.persona('editor_labak')),
  (tests.entry('c142'), tests.tenant('demo'), 'event', null, tests.persona('editor_demo'));
insert into cms.releases (id, tenant_id, number, status, bundle_path, created_at, delivered_at) values
  (tests.k('1421'), tests.tenant('labak'), 1, 'delivered', 'labak/releases/1.json', '2026-11-05 10:00+00', '2026-11-05 10:01+00'),
  (tests.k('1422'), tests.tenant('demo'), 1, 'failed', null, '2026-11-05 11:00+00', null);
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, requested_at, status,
                                  claimed_at, error, release_id) values
  (tests.k('1431'), tests.tenant('labak'), tests.entry('c141'), 'publish', 1, tests.persona('editor_labak'),
   '2026-11-05 09:00+00', 'committed', '2026-11-05 09:01+00', null, tests.k('1421')),
  (tests.k('1432'), tests.tenant('demo'), tests.entry('c142'), 'unpublish', null, tests.persona('editor_demo'),
   '2026-11-05 09:30+00', 'failed_validation', null, '{"code": "schema_version"}', null);
insert into cms.site_deliveries (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status,
                                 live_confirmed_at, last_error, first_failed_at, next_attempt_at) values
  (tests.k('1421'), tests.k('1411'), tests.tenant('labak'), 'ok', 1, '2026-11-05 10:02+00', 'ok', '2026-11-05 10:03+00',
   null, null, null),
  (tests.k('1422'), tests.k('1412'), tests.tenant('demo'), 'failed', 4, null, 'pending', null, '{"code": "http_500"}',
   '2026-11-05 11:05+00', '2026-11-05 12:00+00');
insert into cms.audit_log (tenant_id, action, target_type, target_id)
  values (null, 'system.console_test', 'tenant', tests.k('1441'));
update cms.tenants set status = 'suspended' where id = tests.tenant('demo');

-- ---------------------------------------------------------------------------
-- Catalog: which views, invoker, which columns, who holds what.
select set_eq($$ select c.relname::text from pg_catalog.pg_class c
                 where c.relnamespace = 'api'::regnamespace and c.relname like 'console\_%' $$,
  $$ select unnest(tests.console_all()) $$,
  'the seven console views exist in api and no other console relation');
select is_empty($$ select v from unnest(tests.console_all()) as v
  where to_regclass('api.' || v) is null
     or not coalesce((select c.reloptions @> array['security_invoker=true'] and c.relkind = 'v'
                      from pg_catalog.pg_class c where c.oid = to_regclass('api.' || v)), false) $$,
  'every console view is a security_invoker view');

select columns_are('api', 'console_admin', array['user_id'], 'console_admin columns');
select columns_are('api', 'console_tenants', array['id', 'slug', 'name', 'status', 'created_at'], 'console_tenants columns');
select columns_are('api', 'console_requests',
  array['id', 'tenant_id', 'action', 'status', 'requested_at', 'claimed_at', 'error'], 'console_requests columns');
select columns_are('api', 'console_releases',
  array['id', 'tenant_id', 'number', 'status', 'created_at', 'delivered_at'], 'console_releases columns');
select columns_are('api', 'console_sites', array['id', 'tenant_id', 'base_url', 'active'], 'console_sites columns');
select columns_are('api', 'console_deliveries',
  array['release_id', 'site_id', 'tenant_id', 'notify_status', 'notify_attempts', 'notified_at', 'live_status',
        'live_confirmed_at', 'last_error', 'first_failed_at', 'next_attempt_at'], 'console_deliveries columns');
select columns_are('api', 'console_audit',
  array['id', 'tenant_id', 'at', 'actor_id', 'action', 'target_type', 'target_id'], 'console_audit columns');
select is_empty($$ select a.attrelid::regclass::text, a.attname from pg_catalog.pg_attribute a
  where a.attrelid = any (select to_regclass('api.' || v) from unnest(tests.console_all()) as v)
    and a.attnum > 0 and not a.attisdropped
    and a.attname ~ '(secret|_ref$|^data$|^details$|^revalidate_url$)' $$,
  'no console view exposes a secret reference, the revalidate URL or content');

select set_eq($$
  select v.relname::text as view_name, t.relname::text as table_name
  from pg_catalog.pg_class v
  join pg_catalog.pg_rewrite r on r.ev_class = v.oid
  join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = r.oid
  join pg_catalog.pg_class t on t.oid = d.refobjid and t.oid <> v.oid
  where v.relnamespace = 'api'::regnamespace and v.relname like 'console\_%' and t.relkind in ('r', 'v', 'p') $$,
  $$ values ('console_admin', 'platform_admins'),
            ('console_tenants', 'tenants'), ('console_tenants', 'platform_admins'),
            ('console_requests', 'publish_requests'), ('console_requests', 'platform_admins'),
            ('console_releases', 'releases'), ('console_releases', 'platform_admins'),
            ('console_sites', 'sites'), ('console_sites', 'platform_admins'),
            ('console_deliveries', 'site_deliveries'), ('console_deliveries', 'platform_admins'),
            ('console_audit', 'audit_log'), ('console_audit', 'platform_admins') $$,
  'each view reads its operational table and platform_admins, and no content table');

select set_eq($$
  select v as view_name, a.grantee::regrole::text as grantee, a.privilege_type::text as privilege
  from unnest(tests.console_all()) as v
  cross join lateral pg_catalog.aclexplode((select c.relacl from pg_catalog.pg_class c where c.oid = to_regclass('api.' || v))) as a
  where a.grantee <> (select c.relowner from pg_catalog.pg_class c where c.oid = to_regclass('api.' || v)) $$,
  $$ select v as view_name, 'authenticated' as grantee, 'SELECT' as privilege from unnest(tests.console_all()) as v $$,
  'the only grant on a console view is SELECT for authenticated: nothing for PUBLIC, anon or service_role');

select is_empty($$ select tablename, policyname from pg_catalog.pg_policies
  where schemaname = 'cms'
    and tablename in ('entries', 'drafts', 'revisions', 'draft_refs', 'revision_refs', 'assets')
    and concat(qual, ' ', with_check) ~ '(platform_admins|aal)' $$,
  'no content table has a platform-admin clause');
select set_eq($$ select tablename::text, policyname::text from pg_catalog.pg_policies
                 where schemaname = 'cms' and concat(qual, ' ', with_check) ~ '(platform_admins|aal)' $$,
  $$ values ('tenants', 'tenants_select_console'), ('publish_requests', 'publish_requests_select_console'),
            ('releases', 'releases_select_console'), ('sites', 'sites_select_console'),
            ('site_deliveries', 'site_deliveries_select_console'), ('audit_log', 'audit_log_select_console') $$,
  'the six console policies of §4.5 are the only platform-admin clauses');

-- ---------------------------------------------------------------------------
-- Editors have rows of their own under RLS, and the views still show them none.
select tests.act_as(tests.persona('editor_labak'), 'aal2');
select is(array[(select count(*)::int from cms.tenants), (select count(*)::int from cms.publish_requests),
                (select count(*)::int from cms.releases), (select count(id)::int from cms.sites),
                (select count(*)::int from cms.site_deliveries)],
  array[1, 1, 1, 1, 1], 'control: RLS gives editor_labak one own row in each operational table');

-- ---------------------------------------------------------------------------
-- The matrix: an editor, an outsider and a revoked member get nothing, at either aal.
select tests.act_as(tests.persona('editor_labak'), 'aal1');
select tests.console_empty('editor_labak at aal1', tests.console_all());
select tests.act_as(tests.persona('editor_labak'), 'aal2');
select tests.console_empty('editor_labak at aal2', tests.console_all());
select tests.act_as(tests.persona('editor_demo'), 'aal1');
select tests.console_empty('editor_demo at aal1', tests.console_all());
select tests.act_as(tests.persona('editor_demo'), 'aal2');
select tests.console_empty('editor_demo at aal2', tests.console_all());
select tests.act_as(tests.persona('outsider'), 'aal1');
select tests.console_empty('outsider at aal1', tests.console_all());
select tests.act_as(tests.persona('outsider'), 'aal2');
select tests.console_empty('outsider at aal2', tests.console_all());
select tests.act_as(tests.persona('revoked'), 'aal1');
select tests.console_empty('revoked at aal1', tests.console_all());
select tests.act_as(tests.persona('revoked'), 'aal2');
select tests.console_empty('revoked at aal2', tests.console_all());

-- anon has no usage on api; service_role has no grant on the views.
select tests.act_as_anon();
select tests.console_refused('anon', 'select * from api.%I', tests.console_all());
select tests.act_as_service();
select tests.console_refused('service_role', 'select * from api.%I', tests.console_all());

-- An admin at aal1 gets only their own console_admin row.
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select results_eq($$ select user_id from api.console_admin $$,
  $$ values (tests.persona('platform_admin')) $$, 'admin at aal1: console_admin is their own row');
select tests.console_empty('admin at aal1', tests.console_operational());

-- The same with no aal claim at all.
select pg_catalog.set_config('request.jwt.claims',
  pg_catalog.json_build_object('sub', tests.persona('platform_admin'), 'role', 'authenticated')::text, true);
select results_eq($$ select user_id from api.console_admin $$,
  $$ values (tests.persona('platform_admin')) $$, 'admin with no aal claim: console_admin is their own row');
select tests.console_empty('admin with no aal claim', tests.console_operational());

-- An admin who also edits a tenant: at aal1 the member rows RLS allows stay out of the views.
select tests.act_as_owner();
insert into cms.memberships (tenant_id, user_id) values (tests.tenant('labak'), tests.persona('platform_admin'));
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select is((select count(*)::int from cms.tenants), 1, 'control: RLS gives the admin their member tenant at aal1');
select tests.console_empty('admin with a membership at aal1', tests.console_operational());
select tests.act_as_owner();
delete from cms.memberships where user_id = tests.persona('platform_admin');

-- ---------------------------------------------------------------------------
-- An admin at aal2 sees every tenant, in the columns above.
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select results_eq($$ select user_id from api.console_admin $$,
  $$ values (tests.persona('platform_admin')) $$, 'admin at aal2: console_admin is their own row');
select set_eq($$ select id, slug, name, status from api.console_tenants $$,
  $$ values (tests.tenant('labak'), 'labak', 'Landssamband bakarameistara', 'active'),
            (tests.tenant('demo'), 'demo', 'Demo', 'suspended') $$,
  'admin at aal2: console_tenants has both tenants, the suspended one as suspended');
select set_eq($$ select id, tenant_id, action, status, requested_at, claimed_at, error from api.console_requests $$,
  $$ values (tests.k('1431'), tests.tenant('labak'), 'publish', 'committed', '2026-11-05 09:00+00'::timestamptz,
             '2026-11-05 09:01+00'::timestamptz, null::jsonb),
            (tests.k('1432'), tests.tenant('demo'), 'unpublish', 'failed_validation', '2026-11-05 09:30+00'::timestamptz,
             null::timestamptz, '{"code": "schema_version"}'::jsonb) $$,
  'admin at aal2: console_requests has both tenants, with status, action, times and error');
select set_eq($$ select id, tenant_id, number, status, created_at, delivered_at from api.console_releases $$,
  $$ values (tests.k('1421'), tests.tenant('labak'), 1, 'delivered', '2026-11-05 10:00+00'::timestamptz,
             '2026-11-05 10:01+00'::timestamptz),
            (tests.k('1422'), tests.tenant('demo'), 1, 'failed', '2026-11-05 11:00+00'::timestamptz, null::timestamptz) $$,
  'admin at aal2: console_releases has both tenants, with number, status and times');
select set_eq($$ select id, tenant_id, base_url, active from api.console_sites $$,
  $$ values (tests.k('1411'), tests.tenant('labak'), 'http://localhost:3411', true),
            (tests.k('1412'), tests.tenant('demo'), 'http://localhost:3412', false) $$,
  'admin at aal2: console_sites has both tenants, with id, base URL and active');
select set_eq($$ select release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at, live_status,
                        live_confirmed_at, last_error, first_failed_at, next_attempt_at from api.console_deliveries $$,
  $$ values (tests.k('1421'), tests.k('1411'), tests.tenant('labak'), 'ok', 1, '2026-11-05 10:02+00'::timestamptz, 'ok',
             '2026-11-05 10:03+00'::timestamptz, null::jsonb, null::timestamptz, null::timestamptz),
            (tests.k('1422'), tests.k('1412'), tests.tenant('demo'), 'failed', 4, null::timestamptz, 'pending',
             null::timestamptz, '{"code": "http_500"}'::jsonb, '2026-11-05 11:05+00'::timestamptz,
             '2026-11-05 12:00+00'::timestamptz) $$,
  'admin at aal2: console_deliveries has both tenants, with statuses, attempts, times and last error');
select set_eq($$ select id, tenant_id, at, actor_id, action, target_type, target_id from api.console_audit $$,
  $$ select id, tenant_id, at, actor_id, action, target_type, target_id from cms.audit_log $$,
  'admin at aal2: console_audit has every event');
select results_eq($$ select actor_id from api.console_audit
                     where action = 'publish_request.created' and tenant_id = tests.tenant('labak') $$,
  $$ values (tests.persona('editor_labak')) $$,
  'admin at aal2: console_audit says who acted');
select results_eq($$ select actor_id from api.console_audit where action = 'system.console_test' $$,
  $$ values (null::uuid) $$,
  'admin at aal2: a system event has no actor');
select set_has($$ select tenant_id from api.console_audit $$,
  $$ values (tests.tenant('labak')), (tests.tenant('demo')), (null::uuid) $$,
  'admin at aal2: console_audit covers both tenants and platform events');

-- The views are read-only for everyone, the admin at aal2 included.
select tests.console_refused('admin at aal2, delete', 'delete from api.%I', tests.console_all());
select throws_ok($$ update api.console_tenants set status = 'active' $$, '42501', null,
  'admin at aal2: update refused on console_tenants');
select tests.act_as(tests.persona('outsider'), 'aal2');
select throws_ok($$ insert into api.console_admin (user_id) values (tests.persona('outsider')) $$, '42501', null,
  'outsider: cannot make themselves an admin through console_admin');

-- A second admin: console_admin stays the caller's own row, and removing the row ends access at once.
select tests.act_as_owner();
insert into cms.platform_admins (user_id) values (tests.persona('editor_demo'));
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select results_eq($$ select user_id from api.console_admin $$,
  $$ values (tests.persona('platform_admin')) $$, 'with two admins, console_admin returns only the caller''s row');
select tests.act_as(tests.persona('editor_demo'), 'aal2');
select is((select count(*)::int from api.console_tenants), 2, 'the second admin at aal2 sees both tenants');
select tests.act_as_owner();
delete from cms.platform_admins where user_id = tests.persona('editor_demo');
select tests.act_as(tests.persona('editor_demo'), 'aal2');
select tests.console_empty('a removed admin at aal2', tests.console_all());

select tests.act_as_owner();
select * from finish();
rollback;
