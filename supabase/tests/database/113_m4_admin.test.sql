-- supabase/tests/database/113_m4_admin.test.sql
-- M4-01: the admin functions one person needs to operate the Hub (spec §4.6, §4.7, §8.2, §8.4;
-- 20261105100000_m4_admin.sql). api.admin_set_webhook_secret rotates a site's webhook secret in
-- place, api.admin_set_tenant_status suspends or reactivates a tenant, api.admin_remove_membership
-- revokes an editor, and api.admin_create_tenant can be run twice. A status change is audited. The
-- counts of api functions are in 010_catalog and 100_escalation, the audit triggers in 070_audit.
--
-- Fixtures (tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx): the seed's tenants; sites and
-- a tenant created by the functions under test, and an entry of editor_demo (ids in the temporary
-- table ids).
begin;
\ir _helpers.sql
select plan(86);

create temporary table ids (name text primary key, id uuid not null);
grant select, insert on ids to service_role, authenticated;
grant select on ids to anon;

select tests.seed();

-- ---------------------------------------------------------------------------
-- Catalog: signatures, invoker, pinned search_path, EXECUTE for service_role only.
create temporary table m4_functions (sig text primary key, args text not null, result text not null) on commit drop;
insert into m4_functions values
  ('api.admin_set_webhook_secret(uuid,text)', 'p_site_id uuid, p_webhook_secret text', 'void'),
  ('api.admin_set_tenant_status(uuid,text)', 'p_tenant_id uuid, p_status text', 'void'),
  ('api.admin_remove_membership(uuid,uuid)', 'p_tenant_id uuid, p_user_id uuid', 'void'),
  ('api.admin_create_tenant(text,text)', 'p_slug text, p_name text', 'uuid');
select is_empty($$ select sig from m4_functions where to_regprocedure(sig) is null $$,
  'the four functions exist with M4-01''s signatures');
select is_empty($$ select sig from m4_functions
  where pg_catalog.pg_get_function_identity_arguments(to_regprocedure(sig)) is distinct from args
     or pg_catalog.pg_get_function_result(to_regprocedure(sig)) is distinct from result $$,
  'argument names and return types are as the task gives them');
select is_empty($$ select sig from m4_functions
  where coalesce((select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)), true) $$,
  'all four are SECURITY INVOKER');
select is_empty($$ select sig from m4_functions
  where not coalesce((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)), false) $$,
  'all four pin search_path to the empty string');
select is_empty($$ select sig from m4_functions
  where to_regprocedure(sig) is null
     or not has_function_privilege('service_role', to_regprocedure(sig), 'execute')
     or has_function_privilege('authenticated', to_regprocedure(sig), 'execute')
     or has_function_privilege('anon', to_regprocedure(sig), 'execute') $$,
  'EXECUTE: service_role only');
select is((select count(*)::int from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'api' and p.proname = 'admin_create_tenant'), 1,
  'admin_create_tenant keeps one signature');
select set_eq($$ select col, priv from tests.column_privs('service_role', 'cms.sites') where priv = 'UPDATE' $$,
  $$ values ('preview_secret_ref', 'UPDATE'), ('preview_url', 'UPDATE') $$,
  'service_role gains no update on cms.sites: webhook_secret_ref stays out of reach');
select triggers_are('cms', 'tenants', array['tenants_lock_slug', 'tenants_audit_update'],
  'tenants triggers: the slug lock and the audit of a status change');
select ok(not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.audit_tenants()'::regprocedure),
  'private.audit_tenants is SECURITY INVOKER');

-- ---------------------------------------------------------------------------
-- Refused for anon, an editor and a platform admin at aal2, whatever the arguments name.
select tests.act_as_anon();
select throws_ok($$ select api.admin_set_webhook_secret(gen_random_uuid(), repeat('x', 32)) $$, '42501', null,
  'anon cannot rotate a webhook secret');
select throws_ok($$ select api.admin_set_tenant_status(tests.tenant('demo'), 'suspended') $$, '42501', null,
  'anon cannot suspend a tenant');
select throws_ok($$ select api.admin_remove_membership(tests.tenant('demo'), tests.persona('editor_demo')) $$, '42501', null,
  'anon cannot remove a membership');
select throws_ok($$ select api.admin_create_tenant('ny', 'Ný') $$, '42501', null, 'anon cannot create a tenant');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.admin_set_webhook_secret(gen_random_uuid(), repeat('x', 32)) $$, '42501', null,
  'an editor cannot rotate a webhook secret');
select throws_ok($$ select api.admin_set_tenant_status(tests.tenant('labak'), 'suspended') $$, '42501', null,
  'an editor cannot suspend their own tenant');
select throws_ok($$ select api.admin_remove_membership(tests.tenant('labak'), tests.persona('editor_labak')) $$, '42501', null,
  'an editor cannot remove a membership');
select throws_ok($$ select api.admin_create_tenant('ny', 'Ný') $$, '42501', null, 'an editor cannot create a tenant');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select api.admin_set_webhook_secret(gen_random_uuid(), repeat('x', 32)) $$, '42501', null,
  'a platform admin at aal2 cannot rotate a webhook secret');
select throws_ok($$ select api.admin_set_tenant_status(tests.tenant('labak'), 'suspended') $$, '42501', null,
  'a platform admin at aal2 cannot suspend a tenant with their own session');
select throws_ok($$ select api.admin_remove_membership(tests.tenant('labak'), tests.persona('editor_labak')) $$, '42501', null,
  'a platform admin at aal2 cannot remove a membership with their own session');
select tests.act_as_owner();
select is((select status from cms.tenants where id = tests.tenant('labak')), 'active', 'no refused call changed a tenant');
select is((select count(*)::int from cms.memberships where user_id = tests.persona('editor_labak')), 1,
  'no refused call removed a membership');

-- ---------------------------------------------------------------------------
-- admin_set_webhook_secret (as service_role).
select tests.act_as_service();
insert into ids select 'site', api.admin_create_site(tests.tenant('demo'), 'http://localhost:3201', 'http://localhost:3201/api/cms/revalidate',
                                                     null, 'webhook-old-0123456789abcdef0123456789');
insert into ids select 'other', api.admin_create_site(tests.tenant('labak'), 'http://localhost:3202', 'http://localhost:3202/api/cms/revalidate',
                                                      null, 'webhook-other-0123456789abcdef012345678');
select tests.act_as_owner();
insert into ids select 'ref', webhook_secret_ref from cms.sites where id = (select id from ids where name = 'site');
select tests.act_as_service();

select lives_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), 'webhook-new-0123456789abcdef0123456789') $$,
  'admin_set_webhook_secret rotates the secret (as service_role)');
select is((select webhook_secrets from api.worker_sites(tests.tenant('demo'))), array['webhook-new-0123456789abcdef0123456789'],
  'after a rotation worker_sites returns the new secret, and only that one');
select is((select webhook_secrets from api.worker_sites(tests.tenant('labak'))), array['webhook-other-0123456789abcdef012345678'],
  'another tenant''s site keeps its secret');
select tests.act_as_owner();
select is((select webhook_secret_ref from cms.sites where id = (select id from ids where name = 'site')),
  (select id from ids where name = 'ref'), 'webhook_secret_ref is unchanged by a rotation');
select is((select count(*)::int from vault.secrets where name = 'cms.sites/' || (select id from ids where name = 'site') || '/webhook'), 1,
  'a rotation creates no second Vault secret');
select is((select count(*)::int from vault.secrets v where v.secret like '%webhook-new-0123456789abcdef0123456789%'), 0,
  'Vault stores the rotated secret encrypted');
select is((select count(*)::int from cms.sites s where to_jsonb(s)::text like '%webhook-new-0123456789abcdef0123456789%'), 0,
  'the rotated secret is in no cms.sites column');
select is((select count(*)::int from cms.audit_log a where to_jsonb(a)::text like '%webhook-new-0123456789abcdef0123456789%'), 0,
  'the rotated secret is in no audit row');
select tests.act_as_service();

-- A short or unknown input changes nothing. The length comes first, as in admin_set_preview_secret.
select throws_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), repeat('x', 31)) $$,
  '22023', 'p_webhook_secret must have at least 32 characters', 'a 31-character secret raises 22023');
select throws_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), '') $$,
  '22023', 'p_webhook_secret must not be empty', 'an empty secret raises 22023');
select throws_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), null) $$,
  '22023', 'p_webhook_secret must not be empty', 'a null secret raises 22023');
select throws_ok($$ select api.admin_set_webhook_secret(gen_random_uuid(), 'short') $$,
  '22023', 'p_webhook_secret must have at least 32 characters', 'the length is checked before the site is read');
select throws_ok($$ select api.admin_set_webhook_secret(gen_random_uuid(), repeat('x', 32)) $$,
  'P0001', 'not_found', 'an unknown site is not_found');
select is((select webhook_secrets from api.worker_sites(tests.tenant('demo'))), array['webhook-new-0123456789abcdef0123456789'],
  'a refused secret leaves the stored one unchanged');
select lives_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), repeat('y', 32)) $$,
  'exactly 32 characters are accepted');
select is((select webhook_secrets from api.worker_sites(tests.tenant('demo'))), array[repeat('y', 32)],
  'the 32-character secret is read back');

-- A reference with no Vault row: not_found. vault.update_secret alone would change nothing and
-- report success, and this function must not create a secret the site does not hold.
select tests.act_as_owner();
update cms.sites set webhook_secret_ref = tests.entry('c999') where id = (select id from ids where name = 'site');
select tests.act_as_service();
select throws_ok($$ select api.admin_set_webhook_secret((select id from ids where name = 'site'), repeat('z', 32)) $$,
  'P0001', 'not_found', 'a site whose Vault row is missing is not_found');
select tests.act_as_owner();
select is((select webhook_secret_ref from cms.sites where id = (select id from ids where name = 'site')), tests.entry('c999'),
  'a missing Vault row leaves the reference as it was');
select is((select count(*)::int from vault.secrets where name = 'cms.sites/' || (select id from ids where name = 'site') || '/webhook'), 1,
  'a missing Vault row creates no secret');
update cms.sites set webhook_secret_ref = (select id from ids where name = 'ref') where id = (select id from ids where name = 'site');

-- ---------------------------------------------------------------------------
-- admin_create_tenant: a rerun with the same name returns the id, another name is slug_taken.
select tests.act_as_service();
insert into ids select 'acme', api.admin_create_tenant('acme-m4', 'Acme ehf.');
select is(api.admin_create_tenant('acme-m4', 'Acme ehf.'), (select id from ids where name = 'acme'),
  'a rerun with the same slug and name returns the same id');
select throws_ok($$ select api.admin_create_tenant('acme-m4', 'Annað nafn') $$, 'P0001', 'slug_taken',
  'the same slug with another name is slug_taken');
select throws_ok($$ select api.admin_create_tenant('acme-m4', 'acme ehf.') $$, 'P0001', 'slug_taken',
  'names are compared exactly');
select is((select count(*)::int from cms.tenants where slug = 'acme-m4'), 1, 'one row after three calls');
select is((select name from cms.tenants where slug = 'acme-m4'), 'Acme ehf.', 'the refused name changed nothing');
select throws_ok($$ select api.admin_create_tenant('Acme M4', 'Acme ehf.') $$, '23514', null,
  'a malformed slug still fails the slug check');

-- ---------------------------------------------------------------------------
-- admin_set_tenant_status and its audit row.
select tests.act_as_owner();
create function tests.status_events(p_tenant uuid) returns bigint language sql as $$
  select count(*) from cms.audit_log a where a.target_id = p_tenant and a.action like '%tenant.status_changed'
$$;
select tests.act_as_service();
select lives_ok($$ select api.admin_set_tenant_status((select id from ids where name = 'acme'), 'suspended') $$,
  'admin_set_tenant_status suspends a tenant (as service_role)');
select tests.act_as_owner();
select is((select status from cms.tenants where id = (select id from ids where name = 'acme')), 'suspended', 'the tenant is suspended');
select is(tests.status_events((select id from ids where name = 'acme')), 1::bigint, 'the status change wrote one audit row');
select is((select to_jsonb(a) - 'id' - 'at' from cms.audit_log a where a.target_id = (select id from ids where name = 'acme')),
  jsonb_build_object('tenant_id', (select id from ids where name = 'acme'), 'actor_id', null, 'action', 'system.tenant.status_changed',
                     'target_type', 'tenant', 'target_id', (select id from ids where name = 'acme'),
                     'details', jsonb_build_object('from', 'active', 'to', 'suspended')),
  'the audit row: a system event on the tenant, from and to');
select tests.act_as_service();
select lives_ok($$ select api.admin_set_tenant_status((select id from ids where name = 'acme'), 'suspended') $$,
  'setting the status a tenant already has is allowed');
select lives_ok($$ update cms.tenants set name = 'Acme hf.' where id = (select id from ids where name = 'acme') $$,
  'a name change as service_role');
select tests.act_as_owner();
select is(tests.status_events((select id from ids where name = 'acme')), 1::bigint, 'an unchanged status writes no audit row');
select is((select count(*)::int from cms.audit_log a where a.target_id = (select id from ids where name = 'acme')), 1,
  'a name change writes no audit row');
select tests.act_as_service();
select throws_ok($$ select api.admin_set_tenant_status((select id from ids where name = 'acme'), 'deleted') $$,
  '22023', 'p_status must be active or suspended', 'an unknown status raises 22023');
select throws_ok($$ select api.admin_set_tenant_status((select id from ids where name = 'acme'), null) $$,
  '22023', 'p_status must be active or suspended', 'a null status raises 22023');
select throws_ok($$ select api.admin_set_tenant_status(gen_random_uuid(), 'suspended') $$,
  'P0001', 'not_found', 'an unknown tenant is not_found');
select throws_ok($$ select api.admin_set_tenant_status(gen_random_uuid(), 'deleted') $$,
  '22023', 'p_status must be active or suspended', 'the status is checked before the tenant is read');
select tests.act_as_owner();
select is((select status from cms.tenants where id = (select id from ids where name = 'acme')), 'suspended', 'a refused status changes nothing');
select is(tests.status_events((select id from ids where name = 'acme')), 1::bigint, 'a refused status writes no audit row');
select tests.act_as_service();
select lives_ok($$ select api.admin_set_tenant_status((select id from ids where name = 'acme'), 'active') $$,
  'admin_set_tenant_status reactivates a tenant');
select tests.act_as_owner();
select is(tests.status_events((select id from ids where name = 'acme')), 2::bigint, 'reactivating writes a second audit row');
select is((select a.details from cms.audit_log a where a.target_id = (select id from ids where name = 'acme') order by a.id desc limit 1),
  '{"from": "suspended", "to": "active"}'::jsonb, 'the second row records suspended to active');
-- Constraints and triggers hold for every writer (§4.5): the owner's change is audited too.
update cms.tenants set status = 'suspended' where id = (select id from ids where name = 'acme');
select is(tests.status_events((select id from ids where name = 'acme')), 3::bigint, 'a status change by the owner is audited too');

-- ---------------------------------------------------------------------------
-- Suspending a tenant with work in flight (review focus 4; the public pointer is in
-- pipeline.integration.test.ts). editor_demo has a pending request when the tenant is suspended.
select tests.act_as(tests.persona('editor_demo'));
insert into ids select 'entry', api.create_entry(tests.tenant('demo'), 'news', 'm4-beidni');
select is(api.save_draft((select id from ids where name = 'entry'), 1, '{"title": "Beiðni"}'::jsonb, 1, 'Beiðni', null), 2, 'editor_demo saves a draft');
insert into ids select 'request', api.request_publish((select id from ids where name = 'entry'), 2);
select tests.act_as_service();
select is((select id from api.worker_claim_request((select id from ids where name = 'request'))), (select id from ids where name = 'request'),
  'the worker claims the pending request');
select lives_ok($$ select api.admin_set_tenant_status(tests.tenant('demo'), 'suspended') $$, 'the tenant is suspended with the request in flight');
select is(api.worker_commit_publish((select id from ids where name = 'request'), 2, 1, 'Beiðni', null), 'rejected',
  'focus 4: the commit is refused');
select tests.act_as_owner();
select is((select status || ' ' || (error ->> 'code') from cms.publish_requests where id = (select id from ids where name = 'request')),
  'rejected tenant_inactive', 'focus 4: the request is rejected with tenant_inactive');
select is((select published_rev_id from cms.entries where id = (select id from ids where name = 'entry')), null::uuid,
  'focus 4: nothing was published');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.request_publish((select id from ids where name = 'entry'), 2) $$, 'P0001', 'tenant_inactive',
  'focus 4: a new request is refused while the tenant is suspended');
select tests.act_as_service();
select lives_ok($$ select api.admin_set_tenant_status(tests.tenant('demo'), 'active') $$, 'the tenant is reactivated');
select tests.act_as(tests.persona('editor_demo'));
insert into ids select 'request2', api.request_publish((select id from ids where name = 'entry'), 2);
select tests.act_as_service();
select is((select id from api.worker_claim_request((select id from ids where name = 'request2'))), (select id from ids where name = 'request2'),
  'the worker claims the new request');
select is(api.worker_commit_publish((select id from ids where name = 'request2'), 2, 1, 'Beiðni', null), 'committed',
  'focus 4: after active a new request publishes');

-- ---------------------------------------------------------------------------
-- admin_remove_membership (review focus 5; the editor's tab is in session-expiry.integration.test.ts).
select tests.act_as_owner();
create function tests.removed_events(p_tenant uuid, p_user uuid) returns bigint language sql as $$
  select count(*) from cms.audit_log a
  where a.tenant_id = p_tenant and a.target_id = p_user and a.action = 'system.membership.removed'
$$;
select tests.act_as(tests.persona('editor_demo'));
select is(api.save_draft((select id from ids where name = 'entry'), 2, '{"title": "Áður"}'::jsonb, 1, 'Áður', null), 3,
  'the editor can save before the removal');
select tests.act_as_service();
select lives_ok($$ select api.admin_remove_membership(tests.tenant('demo'), tests.persona('editor_demo')) $$,
  'admin_remove_membership removes an editor (as service_role)');
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select api.save_draft((select id from ids where name = 'entry'), 3, '{"title": "Eftir"}'::jsonb, 1, 'Eftir', null) $$,
  'P0001', 'not_found', 'focus 5: after removal save_draft by that editor fails');
select tests.act_as_owner();
select is((select version from cms.drafts where entry_id = (select id from ids where name = 'entry')), 3, 'focus 5: the draft is unchanged');
select is(tests.removed_events(tests.tenant('demo'), tests.persona('editor_demo')), 1::bigint, 'focus 5: one audit row is written');
select is((select count(*)::int from cms.memberships where user_id = tests.persona('editor_labak')), 1, 'another tenant''s editor is untouched');
select tests.act_as_service();
select lives_ok($$ select api.admin_remove_membership(tests.tenant('demo'), tests.persona('editor_demo')) $$,
  'removing an absent membership is a no-op');
select lives_ok($$ select api.admin_remove_membership(tests.tenant('demo'), tests.persona('editor_labak')) $$,
  'removing a membership of another tenant''s editor is a no-op');
select throws_ok($$ select api.admin_remove_membership(gen_random_uuid(), tests.persona('editor_demo')) $$,
  'P0001', 'not_found', 'an unknown tenant is not_found');
select tests.act_as_owner();
select is(tests.removed_events(tests.tenant('demo'), tests.persona('editor_demo')), 1::bigint, 'a no-op writes no audit row');
select is((select count(*)::int from cms.memberships where user_id = tests.persona('editor_labak')), 1, 'the no-op removed nothing');

select * from finish();
rollback;
