-- supabase/tests/database/111_create_site_preview_url.test.sql
-- api.admin_create_site checks the preview URL with the same rule as api.admin_set_preview_url
-- (spec §4.6, §7.5; 20261104170000_create_site_preview_url.sql): https, or plain http only to a
-- loopback host (token.ts isAllowedPreviewUrl, security review B4). A refused URL raises 22023 and
-- creates no site and no Vault secret; null still creates a site without a preview URL. The
-- signature and grants are unchanged (also counted in 090_api_worker and 103_preview_secrets).
--
-- Fixtures: the seed's tenants; sites created by api.admin_create_site (ids in the temporary table
-- ids).
begin;
\ir _helpers.sql
select plan(17);

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;

-- The SQLSTATE a statement raises as the current role ('00000' if none), each call in its own
-- subtransaction (as in 100_escalation and 110_preview_url).
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
-- Catalog: the function is replaced in place, its signature and grants unchanged.
select is((select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'admin_create_site'), 1,
  'admin_create_site still has one signature');
select is((select pg_catalog.pg_get_function_identity_arguments('api.admin_create_site(uuid,text,text,text,text,text)'::regprocedure)),
  'p_tenant_id uuid, p_base_url text, p_revalidate_url text, p_preview_url text, p_webhook_secret text, p_preview_secret text',
  'admin_create_site keeps its arguments');
select ok(not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'api.admin_create_site(uuid,text,text,text,text,text)'::regprocedure),
  'admin_create_site is still SECURITY INVOKER');
select ok((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p
           where p.oid = 'api.admin_create_site(uuid,text,text,text,text,text)'::regprocedure),
  'admin_create_site still pins search_path to the empty string');
select ok(has_function_privilege('service_role', 'api.admin_create_site(uuid,text,text,text,text,text)', 'execute')
          and not has_function_privilege('authenticated', 'api.admin_create_site(uuid,text,text,text,text,text)', 'execute')
          and not has_function_privilege('anon', 'api.admin_create_site(uuid,text,text,text,text,text)', 'execute'),
  'admin_create_site: EXECUTE for service_role only, as before');

-- ---------------------------------------------------------------------------
-- Allowed URLs and null create the site, with the URL stored as given (as service_role).
select tests.act_as_service();
select lives_ok($$ insert into ids select 'nourl', api.admin_create_site(tests.tenant('demo'), 'https://demo.example.is',
                    'https://demo.example.is/api/cms/revalidate', null, 'webhook-nourl') $$,
  'a null preview URL still creates the site');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'nourl')), null::text,
  'the site has no preview URL');
select lives_ok($$ insert into ids select 'https', api.admin_create_site(tests.tenant('demo'), 'https://demo.example.is',
                    'https://demo.example.is/api/cms/revalidate', 'https://demo.example.is/api/cms/preview', 'webhook-https') $$,
  'an https preview URL creates the site');
select is((select preview_url from cms.sites where id = (select id from ids where name = 'https')),
  'https://demo.example.is/api/cms/preview', 'the https preview URL is stored');

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
  ('http://[::1]:3101/api/cms/preview'),
  ('https://demo.example.is/' || repeat('a', 2024));
select is_empty($$ select url from accepted where tests.sqlstate_of(
    pg_catalog.format('select api.admin_create_site(%L, %L, %L, %L, %L)', tests.tenant('demo'),
                      'https://demo.example.is', 'https://demo.example.is/api/cms/revalidate', url, 'webhook-accepted')) <> '00000' $$,
  'admin_create_site accepts https URLs and http to localhost, 127.0.0.0/8 and [::1], up to 2048 characters');

-- ---------------------------------------------------------------------------
-- Refused with 22023: no site and no Vault secret is created.
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
  ('more than 2048 characters', 'https://demo.example.is/' || repeat('a', 2025));

select tests.act_as_owner();
create temporary table before_refusals as
  select (select count(*) from cms.sites) as sites, (select count(*) from vault.secrets) as secrets;

select tests.act_as_service();
select is_empty($$ select reason from refused where tests.sqlstate_of(
    pg_catalog.format('select api.admin_create_site(%L, %L, %L, %L, %L, %L)', tests.tenant('demo'),
                      'https://demo.example.is', 'https://demo.example.is/api/cms/revalidate', url, 'webhook-refused',
                      'preview-refused-0123456789abcdef0123456789')) <> '22023' $$,
  'admin_create_site refuses every other form with 22023');
select throws_ok($$ select api.admin_create_site(tests.tenant('demo'), 'https://demo.example.is', 'https://demo.example.is/api/cms/revalidate',
                    'http://demo.example.is/preview', 'webhook-refused') $$,
  '22023', 'p_preview_url must be an https URL, or http to a loopback host', 'the refusal names the rule');
select throws_ok($$ select api.admin_create_site(gen_random_uuid(), 'https://demo.example.is', 'https://demo.example.is/api/cms/revalidate',
                    'http://demo.example.is/preview', 'webhook-refused') $$,
  'P0001', 'not_found', 'an unknown tenant is still not_found first');

select tests.act_as_owner();
select is((select count(*) from cms.sites), (select sites from before_refusals),
  'a refused preview URL creates no site');
select is((select count(*) from vault.secrets), (select secrets from before_refusals),
  'a refused preview URL stores no webhook or preview secret in Vault');

-- ---------------------------------------------------------------------------
-- The two functions agree: every URL admin_create_site accepts or refuses, admin_set_preview_url
-- does too.
select tests.act_as_service();
select is_empty($$
  select url from (select url from accepted union all select url from refused) u
  where tests.sqlstate_of(pg_catalog.format('select api.admin_create_site(%L, %L, %L, %L, %L)', tests.tenant('demo'),
                          'https://demo.example.is', 'https://demo.example.is/api/cms/revalidate', url, 'webhook-parity'))
     <> tests.sqlstate_of(pg_catalog.format('select api.admin_set_preview_url(%L, %L)', (select id from ids where name = 'https'), url)) $$,
  'admin_create_site and admin_set_preview_url accept and refuse the same URLs');

select tests.act_as_owner();
select ok(not exists (select 1 from cms.sites s where s.preview_url is not null and s.preview_url !~ '^(https://|http://(localhost|127\.|\[::1\]))'),
  'no stored preview URL is plain http to a host outside loopback');

select * from finish();
rollback;
