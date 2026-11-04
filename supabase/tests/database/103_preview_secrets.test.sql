-- supabase/tests/database/103_preview_secrets.test.sql
-- M3-10: preview secrets per site in Vault (spec §7.5, §8.2; A9 locally;
-- 20261103010000_preview_secrets.sql; the 32-character minimum from
-- 20261104151000_preview_secret_length.sql, security review B5). api.admin_create_site stores the preview secret with the
-- site, api.admin_set_preview_secret gives an existing site one or rotates it, and
-- api.worker_preview_sites reads it back for the token route. The secret is readable by
-- service_role and by no editor, platform admin or anon. Grants are also counted in 010_catalog,
-- 090_api_worker and 100_escalation.
--
-- Fixtures (tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): the seed's tenants; sites
-- created by the functions under test (ids in the temporary table ids).
begin;
\ir _helpers.sql
select plan(49);

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role;
grant select on ids to authenticated, anon;

select tests.seed();

-- ---------------------------------------------------------------------------
-- Catalog: signatures, invoker, pinned search_path, EXECUTE for service_role only.
create temporary table preview_functions (sig text primary key) on commit drop;
insert into preview_functions values
  ('api.admin_create_site(uuid,text,text,text,text,text)'),
  ('api.admin_set_preview_secret(uuid,text)'),
  ('api.worker_preview_sites(uuid)');
select is_empty($$ select sig from preview_functions where to_regprocedure(sig) is null $$,
  'the three functions exist with M3-10''s signatures');
select is((select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'admin_create_site'), 1,
  'admin_create_site has one signature (the five-argument one is replaced)');
select is_empty($$ select sig from preview_functions
  where (select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)) $$,
  'all three are SECURITY INVOKER');
select is_empty($$ select sig from preview_functions
  where not coalesce((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)), false) $$,
  'all three pin search_path to the empty string');
select is_empty($$ select sig from preview_functions
  where not has_function_privilege('service_role', to_regprocedure(sig), 'execute')
     or has_function_privilege('authenticated', to_regprocedure(sig), 'execute')
     or has_function_privilege('anon', to_regprocedure(sig), 'execute') $$,
  'EXECUTE: service_role only');
select is((select pg_catalog.pg_get_function_identity_arguments('api.admin_create_site(uuid,text,text,text,text,text)'::regprocedure)),
  'p_tenant_id uuid, p_base_url text, p_revalidate_url text, p_preview_url text, p_webhook_secret text, p_preview_secret text',
  'admin_create_site: the preview secret is the sixth argument');
select ok((select p.pronargdefaults = 1 from pg_catalog.pg_proc p
           where p.oid = 'api.admin_create_site(uuid,text,text,text,text,text)'::regprocedure),
  'admin_create_site: p_preview_secret has a default, so five-argument callers keep working');
select ok(not has_column_privilege('authenticated', 'cms.sites', 'preview_secret_ref', 'select'),
  'authenticated cannot select sites.preview_secret_ref');
select ok(not has_column_privilege('authenticated', 'cms.sites', 'preview_secret_ref', 'update'),
  'authenticated cannot update sites.preview_secret_ref');

-- ---------------------------------------------------------------------------
-- admin_create_site with a preview secret (as service_role).
select tests.act_as_service();
select lives_ok($$ insert into ids select 'demo', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3101',
                    'http://localhost:3101/api/cms/revalidate', 'http://localhost:3101/api/cms/preview', 'webhook-demo', 'preview-demo-0123456789abcdef0123456789') $$,
  'A9: admin_create_site stores a preview secret in Vault with the site (as service_role)');
select is((select array_agg(row(id, preview_url, preview_secret)::text) from api.worker_preview_sites(tests.tenant('demo'))),
  array[row((select id from ids where name = 'demo'), 'http://localhost:3101/api/cms/preview', 'preview-demo-0123456789abcdef0123456789')::text],
  'A9: worker_preview_sites reads the preview secret back from Vault (as service_role)');
select is((select webhook_secrets from api.worker_sites(tests.tenant('demo'))), array['webhook-demo'],
  'the webhook secret is still stored and read separately');
select lives_ok($$ insert into ids select 'demo_plain', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3103',
                    'http://localhost:3103/api/cms/revalidate', 'http://localhost:3103/api/cms/preview', 'webhook-plain') $$,
  'admin_create_site with five arguments still creates a site');
select is((select preview_secret_ref from cms.sites where id = (select id from ids where name = 'demo_plain')), null::uuid,
  'a site created without a preview secret has no reference');
select is((select array_agg(id) from api.worker_preview_sites(tests.tenant('demo'))), array[(select id from ids where name = 'demo')],
  'worker_preview_sites leaves out a site without a preview secret');
select lives_ok($$ insert into ids select 'demo_nourl', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3104',
                    'http://localhost:3104/api/cms/revalidate', null, 'webhook-nourl', 'preview-nourl-0123456789abcdef0123456789') $$,
  'a site with a preview secret but no preview URL');
select is((select array_agg(id) from api.worker_preview_sites(tests.tenant('demo'))), array[(select id from ids where name = 'demo')],
  'worker_preview_sites leaves out a site without a preview URL');
select throws_ok($$ select api.admin_create_site(tests.tenant('demo'), 'http://x', 'http://x/r', null, 'w', '') $$,
  '22023', 'p_preview_secret must not be empty', 'admin_create_site: an empty preview secret raises 22023');
select throws_ok($$ select api.admin_create_site(tests.tenant('demo'), 'http://x', 'http://x/r', null, '', 'p') $$,
  '22023', 'p_webhook_secret must not be empty', 'admin_create_site: an empty webhook secret still raises 22023');
select throws_ok($$ select api.admin_create_site(gen_random_uuid(), 'http://x', 'http://x/r', null, 'w', 'p') $$,
  'P0001', 'not_found', 'admin_create_site: an unknown tenant is not_found');

-- Stored encrypted, under a name that identifies the site, and in no cms column.
select tests.act_as_owner();
select is((select count(*)::int from vault.secrets v join cms.sites s on s.preview_secret_ref = v.id
           where s.id = (select id from ids where name = 'demo') and v.name = 'cms.sites/' || s.id || '/preview'), 1,
  'A9: preview_secret_ref is a Vault secret named after the site');
select is((select count(*)::int from vault.secrets v join cms.sites s on s.preview_secret_ref = v.id
           where s.id = (select id from ids where name = 'demo') and v.secret like '%preview-demo-0123456789abcdef0123456789%'), 0,
  'A9: Vault stores the preview secret encrypted');
select is((select count(*)::int from cms.sites s where to_jsonb(s)::text like '%preview-demo-0123456789abcdef0123456789%'), 0,
  'the preview secret is in no cms.sites column');
select isnt((select preview_secret_ref from cms.sites where id = (select id from ids where name = 'demo')),
            (select webhook_secret_ref from cms.sites where id = (select id from ids where name = 'demo')),
  'the preview and webhook secrets are separate Vault secrets');

-- ---------------------------------------------------------------------------
-- admin_set_preview_secret: a first secret, then a rotation (as service_role).
select tests.act_as_service();
select lives_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), 'preview-plain-1-0123456789abcdef0123456789') $$,
  'admin_set_preview_secret gives an existing site a preview secret');
select is((select preview_secret from api.worker_preview_sites(tests.tenant('demo')) where id = (select id from ids where name = 'demo_plain')),
  'preview-plain-1-0123456789abcdef0123456789', 'the new secret is read back');
select tests.act_as_owner();
insert into ids select 'plain_ref', preview_secret_ref from cms.sites where id = (select id from ids where name = 'demo_plain');
select tests.act_as_service();
select lives_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), 'preview-plain-2-0123456789abcdef0123456789') $$,
  'admin_set_preview_secret replaces the secret (rotation)');
select is((select preview_secret from api.worker_preview_sites(tests.tenant('demo')) where id = (select id from ids where name = 'demo_plain')),
  'preview-plain-2-0123456789abcdef0123456789', 'the rotated secret is read back');
select tests.act_as_owner();
select is((select preview_secret_ref from cms.sites where id = (select id from ids where name = 'demo_plain')),
  (select id from ids where name = 'plain_ref'), 'rotation updates the same Vault secret');
select is((select count(*)::int from vault.secrets where name = 'cms.sites/' || (select id from ids where name = 'demo_plain') || '/preview'), 1,
  'rotation creates no second Vault secret');
select tests.act_as_service();
select throws_ok($$ select api.admin_set_preview_secret(gen_random_uuid(), repeat('x', 32)) $$,
  'P0001', 'not_found', 'admin_set_preview_secret: an unknown site is not_found');
select throws_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), '') $$,
  '22023', 'p_preview_secret must not be empty', 'admin_set_preview_secret: an empty secret raises 22023');
select throws_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), null) $$,
  '22023', 'p_preview_secret must not be empty', 'admin_set_preview_secret: a null secret raises 22023');
-- Security review B5: a preview secret has at least 32 characters, where it is set.
select throws_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), repeat('x', 31)) $$,
  '22023', 'p_preview_secret must have at least 32 characters', 'admin_set_preview_secret: a 31-character secret raises 22023');
select throws_ok($$ select api.admin_set_preview_secret(gen_random_uuid(), 'short') $$,
  '22023', 'p_preview_secret must have at least 32 characters', 'admin_set_preview_secret: the length is checked before the site is read');
select is((select preview_secret from api.worker_preview_sites(tests.tenant('demo')) where id = (select id from ids where name = 'demo_plain')),
  'preview-plain-2-0123456789abcdef0123456789', 'a refused secret leaves the stored one unchanged');
select lives_ok($$ select api.admin_set_preview_secret((select id from ids where name = 'demo_plain'), repeat('y', 32)) $$,
  'admin_set_preview_secret accepts exactly 32 characters');
select throws_ok($$ select api.admin_create_site(tests.tenant('demo'), 'http://x', 'http://x/r', null, 'w', repeat('x', 31)) $$,
  '22023', 'p_preview_secret must have at least 32 characters', 'admin_create_site: a 31-character preview secret raises 22023');
select lives_ok($$ insert into ids select 'demo_32', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3105',
                    'http://localhost:3105/api/cms/revalidate', null, 'webhook-32', repeat('z', 32)) $$,
  'admin_create_site accepts a 32-character preview secret');
select throws_ok($$ update cms.sites set webhook_secret_ref = gen_random_uuid() where id = (select id from ids where name = 'demo') $$,
  '42501', null, 'service_role still cannot update any other column of sites');

-- ---------------------------------------------------------------------------
-- Tenancy: only the tenant's own active sites.
select lives_ok($$ insert into ids select 'labak', api.admin_create_site(tests.tenant('labak'), 'http://localhost:3102',
                    'http://localhost:3102/api/cms/revalidate', 'http://localhost:3102/api/cms/preview', 'webhook-labak', 'preview-labak-0123456789abcdef0123456789') $$,
  'a labak site with a preview secret');
select is((select array_agg(preview_secret) from api.worker_preview_sites(tests.tenant('labak'))), array['preview-labak-0123456789abcdef0123456789'],
  'worker_preview_sites: the tenant''s own secret only, never another tenant''s');
select tests.act_as_owner();
update cms.sites set active = false where id = (select id from ids where name = 'labak');
select tests.act_as_service();
select is((select count(*)::int from api.worker_preview_sites(tests.tenant('labak'))), 0,
  'worker_preview_sites leaves out an inactive site');
select is((select count(*)::int from api.worker_preview_sites(gen_random_uuid())), 0,
  'worker_preview_sites: no sites for an unknown tenant');

-- ---------------------------------------------------------------------------
-- No editor, platform admin or anon reads a preview secret (A9; §8.5 Escalation).
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select * from api.worker_preview_sites(tests.tenant('demo')) $$, '42501', null,
  'editor_demo cannot read its own tenant''s preview secrets');
select throws_ok($$ select preview_secret_ref from cms.sites $$, '42501', null,
  'editor_demo cannot select sites.preview_secret_ref');
select throws_ok($$ select decrypted_secret from vault.decrypted_secrets $$, '42501', null,
  'editor_demo cannot read Vault');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select * from api.worker_preview_sites(tests.tenant('demo')) $$, '42501', null,
  'platform_admin at aal2 cannot read preview secrets');
select tests.act_as_anon();
select throws_ok($$ select * from api.worker_preview_sites(tests.tenant('demo')) $$, '42501', null,
  'anon cannot read preview secrets');

select * from finish();
rollback;
