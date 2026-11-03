-- supabase/tests/database/104_singletons.test.sql
-- Singletons (spec §3.2, §10.1; plan M2-09, decision 50.5): at most one live entry per singleton
-- type and tenant, enforced by the database for every insert path. api.create_singleton_entry
-- opens a singleton type (find or create); api.create_entry and direct INSERTs of a second entry
-- are refused; archived entries do not count; tenants are independent.
--
-- Fixtures: personas and tenants from tests.seed(). Types used: labak 'settings' and 'footer'
-- (singletons, created here), labak 'page' (ordinary entries c901, c902), demo 'settings'.
begin;
\ir _helpers.sql
select plan(35);

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c901'), tests.tenant('labak'), 'page', 'a', tests.persona('editor_labak')),
  (tests.entry('c902'), tests.tenant('labak'), 'page', 'b', tests.persona('editor_labak'));

-- ---------------------------------------------------------------------------
-- Catalog.
select has_column('cms', 'entries', 'singleton', 'entries has a singleton column');
select col_type_is('cms', 'entries', 'singleton', 'boolean', 'entries.singleton is boolean');
select col_not_null('cms', 'entries', 'singleton', 'entries.singleton is not null');
select col_default_is('cms', 'entries', 'singleton', 'false', 'entries.singleton defaults to false');
select is((select pg_catalog.pg_get_indexdef('cms.entries_tenant_type_singleton_key'::regclass)),
  'CREATE UNIQUE INDEX entries_tenant_type_singleton_key ON cms.entries USING btree (tenant_id, type) WHERE (singleton AND (archived_at IS NULL))',
  'one live singleton entry per tenant and type: partial unique index');
select is((select pg_catalog.pg_get_function_arguments('api.create_singleton_entry(uuid,text,integer)'::regprocedure)),
  'p_tenant_id uuid, p_type text, p_schema_version integer DEFAULT 1',
  'create_singleton_entry(tenant, type, schema version default 1)');
select is((select pg_catalog.pg_get_function_result('api.create_singleton_entry(uuid,text,integer)'::regprocedure)),
  'uuid', 'create_singleton_entry returns the entry id');
select ok((select not p.prosecdef and coalesce(p.proconfig @> array['search_path=""'], false)
           from pg_catalog.pg_proc p where p.oid = 'api.create_singleton_entry(uuid,text,integer)'::regprocedure),
  'create_singleton_entry is security invoker with search_path pinned to ''''');
select set_eq($$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'api.create_singleton_entry(uuid,text,integer)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('authenticated', 'EXECUTE') $$,
  'create_singleton_entry: EXECUTE for postgres (owner) and authenticated only');
select ok((select not p.prosecdef from pg_catalog.pg_proc p where p.oid = 'private.entries_check_singleton()'::regprocedure),
  'the singleton trigger function is security invoker');
select is_empty($$ select 1 from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'private.entries_check_singleton()'::regprocedure and a.grantee <> 'postgres'::regrole $$,
  'the singleton trigger function is granted to no API role');

-- ---------------------------------------------------------------------------
-- anon and service_role cannot call it.
select tests.act_as_anon();
select throws_ok($$ select api.create_singleton_entry(tests.tenant('labak'), 'settings') $$, '42501', null,
  'anon cannot call create_singleton_entry');
select tests.act_as_service();
select throws_ok($$ select api.create_singleton_entry(tests.tenant('labak'), 'settings') $$, '42501', null,
  'service_role cannot call create_singleton_entry');

-- ---------------------------------------------------------------------------
-- First open creates the entry and its draft; later opens return it.
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select set_config('tests.settings', api.create_singleton_entry(tests.tenant('labak'), 'settings', 2)::text, true) $$,
  'editor_labak opens labak settings the first time');
select results_eq($$ select tenant_id, type, slug, singleton, created_by, archived_at from cms.entries
     where id = current_setting('tests.settings')::uuid $$,
  $$ values (tests.tenant('labak'), 'settings'::text, null::text, true, tests.persona('editor_labak'), null::timestamptz) $$,
  'the singleton entry: labak, settings, no slug, singleton, created by the editor');
select results_eq($$ select version, data, schema_version from cms.drafts where entry_id = current_setting('tests.settings')::uuid $$,
  $$ values (1, '{}'::jsonb, 2) $$, 'its draft: version 1, empty data, the given schema version');
select is(api.create_singleton_entry(tests.tenant('labak'), 'settings'), current_setting('tests.settings')::uuid,
  'opening it again returns the same entry');
select is((select count(*)::int from cms.entries where tenant_id = tests.tenant('labak') and type = 'settings'), 1,
  'still one settings entry in labak');

-- ---------------------------------------------------------------------------
-- A second entry is refused on every path.
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'settings') $$, 'P0001', 'singleton_exists',
  'create_entry of a singleton type that has its entry: singleton_exists');
select throws_ok($$ insert into cms.entries (tenant_id, type) values (tests.tenant('labak'), 'settings') $$, 'P0001', 'singleton_exists',
  'editor: direct INSERT of a non-singleton entry of the type: singleton_exists');
select throws_ok($$ insert into cms.entries (tenant_id, type, singleton) values (tests.tenant('labak'), 'settings', true) $$, '23505', null,
  'editor: direct INSERT of a second singleton entry: 23505 (the unique index)');
select tests.act_as_owner();
select throws_ok($$ insert into cms.entries (tenant_id, type, created_by) values (tests.tenant('labak'), 'settings', tests.persona('editor_labak')) $$,
  'P0001', 'singleton_exists', 'owner: direct INSERT of a non-singleton entry: singleton_exists');
-- The index holds without the trigger.
alter table cms.entries disable trigger entries_check_singleton;
select throws_ok($$ insert into cms.entries (tenant_id, type, singleton, created_by) values (tests.tenant('labak'), 'settings', true, tests.persona('editor_labak')) $$,
  '23505', null, 'owner, trigger disabled: a second singleton entry is still refused by the index');
alter table cms.entries enable trigger entries_check_singleton;
-- Un-archiving an archived non-singleton entry of the type is mixing too.
insert into cms.entries (id, tenant_id, type, created_by, archived_at)
  values (tests.entry('c903'), tests.tenant('labak'), 'settings', tests.persona('editor_labak'), now());
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ update cms.entries set archived_at = null where id = tests.entry('c903') $$, 'P0001', 'singleton_exists',
  'editor: un-archiving another entry of a singleton type: singleton_exists');
select is((select count(*)::int from cms.entries where tenant_id = tests.tenant('labak') and type = 'settings' and archived_at is null), 1,
  'after every refused path: one live settings entry in labak');

-- ---------------------------------------------------------------------------
-- A type that has ordinary entries cannot become a singleton.
select throws_ok($$ select api.create_singleton_entry(tests.tenant('labak'), 'page') $$, 'P0001', 'singleton_mismatch',
  'create_singleton_entry of a type with live ordinary entries: singleton_mismatch');
select throws_ok($$ insert into cms.entries (tenant_id, type, singleton) values (tests.tenant('labak'), 'page', true) $$, 'P0001', 'singleton_mismatch',
  'editor: direct INSERT of a singleton entry of that type: singleton_mismatch');
select lives_ok($$ select api.create_entry(tests.tenant('labak'), 'page') $$, 'ordinary types are unaffected');

-- ---------------------------------------------------------------------------
-- Archiving the singleton entry frees the type.
select lives_ok($$ select set_config('tests.footer', api.create_singleton_entry(tests.tenant('labak'), 'footer')::text, true) $$,
  'labak footer opened');
select lives_ok($$ select api.archive_entry(current_setting('tests.footer')::uuid) $$, 'the footer entry is archived');
select isnt(api.create_singleton_entry(tests.tenant('labak'), 'footer'), current_setting('tests.footer')::uuid,
  'opening footer after archiving creates a new entry');

-- ---------------------------------------------------------------------------
-- Tenants are independent; non-members get nothing.
select throws_ok($$ select api.create_singleton_entry(tests.tenant('demo'), 'settings') $$, 'P0001', 'not_found',
  'editor_labak opens demo settings: not_found');
select throws_ok($$ insert into cms.entries (tenant_id, type, singleton) values (tests.tenant('demo'), 'settings', true) $$, '42501', null,
  'editor_labak: direct INSERT into demo: 42501 (RLS)');
select tests.act_as(tests.persona('editor_demo'));
select isnt(api.create_singleton_entry(tests.tenant('demo'), 'settings'), current_setting('tests.settings')::uuid,
  'editor_demo opens demo settings: its own entry, not labak''s');
select tests.act_as(tests.persona('outsider'));
select throws_ok($$ select api.create_singleton_entry(tests.tenant('labak'), 'settings') $$, 'P0001', 'not_found',
  'outsider: not_found');

select * from finish();
rollback;
