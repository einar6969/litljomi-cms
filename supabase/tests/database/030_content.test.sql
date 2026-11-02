-- supabase/tests/database/030_content.test.sql
-- Entries, drafts, revisions (spec §4.1 rule 3, §4.3, §4.5, §5.5, §8.5; plan Task 6,
-- decisions 2, 3, 11 and 17).
--
-- Fixture rows (inserted below in owner context; UUIDs are literals because psql
-- variables are not expanded inside the $$ strings that pgTAP executes):
--   entry    ...c001  labak  news  slug braud-arsins-2025  unpublished, draft v1
--   entry    ...c002  labak  news  slug utgefin-frett      published (revision ...d001), draft v1
--   entry    ...c003  demo   news  slug demo-frett         unpublished, revision ...d002, draft v1
--   entry    ...c004  labak  news  no slug                 no draft
--   revision ...d001  labak, of c002
--   revision ...d002  demo, of c003
begin;
\ir _helpers.sql
select plan(88);

select has_table('cms', 'entries', 'cms.entries exists');
select has_table('cms', 'drafts', 'cms.drafts exists');
select has_table('cms', 'revisions', 'cms.revisions exists');
-- Status is derived, never stored on the entry (§4.3).
select hasnt_column('cms', 'entries', 'status', 'entries has no stored status column');

-- Grants exactly as §4.5 and the plan. Table level first: SELECT only for
-- authenticated; INSERT and UPDATE for authenticated are per column (below).
select table_privs_are('cms', 'entries', 'authenticated', array['SELECT'], 'authenticated: table-level select only on entries');
select table_privs_are('cms', 'drafts', 'authenticated', array['SELECT'], 'authenticated: table-level select only on drafts');
select table_privs_are('cms', 'revisions', 'authenticated', array['SELECT'], 'authenticated: select only on revisions');
select table_privs_are('cms', 'entries', 'service_role', array['SELECT'], 'service_role: table-level select only on entries');
select table_privs_are('cms', 'drafts', 'service_role', array['SELECT'], 'service_role: select only on drafts');
select table_privs_are('cms', 'revisions', 'service_role', array['SELECT', 'INSERT'], 'service_role: select, insert on revisions');
select table_privs_are('cms', 'entries', 'anon', array[]::text[], 'anon: nothing on entries');
select table_privs_are('cms', 'drafts', 'anon', array[]::text[], 'anon: nothing on drafts');
select table_privs_are('cms', 'revisions', 'anon', array[]::text[], 'anon: nothing on revisions');

-- Column privileges: every (column, privilege) pair a role holds for INSERT,
-- UPDATE or REFERENCES, whether granted per column or for the whole table.
create function tests.column_privs(p_role text, p_table regclass)
returns table (col text, priv text)
language sql
set search_path = ''
as $$
  select a.attname::text, p.priv
  from pg_catalog.pg_attribute a
  cross join (values ('INSERT'), ('UPDATE'), ('REFERENCES')) as p(priv)
  where a.attrelid = p_table and a.attnum > 0 and not a.attisdropped
    and pg_catalog.has_column_privilege(p_role, a.attrelid, a.attnum, p.priv)
$$;

select set_eq($$ select * from tests.column_privs('authenticated', 'cms.entries') $$,
  $$ values ('tenant_id', 'INSERT'), ('type', 'INSERT'), ('slug', 'INSERT'), ('created_by', 'INSERT'),
            ('slug', 'UPDATE'), ('archived_at', 'UPDATE') $$,
  'authenticated: insert (tenant_id, type, slug, created_by), update (slug, archived_at) on entries');
select set_eq($$ select * from tests.column_privs('authenticated', 'cms.drafts') $$,
  $$ values ('entry_id', 'INSERT'), ('tenant_id', 'INSERT'), ('schema_version', 'INSERT'), ('data', 'INSERT'),
            ('title', 'INSERT'), ('sort_at', 'INSERT'), ('updated_by', 'INSERT'),
            ('data', 'UPDATE'), ('schema_version', 'UPDATE'), ('title', 'UPDATE'), ('sort_at', 'UPDATE'),
            ('updated_at', 'UPDATE'), ('updated_by', 'UPDATE') $$,
  'authenticated: insert and update columns on drafts exactly §4.5 (never version)');
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.revisions') $$,
  'authenticated: no insert, update or references on any revisions column');
select set_eq($$ select * from tests.column_privs('service_role', 'cms.entries') $$,
  $$ values ('published_rev_id', 'UPDATE'), ('published_draft_version', 'UPDATE'),
            ('first_published_at', 'UPDATE'), ('last_published_at', 'UPDATE') $$,
  'service_role: update only the publish pointer and timestamps on entries');
select is_empty($$ select * from tests.column_privs('service_role', 'cms.drafts') $$,
  'service_role: no insert, update or references on any drafts column');
select set_eq($$ select * from tests.column_privs('service_role', 'cms.revisions') $$,
  $$ select a.attname::text, 'INSERT' from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.revisions'::regclass and a.attnum > 0 and not a.attisdropped $$,
  'service_role: insert (table level) and nothing else on revisions');
-- Revisions are append-only (§4.3): no UPDATE or DELETE for the service role either.
select ok(not has_table_privilege('service_role', 'cms.revisions', 'update'), 'revisions not updatable');
select ok(not has_table_privilege('service_role', 'cms.revisions', 'delete'), 'revisions not deletable');

-- Fixtures (owner context: auth.uid() is null, so actor columns keep the given values).
select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  ('00000000-0000-4000-8000-00000000c001', tests.tenant('labak'), 'news', 'braud-arsins-2025', tests.persona('editor_labak')),
  ('00000000-0000-4000-8000-00000000c002', tests.tenant('labak'), 'news', 'utgefin-frett', tests.persona('editor_labak')),
  ('00000000-0000-4000-8000-00000000c003', tests.tenant('demo'), 'news', 'demo-frett', tests.persona('editor_demo')),
  ('00000000-0000-4000-8000-00000000c004', tests.tenant('labak'), 'news', null, tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, updated_by) values
  ('00000000-0000-4000-8000-00000000c001', tests.tenant('labak'), 1, '{"title": "Brauð ársins 2025"}', 'Brauð ársins 2025', tests.persona('editor_labak')),
  ('00000000-0000-4000-8000-00000000c002', tests.tenant('labak'), 1, '{"title": "Útgefin frétt"}', 'Útgefin frétt', tests.persona('editor_labak')),
  ('00000000-0000-4000-8000-00000000c003', tests.tenant('demo'), 1, '{"title": "Demo"}', 'Demo', tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  ('00000000-0000-4000-8000-00000000d001', tests.tenant('labak'), '00000000-0000-4000-8000-00000000c002', 1, 1, '{"title": "Útgefin frétt"}', 'Útgefin frétt', tests.persona('editor_labak')),
  ('00000000-0000-4000-8000-00000000d002', tests.tenant('demo'), '00000000-0000-4000-8000-00000000c003', 1, 1, '{"title": "Demo"}', 'Demo', tests.persona('editor_demo'));
update cms.entries
  set published_rev_id = '00000000-0000-4000-8000-00000000d001', published_draft_version = 1,
      first_published_at = now(), last_published_at = now()
  where id = '00000000-0000-4000-8000-00000000c002';
select is((select created_by from cms.entries where id = '00000000-0000-4000-8000-00000000c003'),
  tests.persona('editor_demo'), 'owner context (auth.uid() null) keeps the given created_by');

-- Isolation: each editor reads only its own tenant's rows (§4.5 tenant policy).
select tests.act_as(tests.persona('editor_labak'));
select set_eq($$ select id from cms.entries $$,
  array['00000000-0000-4000-8000-00000000c001'::uuid, '00000000-0000-4000-8000-00000000c002',
        '00000000-0000-4000-8000-00000000c004'], 'labak editor sees only labak entries');
select set_eq($$ select entry_id from cms.drafts $$,
  array['00000000-0000-4000-8000-00000000c001'::uuid, '00000000-0000-4000-8000-00000000c002'], 'labak editor sees only labak drafts');
select set_eq($$ select id from cms.revisions $$,
  array['00000000-0000-4000-8000-00000000d001'::uuid], 'labak editor sees only labak revisions');
select tests.act_as(tests.persona('editor_demo'));
select set_eq($$ select id from cms.entries $$,
  array['00000000-0000-4000-8000-00000000c003'::uuid], 'demo editor sees only demo entries');
select throws_ok($$ insert into cms.entries(tenant_id, type) values (tests.tenant('labak'), 'news') $$,
  '42501', null, 'cannot create in another tenant');
select throws_ok($$ insert into cms.drafts(entry_id, tenant_id, schema_version)
  values ('00000000-0000-4000-8000-00000000c004', tests.tenant('labak'), 1) $$,
  '42501', null, 'cannot create a draft in another tenant');
-- Composite foreign key (§4.1 rule 3): a draft in the editor's own tenant cannot
-- point at another tenant's entry.
select throws_ok($$ insert into cms.drafts(entry_id, tenant_id, schema_version)
  values ('00000000-0000-4000-8000-00000000c004', tests.tenant('demo'), 1) $$,
  '23503', null, 'draft cannot reference an entry of another tenant');
select is_empty($$ update cms.entries set slug = 'tekid' where id = '00000000-0000-4000-8000-00000000c001' returning id $$,
  'demo editor cannot update a labak entry');
select is_empty($$ update cms.drafts set title = 'x' where entry_id = '00000000-0000-4000-8000-00000000c001' returning entry_id $$,
  'demo editor cannot update a labak draft');
-- Without a WHERE or RETURNING clause an UPDATE reads no column, so the SELECT
-- policy does not filter its rows and only the UPDATE policy keeps labak's rows
-- out of reach.
update cms.entries set archived_at = now();
update cms.drafts set title = 'Yfirtekið';
select tests.act_as_owner();
select is_empty($$ select 1 from cms.entries where tenant_id = tests.tenant('labak') and archived_at is not null $$,
  'an unfiltered update by the demo editor leaves labak entries alone');
select is_empty($$ select 1 from cms.drafts where tenant_id = tests.tenant('labak') and title = 'Yfirtekið' $$,
  'an unfiltered update by the demo editor leaves labak drafts alone');

-- Users without a membership, revoked members, platform admins (no content
-- clause, even at aal2) and anon see nothing.
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from cms.entries $$, 'user without membership sees no entry');
select is_empty($$ select 1 from cms.drafts $$, 'user without membership sees no draft');
select is_empty($$ select 1 from cms.revisions $$, 'user without membership sees no revision');
select throws_ok($$ insert into cms.entries(tenant_id, type) values (tests.tenant('labak'), 'news') $$,
  '42501', null, 'user without membership cannot create an entry');
select tests.act_as(tests.persona('revoked'));
select is_empty($$ select 1 from cms.entries $$, 'revoked member sees no entry');
select throws_ok($$ insert into cms.entries(tenant_id, type) values (tests.tenant('labak'), 'news') $$,
  '42501', null, 'revoked member cannot create an entry');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from cms.entries $$, 'platform admin with aal2 sees no entry (no implicit content access)');
select is_empty($$ select 1 from cms.drafts $$, 'platform admin with aal2 sees no draft');
select is_empty($$ select 1 from cms.revisions $$, 'platform admin with aal2 sees no revision');
select tests.act_as_anon();
select throws_ok($$ select 1 from cms.entries $$, '42501', null, 'anon cannot read entries (no privilege)');

-- Worker-owned columns and history (§4.5 per-column grants; §4.3 append-only).
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ update cms.entries set published_rev_id = gen_random_uuid() $$,
  '42501', null, 'editor cannot set publish pointer');
select throws_ok($$ update cms.entries set first_published_at = now() $$,
  '42501', null, 'editor cannot set publish timestamps');
select throws_ok($$ update cms.drafts set version = 99 $$, '42501', null, 'editor cannot set draft version');
select throws_ok($$ insert into cms.revisions(tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), gen_random_uuid(), 1, 1, '{}', auth.uid()) $$, '42501', null, 'editor cannot insert revisions');
select throws_ok($$ update cms.revisions set data = '{}' $$, '42501', null, 'editor cannot update revisions');
select throws_ok($$ delete from cms.revisions $$, '42501', null, 'editor cannot delete revisions');
select throws_ok($$ delete from cms.entries $$, '42501', null, 'editor cannot delete entries');
select throws_ok($$ delete from cms.drafts $$, '42501', null, 'editor cannot delete drafts');

-- Integrity of drafts (§4.3): data is a JSON object of at most 1 MB; version
-- increments by exactly 1 on every update and is set by the trigger only.
select throws_ok($$ update cms.drafts set data = '[]'::jsonb $$, '23514', null, 'data must be an object');
select throws_ok($$ update cms.drafts set data = jsonb_build_object('x', repeat('a', 1048577)) $$, '23514', null, 'data at most 1 MB');
select lives_ok($$ update cms.drafts set data = '{"title": "Nýtt"}', updated_at = '2000-01-01'
  where entry_id = '00000000-0000-4000-8000-00000000c001' $$, 'editor saves a draft');
select is((select version from cms.drafts where entry_id = '00000000-0000-4000-8000-00000000c001'), 2,
  'update bumps version by exactly 1');
select is((select updated_at from cms.drafts where entry_id = '00000000-0000-4000-8000-00000000c001'), now(),
  'updated_at is set by the database on update');
select lives_ok($$ update cms.drafts set title = 'Bara titill' where entry_id = '00000000-0000-4000-8000-00000000c001' $$,
  'editor updates the title only');
select is((select version from cms.drafts where entry_id = '00000000-0000-4000-8000-00000000c001'), 3,
  'an update that leaves data unchanged still bumps version');
select tests.act_as_owner();
update cms.drafts set version = 99, data = '{"title": "Eigandi"}' where entry_id = '00000000-0000-4000-8000-00000000c001';
select is((select version from cms.drafts where entry_id = '00000000-0000-4000-8000-00000000c001'), 4,
  'even the owner cannot set version: data changes only with version + 1');

-- Slugs (decision 2; §4.3 partial unique; review focus 5).
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ insert into cms.entries(tenant_id, type, slug) values (tests.tenant('labak'), 'news', 'Brauð') $$,
  '23514', null, 'slug format enforced');
select throws_ok($$ insert into cms.entries(tenant_id, type, slug) values (tests.tenant('labak'), 'news', 'braud-arsins-2025') $$,
  '23505', null, 'slug unique per tenant and type');
select lives_ok($$ insert into cms.entries(tenant_id, type, slug) values (tests.tenant('labak'), 'page', 'braud-arsins-2025') $$,
  'same slug allowed for another type in the same tenant');
select lives_ok($$ insert into cms.entries(tenant_id, type) values (tests.tenant('labak'), 'news'),
  (tests.tenant('labak'), 'news') $$, 'several entries without a slug');
select tests.act_as(tests.persona('editor_demo'));
select lives_ok($$ insert into cms.entries(tenant_id, type, slug) values (tests.tenant('demo'), 'news', 'braud-arsins-2025') $$,
  'same slug allowed in another tenant');

-- Actor columns cannot be spoofed (decision 11).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ insert into cms.entries(tenant_id, type, slug, created_by)
  values (tests.tenant('labak'), 'news', 'hver-skrifadi', tests.persona('outsider')) $$, 'editor inserts an entry naming another user');
-- Identified by slug: created_at is the transaction time, the same for every row here.
select is((select created_by from cms.entries where slug = 'hver-skrifadi'), tests.persona('editor_labak'),
  'created_by forced to auth.uid()');
select lives_ok($$ insert into cms.drafts(entry_id, tenant_id, schema_version, updated_by)
  select id, tenant_id, 1, tests.persona('outsider') from cms.entries where slug = 'hver-skrifadi' $$,
  'editor inserts a draft naming another user');
select is((select d.updated_by from cms.drafts d join cms.entries e on e.id = d.entry_id where e.slug = 'hver-skrifadi'),
  tests.persona('editor_labak'), 'drafts.updated_by forced to auth.uid() on insert');
select is((select d.version from cms.drafts d join cms.entries e on e.id = d.entry_id where e.slug = 'hver-skrifadi'),
  1, 'a new draft starts at version 1');
select lives_ok($$ update cms.drafts set updated_by = tests.persona('outsider')
  where entry_id = '00000000-0000-4000-8000-00000000c002' $$, 'editor updates a draft naming another user');
select is((select updated_by from cms.drafts where entry_id = '00000000-0000-4000-8000-00000000c002'),
  tests.persona('editor_labak'), 'drafts.updated_by forced to auth.uid() on update');

-- Slug lock (§4.3, decision 3): immutable once first_published_at is set (c002).
select lives_ok($$ update cms.entries set slug = 'nytt-heiti' where id = '00000000-0000-4000-8000-00000000c001' $$,
  'slug changes freely before first publish');
select throws_ok($$ update cms.entries set slug = 'nytt' where id = '00000000-0000-4000-8000-00000000c002' $$,
  'P0001', 'slug_locked', 'slug immutable after first publish');
select throws_ok($$ update cms.entries set slug = null where id = '00000000-0000-4000-8000-00000000c002' $$,
  'P0001', 'slug_locked', 'slug cannot be cleared after first publish');
select lives_ok($$ update cms.entries set slug = 'utgefin-frett' where id = '00000000-0000-4000-8000-00000000c002' $$,
  'setting the same slug after publish is not a change');
select tests.act_as_owner();
select throws_ok($$ update cms.entries set slug = 'nytt' where id = '00000000-0000-4000-8000-00000000c002' $$,
  'P0001', 'slug_locked', 'slug immutable after first publish, for the owner too');
select lives_ok($$ update cms.entries set last_published_at = now() where id = '00000000-0000-4000-8000-00000000c002' $$,
  'other columns of a published entry stay updatable');
-- The lock sees the final row, whatever other triggers run: a BEFORE UPDATE
-- trigger whose name sorts after the lock's cannot change the slug.
create function tests.probe_change_slug() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.slug := 'probe';
  return new;
end;
$$;
create trigger zz_probe_change_slug before update on cms.entries
  for each row execute function tests.probe_change_slug();
select throws_ok($$ update cms.entries set last_published_at = now() where id = '00000000-0000-4000-8000-00000000c002' $$,
  'P0001', 'slug_locked', 'a later BEFORE trigger cannot change a published slug');
drop trigger zz_probe_change_slug on cms.entries;
-- An archived entry's slug is free again (the unique index is partial).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ update cms.entries set archived_at = now() where id = '00000000-0000-4000-8000-00000000c001' $$,
  'editor archives an unpublished entry');
select lives_ok($$ insert into cms.entries(tenant_id, type, slug) values (tests.tenant('labak'), 'news', 'nytt-heiti') $$,
  'an archived entry''s slug can be reused');

-- Revisions and the publish pointer (§4.3): the worker (service_role) appends
-- revisions; the pointer must name a revision of the same entry and tenant.
select tests.act_as_service();
select lives_ok($$ insert into cms.revisions(id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values ('00000000-0000-4000-8000-00000000d003', tests.tenant('labak'), '00000000-0000-4000-8000-00000000c002', 2, 1, '{}',
          tests.persona('editor_labak')) $$, 'service_role appends a revision');
select throws_ok($$ insert into cms.revisions(tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('demo'), '00000000-0000-4000-8000-00000000c002', 1, 1, '{}', tests.persona('editor_labak')) $$,
  '23503', null, 'revision cannot reference an entry of another tenant');
select lives_ok($$ update cms.entries set published_rev_id = '00000000-0000-4000-8000-00000000d003', published_draft_version = 2
  where id = '00000000-0000-4000-8000-00000000c002' $$, 'pointer to a revision of the same entry');
select throws_ok($$ update cms.entries set published_rev_id = '00000000-0000-4000-8000-00000000d003'
  where id = '00000000-0000-4000-8000-00000000c001' $$, '23503', null, 'pointer cannot name a revision of another entry');
select throws_ok($$ update cms.entries set published_rev_id = '00000000-0000-4000-8000-00000000d002'
  where id = '00000000-0000-4000-8000-00000000c002' $$, '23503', null, 'pointer cannot name a revision of another tenant');
select throws_ok($$ update cms.revisions set data = '{"x": 1}' $$, '42501', null, 'service_role cannot update revisions');
select throws_ok($$ delete from cms.revisions $$, '42501', null, 'service_role cannot delete revisions');
select throws_ok($$ update cms.entries set slug = 'nytt' $$, '42501', null, 'service_role cannot update slugs');

select * from finish();
rollback;
