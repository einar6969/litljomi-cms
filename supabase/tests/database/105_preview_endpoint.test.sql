-- supabase/tests/database/105_preview_endpoint.test.sql
-- M3-11: the preview endpoint's reads (spec §7.5; 20261103193500_preview_endpoint.sql).
-- api.worker_preview_tenant gives an active tenant's id by slug; api.worker_preview_draft gives
-- one entry of one tenant with its draft and the assets the draft references. Both are
-- service_role only. Grants are also counted in 010_catalog, 090_api_worker and 100_escalation.
--
-- Fixtures (owner context):
--   c301 labak news, draft version 3 referencing assets f301 and f302 (f302 archived)
--   c302 labak news, archived
--   c303 demo  news, draft referencing nothing
begin;
\ir _helpers.sql
select plan(19);

select tests.seed();
insert into cms.entries (id, tenant_id, type, slug, created_by, archived_at) values
  (tests.entry('c301'), tests.tenant('labak'), 'news', 'frett', tests.persona('editor_labak'), null),
  (tests.entry('c302'), tests.tenant('labak'), 'news', null, tests.persona('editor_labak'), now()),
  (tests.entry('c303'), tests.tenant('demo'), 'news', null, tests.persona('editor_demo'), null);
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by, archived_at)
  select a, tests.tenant('labak'), tests.tenant('labak') || '/' || a || '/' || f, f, 'image/jpeg', 1000, 800, 600,
         repeat('a', 64), tests.persona('editor_labak'), arch
  from (values ('00000000-0000-4000-8000-00000000f301'::uuid, 'a.jpg', null::timestamptz),
               ('00000000-0000-4000-8000-00000000f302'::uuid, 'b.jpg', now()),
               ('00000000-0000-4000-8000-00000000f303'::uuid, 'c.jpg', null)) as v(a, f, arch);
insert into cms.drafts (entry_id, tenant_id, schema_version, data, version, updated_by) values
  (tests.entry('c301'), tests.tenant('labak'), 1,
   '{"title": "Frétt", "image": {"_ref": "00000000-0000-4000-8000-00000000f301", "_kind": "asset", "alt": "x"},
     "gallery": [{"_ref": "00000000-0000-4000-8000-00000000f302", "_kind": "asset"},
                 {"_ref": "00000000-0000-4000-8000-00000000f301", "_kind": "asset"}]}', 3, tests.persona('editor_labak')),
  (tests.entry('c302'), tests.tenant('labak'), 1, '{}', 1, tests.persona('editor_labak')),
  (tests.entry('c303'), tests.tenant('demo'), 1, '{"title": "Demo"}', 1, tests.persona('editor_demo'));

-- ---------------------------------------------------------------------------
-- Catalog: signatures, invoker, pinned search_path, EXECUTE for service_role only.
create temporary table preview_functions (sig text primary key) on commit drop;
insert into preview_functions values ('api.worker_preview_tenant(text)'), ('api.worker_preview_draft(uuid,uuid)');
select is_empty($$ select sig from preview_functions where to_regprocedure(sig) is null $$,
  'both functions exist with M3-11''s signatures');
select is_empty($$ select sig from preview_functions
  where (select p.prosecdef from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)) $$,
  'both are SECURITY INVOKER');
select is_empty($$ select sig from preview_functions
  where not coalesce((select p.proconfig @> array['search_path=""'] from pg_catalog.pg_proc p where p.oid = to_regprocedure(sig)), false) $$,
  'both pin search_path to the empty string');
select is_empty($$ select sig from preview_functions
  where not has_function_privilege('service_role', to_regprocedure(sig), 'execute')
     or has_function_privilege('authenticated', to_regprocedure(sig), 'execute')
     or has_function_privilege('anon', to_regprocedure(sig), 'execute') $$,
  'EXECUTE: service_role only');

-- ---------------------------------------------------------------------------
-- Nobody else can call them.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) $$, '42501', null,
  'an editor of the tenant cannot read a draft through the preview function');
select throws_ok($$ select api.worker_preview_tenant('labak') $$, '42501', null, 'an editor cannot look up a tenant');
select tests.act_as(tests.persona('platform_admin'), 'aal2');
select throws_ok($$ select api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) $$, '42501', null,
  'a platform admin cannot either');
select tests.act_as_anon();
select throws_ok($$ select api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) $$, '42501', null, 'anon cannot either');

-- ---------------------------------------------------------------------------
-- worker_preview_tenant (as service_role).
select tests.act_as_service();
select is(api.worker_preview_tenant('labak'), tests.tenant('labak'), 'an active tenant''s id by its slug');
select is(api.worker_preview_tenant('enginn'), null::uuid, 'null for an unknown slug');
select tests.act_as_owner();
update cms.tenants set status = 'suspended' where id = tests.tenant('demo');
select tests.act_as_service();
select is(api.worker_preview_tenant('demo'), null::uuid, 'null for a suspended tenant: it cannot preview');

-- ---------------------------------------------------------------------------
-- worker_preview_draft (as service_role).
select is(api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) -> 'entry',
  jsonb_build_object('id', tests.entry('c301'), 'type', 'news', 'slug', 'frett', 'archived', false,
                     'first_published_at', null, 'last_published_at', null),
  'the entry: id, type, slug, archived and publication times');
select is((api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) -> 'draft') - 'data'::text,
  '{"version": 3, "schema_version": 1}'::jsonb, 'the draft''s version and schema version');
select is(api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) #>> '{draft,data,title}', 'Frétt',
  'the draft''s data');
select is((select array_agg(a ->> 'id' order by a ->> 'id')
           from jsonb_array_elements(api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) -> 'assets') a),
  array['00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f302'],
  'the assets the draft references, each once (not f303, which it does not reference)');
select is((select a from jsonb_array_elements(api.worker_preview_draft(tests.tenant('labak'), tests.entry('c301')) -> 'assets') a
           where a ->> 'id' = '00000000-0000-4000-8000-00000000f302') - array['id', 'focal_x', 'focal_y', 'default_alt']::text[],
  jsonb_build_object('filename', 'b.jpg', 'mime', 'image/jpeg', 'width', 800, 'height', 600,
                     'original_path', tests.tenant('labak') || '/00000000-0000-4000-8000-00000000f302/b.jpg', 'archived', true),
  'an asset row: its metadata, its original''s path and whether it is archived');
select is((api.worker_preview_draft(tests.tenant('labak'), tests.entry('c302')) #>> '{entry,archived}')::boolean, true,
  'an archived entry says so (the endpoint refuses it)');
select is(api.worker_preview_draft(tests.tenant('demo'), tests.entry('c301')), null::jsonb,
  'null for another tenant''s entry: the token''s entry is read in the path''s tenant only');
select is(api.worker_preview_draft(tests.tenant('labak'), gen_random_uuid()), null::jsonb, 'null for no such entry');

select * from finish();
rollback;
