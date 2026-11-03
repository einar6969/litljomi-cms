-- supabase/tests/database/104_draft_migration.test.sql
-- The draft migration's admin api (spec §5.3, §4.5; plan M2-13): api.admin_outdated_drafts lists a
-- tenant's drafts of one type below the current schema version, and api.admin_migrate_draft saves
-- one of them at a newer version as a versioned draft update, only if it is unchanged since it was
-- read. Both are service_role only. Revisions are never touched. The grants they need are pinned in
-- 030_content (drafts) and 040_refs (draft_refs); the function counts in 010_catalog and 100_escalation.
--
-- Fixtures (owner context):
--   c201 demo  notice draft schema 1, version 1; revision d201 at schema 1
--   c202 demo  notice draft schema 2 (current)
--   c203 demo  event  draft schema 1 (another type)
--   c204 labak notice draft schema 1 (another tenant)
--   c205 demo  notice draft schema 1, version 1
begin;
\ir _helpers.sql
select plan(28);

select tests.seed();
insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('c201'), tests.tenant('demo'), 'notice', tests.persona('editor_demo')),
  (tests.entry('c202'), tests.tenant('demo'), 'notice', tests.persona('editor_demo')),
  (tests.entry('c203'), tests.tenant('demo'), 'event', tests.persona('editor_demo')),
  (tests.entry('c204'), tests.tenant('labak'), 'notice', tests.persona('editor_labak')),
  (tests.entry('c205'), tests.tenant('demo'), 'notice', tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, updated_by) values
  (tests.entry('c201'), tests.tenant('demo'), 1, '{"heading": "Eitt"}', 'Eitt', tests.persona('editor_demo')),
  (tests.entry('c202'), tests.tenant('demo'), 2, '{"title": "Tvö"}', 'Tvö', tests.persona('editor_demo')),
  (tests.entry('c203'), tests.tenant('demo'), 1, '{}', null, tests.persona('editor_demo')),
  (tests.entry('c204'), tests.tenant('labak'), 1, '{"heading": "Labak"}', 'Labak', tests.persona('editor_labak')),
  (tests.entry('c205'), tests.tenant('demo'), 1, '{"heading": "Fimm"}', 'Fimm', tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  (tests.revision('d201'), tests.tenant('demo'), tests.entry('c201'), 1, 1, '{"heading": "Eitt"}', 'Eitt', tests.persona('editor_demo'));
create temporary table revisions_before as select * from cms.revisions;
grant select on revisions_before to service_role;

-- ---------------------------------------------------------------------------
-- Only service_role can call them.
select tests.act_as(tests.persona('editor_demo'));
select throws_ok($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 100) $$, '42501', null,
  'an editor cannot list outdated drafts');
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c201'), 1, 1, '{"title": "x"}', 2, 'x', null) $$, '42501', null,
  'an editor cannot migrate a draft');
select tests.act_as_anon();
select throws_ok($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 100) $$, '42501', null,
  'anon cannot list outdated drafts');

-- ---------------------------------------------------------------------------
-- admin_outdated_drafts
select tests.act_as_service();
select results_eq($$ select entry_id, version, schema_version, data from api.admin_outdated_drafts('demo', 'notice', 2, null, 100) $$,
  $$ values (tests.entry('c201'), 1, 1, '{"heading": "Eitt"}'::jsonb), (tests.entry('c205'), 1, 1, '{"heading": "Fimm"}'::jsonb) $$,
  'lists the tenant''s drafts of the type below the current version, in entry id order (not c202 current, c203 event, c204 labak)');
select results_eq($$ select entry_id from api.admin_outdated_drafts('demo', 'notice', 2, null, 1) $$,
  $$ values (tests.entry('c201')) $$, 'p_limit bounds a page');
select results_eq($$ select entry_id from api.admin_outdated_drafts('demo', 'notice', 2, tests.entry('c201'), 1) $$,
  $$ values (tests.entry('c205')) $$, 'p_after starts after that entry (keyset paging)');
select results_eq($$ select entry_id from api.admin_outdated_drafts('demo', 'notice', 2, null, 100, tests.entry('c205')) $$,
  $$ values (tests.entry('c205')) $$, 'p_entry_id narrows the result to one entry');
select is_empty($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 100, tests.entry('c202')) $$,
  'a draft at the current version is never listed, even by id');
select is_empty($$ select * from api.admin_outdated_drafts('demo', 'notice', 1, null, 100) $$,
  'nothing is below version 1');
select results_eq($$ select entry_id from api.admin_outdated_drafts('labak', 'notice', 2, null, 100) $$,
  $$ values (tests.entry('c204')) $$, 'another tenant''s drafts are listed only for that tenant');
select throws_ok($$ select * from api.admin_outdated_drafts('nope', 'notice', 2, null, 100) $$, 'P0001', 'not_found',
  'an unknown tenant is not_found');
select throws_ok($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 0) $$, '22023', null, 'p_limit 0 is refused');
select throws_ok($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 1001) $$, '22023', null,
  'p_limit above 1000 (max_rows) is refused');
select throws_ok($$ select * from api.admin_outdated_drafts('demo', 'notice', 0, null, 100) $$, '22023', null,
  'p_current_version 0 is refused');

-- ---------------------------------------------------------------------------
-- admin_migrate_draft
select is(api.admin_migrate_draft(tests.entry('c201'), 1, 1, '{"title": "Eitt"}', 2, 'Eitt', '2026-11-04'), 2,
  'saves c201 at schema version 2 and returns the new draft version');
select tests.act_as_owner();
select row_eq($$ select version, schema_version, data, title, sort_at, updated_by from cms.drafts where entry_id = tests.entry('c201') $$,
  row(2, 2, '{"title": "Eitt"}'::jsonb, 'Eitt'::text, '2026-11-04'::timestamptz, null::uuid),
  'the draft is a versioned update: version + 1, the new data and columns, updated_by null (a system write)');
select tests.act_as_service();
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c201'), 1, 1, '{"title": "Eitt"}', 2, 'Eitt', null) $$,
  'P0001', 'version_conflict', 'the same call again is version_conflict (the draft moved on)');
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c201'), 2, 1, '{"title": "Eitt"}', 3, 'Eitt', null) $$,
  'P0001', 'version_conflict', 'a draft no longer at the schema version that was read is version_conflict');
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c205'), 1, 1, '{"title": "x"}', 1, 'x', null) $$,
  '22023', null, 'the new schema version must be above the old one');
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c299'), 1, 1, '{"title": "x"}', 2, 'x', null) $$,
  'P0001', 'not_found', 'an entry without a draft is not_found');
select throws_ok($$ select api.admin_migrate_draft(tests.entry('c205'), 1, 1, '[]', 2, 'x', null) $$,
  '23514', null, 'the drafts data check still applies');
-- The references are rebuilt as on any draft save (drafts_sync_refs runs as service_role).
select is(api.admin_migrate_draft(tests.entry('c205'), 1, 1,
  '{"title": "Fimm", "x": {"_ref": "00000000-0000-4000-8000-00000000c201", "_kind": "entry"}}', 2, 'Fimm', null), 2,
  'saves c205 with a reference');
select results_eq($$ select path, target_entry_id from cms.draft_refs where entry_id = tests.entry('c205') $$,
  $$ values ('$."x"'::text, tests.entry('c201')) $$, 'c205''s draft_refs are rebuilt from the new data');
select is_empty($$ select * from api.admin_outdated_drafts('demo', 'notice', 2, null, 100) $$,
  'no demo notice draft is outdated any more (a second run finds nothing)');

-- service_role still cannot set the version or touch revisions.
select throws_ok($$ update cms.drafts set version = 99 where entry_id = tests.entry('c202') $$, '42501', null,
  'service_role cannot set drafts.version');
select throws_ok($$ update cms.revisions set schema_version = 2 $$, '42501', null, 'service_role cannot update revisions');
select set_eq($$ select * from cms.revisions $$, $$ select * from revisions_before $$,
  'revisions are exactly as before the migration');
select tests.act_as_owner();
select results_eq($$ select schema_version, data from cms.drafts where entry_id in (tests.entry('c202'), tests.entry('c203'), tests.entry('c204')) order by entry_id $$,
  $$ values (2, '{"title": "Tvö"}'::jsonb), (1, '{}'::jsonb), (1, '{"heading": "Labak"}'::jsonb) $$,
  'the other drafts are unchanged');

select * from finish();
rollback;
