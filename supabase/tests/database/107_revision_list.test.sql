-- supabase/tests/database/107_revision_list.test.sql
-- api.revision_list (spec §5.5, §7.1; plan M2-16; Einar 2026-11-03): an entry's published
-- revisions for the editor's history and restore. The catalog checks (security_invoker, columns,
-- SELECT for authenticated only) are in 080_api_editor's editor-view list; this file checks the
-- rows: members of the revision's tenant only, is_published follows the publish pointer, and no
-- role can change a revision through the view.
--
-- Fixtures: personas and tenants from tests.seed(). labak news c701 has revisions d701 (older)
-- and d702 (published); labak news c702 has d703 and was unpublished; demo news c703 has d704.
begin;
\ir _helpers.sql
select plan(16);

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c701'), tests.tenant('labak'), 'news', 'a', tests.persona('editor_labak')),
  (tests.entry('c702'), tests.tenant('labak'), 'news', 'b', tests.persona('editor_labak')),
  (tests.entry('c703'), tests.tenant('demo'), 'news', 'c', tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by, committed_at) values
  (tests.revision('d701'), tests.tenant('labak'), tests.entry('c701'), 2, 1, '{"title": "Fyrsta"}', 'Fyrsta',
   tests.persona('editor_labak'), '2026-11-01 10:00+00'),
  (tests.revision('d702'), tests.tenant('labak'), tests.entry('c701'), 4, 1, '{"title": "Önnur"}', 'Önnur',
   tests.persona('revoked'), '2026-11-02 10:00+00'),
  (tests.revision('d703'), tests.tenant('labak'), tests.entry('c702'), 2, 1, '{}', null,
   tests.persona('editor_labak'), '2026-11-01 11:00+00'),
  (tests.revision('d704'), tests.tenant('demo'), tests.entry('c703'), 2, 1, '{"title": "Demo"}', 'Demo',
   tests.persona('editor_demo'), '2026-11-01 12:00+00');
update cms.entries set published_rev_id = tests.revision('d702'), published_draft_version = 4,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c701');
update cms.entries set first_published_at = now(), last_published_at = now() where id = tests.entry('c702');

-- ---------------------------------------------------------------------------
-- A labak editor sees labak's revisions, with the columns as stored.
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by, committed_at,
            is_published from api.revision_list where entry_id = tests.entry('c701') order by committed_at desc $$,
  $$ values (tests.revision('d702'), tests.tenant('labak'), tests.entry('c701'), 4, 1, '{"title": "Önnur"}'::jsonb,
             'Önnur'::text, tests.persona('revoked'), '2026-11-02 10:00+00'::timestamptz, true),
            (tests.revision('d701'), tests.tenant('labak'), tests.entry('c701'), 2, 1, '{"title": "Fyrsta"}'::jsonb,
             'Fyrsta'::text, tests.persona('editor_labak'), '2026-11-01 10:00+00'::timestamptz, false) $$,
  'revision_list: an entry''s revisions as stored; is_published only for the one the pointer names');
select results_eq($$ select id, is_published from api.revision_list order by id $$,
  $$ values (tests.revision('d701'), false), (tests.revision('d702'), true), (tests.revision('d703'), false) $$,
  'revision_list: only labak revisions; an unpublished entry''s revision is not published');

-- No role changes a revision through the view (§4.3: append-only): it is not updatable (a join),
-- and authenticated holds no write privilege on it either.
select throws_ok($$ update api.revision_list set title = 'x' where id = tests.revision('d701') $$, null, null,
  'an editor cannot update a revision through revision_list');
select throws_ok($$ delete from api.revision_list where id = tests.revision('d701') $$, null, null,
  'an editor cannot delete a revision through revision_list');
select ok(not has_table_privilege('authenticated', 'api.revision_list', 'INSERT, UPDATE, DELETE, TRUNCATE'),
  'authenticated has no write privilege on revision_list');

-- The demo editor sees only demo's.
select tests.act_as(tests.persona('editor_demo'));
select results_eq($$ select id from api.revision_list $$, $$ values (tests.revision('d704')) $$, 'revision_list: demo only');
select is_empty($$ select 1 from api.revision_list where tenant_id = tests.tenant('labak') or entry_id = tests.entry('c701') $$,
  'the demo editor cannot read a labak revision by naming its tenant or entry');

-- No membership, no rows: not the platform admin (no clause on content tables, §4.5), not an
-- outsider, not a revoked member (who requested d702 while a member).
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from api.revision_list $$, 'platform admin at aal2: revision_list is empty');
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from api.revision_list $$, 'an outsider sees no revision');
select tests.act_as(tests.persona('revoked'));
select is_empty($$ select 1 from api.revision_list $$, 'a revoked member sees no revision, not even their own');

-- anon and service_role cannot read it.
select tests.act_as_anon();
select throws_ok($$ select 1 from api.revision_list $$, '42501', null, 'anon cannot read revision_list');
select tests.act_as_service();
select throws_ok($$ select 1 from api.revision_list $$, '42501', null, 'service_role cannot read revision_list');

-- The revisions are unchanged by everything above.
select tests.act_as_owner();
select results_eq($$ select id, draft_version, data, title from cms.revisions order by id $$,
  $$ values (tests.revision('d701'), 2, '{"title": "Fyrsta"}'::jsonb, 'Fyrsta'::text),
            (tests.revision('d702'), 4, '{"title": "Önnur"}'::jsonb, 'Önnur'::text),
            (tests.revision('d703'), 2, '{}'::jsonb, null::text),
            (tests.revision('d704'), 2, '{"title": "Demo"}'::jsonb, 'Demo'::text) $$,
  'no revision changed');
-- The view adds no grant on cms: authenticated still has only SELECT on cms.revisions.
select set_eq($$ select a.privilege_type from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
     where c.oid = 'cms.revisions'::regclass and a.grantee = 'authenticated'::regrole $$,
  $$ values ('SELECT') $$, 'authenticated: SELECT only on cms.revisions');
select ok((select coalesce(c.reloptions @> array['security_invoker=true'], false) from pg_catalog.pg_class c
           where c.oid = 'api.revision_list'::regclass), 'revision_list is security_invoker');
select is((select count(*)::int from pg_catalog.pg_class c, pg_catalog.aclexplode(c.relacl) a
           where c.oid = 'api.revision_list'::regclass and a.grantee <> c.relowner), 1,
  'revision_list: one grant besides the owner (SELECT for authenticated)');

select * from finish();
rollback;
