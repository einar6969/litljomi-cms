-- supabase/tests/database/040_refs.test.sql
-- Reference extraction (spec §4.1 rule 3, §4.3 "References inside JSON", §4.5,
-- §8.5 integrity, §11.1 A13; plan Task 7, decisions 3, 25, 26, 27, 28 and 29).
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
--   entry c108  labak  news  draft {}                      the nesting-limit draft
--   entry c109  labak  news  draft {}                      the key- and reference-limit and cost-regression draft
--   entry c110  labak  news  no draft                      refused draft inserts (last section)
--   assets f001, f002: plain UUIDs; cms.assets and the asset foreign keys come
--   in Task 8, so asset references are not checked against a table yet.
--
-- Later assertions depend on earlier mutations, in this order: c104's draft is
-- saved with references (version 2), gets a stray draft_refs row, a title-only
-- update (version 3) and a new document (version 4); the worker appends
-- revisions d101 (c104 at version 4) and d102 (referencing c107); c106 and
-- c105 are deleted; the nesting-limit section adds c108, saves its draft and
-- appends revision d103; the key- and reference-limit section adds c109 and
-- c110, saves c109's draft and appends revisions d104 and d105; the
-- adversarial-shapes section saves c109's draft once per shape and appends
-- revisions d106 to d109, d10b and d10c (d10a is refused).
begin;
\ir _helpers.sql
select plan(187);

-- {"_ref": <id>, "_kind": <kind>}, the reference shape of §4.3.
create function tests.ref(p_id uuid, p_kind text) returns jsonb
language sql
set search_path = ''
as $$ select pg_catalog.jsonb_build_object('_ref', p_id, '_kind', p_kind) $$;
grant execute on function tests.ref(uuid, text) to authenticated, service_role;

-- p_inner wrapped in p_levels objects {"a": ...}: tests.nest(127, '{}') is 128
-- levels deep (decision 27).
create function tests.nest(p_levels int, p_inner jsonb) returns jsonb
language sql
set search_path = ''
as $$ select (pg_catalog.repeat('{"a":', p_levels) || p_inner::text || pg_catalog.repeat('}', p_levels))::jsonb $$;
grant execute on function tests.nest(int, jsonb) to authenticated, service_role;

-- A JSON array of p_count references to entry c101 (decision 28).
create function tests.refs(p_count int) returns jsonb
language sql
set search_path = ''
as $$ select coalesce(pg_catalog.jsonb_agg(tests.ref(tests.entry('c101'), 'entry')), '[]')
      from pg_catalog.generate_series(1, p_count) $$;
grant execute on function tests.refs(int) to authenticated, service_role;

-- p_inner wrapped in p_levels objects, each with one key of p_key_length
-- characters 'k' (decision 28).
create function tests.trunk(p_levels int, p_key_length int, p_inner jsonb) returns jsonb
language sql
set search_path = ''
as $$ select (pg_catalog.repeat('{"' || pg_catalog.repeat('k', p_key_length) || '":', p_levels)
              || p_inner::text || pg_catalog.repeat('}', p_levels))::jsonb $$;
grant execute on function tests.trunk(int, int, jsonb) to authenticated, service_role;

-- Cost of one statement (decision 28): its SQLSTATE ('00000' when it succeeds),
-- the bytes of temporary files it wrote and its run time. EXPLAIN (ANALYZE,
-- BUFFERS) counts the temp blocks written by everything the statement runs,
-- function and trigger bodies included; tests.try_sql runs the statement and
-- catches its error, so the EXPLAIN completes and a refused statement is measured
-- too. A statement that succeeds keeps its effects.
create function tests.try_sql(p_sql text) returns void
language plpgsql
set search_path = ''
as $$
begin
  execute p_sql;
  perform pg_catalog.set_config('tests.state', '00000', true);
exception when others then
  perform pg_catalog.set_config('tests.state', sqlstate, true);
end;
$$;
create function tests.cost(p_sql text, out state text, out temp_bytes bigint, out elapsed interval)
language plpgsql
set search_path = ''
as $$
declare
  v_t0 timestamptz := pg_catalog.clock_timestamp();
  v_plan jsonb;
begin
  execute pg_catalog.format('explain (analyze, buffers, format json) select tests.try_sql(%L)', p_sql) into v_plan;
  elapsed := pg_catalog.clock_timestamp() - v_t0;
  state := pg_catalog.current_setting('tests.state');
  temp_bytes := (v_plan -> 0 -> 'Plan' ->> 'Temp Written Blocks')::bigint * pg_catalog.current_setting('block_size')::bigint;
end;
$$;
grant execute on function tests.try_sql(text), tests.cost(text) to authenticated, service_role;
-- Results of tests.cost, read by the assertions that follow each measurement.
create table tests.costs (probe text primary key, state text, temp_bytes bigint, elapsed interval);
grant select, insert on tests.costs to authenticated, service_role;

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
-- at two locations; keys with '-' and '_' (every key matches
-- ^[A-Za-z0-9_-]{1,64}$, decision 29, so none needs escaping); an object with
-- _kind but no _ref.
create table tests.edge_doc (doc jsonb);
insert into tests.edge_doc values (
  '{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry",
    "meta":{"_ref":"00000000-0000-4000-8000-00000000f001","_kind":"asset",
            "credit":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}},
    "grid":[[{"_ref":"00000000-0000-4000-8000-00000000c101","_kind":"entry"}],[],[1,"x",null,true]],
    "we-ird_Key9":{"_ref":"00000000-0000-4000-8000-00000000f002","_kind":"asset"},
    "thyding":[{"x":{"_ref":"00000000-0000-4000-8000-00000000c102","_kind":"entry"}}],
    "notref":{"_kind":"entry"}}');
select results_eq($$ select path, ref from private.extract_refs((select doc from tests.edge_doc)) order by 1 $$,
  $$ values ('$', tests.entry('c101')),
            ('$."grid"[0][0]', tests.entry('c101')),
            ('$."meta"', '00000000-0000-4000-8000-00000000f001'::uuid),
            ('$."meta"."credit"', tests.entry('c102')),
            ('$."thyding"[0]."x"', tests.entry('c102')),
            ('$."we-ird_Key9"', '00000000-0000-4000-8000-00000000f002'::uuid) $$,
  'edge cases: root, nested inside a reference, arrays of arrays, duplicates, keys with - and _');
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

-- Nesting limit and lean walk (§4.3, decision 27). Levels count nested objects
-- and arrays: the document is level 1, a container directly inside a level-n
-- container is level n + 1, and scalars are not levels. 128 levels are allowed;
-- a container at level 129 fails the write with 54000, checked before the walk.
-- The statement timeout is only a guard: without the limit, the 10,000-level
-- documents below wrote gigabytes of temp files.
set local statement_timeout = '5s';
select is_empty($$ select * from private.extract_refs(tests.nest(127, '{}')) $$, '128 nested objects are allowed');
select throws_ok($$ select * from private.extract_refs(tests.nest(128, '{}')) $$,
  '54000', 'document nested deeper than 128 levels', '129 nested objects are rejected with 54000');
select is_empty($$ select * from private.extract_refs((repeat('[', 128) || repeat(']', 128))::jsonb) $$,
  '128 nested arrays are allowed');
select throws_ok($$ select * from private.extract_refs((repeat('[', 129) || repeat(']', 129))::jsonb) $$,
  '54000', 'document nested deeper than 128 levels', '129 nested arrays are rejected with 54000');
select is_empty($$ select * from private.extract_refs(tests.nest(128, '"x"')) $$,
  'a scalar inside the 128th level is not a level');
select throws_ok($$ select * from private.extract_refs(tests.nest(128, '{"_ref": "nope", "_kind": "page"}')) $$,
  '54000', 'document nested deeper than 128 levels', 'the limit is checked before the walk validates references');
select results_eq($$ select path, ref, kind from private.extract_refs(tests.nest(119, tests.ref(tests.entry('c101'), 'entry'))) $$,
  $$ values ('$' || repeat('."a"', 119), tests.entry('c101'), 'entry') $$,
  'a reference at level 120 is found, with its full path');

insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('c108'), tests.tenant('labak'), 'news', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c108'), tests.tenant('labak'), 1, '{}', tests.persona('editor_labak'));

-- Draft saves, as the editor.
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ update cms.drafts set data = tests.nest(127, tests.ref(tests.entry('c101'), 'entry'))
  where entry_id = tests.entry('c108') $$, 'editor saves a draft 128 levels deep');
select results_eq($$ select path, target_entry_id from cms.draft_refs where entry_id = tests.entry('c108') $$,
  $$ values ('$' || repeat('."a"', 127), tests.entry('c101')) $$, 'the reference at level 128 is in draft_refs');
select throws_ok($$ update cms.drafts set data = tests.nest(128, tests.ref(tests.entry('c101'), 'entry'))
  where entry_id = tests.entry('c108') $$,
  '54000', 'document nested deeper than 128 levels', 'editor cannot save a draft 129 levels deep');
-- The security review's document: 10,000 levels of 90-character keys, 960,001
-- bytes as text (under the 1 MB data check). Rejected in milliseconds; 1 s is a
-- wide margin that still fails if the walk runs first (8 s and 3 GB before).
select set_config('tests.t0', clock_timestamp()::text, true);
select throws_ok($$ update cms.drafts
  set data = (repeat('{"' || repeat('a', 90) || '":', 10000) || '1' || repeat('}', 10000))::jsonb
  where entry_id = tests.entry('c108') $$,
  '54000', 'document nested deeper than 128 levels', 'editor cannot save a ~1 MB draft 10,000 levels deep');
select cmp_ok(clock_timestamp() - current_setting('tests.t0')::timestamptz, '<', interval '1 second',
  'the 10,000-level draft is rejected in under a second');
-- Wide and shallow: 15,000 references in one list, about 1 MB. Saved before
-- decision 28; now over the 1,000-reference limit and rejected at once.
select set_config('tests.t0', clock_timestamp()::text, true);
select throws_ok($$ update cms.drafts set data = jsonb_build_object('list', tests.refs(15000))
  where entry_id = tests.entry('c108') $$,
  '54000', 'more than 1000 references', 'editor cannot save a ~1 MB draft with 15,000 references');
select cmp_ok(clock_timestamp() - current_setting('tests.t0')::timestamptz, '<', interval '1 second',
  'the 15,000-reference draft is rejected in under a second');

-- Revision inserts, as the worker (no role statement timeout in production).
select tests.act_as_service();
select lives_ok($$ insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.revision('d103'), tests.tenant('labak'), tests.entry('c108'), 2, 1,
          tests.nest(127, tests.ref(tests.entry('c101'), 'entry')), tests.persona('editor_labak')) $$,
  'service_role appends a revision 128 levels deep');
select results_eq($$ select path, target_entry_id from cms.revision_refs where revision_id = tests.revision('d103') $$,
  $$ values ('$' || repeat('."a"', 127), tests.entry('c101')) $$, 'the reference at level 128 is in revision_refs');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c108'), 2, 1,
          tests.nest(128, tests.ref(tests.entry('c101'), 'entry')), tests.persona('editor_labak')) $$,
  '54000', 'document nested deeper than 128 levels', 'service_role cannot append a revision 129 levels deep');
select set_config('tests.t0', clock_timestamp()::text, true);
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c108'), 2, 1,
          (repeat('{"' || repeat('a', 90) || '":', 10000) || '1' || repeat('}', 10000))::jsonb,
          tests.persona('editor_labak')) $$,
  '54000', 'document nested deeper than 128 levels', 'service_role cannot append a ~1 MB revision 10,000 levels deep');
select cmp_ok(clock_timestamp() - current_setting('tests.t0')::timestamptz, '<', interval '1 second',
  'the 10,000-level revision is rejected in under a second');

-- Key and reference-count limits (§4.3, decisions 28 and 29). Every object key
-- must match ^[A-Za-z0-9_-]{1,64}$, wherever it is: a key of 64 such characters
-- is allowed, 65 fail with 54000 (decision 29 replaces decision 28's
-- 64-character rule, so any other character fails too; see "Object-key
-- pattern" below). 1,000 references are allowed and 1,001 fail with 54000. A
-- reference is an object with a _ref key, as strict $.**._ref counts them. Both
-- are checked before the walk, so they come before 22P02 and invalid_reference.
select tests.act_as_owner();
select results_eq($$ select path, ref from private.extract_refs(jsonb_build_object(repeat('k', 64), tests.ref(tests.entry('c101'), 'entry'))) $$,
  $$ values ('$."' || repeat('k', 64) || '"', tests.entry('c101')) $$, 'a 64-character key is allowed');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('k', 65), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key at the top level is rejected with 54000');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(
    'a', jsonb_build_object(repeat('k', 65), 1), 'r', tests.ref(tests.entry('c101'), 'entry'))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key in a nested object is rejected');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(
    'list', jsonb_build_array(1, jsonb_build_object(repeat('k', 65), true)))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key in an array element''s object is rejected');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(
    'x', tests.ref(tests.entry('c101'), 'entry') || jsonb_build_object(repeat('k', 65), 'y'))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key on a reference object is rejected');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object('x', tests.ref(tests.entry('c101'), 'entry'),
    'y', jsonb_build_object('z', jsonb_build_array(jsonb_build_object(repeat('k', 65), null))))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key in a reference-free subtree is rejected');
-- Decision 28 allowed these (it counted characters of the key itself);
-- decision 29 refuses them: keys are ASCII letters, digits, '_' and '-' only.
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('þ', 64), tests.ref(tests.entry('c101'), 'entry'))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$',
  'a key of 64 multi-byte characters is rejected (decision 29; allowed under decision 28)');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('þ', 65), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key of 65 multi-byte characters is rejected');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('k', 62) || '"' || E'\n', 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$',
  'a 64-character key with characters escaped in JSON text is rejected (decision 29; allowed under decision 28)');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('k', 63) || '"' || E'\n', 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a 65-character key with escaped characters is rejected');
-- Long string values are not keys, even when they look like one.
select results_eq($$ select path from private.extract_refs(jsonb_build_object('a', repeat('v', 100) || '": ',
    'b', repeat('v', 100000), 'c', tests.ref(tests.entry('c101'), 'entry'))) $$,
  $$ values ('$."c"') $$, 'long string values are allowed, including one ending in a quote and colon');
select is((select count(*)::int from private.extract_refs(jsonb_build_object('list', tests.refs(1000)))), 1000,
  '1,000 references are allowed');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object('list', tests.refs(1001))) $$,
  '54000', 'more than 1000 references', '1,001 references are rejected with 54000');
-- References count wherever they are, a reference inside another's usage
-- properties included.
select is((select count(*)::int from private.extract_refs(jsonb_build_object('a', tests.refs(500),
    'b', jsonb_build_object('c', tests.refs(498)),
    'd', tests.ref(tests.entry('c101'), 'entry') || jsonb_build_object('meta', tests.ref(tests.entry('c102'), 'entry'))))),
  1000, '1,000 references spread over the document, one inside another, are allowed');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object('a', tests.refs(500),
    'b', jsonb_build_object('c', tests.refs(499)),
    'd', tests.ref(tests.entry('c101'), 'entry') || jsonb_build_object('meta', tests.ref(tests.entry('c102'), 'entry')))) $$,
  '54000', 'more than 1000 references', '1,001 references spread over the document are rejected');
select throws_ok($$ select * from private.extract_refs(
    (select jsonb_build_object('list', jsonb_agg('{"_ref": "nope", "_kind": "page"}'::jsonb)) from generate_series(1, 1001))) $$,
  '54000', 'more than 1000 references', 'the reference limit is checked before references are validated');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(
    'x', '{"_ref": "nope", "_kind": "page"}'::jsonb || jsonb_build_object(repeat('k', 65), 1))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the key limit is checked before references are validated');

-- Object-key pattern (§4.3, decision 29): every object key in the document,
-- wherever it is, matches ^[A-Za-z0-9_-]{1,64}$, else 54000. Keys come from
-- schema field names and the fixed rich-text format, so no stored path contains
-- an escaped character. Checked after the nesting limit and before the
-- reference count, the walk and the _ref/_kind checks.
create table tests.bad_keys (label text primary key, k text);
insert into tests.bad_keys values
  ('64 control characters', repeat(chr(1), 64)),
  ('the empty key', ''),
  ('a space', 'a b'),
  ('a dot', 'a.b'),
  ('a double quote', 'a"b'),
  ('a backslash', 'a\b'),
  ('a dollar sign', 'a$'),
  ('a bracket', 'a[0'),
  ('þ', 'þ'),
  ('é', 'é'),
  ('an emoji', 'a' || chr(128512)),
  ('65 characters of a', repeat('a', 65));
-- Each key at the top level, nested, in an array element's object, on a
-- reference object and in a reference-free subtree beside a reference: every
-- one of the 60 documents is refused with 54000 and the rule's message.
create function tests.key_refusal(p_doc jsonb) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.count(*) from private.extract_refs(p_doc);
  return 'accepted';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create table tests.bad_key_docs as
  select b.label, w.place, w.doc
  from tests.bad_keys b
  cross join lateral (values
    ('top level', jsonb_build_object(b.k, 1)),
    ('nested', jsonb_build_object('a', jsonb_build_object('b', jsonb_build_object(b.k, 1)))),
    ('array element', jsonb_build_object('list', jsonb_build_array(1, jsonb_build_object(b.k, true)))),
    ('reference object', jsonb_build_object('x', tests.ref(tests.entry('c101'), 'entry') || jsonb_build_object(b.k, 'y'))),
    ('reference-free subtree', jsonb_build_object('x', tests.ref(tests.entry('c101'), 'entry'),
       'y', jsonb_build_object('z', jsonb_build_array(jsonb_build_object(b.k, null))))))
    as w (place, doc);
select is((select count(*)::int from tests.bad_key_docs where tests.key_refusal(doc) = '54000 object key does not match ^[A-Za-z0-9_-]{1,64}$'),
  60, 'keys outside ^[A-Za-z0-9_-]{1,64}$ are refused with 54000 wherever they are (12 keys at 5 places)');
select is_empty($$ select label, place, tests.key_refusal(doc) from tests.bad_key_docs
    where tests.key_refusal(doc) is distinct from '54000 object key does not match ^[A-Za-z0-9_-]{1,64}$' $$,
  'no refused-key document is accepted or fails another way (lists any that do)');
-- Each refused key on its own, at the top level (named in the test output).
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat(chr(1), 64), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key of 64 control characters is refused');
select throws_ok($$ select * from private.extract_refs('{"": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the empty key is refused');
select throws_ok($$ select * from private.extract_refs('{"a b": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a space is refused');
select throws_ok($$ select * from private.extract_refs('{"a.b": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a dot is refused');
select throws_ok($$ select * from private.extract_refs('{"a\"b": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a double quote is refused');
select throws_ok($$ select * from private.extract_refs('{"a\\b": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a backslash is refused');
select throws_ok($$ select * from private.extract_refs('{"a$": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a dollar sign is refused');
select throws_ok($$ select * from private.extract_refs('{"a[0": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with a bracket is refused');
select throws_ok($$ select * from private.extract_refs('{"þ": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the key þ is refused');
select throws_ok($$ select * from private.extract_refs('{"é": 1}') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the key é is refused');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object('a' || chr(128512), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key with an emoji is refused');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(repeat('a', 65), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'a key of 65 characters of a is refused');
-- Accepted: 64 characters of [A-Za-z0-9_-], _ref, _kind, a-b, A_9.
select results_eq($$ select path, ref from private.extract_refs(jsonb_build_object(
    repeat('Az9_-', 12) || 'Az09', jsonb_build_object('a-b', jsonb_build_object('A_9', tests.ref(tests.entry('c101'), 'entry'))))) $$,
  $$ values ('$."' || repeat('Az9_-', 12) || 'Az09' || '"."a-b"."A_9"', tests.entry('c101')) $$,
  'keys of 64 characters of [A-Za-z0-9_-], a-b, A_9, _ref and _kind are accepted');
select is(char_length(repeat('Az9_-', 12) || 'Az09'), 64, 'the accepted long key is 64 characters');
-- Order: the nesting limit first, then the key pattern, then the reference
-- count, then the walk's _ref and _kind checks.
select throws_ok($$ select * from private.extract_refs(tests.nest(128, '{"a b": 1}')) $$,
  '54000', 'document nested deeper than 128 levels', 'the nesting limit is checked before the key pattern');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object('list', tests.refs(1001), 'a b', 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the key pattern is checked before the reference count');
select throws_ok($$ select * from private.extract_refs(jsonb_build_object(
    'x', '{"_ref": "nope", "_kind": "page"}'::jsonb || jsonb_build_object(chr(1), 1))) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'the key pattern is checked before _ref and _kind are validated');
-- Strings that are values, not keys, may hold anything.
select results_eq($$ select path from private.extract_refs(jsonb_build_object('a', 'þ é "x": \ $ [0] ' || chr(1),
    'b', jsonb_build_array('a b', ''), 'c', tests.ref(tests.entry('c101'), 'entry'))) $$,
  $$ values ('$."c"') $$, 'string values with any characters are allowed');

insert into cms.entries (id, tenant_id, type, created_by) values
  (tests.entry('c109'), tests.tenant('labak'), 'news', tests.persona('editor_labak')),
  (tests.entry('c110'), tests.tenant('labak'), 'news', tests.persona('editor_labak'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c109'), tests.tenant('labak'), 1, '{}', tests.persona('editor_labak'));

-- Draft writes, as the editor: update and insert.
select tests.act_as(tests.persona('editor_labak'));
select lives_ok($$ update cms.drafts set data = jsonb_build_object(repeat('k', 64), tests.refs(1000))
  where entry_id = tests.entry('c109') $$, 'editor saves a draft with a 64-character key and 1,000 references');
select is((select count(*)::int from cms.draft_refs where entry_id = tests.entry('c109')), 1000,
  'the 1,000 references are in draft_refs');
select throws_ok($$ update cms.drafts set data = jsonb_build_object(repeat('k', 65), tests.refs(1))
  where entry_id = tests.entry('c109') $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'editor cannot save a draft with a 65-character key');
select throws_ok($$ update cms.drafts set data = jsonb_build_object('list', tests.refs(1001))
  where entry_id = tests.entry('c109') $$,
  '54000', 'more than 1000 references', 'editor cannot save a draft with 1,001 references');
select throws_ok($$ insert into cms.drafts (entry_id, tenant_id, schema_version, data)
  values (tests.entry('c110'), tests.tenant('labak'), 1, jsonb_build_object(repeat('k', 65), 1)) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'editor cannot insert a draft with a 65-character key');
select throws_ok($$ insert into cms.drafts (entry_id, tenant_id, schema_version, data)
  values (tests.entry('c110'), tests.tenant('labak'), 1, jsonb_build_object('list', tests.refs(1001))) $$,
  '54000', 'more than 1000 references', 'editor cannot insert a draft with 1,001 references');
select is((select count(*)::int from cms.draft_refs where entry_id = tests.entry('c109')), 1000,
  'refused saves leave draft_refs alone');

-- Revision inserts, as the worker.
select tests.act_as_service();
select lives_ok($$ insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.revision('d104'), tests.tenant('labak'), tests.entry('c109'), 2, 1,
          jsonb_build_object(repeat('k', 64), tests.refs(1000)), tests.persona('editor_labak')) $$,
  'service_role appends a revision with a 64-character key and 1,000 references');
select is((select count(*)::int from cms.revision_refs where revision_id = tests.revision('d104')), 1000,
  'the 1,000 references are in revision_refs');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c109'), 2, 1,
          jsonb_build_object(repeat('k', 65), tests.refs(1)), tests.persona('editor_labak')) $$,
  '54000', 'object key does not match ^[A-Za-z0-9_-]{1,64}$', 'service_role cannot append a revision with a 65-character key');
select throws_ok($$ insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c109'), 2, 1,
          jsonb_build_object('list', tests.refs(1001)), tests.persona('editor_labak')) $$,
  '54000', 'more than 1000 references', 'service_role cannot append a revision with 1,001 references');

-- Cost regressions (decision 28), measured with tests.cost: temp-file bytes
-- written and run time, for whole statements with their triggers.
--
-- The long-key probe: 100 levels of 900-character keys over 13,000 references,
-- 974,600 bytes as text (under the 1 MB data check). Every reference's path was
-- about 90 KB: before decision 28 the walk alone wrote 3.5 GB of temp files in
-- about 4 s. It is now rejected in about 0.1 s, most of it building the
-- document, with no temp files; the bounds (1 MB, 1 s) are wide margins that
-- still fail on the old behaviour.
select tests.act_as_owner();
select cmp_ok(octet_length(tests.trunk(100, 900, tests.refs(13000))::text), '>', 950000,
  'the long-key probe is about 1 MB');
select tests.act_as(tests.persona('editor_labak'));
insert into tests.costs select 'draft long keys', * from tests.cost($$ update cms.drafts
  set data = tests.trunk(100, 900, tests.refs(13000)) where entry_id = tests.entry('c109') $$);
-- The same keys with 1,000 references: the key limit alone stops it.
insert into tests.costs select 'draft long keys 1000 refs', * from tests.cost($$ update cms.drafts
  set data = tests.trunk(100, 900, tests.refs(1000)) where entry_id = tests.entry('c109') $$);
select tests.act_as_service();
insert into tests.costs select 'revision long keys', * from tests.cost($$ insert into cms.revisions
  (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c109'), 2, 1, tests.trunk(100, 900, tests.refs(13000)),
          tests.persona('editor_labak')) $$);
select tests.act_as_owner();
select results_eq($$ select probe, state from tests.costs order by probe $$,
  $$ values ('draft long keys', '54000'), ('draft long keys 1000 refs', '54000'), ('revision long keys', '54000') $$,
  'the long-key probes are rejected with 54000, as draft saves and as a revision');
select is_empty($$ select probe from tests.costs where temp_bytes >= 1024 * 1024 or elapsed >= interval '1 second' $$,
  'the long-key probes write under 1 MB of temp files and finish in under a second');

-- The control-character probe (Task 7 round 3 security review, decision 29):
-- 126 levels of objects, each with one key of 64 x chr(1), over an array of
-- 1,000 references; 128 levels deep, 1,000 references, 117,140 bytes as text.
-- Every key was within decision 28's 64 characters, but a path stores each key
-- escaped (chr(1) is \u0001, 6 characters), so every path was about 49 KB and
-- the result 48.8 MB of temp files (48,807,936 bytes in 0.53 s, as a draft save
-- and as a revision). The key pattern now refuses it before the walk: no temp
-- files, in milliseconds.
create function tests.control_keys() returns jsonb
language sql
set search_path = ''
as $$ select (pg_catalog.repeat('{' || pg_catalog.to_jsonb(pg_catalog.repeat(pg_catalog.chr(1), 64))::text || ':', 126)
              || tests.refs(1000)::text || pg_catalog.repeat('}', 126))::jsonb $$;
grant execute on function tests.control_keys() to authenticated, service_role;
select ok(octet_length(tests.control_keys()::text) = 117140
    and jsonb_path_exists(tests.control_keys(), 'strict $.**{127} ? (@.type() == "object")')
    and not jsonb_path_exists(tests.control_keys(), 'strict $.**{128} ? (@.type() == "object" || @.type() == "array")')
    and (select count(*) = 1000 from jsonb_path_query(tests.control_keys(), 'strict $.**._ref')),
  'the control-character probe is 117,140 bytes, 128 levels deep, with 1,000 references');
select tests.act_as(tests.persona('editor_labak'));
insert into tests.costs select 'draft control-character keys', * from tests.cost($$ update cms.drafts
  set data = tests.control_keys() where entry_id = tests.entry('c109') $$);
select tests.act_as_service();
insert into tests.costs select 'revision control-character keys', * from tests.cost($$ insert into cms.revisions
  (tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.tenant('labak'), tests.entry('c109'), 2, 1, tests.control_keys(), tests.persona('editor_labak')) $$);
select tests.act_as_owner();
select results_eq($$ select probe, state from tests.costs where probe like '% control-character keys' order by probe $$,
  $$ values ('draft control-character keys', '54000'), ('revision control-character keys', '54000') $$,
  'the control-character probe is refused with 54000, as a draft save and as a revision');
select is_empty($$ select probe from tests.costs where probe like '% control-character keys'
    and (temp_bytes <> 0 or elapsed >= interval '1 second') $$,
  'the control-character probe writes no temp files and is refused in under a second');
select is((select count(*)::int from cms.draft_refs where entry_id = tests.entry('c109')), 1000,
  'the refused control-character probe leaves draft_refs alone');

-- A document at every limit at once, just under 1 MB: 126 levels of objects
-- with 64-character keys, an array at level 127 and 1,000 reference objects at
-- level 128, each with a 64-character usage key holding 880 characters. Every
-- path is about 8.5 KB, so the result is about 8.5 MB of paths: the largest
-- result decisions 28 and 29 allow (no key is escaped, decision 29; the
-- documented worst case is about 10 MB of temp files per statement). It is
-- accepted, as a draft save and as a revision.
-- The only temp file is that result, spilled past work_mem (4 MB): locally
-- 8,486,912 bytes in about 0.18 s (26.6 MB in 0.27 s when the walk carried each
-- node's path), so the bounds are 10 MB and 1 s. The keys repeat, so the paths
-- compress under the primary keys' btree limit (2,704 bytes); paths this long
-- made of incompressible keys are refused by the index, also with 54000 (below).
create function tests.at_limits() returns jsonb
language sql
set search_path = ''
as $$ select tests.trunk(126, 64, (select pg_catalog.jsonb_agg(tests.ref(tests.entry('c101'), 'entry')
             || pg_catalog.jsonb_build_object(pg_catalog.repeat('u', 64), pg_catalog.repeat('x', 880)))
           from pg_catalog.generate_series(1, 1000))) $$;
grant execute on function tests.at_limits() to authenticated, service_role;
select ok((select octet_length(tests.at_limits()::text) between 1000000 and 1048576),
  'the document at the limits is between 1,000,000 bytes and 1 MB');
select ok(jsonb_path_exists(tests.at_limits(), 'strict $.**{127} ? (@.type() == "object")')
  and (select count(*) = 1000 from jsonb_path_query(tests.at_limits(), 'strict $.**._ref')),
  'the document at the limits is 128 levels deep with 1,000 references');
select tests.act_as(tests.persona('editor_labak'));
insert into tests.costs select 'draft at limits', * from tests.cost($$ update cms.drafts
  set data = tests.at_limits() where entry_id = tests.entry('c109') $$);
select tests.act_as_service();
insert into tests.costs select 'revision at limits', * from tests.cost($$ insert into cms.revisions
  (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
  values (tests.revision('d105'), tests.tenant('labak'), tests.entry('c109'), 3, 1, tests.at_limits(),
          tests.persona('editor_labak')) $$);
select tests.act_as_owner();
select results_eq($$ select probe, state from tests.costs where probe like '% at limits' order by probe $$,
  $$ values ('draft at limits', '00000'), ('revision at limits', '00000') $$,
  'the document at the limits is accepted, as a draft save and as a revision');
select is_empty($$ select probe from tests.costs where probe like '% at limits'
    and (temp_bytes > 10 * 1024 * 1024 or elapsed >= interval '1 second') $$,
  'the document at the limits writes at most 10 MB of temp files and is saved in under a second');
select set_eq($$ select path, target_entry_id from cms.draft_refs where entry_id = tests.entry('c109') $$,
  $$ select '$' || repeat('."' || repeat('k', 64) || '"', 126) || '[' || i || ']', tests.entry('c101')
     from generate_series(0, 999) as i $$,
  'every one of the 1,000 references is in draft_refs at its full path');
select set_eq($$ select path, target_entry_id from cms.revision_refs where revision_id = tests.revision('d105') $$,
  $$ select path, target_entry_id from cms.draft_refs where entry_id = tests.entry('c109') $$,
  'the revision at the limits has the same references');

-- Adversarial shapes inside all three limits (Task 7 round 2 security review).
-- The walk once kept one row per reference and per container on the way to
-- one, each with its full path, so a document whose references each sit at the
-- end of their own long chain under a shared trunk made it carry about 1,000
-- times the depth in paths. The walk now keeps one parent position and one step
-- per node and puts a path together only for a reference, so the only temp
-- file left is the result itself when it passes work_mem (4 MB): at most 1,000
-- paths of at most about 8.6 KB. Each shape is saved as a draft by the editor
-- and appended as a revision by the worker, with the bounds 10 MB and 1 s (at
-- most 8.0 MB and about 0.5 s locally, against up to 1.1 GB and 1.1 s before); the
-- statement timeout is only a guard. The measurements are printed at the end.
set local statement_timeout = '3s';
-- p_count references, each at the end of its own chain of p_chain objects
-- {"a": ...}, in an array under p_trunk objects with 64-character keys.
create function tests.branching(p_trunk int, p_chain int, p_count int) returns jsonb
language sql
set search_path = ''
as $$ select tests.trunk(p_trunk, 64, (select pg_catalog.jsonb_agg(tests.nest(p_chain, tests.ref(tests.entry('c101'), 'entry')))
           from pg_catalog.generate_series(1, p_count))) $$;
-- p_inner wrapped in p_levels objects, each with one 64-character key made of
-- two md5 digests of p_seed and the level, so the keys do not repeat and the
-- paths do not compress.
create function tests.md5_chain(p_seed text, p_levels int, p_inner jsonb) returns jsonb
language sql
set search_path = ''
as $$ select (pg_catalog.string_agg('{"' || pg_catalog.md5(p_seed || '/' || i) || pg_catalog.md5(i || '/' || p_seed) || '":', ''
              order by i) || p_inner::text || pg_catalog.repeat('}', p_levels))::jsonb
      from pg_catalog.generate_series(1, p_levels) as i $$;
-- p_count references, each at the end of its own chain of p_chain md5-key
-- objects, in an array under p_trunk objects with 64-character keys.
create function tests.md5_branching(p_trunk int, p_chain int, p_count int) returns jsonb
language sql
set search_path = ''
as $$ select tests.trunk(p_trunk, 64, (select pg_catalog.jsonb_agg(tests.md5_chain(g::text, p_chain, tests.ref(tests.entry('c101'), 'entry')))
           from pg_catalog.generate_series(1, p_count) as g)) $$;
grant execute on function tests.branching(int, int, int), tests.md5_chain(text, int, jsonb), tests.md5_branching(int, int, int)
  to authenticated, service_role;
-- The shapes, all within the limits: 128 levels at most, keys of 64 characters
-- at most, 1,000 references at most and 1 MB at most (before: when the walk
-- carried each node's path; now: this walk, as a draft save):
--   "branching", the security review's document: trunk 63, 1,000 chains of 63.
--     Before 1.1 GB of temp files in 1.1 s; now 4.5 MB (the result) in 0.28 s.
--   "branching deep trunk", its second document: trunk 118, 1,000 chains of 8.
--     Before 281 MB in 0.33 s; now 8.0 MB in 0.17 s.
--   "md5 chains": 1,000 chains of 13 incompressible keys under a trunk of 50.
--     Before 211 MB in 0.33 s; now 4.3 MB in 0.18 s.
--   "md5 deep chains": 370 chains of 38 incompressible keys under a trunk of 1,
--     about 2.6 KB per path, as long as the primary keys' btree limit (2,704
--     bytes per index row) allows. Before 39 MB in 0.14 s; now none in 0.14 s.
--   "long chains": 1,000 chains of 125, the most nodes the walk can enter.
--     Before 117 MB in 0.86 s; now none in 0.4 to 0.5 s, the slowest.
--   "deep blob": one reference beside a 940 KB array, 125 levels down, the
--     review's CPU probe (each level scanned the whole subtree again; now only
--     children at most half their parent are counted). Before 0.56 s; now 0.08 s.
create table tests.shapes (shape text primary key, doc jsonb);
insert into tests.shapes (shape, doc) values
  ('branching', tests.branching(63, 63, 1000)),
  ('branching deep trunk', tests.branching(118, 8, 1000)),
  ('md5 chains', tests.md5_branching(50, 13, 1000)),
  ('md5 deep chains', tests.md5_branching(1, 38, 370)),
  ('long chains', tests.branching(1, 125, 1000)),
  ('deep blob', tests.nest(125, jsonb_build_object('blob', (select jsonb_agg(jsonb_build_array(g, g)) from generate_series(1, 60000) as g),
                                                   'ref', tests.ref(tests.entry('c101'), 'entry'))));
grant select on tests.shapes to authenticated, service_role;
-- Depth d: a container at jsonpath depth d - 1 and none at depth d.
select results_eq($$ select s.shape, e.depth,
      jsonb_path_exists(s.doc, ('strict $.**{' || (e.depth - 1) || '} ? (@.type() == "object" || @.type() == "array")')::jsonpath)
      and not jsonb_path_exists(s.doc, ('strict $.**{' || e.depth || '} ? (@.type() == "object" || @.type() == "array")')::jsonpath),
      (select count(*)::int from jsonb_path_query(s.doc, 'strict $.**._ref')), octet_length(s.doc::text) <= 1048576
    from tests.shapes s
    join (values ('branching', 128), ('branching deep trunk', 128), ('md5 chains', 65), ('md5 deep chains', 41),
                 ('long chains', 128), ('deep blob', 128)) as e (shape, depth)
      on e.shape = s.shape
    order by s.shape $$,
  $$ values ('branching', 128, true, 1000, true), ('branching deep trunk', 128, true, 1000, true),
            ('deep blob', 128, true, 1, true), ('long chains', 128, true, 1000, true),
            ('md5 chains', 65, true, 1000, true), ('md5 deep chains', 41, true, 370, true) $$,
  'the adversarial shapes are within the limits: depth, references and size');
select is_empty($$ select 1 from tests.shapes s,
    lateral (select regexp_matches(s.doc::text, '"((?:[^"\\]|\\.)*)":', 'g')) as m (a) where m.a[1] !~ '^[A-Za-z0-9_-]{1,64}$' $$,
  'the adversarial shapes'' keys all match ^[A-Za-z0-9_-]{1,64}$');

-- Each shape: the editor saves it as c109's draft, and draft_refs then holds
-- exactly the references strict $.**._ref finds, each at a path that evaluates
-- to it; the worker appends it as a revision with the same references.
create function tests.save_shape(p_shape text, p_revision text, p_version int) returns void
language plpgsql
set search_path = ''
as $$
begin
  perform tests.act_as(tests.persona('editor_labak'));
  insert into tests.costs select 'draft ' || p_shape, c.* from tests.cost(pg_catalog.format(
    'update cms.drafts set data = (select doc from tests.shapes where shape = %L) where entry_id = tests.entry(''c109'')',
    p_shape)) as c;
  perform tests.act_as_service();
  insert into tests.costs select 'revision ' || p_shape, c.* from tests.cost(pg_catalog.format(
    'insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, requested_by)
       select tests.revision(%L), tests.tenant(''labak''), tests.entry(''c109''), %s, 1, doc, tests.persona(''editor_labak'')
       from tests.shapes where shape = %L', p_revision, p_version, p_shape)) as c;
  perform tests.act_as_owner();
end;
$$;
create table tests.shape_refs (shape text, path text, target uuid, found boolean, in_revision boolean);
create function tests.record_shape(p_shape text, p_revision text) returns void
language sql
set search_path = ''
as $$
  with s as materialized (select doc #> '{}' as doc from tests.shapes where shape = p_shape)
  insert into tests.shape_refs
  select p_shape, r.path, r.target_entry_id,
         (pg_catalog.jsonb_path_query_first(s.doc, ('strict ' || r.path)::pg_catalog.jsonpath, '{}', true) ->> '_ref') = r.target_entry_id::text,
         exists (select 1 from cms.revision_refs v where v.tenant_id = tests.tenant('labak') and v.revision_id = tests.revision(p_revision)
                 and v.path = r.path and v.target_entry_id = r.target_entry_id)
  from cms.draft_refs r, s
  where r.entry_id = tests.entry('c109')
$$;
select tests.save_shape('branching', 'd106', 4);
select tests.record_shape('branching', 'd106');
select tests.save_shape('branching deep trunk', 'd107', 5);
select tests.record_shape('branching deep trunk', 'd107');
select tests.save_shape('md5 chains', 'd108', 6);
select tests.record_shape('md5 chains', 'd108');
select tests.save_shape('md5 deep chains', 'd109', 7);
select tests.record_shape('md5 deep chains', 'd109');
select tests.save_shape('long chains', 'd10b', 8);
select tests.record_shape('long chains', 'd10b');
select tests.save_shape('deep blob', 'd10c', 9);
select tests.record_shape('deep blob', 'd10c');
-- The probes of the shapes above (the longest path comes after).
create view tests.shape_costs as
  select c.* from tests.costs c join tests.shapes s on c.probe in ('draft ' || s.shape, 'revision ' || s.shape);
select results_eq($$ select probe, state from tests.shape_costs order by probe $$,
  $$ values ('draft branching', '00000'), ('draft branching deep trunk', '00000'), ('draft deep blob', '00000'),
            ('draft long chains', '00000'), ('draft md5 chains', '00000'), ('draft md5 deep chains', '00000'),
            ('revision branching', '00000'), ('revision branching deep trunk', '00000'), ('revision deep blob', '00000'),
            ('revision long chains', '00000'), ('revision md5 chains', '00000'), ('revision md5 deep chains', '00000') $$,
  'the adversarial shapes are accepted, as draft saves and as revisions');
select is_empty($$ select probe from tests.shape_costs
    where (temp_bytes > 10 * 1024 * 1024 or elapsed >= interval '1 second') $$,
  'the adversarial shapes write at most 10 MB of temp files and are saved in under a second');
select results_eq($$ select shape, count(*)::int, count(*) filter (where found and in_revision)::int
    from tests.shape_refs group by shape order by shape $$,
  $$ values ('branching', 1000, 1000), ('branching deep trunk', 1000, 1000), ('deep blob', 1, 1),
            ('long chains', 1000, 1000), ('md5 chains', 1000, 1000), ('md5 deep chains', 370, 370) $$,
  'each shape''s references are all in draft_refs and revision_refs, at paths that evaluate to them');
select set_eq($$ select path from tests.shape_refs where shape = 'branching' $$,
  $$ select '$' || repeat('."' || repeat('k', 64) || '"', 63) || '[' || i || ']' || repeat('."a"', 63)
     from generate_series(0, 999) as i $$,
  'the branching shape''s references are at their full paths');
select ok((select min(octet_length(path)) > 2500 from tests.shape_refs where shape = 'md5 deep chains'),
  'the md5 deep chains'' paths are over 2,500 bytes of incompressible keys');

-- The longest path, 126 levels of incompressible 64-character keys (about
-- 8.5 KB), is within the limits too, but no index row can hold it: the primary
-- keys refuse it with 54000, so the write fails closed, cheaply.
insert into tests.shapes (shape, doc) values ('md5 longest path', tests.md5_chain('x', 126, tests.ref(tests.entry('c101'), 'entry')));
select tests.save_shape('md5 longest path', 'd10a', 10);
select results_eq($$ select probe, state from tests.costs where probe like '% md5 longest path' order by probe $$,
  $$ values ('draft md5 longest path', '54000'), ('revision md5 longest path', '54000') $$,
  'a path longer than the btree limit is refused with 54000, as a draft save and as a revision');
select is_empty($$ select probe from tests.costs where probe like '% md5 longest path'
    and (temp_bytes > 1024 * 1024 or elapsed >= interval '1 second') $$,
  'the refused longest path writes under 1 MB of temp files and is refused in under a second');
select tests.act_as(tests.persona('editor_labak'));
select throws_like($$ update cms.drafts set data = (select doc from tests.shapes where shape = 'md5 longest path') where entry_id = tests.entry('c109') $$,
  'index row %', 'it is the index that refuses the longest path');
select tests.act_as_owner();

-- For the record: every cost measured above (SQLSTATE, temp bytes, run time).
select diag(probe || ' ' || state || ' ' || temp_bytes || ' ' || elapsed) from tests.costs order by probe;
select * from finish();
rollback;
