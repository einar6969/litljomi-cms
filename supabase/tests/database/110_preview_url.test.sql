-- supabase/tests/database/110_preview_url.test.sql
-- fix/preview-url: api.admin_set_preview_url gives an existing site a preview URL, or clears it
-- with null (spec §4.6, §7.5; 20261104161000_preview_url.sql). The URL follows the token route's
-- rule (token.ts isAllowedPreviewUrl, security review B4): https, or http only to a loopback host.
-- EXECUTE for service_role only; service_role may update cms.sites.preview_url and no other new
-- column. Grants are also counted in 010_catalog, 060_publishing, 090_api_worker and 100_escalation.
--
-- Fixtures (tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): the seed's tenants; sites
-- created by api.admin_create_site (ids in the temporary table ids).
begin;
\ir _helpers.sql
select plan(45);

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;
grant select on ids to authenticated, anon;

-- The SQLSTATE a statement raises as the current role ('00000' if none), each call in its own
-- subtransaction (as in 100_escalation).
create function tests.sqlstate_of(p_sql text) returns text
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  return '00000';
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.sqlstate_of(text) to service_role;

select tests.seed();

-- ---------------------------------------------------------------------------
-- Catalog: signature, invoker, pinned search_path, EXECUTE for service_role only.
select ok(to_regprocedure('api.admin_set_preview_url(uuid,text)') is not null,
  'admin_set_preview_url(uuid, text) exists');
select is((select pg_catalog.pg_get_function_identity_arguments('api.admin_set_preview_url(uuid,text)'::regprocedure)),
  'p_site_id uuid, p_preview_url text', 'admin_set_preview_url: arguments p_site_id, p_preview_url');
select ok(not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'api.admin_set_preview_url(uuid,text)'::regprocedure),
  'admin_set_preview_url is SECURITY INVOKER');
select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
           where p.oid = 'api.admin_set_preview_url(uuid,text)'::regprocedure),
  'admin_set_preview_url pins search_path to the empty string');
select ok(has_function_privilege('service_role', 'api.admin_set_preview_url(uuid,text)', 'execute'),
  'service_role may execute admin_set_preview_url');
select ok(not has_function_privilege('authenticated', 'api.admin_set_preview_url(uuid,text)', 'execute'),
  'authenticated may not execute admin_set_preview_url');
select ok(not has_function_privilege('anon', 'api.admin_set_preview_url(uuid,text)', 'execute'),
  'anon may not execute admin_set_preview_url');
select ok(has_column_privilege('service_role', 'cms.sites', 'preview_url', 'update'),
  'service_role may update sites.preview_url (for admin_set_preview_url)');
select ok(not has_column_privilege('authenticated', 'cms.sites', 'preview_url', 'update'),
  'authenticated cannot update sites.preview_url');

-- ---------------------------------------------------------------------------
-- Setting, replacing and clearing the URL (as service_role).
select tests.act_as_service();
select lives_ok($$ insert into ids select 'demo', api.admin_create_site(tests.tenant('demo'), 'https://demo.example.is',
                    'https://demo.example.is/api/cms/revalidate', null, 'webhook-demo', 'preview-demo-0123456789abcdef0123456789') $$,
  'a site with a preview secret and no preview URL');
select is((select count(*)::int from api.worker_preview_sites(tests.tenant('demo'))), 0,
  'without a preview URL the site cannot preview');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://demo.example.is/api/cms/preview') $$,
  'admin_set_preview_url gives an existing site a preview URL');
select is((select array_agg(row(id, preview_url)::text) from api.worker_preview_sites(tests.tenant('demo'))),
  array[row((select id from ids where name = 'demo'), 'https://demo.example.is/api/cms/preview')::text],
  'the site can now preview, at the new URL');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://preview.demo.example.is:8443/cms/preview') $$,
  'admin_set_preview_url replaces the URL');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'demo')),
  'https://preview.demo.example.is:8443/cms/preview', 'the replaced URL is stored');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), null) $$,
  'admin_set_preview_url with null clears the URL');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'demo')), null::text,
  'the cleared URL is null');
select is((select count(*)::int from api.worker_preview_sites(tests.tenant('demo'))), 0,
  'a cleared site cannot preview');
select throws_ok($$ select api.admin_set_preview_url(gen_random_uuid(), 'https://x.example.is/p') $$,
  'P0001', 'not_found', 'admin_set_preview_url: an unknown site is not_found');
select throws_ok($$ select api.admin_set_preview_url(gen_random_uuid(), null) $$,
  'P0001', 'not_found', 'admin_set_preview_url: clearing an unknown site is not_found');
select throws_ok($$ select api.admin_set_preview_url(gen_random_uuid(), 'http://x.example.is/p') $$,
  '22023', 'p_preview_url must be an https URL, or http to a loopback host',
  'admin_set_preview_url: the URL is checked before the site is read');

-- The secret and the other columns are untouched.
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://demo.example.is/api/cms/preview') $$,
  'the URL is set again');
select is((select preview_secret from api.worker_preview_sites(tests.tenant('demo'))), 'preview-demo-0123456789abcdef0123456789',
  'the preview secret is unchanged');
select is((select row(base_url, revalidate_url, active)::text from cms.sites where id = (select id from ids where name = 'demo')),
  row('https://demo.example.is', 'https://demo.example.is/api/cms/revalidate', true)::text,
  'base URL, revalidate URL and active are unchanged');

-- ---------------------------------------------------------------------------
-- Allowed: https to any host; plain http to a loopback host only (token.ts isAllowedPreviewUrl).
create temporary table accepted (url text primary key) on commit drop;
grant select on accepted to service_role;
insert into accepted values
  ('https://a.is'),
  ('https://demo-staging.litljomi.is/api/cms/preview'),
  ('https://Site.Example.IS/Preview'),
  ('https://203.0.113.7:8443/preview'),
  ('https://[2001:db8::1]/preview'),
  ('http://localhost:3101/api/cms/preview'),
  ('http://localhost'),
  ('http://127.0.0.1:3101/api/cms/preview'),
  ('http://127.255.10.1/p'),
  ('http://[::1]:3101/api/cms/preview');
select is_empty($$ select url from accepted where tests.sqlstate_of(
    pg_catalog.format('select api.admin_set_preview_url(%L, %L)', (select id from ids where name = 'demo'), url)) <> '00000' $$,
  'admin_set_preview_url accepts https URLs and http to localhost, 127.0.0.0/8 and [::1]');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'http://[::1]:3101/api/cms/preview') $$,
  'a known URL is stored before the refusals');

-- Refused with 22023, the stored URL unchanged.
create temporary table refused (reason text primary key, url text not null) on commit drop;
grant select on refused to service_role;
insert into refused values
  ('http to a public host', 'http://demo.example.is/preview'),
  ('http to a private address', 'http://10.0.0.5/preview'),
  ('http to 0.0.0.0', 'http://0.0.0.0:3101/preview'),
  ('http to a host that only starts with localhost', 'http://localhost.example.is/preview'),
  ('http to a host that only starts with 127', 'http://127.0.0.1.example.is/preview'),
  ('http to an out-of-range 127 address', 'http://127.0.0.256/preview'),
  ('http to a 127 address with a leading zero', 'http://127.0.0.01/preview'),
  ('http to an IPv6 address other than ::1', 'http://[::2]/preview'),
  ('an uppercase scheme', 'HTTPS://demo.example.is/preview'),
  ('another scheme', 'javascript:alert(1)'),
  ('a ftp URL', 'ftp://demo.example.is/preview'),
  ('no scheme', 'demo.example.is/preview'),
  ('a scheme-relative URL', '//demo.example.is/preview'),
  ('user info', 'https://user:pass@demo.example.is/preview'),
  ('user info hiding the host', 'https://localhost@evil.example/preview'),
  ('a query', 'https://demo.example.is/preview?x=1'),
  ('a fragment', 'https://demo.example.is/preview#x'),
  ('a space', 'https://demo.example.is/pre view'),
  ('a backslash', 'https://demo.example.is\preview'),
  ('a newline', 'https://demo.example.is/preview' || chr(10)),
  ('an empty host', 'https:///preview'),
  ('a trailing dot in the host', 'https://demo.example.is./preview'),
  ('a percent-encoded host', 'https://%6c%6f%63%61%6c%68%6f%73%74/preview'),
  ('a non-ASCII host', 'https://bakarí.is/preview'),
  ('an empty string', ''),
  ('more than 2048 characters', 'https://demo.example.is/' || repeat('a', 2030));
select is_empty($$ select reason from refused where tests.sqlstate_of(
    pg_catalog.format('select api.admin_set_preview_url(%L, %L)', (select id from ids where name = 'demo'), url)) <> '22023' $$,
  'admin_set_preview_url refuses every other form with 22023');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'demo')),
  'http://[::1]:3101/api/cms/preview', 'a refused URL leaves the stored one unchanged');
select throws_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'http://demo.example.is/preview') $$,
  '22023', 'p_preview_url must be an https URL, or http to a loopback host', 'the refusal names the rule');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://demo.example.is/' || repeat('a', 2024)) $$,
  'admin_set_preview_url accepts exactly 2048 characters');

-- Still no other column of cms.sites is updatable by service_role.
select throws_ok($$ update cms.sites set base_url = 'https://evil.example' where id = (select id from ids where name = 'demo') $$,
  '42501', null, 'service_role still cannot update sites.base_url');
select throws_ok($$ update cms.sites set revalidate_url = 'https://evil.example/r' where id = (select id from ids where name = 'demo') $$,
  '42501', null, 'service_role still cannot update sites.revalidate_url');
select throws_ok($$ update cms.sites set tenant_id = tests.tenant('labak') where id = (select id from ids where name = 'demo') $$,
  '42501', null, 'service_role still cannot update sites.tenant_id');

-- ---------------------------------------------------------------------------
-- Tenancy: only the named site changes.
select lives_ok($$ insert into ids select 'labak', api.admin_create_site(tests.tenant('labak'), 'https://labak.example.is',
                    'https://labak.example.is/api/cms/revalidate', 'https://labak.example.is/api/cms/preview', 'webhook-labak',
                    'preview-labak-0123456789abcdef0123456789') $$,
  'a labak site with a preview URL');
select lives_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), null) $$,
  'the demo site''s URL is cleared');
select is((select preview_url from api.worker_preview_sites(tests.tenant('labak'))), 'https://labak.example.is/api/cms/preview',
  'another tenant''s site keeps its URL');

-- ---------------------------------------------------------------------------
-- No editor, platform admin or anon sets a preview URL (§8.5 Escalation), and none writes the
-- column directly.
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://evil.example/p') $$,
  '42501', null, 'editor_demo cannot set its own tenant''s preview URL');
select throws_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), null) $$,
  '42501', null, 'editor_demo cannot clear its own tenant''s preview URL');
select throws_ok($$ update cms.sites set preview_url = 'https://evil.example/p' $$,
  '42501', null, 'editor_demo cannot update sites.preview_url directly');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://evil.example/p') $$,
  '42501', null, 'editor_labak cannot set another tenant''s preview URL');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select api.admin_set_preview_url((select id from ids where name = 'demo'), 'https://evil.example/p') $$,
  '42501', null, 'platform_admin at aal2 cannot set a preview URL');
select throws_ok($$ update cms.sites set preview_url = 'https://evil.example/p' $$,
  '42501', null, 'platform_admin at aal2 cannot update sites.preview_url directly');
select tests.act_as_anon();
select throws_ok($$ select api.admin_set_preview_url(gen_random_uuid(), 'https://evil.example/p') $$,
  '42501', null, 'anon cannot set a preview URL');

select tests.act_as_owner();
select is((select preview_url from cms.sites where id = (select id from ids where name = 'demo')), null::text,
  'no refused caller changed the demo site''s URL');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'labak')),
  'https://labak.example.is/api/cms/preview', 'no refused caller changed the labak site''s URL');

select * from finish();
rollback;
