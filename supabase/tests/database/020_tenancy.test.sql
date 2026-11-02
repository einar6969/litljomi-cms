-- supabase/tests/database/020_tenancy.test.sql
-- Tenancy tables and RLS (spec §4.1 rules 3 and 7, §4.3, §4.5; plan Task 5).
begin;
\ir _helpers.sql
select plan(44);

select has_table('cms', 'tenants', 'cms.tenants exists');
select has_table('cms', 'memberships', 'cms.memberships exists');
select has_table('cms', 'platform_admins', 'cms.platform_admins exists');
select enum_has_labels('cms', 'membership_role', array['editor'], 'membership_role has the single v1 value editor');

-- Grants exactly as §4.5 and the plan (table level; no column grants on these tables).
select table_privs_are('cms', 'tenants', 'authenticated', array['SELECT'], 'authenticated: select on tenants');
select table_privs_are('cms', 'memberships', 'authenticated', array['SELECT'], 'authenticated: select on memberships');
select table_privs_are('cms', 'platform_admins', 'authenticated', array['SELECT'], 'authenticated: select on platform_admins');
select table_privs_are('cms', 'tenants', 'service_role', array['SELECT', 'INSERT', 'UPDATE'], 'service_role: select, insert, update on tenants');
select table_privs_are('cms', 'memberships', 'service_role', array['SELECT', 'INSERT', 'DELETE'], 'service_role: select, insert, delete on memberships');
select table_privs_are('cms', 'platform_admins', 'service_role', array['SELECT', 'INSERT', 'DELETE'], 'service_role: select, insert, delete on platform_admins');
select table_privs_are('cms', 'tenants', 'anon', array[]::text[], 'anon: nothing on tenants');
select table_privs_are('cms', 'memberships', 'anon', array[]::text[], 'anon: nothing on memberships');
select table_privs_are('cms', 'platform_admins', 'anon', array[]::text[], 'anon: nothing on platform_admins');

select tests.seed();

-- Seed: two tenants, two editor memberships (revoked's deleted), one platform admin.
select results_eq($$ select slug from cms.tenants order by slug $$, array['demo', 'labak'], 'seed inserts both tenants');
select results_eq($$ select tenant_id, user_id from cms.memberships order by user_id $$,
  $$ values (tests.tenant('labak'), tests.persona('editor_labak')), (tests.tenant('demo'), tests.persona('editor_demo')) $$,
  'seed leaves exactly the two editor memberships');
select results_eq($$ select user_id from cms.platform_admins $$, array[tests.persona('platform_admin')], 'seed registers the platform admin');

-- editor_labak
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select slug from cms.tenants $$, array['labak'], 'editor sees only own tenant');
select results_eq($$ select count(*)::int from cms.memberships $$, array[1], 'editor sees only own membership');
select is_empty($$ select 1 from cms.platform_admins $$, 'editor sees no platform admin row');
select throws_ok($$ insert into cms.memberships(tenant_id, user_id) values (tests.tenant('demo'), auth.uid()) $$,
  '42501', null, 'editor cannot add a membership');
select throws_ok($$ update cms.memberships set role = 'editor' $$, '42501', null, 'editor cannot change a membership');
select throws_ok($$ delete from cms.memberships $$, '42501', null, 'editor cannot delete a membership');
select throws_ok($$ update cms.tenants set status = 'suspended' $$, '42501', null, 'editor cannot update a tenant');
select throws_ok($$ insert into cms.platform_admins(user_id) values (auth.uid()) $$, '42501', null, 'editor cannot make itself a platform admin');

-- editor_demo
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select slug from cms.tenants $$, array['demo'], 'demo editor sees only its tenant');

-- outsider, revoked, anon
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from cms.tenants $$, 'user without membership sees no tenant');
select is_empty($$ select 1 from cms.memberships $$, 'user without membership sees no membership');
select tests.act_as(tests.persona('revoked'));
select is_empty($$ select 1 from cms.tenants $$, 'revoked member sees no tenant');
select is_empty($$ select 1 from cms.memberships $$, 'revoked member sees no membership');
select tests.act_as_anon();
select throws_ok($$ select 1 from cms.tenants $$, '42501', null, 'anon cannot read tenants');

-- platform_admin: console read of tenants needs aal2; no implicit access to memberships
select tests.act_as(tests.persona('platform_admin'), 'aal1');
select is_empty($$ select 1 from cms.tenants $$, 'platform admin without MFA sees no tenants');
select results_eq($$ select user_id from cms.platform_admins $$, array[tests.persona('platform_admin')], 'platform admin sees own platform_admins row');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select results_eq($$ select count(*)::int from cms.tenants $$, array[2], 'platform admin with aal2 sees all tenants');
select is_empty($$ select 1 from cms.memberships $$, 'platform admin with aal2 sees no other user''s membership');

-- Non-admins at aal2: the console policy also needs platform_admins membership (§4.5),
-- so aal2 alone (any user can enrol TOTP) grants no extra tenants.
select tests.act_as(tests.persona('editor_labak'), 'aal2');
select results_eq($$ select slug from cms.tenants $$, array['labak'], 'editor with aal2 still sees only own tenant');
select tests.act_as(tests.persona('outsider'), 'aal2');
select is_empty($$ select 1 from cms.tenants $$, 'user without membership at aal2 sees no tenant');

-- Tenant slug immutable (§4.1 rule 7), for the owner and for service_role (the CLI's writer).
select tests.act_as_owner();
select throws_ok($$ update cms.tenants set slug = 'other' where slug = 'labak' $$, 'P0001', 'slug_locked', 'tenant slug immutable');
select lives_ok($$ update cms.tenants set name = 'Annað nafn' where slug = 'labak' $$, 'other tenant columns stay updatable');
select tests.act_as_service();
select throws_ok($$ update cms.tenants set slug = 'other' where slug = 'labak' $$, 'P0001', 'slug_locked', 'tenant slug immutable for service_role');
select lives_ok($$ update cms.tenants set status = 'suspended' where slug = 'demo' $$, 'service_role can suspend a tenant');

-- Integrity (decision 2; status values; single role)
select tests.act_as_owner();
select throws_ok($$ insert into cms.tenants(slug, name) values ('Brauð', 'x') $$, '23514', null, 'tenant slug format enforced');
select throws_ok($$ insert into cms.tenants(slug, name) values ('labak', 'x') $$, '23505', null, 'tenant slug unique');
select throws_ok($$ insert into cms.tenants(slug, name, status) values ('nytt', 'x', 'deleted') $$, '23514', null, 'tenant status restricted');
select throws_ok($$ insert into cms.memberships(tenant_id, user_id, role) values (tests.tenant('demo'), tests.persona('outsider'), 'admin') $$,
  '22P02', null, 'membership role is editor only');

select * from finish();
rollback;
