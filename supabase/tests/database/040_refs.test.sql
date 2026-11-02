-- supabase/tests/database/040_refs.test.sql
-- Reference extraction (spec §4.1 rule 3, §4.3 "References inside JSON", §4.5,
-- §8.5 integrity, §11.1 A13; plan Task 7, decisions 3, 25 and 26).
--
-- Personas and tenants come from tests.seed() (_helpers.sql): editor_labak and
-- editor_demo are members of labak and demo; outsider, revoked and
-- platform_admin are members of nothing.
--
-- Fixture rows (inserted below in owner context):
--   entry c101  labak  news  draft {}                      a reference target
--   entry c102  labak  news  draft {}                      a reference target
--   entry c103  demo   news  draft {}                      another tenant's entry
--   entry c104  labak  news  draft {}                      the draft the editor saves
--   entry c105  labak  news  no draft                      referenced by c106's draft only
--   entry c106  labak  news  draft referencing c105        deleted in the cascade test
--   entry c107  labak  news  no draft                      referenced by revision d102 only
--   assets f001, f002: plain UUIDs; cms.assets and the asset foreign keys come
--   in Task 8, so asset references are not checked against a table yet.
--
-- Later assertions depend on earlier mutations, in this order: c104's draft is
-- saved with references (version 2), gets a stray draft_refs row, a title-only
-- update (version 3) and a new document (version 4); the worker appends
-- revisions d101 (c104 at version 4) and d102 (referencing c107); c106 and
-- c105 are deleted at the end.
begin;
\ir _helpers.sql
select plan(97);

-- {"_ref": <id>, "_kind": <kind>}, the reference shape of §4.3.
create function tests.ref(p_id uuid, p_kind text) returns jsonb
language sql
set search_path = ''
as $$ select pg_catalog.jsonb_build_object('_ref', p_id, '_kind', p_kind) $$;
grant execute on function tests.ref(uuid, text) to authenticated, service_role;

-- Tables, keys and grants.
select has_table('cms', 'draft_refs', 'cms.draft_refs exists');
select has_table('cms', 'revision_refs', 'cms.revision_refs exists');
select columns_are('cms', 'draft_refs', array['tenant_id', 'entry_id', 'path', 'target_entry_id', 'target_asset_id'],
  'draft_refs columns');
select columns_are('cms', 'revision_refs', array['tenant_id', 'revision_id', 'path', 'target_entry_id', 'target_asset_id'],
  'revision_refs columns');
select col_not_null('cms', 'draft_refs', 'path', 'draft_refs.path is not null');
select col_not_null('cms', 'revision_refs', 'path', 'revision_refs.path is not null');
-- tenant_id first, so a duplicate key cannot reveal another tenant's rows (decision 26).
select col_is_pk('cms', 'draft_refs', array['tenant_id', 'entry_id', 'path'], 'draft_refs key is (tenant_id, entry_id, path)');
select col_is_pk('cms', 'revision_refs', array['tenant_id', 'revision_id', 'path'], 'revision_refs key is (tenant_id, revision_id, path)');
select table_privs_are('cms', 'draft_refs', 'authenticated', array['SELECT', 'INSERT', 'DELETE'],
  'authenticated: select, insert, delete on draft_refs');
select table_privs_are('cms', 'revision_refs', 'authenticated', array['SELECT'], 'authenticated: select only on revision_refs');
select table_privs_are('cms', 'draft_refs', 'service_role', array['SELECT'], 'service_role: select only on draft_refs');
select table_privs_are('cms', 'revision_refs', 'service_role', array['SELECT', 'INSERT'], 'service_role: select, insert on revision_refs');
select table_privs_are('cms', 'draft_refs', 'anon', array[]::text[], 'anon: nothing on draft_refs');
select table_privs_are('cms', 'revision_refs', 'anon', array[]::text[], 'anon: nothing on revision_refs');
select is_empty($$ select * from tests.column_privs('authenticated', 'cms.revision_refs') $$,
  'authenticated: no column-level insert, update or references on revision_refs');
select set_eq($$ select * from tests.column_privs('authenticated', 'cms.draft_refs') $$,
  $$ select a.attname::text, 'INSERT' from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.draft_refs'::regclass and a.attnum > 0 and not a.attisdropped $$,
  'authenticated: insert (table level) and no update on draft_refs');
select is_empty($$ select * from tests.column_privs('service_role', 'cms.draft_refs') $$,
  'service_role: no insert, update or references on draft_refs');
select policies_are('cms', 'draft_refs', array['draft_refs_select_member', 'draft_refs_insert_member', 'draft_refs_delete_member'],
  'draft_refs policies: select, insert, delete for members');
select policies_are('cms', 'revision_refs', array['revision_refs_select_member'], 'revision_refs policy: select for members');
select ok(has_function_privilege('authenticated', 'private.extract_refs(jsonb)', 'execute')
  and has_function_privilege('service_role', 'private.extract_refs(jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.extract_refs(jsonb)', 'execute'),
  'extract_refs: executable by authenticated and service_role, not anon (decision 26)');
select isnt_definer('private', 'extract_refs', array['jsonb'], 'extract_refs is security invoker');

-- A13: the walk finds _ref at any depth, including arrays and rich text (§11.1).
-- The document: top-level field, array element, rich-text link mark and image node.
select results_eq($$ select ref from private.extract_refs(
  '{"image":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset","alt":"x"},
    "list":[{"link":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}}],
    "body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a",
      "marks":[{"type":"link","attrs":{"entry":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}}]}]},
      {"type":"image","attrs":{"asset":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},"alt":"y"}}]}}'::jsonb)
  order by 1 $$,
  $$ values (tests.entry('c101')), (tests.entry('c102')),
            ('00000000-0000-4000-8000-00000000f001'::uuid), ('00000000-0000-4000-8000-00000000f002'::uuid) $$,
  'refs found at any depth');
select results_eq($$ select path, kind from private.extract_refs(
  '{"image":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset","alt":"x"},
    "list":[{"link":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}}],
    "body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a",
      "marks":[{"type":"link","attrs":{"entry":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}}]}]},
      {"type":"image","attrs":{"asset":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},"alt":"y"}}]}}'::jsonb)
  order by 1 $$,
  $$ values ('$."body"."content"[0]."content"[0]."marks"[0]."attrs"."entry"', 'entry'),
            ('$."body"."content"[1]."attrs"."asset"', 'asset'),
            ('$."image"', 'asset'),
            ('$."list"[0]."link"', 'entry') $$,
  'each reference''s location is a jsonpath to the reference object, with its kind');
-- Cross-check (decision 25): the walk finds exactly what the recursive JSON path
-- strict $.**._ref finds, counting duplicates.
select bag_eq($$ select ref from private.extract_refs(
  '{"image":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset","alt":"x"},
    "list":[{"link":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}}],
    "body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a",
      "marks":[{"type":"link","attrs":{"entry":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}}]}]},
      {"type":"image","attrs":{"asset":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},"alt":"y"}}]}}'::jsonb) $$,
  $$ select (r #>> '{}')::uuid from jsonb_path_query(
  '{"image":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset","alt":"x"},
    "list":[{"link":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}}],
    "body":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"a",
      "marks":[{"type":"link","attrs":{"entry":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}}]}]},
      {"type":"image","attrs":{"asset":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},"alt":"y"}}]}}'::jsonb,
  'strict $.**._ref') as r $$,
  'the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (rich-text document)');

-- Edge cases in one document: the document itself is a reference; a reference
-- nested inside another's usage properties; arrays of arrays; the same target
-- at two locations; keys that need quoting; an object with _kind but no _ref.
create table tests.edge_doc (doc jsonb);
insert into tests.edge_doc values (
  '{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry",
    "meta":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset",
            "credit":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}},
    "grid":[[{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}],[],[1,"x",null,true]],
    "we\"ird key":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},
    "þýðing":[{"x":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}],
    "notref":{"_kind":"entry"}}');
select results_eq($$ select path, ref from private.extract_refs((select doc from tests.edge_doc)) order by 1 $$,
  $$ values ('$', tests.entry('c101')),
            ('$."grid"[0][0]', tests.entry('c101')),
            ('$."meta"', '00000000-0000-4000-8000-00000000f001'::uuid),
            ('$."meta"."credit"', tests.entry('c102')),
            ('$."we\"ird key"', '00000000-0000-4000-8000-00000000f002'::uuid),
            ('$."þýðing"[0]."x"', tests.entry('c102')) $$,
  'edge cases: root, nested inside a reference, arrays of arrays, duplicates, quoted keys');
select bag_eq($$ select ref from private.extract_refs((select doc from tests.edge_doc)) $$,
  $$ select (r #>> '{}')::uuid from jsonb_path_query((select doc from tests.edge_doc), 'strict $.**._ref') as r $$,
  'the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (edge cases)');
select is_empty($$ select e.path from tests.edge_doc d, private.extract_refs(d.doc) e
  where (jsonb_path_query_first(d.doc, ('strict ' || e.path)::jsonpath) ->> '_ref') is distinct from e.ref::text
     or (jsonb_path_query_first(d.doc, ('strict ' || e.path)::jsonpath) ->> '_kind') is distinct from e.kind $$,
  'every path evaluates, as a jsonpath, to the reference object it names');
select is_empty($$ select * from private.extract_refs('{}') $$, 'an empty document has no references');
select is_empty($$ select * from private.extract_refs('{"a":[{"_kind":"entry"}],"_refs":"x","ref":"y"}') $$,
  'only a key named exactly _ref makes a reference');

-- Malformed _ref: anything but a JSON string in canonical lowercase 8-4-4-4-12
-- form raises 22P02 (decision 25). The same rule as packages/schema and
-- packages/rich-text: no version or variant check.
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"not-a-uuid","_kind":"asset"}}') $$,
  '22P02', null, 'malformed _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000C101","_kind":"entry"}}') $$,
  '22P02', null, 'upper-case _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"{00000000-0000-4000-8000-00000000c101}","_kind":"entry"}}') $$,
  '22P02', null, 'braced _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"000000000000400080000000000c101a","_kind":"entry"}}') $$,
  '22P02', null, 'unhyphenated _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c101\n","_kind":"entry"}}') $$,
  '22P02', null, '_ref with a trailing newline rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"\n00000000-0000-4000-8000-00000000c101","_kind":"entry"}}') $$,
  '22P02', null, '_ref with a leading newline rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":" 00000000-0000-4000-8000-00000000c101","_kind":"entry"}}') $$,
  '22P02', null, '_ref with a leading space rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c1011","_kind":"entry"}}') $$,
  '22P02', null, '_ref with an extra digit rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":null,"_kind":"entry"}}') $$,
  '22P02', null, 'JSON null _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":42,"_kind":"entry"}}') $$,
  '22P02', null, 'numeric _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":{"_ref":"00000000-0000-4000-8000-00000000c101"},"_kind":"entry"}}') $$,
  '22P02', null, 'object _ref rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":["00000000-0000-4000-8000-00000000c101"],"_kind":"entry"}}') $$,
  '22P02', null, 'array _ref rejected');
select results_eq($$ select ref from private.extract_refs('{"x":{"_ref":"00000000-0000-0000-0000-000000000000","_kind":"asset"}}') $$,
  $$ values ('00000000-0000-0000-0000-000000000000'::uuid) $$, 'the nil UUID is accepted (no version or variant check)');
select results_eq($$ select ref from private.extract_refs('{"x":{"_ref":"abcdef01-2345-1789-cdef-0123456789ab","_kind":"entry"}}') $$,
  $$ values ('abcdef01-2345-1789-cdef-0123456789ab'::uuid) $$, 'a canonical non-v4 UUID is accepted');
-- _kind: exactly "entry" or "asset", else invalid_reference (decision 3); _ref is checked first.
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"page"}}') $$,
  'P0001', 'invalid_reference', 'unknown _kind rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c101"}}') $$,
  'P0001', 'invalid_reference', 'missing _kind rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"Entry"}}') $$,
  'P0001', 'invalid_reference', '_kind is case-sensitive');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":["entry"]}}') $$,
  'P0001', 'invalid_reference', 'non-string _kind rejected');
select throws_ok($$ select * from private.extract_refs('{"x":{"_ref":"nope","_kind":"page"}}') $$,
  '22P02', null, 'a malformed _ref is reported before an unknown _kind');

-- Fixtures (owner context).
select tests.seed();
insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('c101'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c102'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c103'), tests.tenant('demo'), 'news', tests.persona('editor_demo')),
  (tests.entry('c104'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c105'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c106'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c107'), tests.tenant('labak'), 'news', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by)
  select e, t, 1, '{}'::jsonb, p from (values
    (tests.entry('c101'), tests.tenant('labak'), tests.persona('editor_labak')),
    (tests.entry('c102'), tests.tenant('labak'), tests.persona('editor_labak')),
    (tests.entry('c103'), tests.tenant('demo'), tests.persona('editor_demo')),
    (tests.entry('c104'), tests.tenant('labak'), tests.persona('editor_labak'))) as v(e, t, p);
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c106'), tests.tenant('labak'), 1,
   jsonb_build_object('related', tests.ref(tests.entry('c105'), 'entry')), tests.persona('editor_labak'));
select results_eq($$ select path, target_entry_id from cms.draft_refs where entry_id = tests.entry('c106') $$,
  $$ values ('$."related"', tests.entry('c105')) $$, 'a draft inserted by the owner gets its draft_refs');

-- Saving a draft rebuilds its draft_refs, as the editor (the invoking role).
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ update cms.drafts set data = jsonb_build_object(
    'related', tests.ref(tests.entry('c101'), 'entry'),
    'image', tests.ref('00000000-0000-4000-8000-00000000f001', 'asset') || '{"alt": "Brauð"}')
  where entry_id = tests.entry('c104') $$, 'editor saves a draft with references');
select results_eq($$ select tenant_id, entry_id, path, target_entry_id, target_asset_id from cms.draft_refs
    where entry_id = tests.entry('c104') order by path $$,
  $$ values (tests.tenant('labak'), tests.entry('c104'), '$."image"', null::uuid, '00000000-0000-4000-8000-00000000f001'::uuid),
            (tests.tenant('labak'), tests.entry('c104'), '$."related"', tests.entry('c101'), null::uuid) $$,
  'draft_refs rebuilt on save');
-- A stray row survives an update that leaves data unchanged (the trigger fires
-- only when data changes) and is removed by the next change of data.
select lives_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
  values (tests.tenant('labak'), tests.entry('c104'), '$."stray"', tests.entry('c102')) $$,
  'editor can insert a draft_refs row in its own tenant (the trigger needs it)');
select lives_ok($$ update cms.drafts set title = 'Bara titill' where entry_id = tests.entry('c104') $$,
  'editor updates the title only');
select is((select count(*)::int from cms.draft_refs where entry_id = tests.entry('c104')), 3,
  'an update that leaves data unchanged does not rebuild draft_refs');
select lives_ok($$ update cms.drafts set data = jsonb_build_object(
    'body', jsonb_build_object('type', 'doc', 'content', jsonb_build_array(jsonb_build_object('type', 'paragraph',
      'content', jsonb_build_array(jsonb_build_object('type', 'text', 'text', 'sjá',
        'marks', jsonb_build_array(jsonb_build_object('type', 'link',
          'attrs', jsonb_build_object('entry', tests.ref(tests.entry('c102'), 'entry'))))))))),
    'gallery', jsonb_build_array(tests.ref('00000000-0000-4000-8000-00000000f002', 'asset') || '{"alt": "Kaka"}'))
  where entry_id = tests.entry('c104') $$, 'editor saves rich text and an array of images');
select results_eq($$ select path, target_entry_id, target_asset_id from cms.draft_refs
    where entry_id = tests.entry('c104') order by path $$,
  $$ values ('$."body"."content"[0]."content"[0]."marks"[0]."attrs"."entry"', tests.entry('c102'), null::uuid),
            ('$."gallery"[0]', null::uuid, '00000000-0000-4000-8000-00000000f002'::uuid) $$,
  'draft_refs replaced by the new document''s references (stray and old rows gone)');
select is((select version from cms.drafts where entry_id = tests.entry('c104')), 4, 'c104 is at version 4');

-- Integrity on save (§4.3, §8.5): another tenant's target, a missing target, a
-- malformed _ref or an unknown _kind fails the write, and nothing changes.
select throws_ok($$ update cms.drafts set data = jsonb_build_object('related', tests.ref(tests.entry('c103'), 'entry'))
  where entry_id = tests.entry('c104') $$, '23503', null, 'cross-tenant ref rejected');
select throws_ok($$ update cms.drafts set data = jsonb_build_object('related', tests.ref(gen_random_uuid(), 'entry'))
  where entry_id = tests.entry('c104') $$, '23503', null, 'missing target rejected');
select throws_ok($$ update cms.drafts set data = '{"related": {"_ref": "00000000-0000-4000-8000-00000000C101", "_kind": "entry"}}'
  where entry_id = tests.entry('c104') $$, '22P02', null, 'malformed _ref fails the draft write');
select throws_ok($$ update cms.drafts set data = jsonb_build_object('related', tests.ref(tests.entry('c101'), 'page'))
  where entry_id = tests.entry('c104') $$, 'P0001', 'invalid_reference', 'unknown _kind fails the draft write');
select throws_ok($$ insert into cms.drafts (entry_id, tenant_id, schema_version, data)
  values (tests.entry('c105'), tests.tenant('labak'), 1, jsonb_build_object('x', tests.ref(tests.entry('c103'), 'entry'))) $$,
  '23503', null, 'cross-tenant ref rejected on draft insert');
select is((select version from cms.drafts where entry_id = tests.entry('c104')), 4, 'failed saves leave the version alone');
select is((select count(*)::int from cms.draft_refs where entry_id = tests.entry('c104')), 2,
  'failed saves leave draft_refs alone');
-- Direct writes to draft_refs are bound by the same rules.
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
  values (tests.tenant('labak'), tests.entry('c104'), '$."x"', tests.entry('c103')) $$,
  '23503', null, 'a draft_refs row cannot target another tenant''s entry');
select throws_ok($$ update cms.draft_refs set path = '$."y"' $$, '42501', null, 'editor cannot update draft_refs');
select throws_ok($$ insert into cms.revision_refs (tenant_id, revision_id, path, target_entry_id)
  values (tests.tenant('labak'), gen_random_uuid(), '$', tests.entry('c101')) $$, '42501', null, 'editor cannot insert revision_refs');
select throws_ok($$ delete from cms.revision_refs $$, '42501', null, 'editor cannot delete revision_refs');

-- Isolation: other tenants, non-members and anon (§4.5 tenant policy).
select tests.act_as(tests.persona('editor_demo'));
select is_empty($$ select 1 from cms.draft_refs $$, 'demo editor sees no labak draft_refs');
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
  values (tests.tenant('labak'), tests.entry('c104'), '$."x"', tests.entry('c101')) $$,
  '42501', null, 'demo editor cannot insert a draft_refs row in labak');
-- Composite foreign key (§4.1 rule 3): a row in demo cannot name a labak entry.
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
  values (tests.tenant('demo'), tests.entry('c104'), '$."x"', tests.entry('c103')) $$,
  '23503', null, 'a draft_refs row cannot belong to another tenant''s entry');
delete from cms.draft_refs;
select tests.act_as(tests.persona('outsider'));
select is_empty($$ select 1 from cms.draft_refs $$, 'user without membership sees no draft_refs');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from cms.draft_refs $$, 'platform admin with aal2 sees no draft_refs (no implicit content access)');
select tests.act_as_anon();
select throws_ok($$ select 1 from cms.draft_refs $$, '42501', null, 'anon cannot read draft_refs');
select throws_ok($$ select 1 from cms.revision_refs $$, '42501', null, 'anon cannot read revision_refs');
select tests.act_as_owner();
select is((select count(*)::int from cms.draft_refs where tenant_id = tests.tenant('labak')), 3,
  'an unfiltered delete by the demo editor leaves labak draft_refs alone');

-- Revisions: the worker (service_role) appends a revision; its revision_refs are
-- written by trigger and equal the draft's draft_refs at that version (plan,
-- "Exactness" item 2).
select tests.act_as_service();
select lives_ok($$ insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  select tests.revision('d101'), d.tenant_id, d.entry_id, d.version, d.schema_version, d.data, tests.persona('editor_labak')
  from cms.drafts d where d.entry_id = tests.entry('c104') $$, 'service_role appends a revision of c104');
select results_eq($$ select path, target_entry_id, target_asset_id from cms.revision_refs
    where revision_id = tests.revision('d101') order by path $$,
  $$ select path, target_entry_id, target_asset_id from cms.draft_refs
    where entry_id = tests.entry('c104') order by path $$,
  'revision_refs equal the draft''s draft_refs at that version');
select is((select count(*)::int from cms.revision_refs where revision_id = tests.revision('d101')), 2,
  'the revision has two references');
select lives_ok($$ insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.revision('d102'), tests.tenant('labak'), tests.entry('c104'), 4, 1,
          jsonb_build_object('x', tests.ref(tests.entry('c107'), 'entry')), tests.persona('editor_labak')) $$,
  'service_role appends a revision referencing c107');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c104'), 4, 1,
          jsonb_build_object('x', tests.ref(tests.entry('c103'), 'entry')), tests.persona('editor_labak')) $$,
  '23503', null, 'a revision cannot reference another tenant''s entry');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c104'), 4, 1,
          '{"x": {"_ref": "00000000-0000-4000-8000-00000000c101 ", "_kind": "entry"}}', tests.persona('editor_labak')) $$,
  '22P02', null, 'a revision with a malformed _ref is refused');
select throws_ok($$ delete from cms.revision_refs $$, '42501', null, 'service_role cannot delete revision_refs');
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id)
  values (tests.tenant('labak'), tests.entry('c104'), '$."x"', tests.entry('c101')) $$, '42501', null,
  'service_role cannot insert draft_refs');
select tests.act_as(tests.persona('editor_labak'));
select is((select count(*)::int from cms.revision_refs), 3, 'labak editor reads labak revision_refs');
select tests.act_as(tests.persona('editor_demo'));
select is_empty($$ select 1 from cms.revision_refs $$, 'demo editor sees no labak revision_refs');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is_empty($$ select 1 from cms.revision_refs $$, 'platform admin with aal2 sees no revision_refs');

-- Shape and deletion rules (owner context).
select tests.act_as_owner();
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path)
  values (tests.tenant('labak'), tests.entry('c104'), '$."none"') $$, '23514', null, 'a draft_refs row needs a target');
select throws_ok($$ insert into cms.draft_refs (tenant_id, entry_id, path, target_entry_id, target_asset_id)
  values (tests.tenant('labak'), tests.entry('c104'), '$."both"', tests.entry('c101'), gen_random_uuid()) $$,
  '23514', null, 'a draft_refs row has exactly one target');
select throws_ok($$ insert into cms.revision_refs (tenant_id, revision_id, path)
  values (tests.tenant('labak'), tests.revision('d101'), '$."none"') $$, '23514', null, 'a revision_refs row needs a target');
select throws_ok($$ insert into cms.revision_refs (tenant_id, revision_id, path, target_entry_id)
  values (tests.tenant('demo'), tests.revision('d101'), '$."x"', tests.entry('c103')) $$,
  '23503', null, 'a revision_refs row cannot belong to another tenant''s revision');
-- revision_refs: ON DELETE RESTRICT on the revision and on the target.
select throws_like($$ delete from cms.revisions where id = tests.revision('d102') $$,
  '%"revision_refs_tenant_id_revision_id_fkey" on table "revision_refs"', 'a revision with references cannot be deleted');
select throws_like($$ delete from cms.entries where id = tests.entry('c107') $$,
  '%"revision_refs_tenant_id_target_entry_id_fkey" on table "revision_refs"', 'an entry referenced by a revision cannot be deleted');
-- draft_refs: a referenced entry cannot be deleted; an entry's own draft_refs
-- go with it (ON DELETE CASCADE).
select throws_like($$ delete from cms.entries where id = tests.entry('c105') $$,
  '%"draft_refs_tenant_id_target_entry_id_fkey" on table "draft_refs"', 'an entry referenced by a draft cannot be deleted');
delete from cms.drafts where entry_id = tests.entry('c106');
select lives_ok($$ delete from cms.entries where id = tests.entry('c106') $$, 'deleting an entry (after its draft) succeeds');
select is_empty($$ select 1 from cms.draft_refs where entry_id = tests.entry('c106') $$,
  'the deleted entry''s draft_refs are gone (cascade)');
select lives_ok($$ delete from cms.entries where id = tests.entry('c105') $$,
  'an entry no longer referenced can be deleted');

select * from finish();
rollback;
