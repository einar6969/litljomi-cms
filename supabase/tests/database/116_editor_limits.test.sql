-- supabase/tests/database/116_editor_limits.test.sql
-- M5-02 (findings 3, 4 and 5 of docs/verification/m5-review.md; spec §4.3, §4.5, §4.6; decision 65;
-- migrations 20261105140000_editor_limits and 20261105140100_view_data_removal):
--   1. No view in api reads drafts.data or revisions.data, so PostgREST can neither bulk-read it
--      nor run a filter over it.
--   2. api.entry_detail_by_id and api.revision_detail_by_id read one row's data, as the invoker
--      under RLS: the persona matrix for both.
--   3. Length limits on the text an editor writes, refused before the audit copy.
--   4. A request's stored error is bounded before the audit trigger copies it.
--   5. authenticated runs with a 3 s statement timeout.
-- The same refusals over real HTTP are in tests/integration/src/editor-limits.test.ts.
--
-- Fixtures: personas and tenants from tests.seed(). labak news ce01 is published at revision de01,
-- labak news ce03 never was; demo news ce02 has revision de02. tests.k('xxxx') =
-- 00000000-0000-4000-8000-00000000xxxx, for assets and requests.
begin;
\ir _helpers.sql
select plan(44);

create function tests.k(p_key text) returns uuid
language sql
set search_path = ''
as $$ select ('00000000-0000-4000-8000-00000000' || p_key)::uuid $$;
grant execute on function tests.k(text) to authenticated, service_role;

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('ce01'), tests.tenant('labak'), 'news', 'frett', tests.persona('editor_labak')),
  (tests.entry('ce03'), tests.tenant('labak'), 'news', 'ny-frett', tests.persona('editor_labak')),
  (tests.entry('ce02'), tests.tenant('demo'), 'news', 'demo-frett', tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, title) values
  (tests.entry('ce01'), tests.tenant('labak'), 3, '{"title": "Drög"}', 'Drög'),
  (tests.entry('ce03'), tests.tenant('labak'), 1, '{}', null),
  (tests.entry('ce02'), tests.tenant('demo'), 1, '{"title": "Demo"}', 'Demo');
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  (tests.revision('de01'), tests.tenant('labak'), tests.entry('ce01'), 1, 2, '{"title": "Birt"}', 'Birt',
   tests.persona('editor_labak')),
  (tests.revision('de02'), tests.tenant('demo'), tests.entry('ce02'), 1, 1, '{"title": "Demo"}', 'Demo',
   tests.persona('editor_demo'));
update cms.entries set published_rev_id = tests.revision('de01'), published_draft_version = 1,
  first_published_at = '2026-11-01 10:00+00', last_published_at = now() where id = tests.entry('ce01');

-- ---------------------------------------------------------------------------
-- 1. No exposed view reads the data columns, by any name.
select is_empty($$ select v.relname::text
     from pg_catalog.pg_rewrite r
     join pg_catalog.pg_class v on v.oid = r.ev_class
     join pg_catalog.pg_namespace n on n.oid = v.relnamespace
     join pg_catalog.pg_depend d on d.classid = 'pg_catalog.pg_rewrite'::regclass and d.objid = r.oid
     join pg_catalog.pg_attribute a on a.attrelid = d.refobjid and a.attnum = d.refobjsubid
     where n.nspname = 'api' and d.refclassid = 'pg_catalog.pg_class'::regclass
       and d.refobjid in ('cms.drafts'::regclass, 'cms.revisions'::regclass) and a.attname = 'data' $$,
  'no api view reads drafts.data or revisions.data');
select is_empty($$ select c.relname::text
     from pg_catalog.pg_attribute a
     join pg_catalog.pg_class c on c.oid = a.attrelid
     join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'api' and a.attname = 'data' and a.attnum > 0 and not a.attisdropped $$,
  'no relation in api has a data column');

-- ---------------------------------------------------------------------------
-- 2. The by-id reads: one id, one document, so nothing can be read or filtered across rows.
select set_eq($$ select p.proname::text, pg_catalog.pg_get_function_arguments(p.oid), pg_catalog.pg_get_function_result(p.oid),
            p.prosecdef, p.proretset, p.provolatile::text, p.proconfig
     from pg_catalog.pg_proc p
     where p.oid in ('api.entry_detail_by_id(uuid)'::regprocedure, 'api.revision_detail_by_id(uuid)'::regprocedure) $$,
  $$ values ('entry_detail_by_id', 'p_entry_id uuid', 'jsonb', false, false, 's', array['search_path=""']),
            ('revision_detail_by_id', 'p_revision_id uuid', 'jsonb', false, false, 's', array['search_path=""']) $$,
  'by-id reads: stable, security invoker, search_path pinned, one jsonb value');
select set_eq($$ select p.proname::text, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in ('api.entry_detail_by_id(uuid)'::regprocedure, 'api.revision_detail_by_id(uuid)'::regprocedure) $$,
  $$ values ('entry_detail_by_id', 'postgres', 'EXECUTE'), ('entry_detail_by_id', 'authenticated', 'EXECUTE'),
            ('revision_detail_by_id', 'postgres', 'EXECUTE'), ('revision_detail_by_id', 'authenticated', 'EXECUTE') $$,
  'by-id reads: EXECUTE for the owner and authenticated only');

select tests.act_as(tests.persona('editor_labak'));
select is(api.entry_detail_by_id(tests.entry('ce01')),
  jsonb_build_object('id', tests.entry('ce01'), 'tenant_id', tests.tenant('labak'), 'type', 'news', 'slug', 'frett',
    'data', '{"title": "Drög"}'::jsonb, 'schema_version', 3, 'draft_version', 1, 'published_draft_version', 1,
    'first_published_at', to_jsonb('2026-11-01 10:00+00'::timestamptz), 'status', 'published'),
  'entry_detail_by_id: an editor reads their entry, with the view''s columns and the data');
select is(api.revision_detail_by_id(tests.revision('de01')) ->> 'entry_id', tests.entry('ce01')::text,
  'revision_detail_by_id: an editor reads their revision');
select is(api.revision_detail_by_id(tests.revision('de01')) - 'committed_at',
  jsonb_build_object('id', tests.revision('de01'), 'tenant_id', tests.tenant('labak'), 'entry_id', tests.entry('ce01'),
    'draft_version', 1, 'schema_version', 2, 'data', '{"title": "Birt"}'::jsonb, 'title', 'Birt',
    'requested_by', tests.persona('editor_labak'), 'is_published', true),
  'revision_detail_by_id: the view''s columns and the data');
select is(api.entry_detail_by_id(tests.entry('ce02')), null, 'an editor gets nothing for another tenant''s entry');
select is(api.revision_detail_by_id(tests.revision('de02')), null, 'an editor gets nothing for another tenant''s revision');
select is(api.entry_detail_by_id(gen_random_uuid()), null, 'an unknown entry is null');
select is(api.revision_detail_by_id(gen_random_uuid()), null, 'an unknown revision is null');

select tests.act_as(tests.persona('editor_demo'));
select is(api.entry_detail_by_id(tests.entry('ce01')), null, 'editor_demo gets nothing for a labak entry');
select is(api.revision_detail_by_id(tests.revision('de01')), null, 'editor_demo gets nothing for a labak revision');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is(api.entry_detail_by_id(tests.entry('ce01')), null, 'platform admin at aal2: no entry (§4.5)');
select is(api.revision_detail_by_id(tests.revision('de01')), null, 'platform admin at aal2: no revision (§4.5)');
select tests.act_as(tests.persona('outsider'));
select is(api.entry_detail_by_id(tests.entry('ce01')), null, 'an outsider gets no entry');
select is(api.revision_detail_by_id(tests.revision('de01')), null, 'an outsider gets no revision');
select tests.act_as(tests.persona('revoked'));
select is(api.entry_detail_by_id(tests.entry('ce01')), null, 'a revoked member gets no entry');
select is(api.revision_detail_by_id(tests.revision('de01')), null, 'a revoked member gets no revision');
select tests.act_as_anon();
select throws_ok($$ select api.entry_detail_by_id(tests.entry('ce01')) $$, '42501', null, 'anon cannot call entry_detail_by_id');
select throws_ok($$ select api.revision_detail_by_id(tests.revision('de01')) $$, '42501', null, 'anon cannot call revision_detail_by_id');
select tests.act_as_service();
select throws_ok($$ select api.entry_detail_by_id(tests.entry('ce01')) $$, '42501', null, 'service_role cannot call entry_detail_by_id');
select throws_ok($$ select api.revision_detail_by_id(tests.revision('de01')) $$, '42501', null, 'service_role cannot call revision_detail_by_id');

-- ---------------------------------------------------------------------------
-- 3. Length limits, at the limit and one past it, through the api an editor calls.
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ select api.create_entry(tests.tenant('labak'), repeat('t', 100), repeat('a', 200)) $$,
  'create_entry: a type of 100 and a slug of 200 characters are stored');
select throws_ok($$ select api.create_entry(tests.tenant('labak'), repeat('t', 101)) $$, '23514', null,
  'create_entry refuses a type of 101 characters');
select throws_ok($$ select api.create_entry(tests.tenant('labak'), 'news', repeat('a', 201)) $$, '23514', null,
  'create_entry refuses a slug of 201 characters');
select throws_ok($$ select api.create_singleton_entry(tests.tenant('labak'), repeat('t', 101)) $$, '23514', null,
  'create_singleton_entry refuses a type of 101 characters');

select lives_ok($$ select api.save_draft(tests.entry('ce01'), 1, '{}', 3, repeat('þ', 500), null) $$,
  'save_draft: a title of 500 characters is stored, counted in characters, not bytes');
select throws_ok($$ select api.save_draft(tests.entry('ce01'), 2, '{}', 3, repeat('t', 501), null) $$, '23514', null,
  'save_draft refuses a title of 501 characters');

select lives_ok($$ select api.set_slug(tests.entry('ce03'), repeat('b', 200)) $$, 'set_slug: a slug of 200 characters is stored');
select throws_ok($$ select api.set_slug(tests.entry('ce03'), repeat('b', 201)) $$, '23514', null,
  'set_slug refuses a slug of 201 characters');

-- register_asset requires the path to name the filename, so the filename limit bounds the path.
select lives_ok(format($f$ select api.register_asset(%L, %L, %L, %L, 'image/jpeg', 1024, 10, 10, %L) $f$,
    tests.k('f161'), tests.tenant('labak'),
    tests.tenant('labak')::text || '/' || tests.k('f161')::text || '/' || repeat('n', 251) || '.jpg',
    repeat('n', 251) || '.jpg', repeat('a', 64)),
  'register_asset: a filename of 255 characters is stored');
select throws_ok(format($f$ select api.register_asset(%L, %L, %L, %L, 'image/jpeg', 1024, 10, 10, %L) $f$,
    tests.k('f162'), tests.tenant('labak'),
    tests.tenant('labak')::text || '/' || tests.k('f162')::text || '/' || repeat('n', 252) || '.jpg',
    repeat('n', 252) || '.jpg', repeat('a', 64)), '23514', null,
  'register_asset refuses a filename of 256 characters');
select lives_ok($$ select api.update_asset(tests.k('f161'), null, null, repeat('a', 1000)) $$,
  'update_asset: a default alt of 1000 characters is stored');
select throws_ok($$ select api.update_asset(tests.k('f161'), null, null, repeat('a', 1001)) $$, '23514', null,
  'update_asset refuses a default alt of 1001 characters');

-- Refused before the audit copy: nothing past a limit reached the log.
select tests.act_as_owner();
select is_empty($$ select id from cms.audit_log
     where char_length(details ->> 'type') > 100 or char_length(details ->> 'slug') > 200
        or char_length(details ->> 'to') > 200 or char_length(details ->> 'filename') > 255
        or char_length(details ->> 'default_alt') > 1000 $$,
  'no refused value reached audit_log');

-- A revision's title comes from the draft's data through the worker, not from drafts.title, so it
-- has its own limit.
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
    values (tests.tenant('labak'), tests.entry('ce01'), 9, 1, '{}', repeat('t', 501), tests.persona('editor_labak')) $$,
  '23514', null, 'a revision title of 501 characters is refused');

select is_empty($$ select conrelid::regclass::text || '.' || conname from pg_catalog.pg_constraint
     where connamespace = 'cms'::regnamespace and conname like '%\_length' and not convalidated $$,
  'every length limit is validated on the empty local database');
select set_eq($$ select conname::text from pg_catalog.pg_constraint
     where connamespace = 'cms'::regnamespace and conname like '%\_length' $$,
  $$ values ('assets_default_alt_length'), ('assets_filename_length'), ('assets_original_path_length'),
            ('drafts_title_length'), ('entries_slug_length'), ('entries_type_length'), ('revisions_title_length') $$,
  'the length limits');

-- ---------------------------------------------------------------------------
-- 4. A request's error comes from the draft's data (validation issues name its paths), and the audit
-- trigger copies it. Past 64 KB only its code is kept, whoever wrote it.
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts) values
  (tests.k('e161'), tests.tenant('labak'), tests.entry('ce01'), 'publish', 1, tests.persona('editor_labak'), 'validating', now(), 1),
  (tests.k('e162'), tests.tenant('labak'), tests.entry('ce01'), 'publish', 1, tests.persona('editor_labak'), 'validating', now(), 1);
select tests.act_as_service();
select lives_ok($$ select api.worker_reject_request(tests.k('e161'), 'failed_validation',
    jsonb_build_object('code', 'invalid_data', 'issues', (select jsonb_agg(jsonb_build_object('path', jsonb_build_array('a', i), 'message', repeat('m', 100)))
                                                         from generate_series(1, 2000) i))) $$,
  'worker_reject_request stores an oversized error without failing the request');
select lives_ok($$ select api.worker_reject_request(tests.k('e162'), 'failed_validation',
    '{"code": "invalid_data", "issues": [{"path": ["title"], "message": "m"}]}') $$,
  'worker_reject_request stores an ordinary error');
select tests.act_as_owner();
select results_eq($$ select status, error from cms.publish_requests where id in (tests.k('e161'), tests.k('e162')) order by id $$,
  $$ values ('failed_validation'::text, '{"code": "invalid_data", "truncated": true}'::jsonb),
            ('failed_validation'::text, '{"code": "invalid_data", "issues": [{"path": ["title"], "message": "m"}]}'::jsonb) $$,
  'an oversized error keeps its code; an ordinary one is stored as it came');
select is((select details -> 'error' from cms.audit_log where target_id = tests.k('e161') and action = 'publish_request.failed_validation'),
  '{"code": "invalid_data", "truncated": true}'::jsonb, 'the audit copy holds the bounded error');

-- ---------------------------------------------------------------------------
-- 5. The editor statement timeout; editor-limits.test.ts proves it over the REST API.
select is((select setconfig from pg_catalog.pg_db_role_setting where setrole = 'authenticated'::regrole and setdatabase = 0),
  array['statement_timeout=3s'], 'authenticated has statement_timeout = 3s as a role setting, in every database');

select * from finish();
rollback;
