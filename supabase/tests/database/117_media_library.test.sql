-- supabase/tests/database/117_media_library.test.sql
-- Media library L1 (20261112200000_media_library.sql; docs/plans/media-library.md sections 3, 4 and
-- 8; spec §4.3, §4.5, §4.6, §4.7, §5.6; Einar's ruling of 2026-11-12):
--   1. cms.assets gains caption, credit and thumb_path with their checks, and authenticated may
--      update exactly those three more columns.
--   2. api.asset_list gains its library columns; in_use has the truth table of the plan's
--      section 4.1 and agrees with api.archive_asset's refusal.
--   3. api.asset_usage: one row per file and entry.
--   4. api.asset_summary, api.update_asset_text and api.set_asset_thumbnail, with the persona matrix.
--   5. The audit event asset.updated records caption and credit; a thumbnail is not audited.
--   6. api.worker_private_orphans keeps an object an asset row names as its thumbnail.
-- The same objects over real HTTP, and the timings, are in tests/integration/src/media-library.test.ts.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak assets                               referenced by
--     a001 bolla.jpg      alt, caption, credit  the draft of live entry c171 (twice)
--     a002 braud.jpg      alt                   the published revision d172 of c172
--     a003 kaka.png       alt                   the draft of archived entry c173
--     a004 kleina.webp    alt                   c172's older revision d171 and the revision d174 of
--                                               c174, which is no longer published
--     a005 snudur.jpg     no alt                nothing
--     a006 terta.jpg      alt                   c171's draft and c172's published revision
--     a007 vinarbraud.jpg alt                   the draft and the published revision d175 of c175
--     a008 gamalt.jpg     alt '', archived      nothing
--     a009 autt.jpg       alt of spaces only    nothing
--   demo asset b001 demo.png, no alt            the draft of demo entry c179
begin;
\ir _helpers.sql
select plan(134);

create function tests.k(p_key text) returns uuid
language plpgsql
set search_path = ''
as $$
begin
  if p_key is null or p_key !~ '^[0-9a-f]{4}$' then
    raise exception 'unknown key: %', coalesce(p_key, '<null>');
  end if;
  return ('00000000-0000-4000-8000-00000000' || p_key)::uuid;
end;
$$;
create function tests.asset_path(p_tenant uuid, p_asset uuid, p_filename text) returns text
language sql
set search_path = ''
as $$ select p_tenant::text || '/' || p_asset::text || '/' || p_filename $$;
-- The one path a file's thumbnail may have: {tenant_id}/{asset_id}/thumb/{n}.webp.
create function tests.thumb(p_tenant text, p_key text, p_size text default '480') returns text
language sql
set search_path = ''
as $$ select tests.tenant(p_tenant)::text || '/' || tests.k(p_key)::text || '/thumb/' || p_size || '.webp' $$;
create function tests.ref(p_key text) returns jsonb
language sql
set search_path = ''
as $$ select pg_catalog.jsonb_build_object('_ref', tests.k(p_key), '_kind', 'asset', 'alt', '') $$;
grant execute on function tests.k(text), tests.asset_path(uuid, uuid, text), tests.thumb(text, text, text), tests.ref(text)
  to anon, authenticated, service_role;

-- Cells: each returns 'ok' (or a value) or the error, so a refusal can be compared as text.
create function tests.text_cell(p_key text default 'a005') returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.update_asset_text(tests.k(p_key), 'Snúður', 'Kanilsnúður með glassúr', 'Anna Önnudóttir');
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function tests.thumb_cell(p_key text default 'a001', p_path text default null) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.set_asset_thumbnail(tests.k(p_key), coalesce(p_path, tests.thumb('labak', p_key)));
  return 'ok';
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function tests.summary_cell() returns text
language plpgsql
set search_path = ''
as $$
begin
  return (api.asset_summary(tests.tenant('labak')) ->> 'files');
exception when others then
  return sqlstate || ' ' || sqlerrm;
end;
$$;
create function tests.view_cell(p_view text) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_count int;
begin
  execute pg_catalog.format('select count(*)::int from api.%I where tenant_id = $1', p_view) into v_count using tests.tenant('labak');
  return v_count::text;
exception when others then
  return sqlstate;
end;
$$;
grant execute on function tests.text_cell(text), tests.thumb_cell(text, text), tests.summary_cell(), tests.view_cell(text)
  to anon, authenticated, service_role;
-- An archive attempt that is undone whether or not it was allowed: 'archived' or the refusal.
create function tests.archive_cell(p_key text) returns text
language plpgsql
set search_path = ''
as $$
begin
  perform api.archive_asset(tests.k(p_key));
  raise exception 'archived';
exception when others then
  return sqlerrm;
end;
$$;
grant execute on function tests.archive_cell(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Catalog: the columns and their checks.
select col_type_is('cms', 'assets', 'caption', 'text', 'assets.caption is text');
select col_type_is('cms', 'assets', 'credit', 'text', 'assets.credit is text');
select col_type_is('cms', 'assets', 'thumb_path', 'text', 'assets.thumb_path is text');
select set_eq($$ select a.attname::text from pg_catalog.pg_attribute a
     where a.attrelid = 'cms.assets'::regclass and a.attname in ('caption', 'credit', 'thumb_path')
       and not a.attnotnull and not a.atthasdef $$,
  array['caption', 'credit', 'thumb_path'], 'the three new columns are nullable and have no default');
select set_eq($$ select conname::text collate "default", convalidated from pg_catalog.pg_constraint
     where conrelid = 'cms.assets'::regclass and contype = 'c'
       and conname in ('assets_caption_length', 'assets_credit_length', 'assets_thumb_path_form') $$,
  $$ values ('assets_caption_length', true), ('assets_credit_length', true), ('assets_thumb_path_form', true) $$,
  'the three new checks exist and are validated');

-- Grants (§4.5): three more UPDATE columns for authenticated, nothing new for INSERT, nothing for
-- service_role or anon. 050_assets_storage pins the same list.
select set_eq($$ select * from tests.column_privs('authenticated', 'cms.assets') $$,
  $$ values ('id', 'INSERT'), ('tenant_id', 'INSERT'), ('original_path', 'INSERT'), ('filename', 'INSERT'),
            ('mime', 'INSERT'), ('bytes', 'INSERT'), ('width', 'INSERT'), ('height', 'INSERT'), ('sha256', 'INSERT'),
            ('default_alt', 'INSERT'), ('created_by', 'INSERT'),
            ('focal_x', 'UPDATE'), ('focal_y', 'UPDATE'), ('default_alt', 'UPDATE'), ('archived_at', 'UPDATE'),
            ('caption', 'UPDATE'), ('credit', 'UPDATE'), ('thumb_path', 'UPDATE') $$,
  'authenticated: UPDATE gains caption, credit and thumb_path; INSERT is unchanged');
select set_eq($$ select * from tests.column_privs('service_role', 'cms.assets') $$,
  $$ values ('public_path', 'UPDATE') $$, 'service_role: still update (public_path) only');
select is_empty($$ select * from tests.column_privs('anon', 'cms.assets') $$, 'anon: still no column privilege on assets');
select table_privs_are('cms', 'assets', 'authenticated', array['SELECT'], 'authenticated: still table-level select only');
select policies_are('cms', 'assets', array['assets_select_member', 'assets_insert_member', 'assets_update_member'],
  'no new policy on assets');

-- Functions (§4.6): invoker, pinned search_path, the editor's for authenticated only, the
-- worker's for service_role only.
create temporary table library_functions (sig text primary key, editor boolean, result text, volatility "char") on commit drop;
insert into library_functions values
  ('api.update_asset_text(uuid,text,text,text)', true, 'void', 'v'),
  ('api.set_asset_thumbnail(uuid,text)', true, 'void', 'v'),
  ('api.asset_summary(uuid)', true, 'jsonb', 's'),
  ('api.worker_private_orphans(integer,integer)', false, 'TABLE(name text, created_at timestamp with time zone)', 's');
select is_empty($$ select sig from library_functions where to_regprocedure(sig) is null $$,
  'the three new functions and worker_private_orphans exist with these signatures');
select is_empty($$ select p.oid::regprocedure::text from pg_catalog.pg_proc p
     where p.oid in (select to_regprocedure(sig) from library_functions)
       and (p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false)) $$,
  'all four are security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from library_functions) $$,
  $$ select to_regprocedure(sig)::text, g, 'EXECUTE'
     from library_functions, (values ('postgres')) as o(g)
     union all
     select to_regprocedure(sig)::text, case when editor then 'authenticated' else 'service_role' end, 'EXECUTE'
     from library_functions $$,
  'EXECUTE: the editor functions for authenticated only, worker_private_orphans for service_role only; postgres owns all');
select is_empty($$ select f.sig from library_functions f join pg_catalog.pg_proc p on p.oid = to_regprocedure(f.sig)
     where pg_catalog.pg_get_function_result(p.oid) is distinct from f.result or p.provolatile is distinct from f.volatility $$,
  'return types and volatility: the two writes return void, asset_summary is stable and returns jsonb');
select is(pg_catalog.pg_get_function_arguments('api.worker_private_orphans(integer,integer)'::regprocedure),
  'p_grace_seconds integer, p_limit integer DEFAULT 100', 'worker_private_orphans keeps its arguments and default');
select is(pg_catalog.pg_get_function_arguments('api.update_asset_text(uuid,text,text,text)'::regprocedure),
  'p_asset_id uuid, p_default_alt text, p_caption text, p_credit text', 'update_asset_text: argument names');
select is(pg_catalog.pg_get_function_arguments('api.set_asset_thumbnail(uuid,text)'::regprocedure),
  'p_asset_id uuid, p_thumb_path text', 'set_asset_thumbnail: argument names');

-- Views (§4.6): asset_list keeps its eleven columns in place and appends nine; asset_usage is new.
create temporary table library_views (name text primary key, cols text[]) on commit drop;
insert into library_views values
  ('asset_list', array['id', 'tenant_id', 'filename', 'mime', 'width', 'height', 'focal_x', 'focal_y', 'default_alt',
                       'original_path', 'archived_at',
                       'bytes', 'created_at', 'caption', 'credit', 'thumb_path', 'kind', 'missing_alt', 'in_use',
                       'search_text']),
  ('asset_usage', array['tenant_id', 'asset_id', 'entry_id', 'type', 'title', 'in_draft', 'in_published']);
select is_empty($$ select v.name from library_views v
     where v.cols is distinct from (select array_agg(a.attname::text order by a.attnum) from pg_catalog.pg_attribute a
                                   where a.attrelid = to_regclass('api.' || v.name) and a.attnum > 0 and not a.attisdropped) $$,
  'asset_list and asset_usage have exactly these columns, in order');
select is_empty($$ select v.name from library_views v left join pg_catalog.pg_class c on c.oid = to_regclass('api.' || v.name)
     where c.oid is null or c.relkind <> 'v' or not coalesce(c.reloptions @> array['security_invoker=true'], false) $$,
  'both are security_invoker views');
select set_eq($$ select c.relname::text, case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end,
            a.privilege_type
     from library_views v join pg_catalog.pg_class c on c.oid = to_regclass('api.' || v.name),
          pg_catalog.aclexplode(c.relacl) a
     where a.grantee <> c.relowner $$,
  $$ select name, 'authenticated' as grantee, 'SELECT' as privilege_type from library_views $$,
  'both views: SELECT for authenticated only (besides the owner)');
select set_eq($$ select a.attname::text, pg_catalog.format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a
     where a.attrelid = to_regclass('api.asset_list') and a.attnum > 11 and not a.attisdropped $$,
  $$ values ('bytes', 'bigint'), ('created_at', 'timestamp with time zone'), ('caption', 'text'), ('credit', 'text'),
            ('thumb_path', 'text'), ('kind', 'text'), ('missing_alt', 'boolean'), ('in_use', 'boolean'),
            ('search_text', 'text') $$,
  'asset_list: the types of the appended columns');

-- Indexes (plan section 4.3).
select set_eq($$ select indexname::text collate "default", indexdef from pg_catalog.pg_indexes
     where schemaname = 'cms' and indexname in ('draft_refs_tenant_target_asset_idx', 'revision_refs_tenant_target_asset_idx',
                                                'assets_tenant_created_at_idx', 'assets_thumb_path_idx') $$,
  $$ values
     ('draft_refs_tenant_target_asset_idx',
      'CREATE INDEX draft_refs_tenant_target_asset_idx ON cms.draft_refs USING btree (tenant_id, target_asset_id) WHERE (target_asset_id IS NOT NULL)'),
     ('revision_refs_tenant_target_asset_idx',
      'CREATE INDEX revision_refs_tenant_target_asset_idx ON cms.revision_refs USING btree (tenant_id, target_asset_id) WHERE (target_asset_id IS NOT NULL)'),
     ('assets_tenant_created_at_idx',
      'CREATE INDEX assets_tenant_created_at_idx ON cms.assets USING btree (tenant_id, created_at DESC, id)'),
     ('assets_thumb_path_idx',
      'CREATE INDEX assets_thumb_path_idx ON cms.assets USING btree (thumb_path) WHERE (thumb_path IS NOT NULL)') $$,
  'the four indexes');
-- The audit triggers are the same two (050 pins the full trigger list).
select set_eq($$ select t.tgname::text collate "default" from pg_catalog.pg_trigger t
     where t.tgrelid = 'cms.assets'::regclass and not t.tgisinternal and t.tgname::text like '%audit%' $$,
  array['assets_audit_insert', 'assets_audit_update'], 'assets still has exactly its two audit triggers');

-- ---------------------------------------------------------------------------
-- Fixtures.
select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, default_alt, created_by,
                        created_at, archived_at) values
  (tests.k('a001'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a001'), 'bolla.jpg'),
   'bolla.jpg', 'image/jpeg', 1000, 800, 600, repeat('a', 64), 'Bolla', tests.persona('editor_labak'), '2026-11-01 10:00+00', null),
  (tests.k('a002'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a002'), 'braud.jpg'),
   'braud.jpg', 'image/jpeg', 2000, 800, 600, repeat('a', 64), 'Brauð', tests.persona('editor_labak'), '2026-11-02 10:00+00', null),
  (tests.k('a003'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a003'), 'kaka.png'),
   'kaka.png', 'image/png', 3000, 800, 600, repeat('a', 64), 'Kaka', tests.persona('editor_labak'), '2026-11-03 10:00+00', null),
  (tests.k('a004'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a004'), 'kleina.webp'),
   'kleina.webp', 'image/webp', 4000, 800, 600, repeat('a', 64), 'Kleina', tests.persona('editor_labak'), '2026-11-04 10:00+00', null),
  (tests.k('a005'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a005'), 'snudur.jpg'),
   'snudur.jpg', 'image/jpeg', 5000, 800, 600, repeat('a', 64), null, tests.persona('editor_labak'), '2026-11-05 10:00+00', null),
  (tests.k('a006'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a006'), 'terta.jpg'),
   'terta.jpg', 'image/jpeg', 6000, 800, 600, repeat('a', 64), 'Terta', tests.persona('editor_labak'), '2026-11-06 10:00+00', null),
  (tests.k('a007'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a007'), 'vinarbraud.jpg'),
   'vinarbraud.jpg', 'image/jpeg', 7000, 800, 600, repeat('a', 64), 'Vínarbrauð', tests.persona('editor_labak'), '2026-11-07 10:00+00', null),
  (tests.k('a008'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a008'), 'gamalt.jpg'),
   'gamalt.jpg', 'image/jpeg', 8000, 800, 600, repeat('a', 64), '', tests.persona('editor_labak'), '2026-11-08 10:00+00', now()),
  (tests.k('a009'), tests.tenant('labak'), tests.asset_path(tests.tenant('labak'), tests.k('a009'), 'autt.jpg'),
   'autt.jpg', 'image/jpeg', 9000, 800, 600, repeat('a', 64), E'  \n\t ', tests.persona('editor_labak'), '2026-11-09 10:00+00', null),
  (tests.k('b001'), tests.tenant('demo'), tests.asset_path(tests.tenant('demo'), tests.k('b001'), 'demo.png'),
   'demo.png', 'image/png', 500, 40, 30, repeat('b', 64), null, tests.persona('editor_demo'), '2026-11-01 10:00+00', null);
update cms.assets set caption = 'Rjómabolla á bolludegi', credit = 'Jón Jónsson' where id = tests.k('a001');

insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c171'), tests.tenant('labak'), 'news', 'bollur', tests.persona('editor_labak')),
  (tests.entry('c172'), tests.tenant('labak'), 'news', 'braud', tests.persona('editor_labak')),
  (tests.entry('c173'), tests.tenant('labak'), 'page', 'kokur', tests.persona('editor_labak')),
  (tests.entry('c174'), tests.tenant('labak'), 'news', 'kleinur', tests.persona('editor_labak')),
  (tests.entry('c175'), tests.tenant('labak'), 'page', 'vinarbraud', tests.persona('editor_labak')),
  (tests.entry('c179'), tests.tenant('demo'), 'news', 'demo', tests.persona('editor_demo'));
-- The draft triggers extract the references (§4.3). c171 names a001 twice.
insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, updated_by) values
  (tests.entry('c171'), tests.tenant('labak'), 1,
   jsonb_build_object('image', tests.ref('a001'), 'gallery', jsonb_build_array(tests.ref('a001'), tests.ref('a006'))),
   'Bollufrétt', tests.persona('editor_labak')),
  (tests.entry('c172'), tests.tenant('labak'), 1, '{}', 'Brauðfrétt', tests.persona('editor_labak')),
  (tests.entry('c173'), tests.tenant('labak'), 1, jsonb_build_object('image', tests.ref('a003')), 'Kökusíða',
   tests.persona('editor_labak')),
  (tests.entry('c174'), tests.tenant('labak'), 1, '{}', 'Kleinufrétt', tests.persona('editor_labak')),
  (tests.entry('c175'), tests.tenant('labak'), 1, jsonb_build_object('image', tests.ref('a007')), 'Vínarbrauð',
   tests.persona('editor_labak')),
  (tests.entry('c179'), tests.tenant('demo'), 1, jsonb_build_object('image', tests.ref('b001')), 'Demo',
   tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by) values
  (tests.revision('d171'), tests.tenant('labak'), tests.entry('c172'), 1, 1, jsonb_build_object('image', tests.ref('a004')),
   'Brauðfrétt', tests.persona('editor_labak')),
  (tests.revision('d172'), tests.tenant('labak'), tests.entry('c172'), 2, 1,
   jsonb_build_object('image', tests.ref('a002'), 'gallery', jsonb_build_array(tests.ref('a006'))),
   'Brauðfrétt', tests.persona('editor_labak')),
  (tests.revision('d174'), tests.tenant('labak'), tests.entry('c174'), 1, 1, jsonb_build_object('image', tests.ref('a004')),
   'Kleinufrétt', tests.persona('editor_labak')),
  (tests.revision('d175'), tests.tenant('labak'), tests.entry('c175'), 1, 1, jsonb_build_object('image', tests.ref('a007')),
   'Vínarbrauð', tests.persona('editor_labak'));
update cms.entries set published_rev_id = tests.revision('d172'), published_draft_version = 2,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c172');
update cms.entries set published_rev_id = tests.revision('d175'), published_draft_version = 1,
  first_published_at = now(), last_published_at = now() where id = tests.entry('c175');
-- c174 was published and withdrawn: its revision is history.
update cms.entries set first_published_at = now(), last_published_at = now() where id = tests.entry('c174');
update cms.entries set archived_at = now() where id = tests.entry('c173');

-- Stored objects, all three days old but the last. The names are the only thing that matters here.
insert into storage.objects (bucket_id, name, created_at) values
  ('media-private', tests.asset_path(tests.tenant('labak'), tests.k('a001'), 'bolla.jpg'), now() - interval '3 days'),
  ('media-private', tests.thumb('labak', 'a001'), now() - interval '3 days'),
  ('media-private', tests.thumb('labak', 'a001', '960'), now() - interval '3 days'),
  ('media-private', tests.thumb('labak', 'a002'), now() - interval '3 days'),
  ('media-public', tests.thumb('labak', 'a005'), now() - interval '3 days'),
  ('media-private', tests.thumb('demo', 'b001'), now() - interval '3 days'),
  ('media-private', tests.thumb('labak', 'a008'), now() - interval '3 days'),
  ('media-private', tests.thumb('labak', 'a007'), now() - interval '10 minutes');

-- ---------------------------------------------------------------------------
-- 1. The checks hold for every writer (owner context here).
select lives_ok($$ update cms.assets set caption = repeat('þ', 1000), credit = repeat('ð', 300) where id = tests.k('a009') $$,
  'a caption of 1000 characters and a credit of 300 are stored (characters, not bytes)');
select throws_ok($$ update cms.assets set caption = repeat('a', 1001) where id = tests.k('a009') $$, '23514', null,
  'a caption of 1001 characters is refused');
select throws_ok($$ update cms.assets set credit = repeat('a', 301) where id = tests.k('a009') $$, '23514', null,
  'a credit of 301 characters is refused');
update cms.assets set caption = null, credit = null where id = tests.k('a009');
select lives_ok($$ update cms.assets set thumb_path = tests.thumb('labak', 'a009') where id = tests.k('a009') $$,
  'thumb_path: the file''s own {tenant_id}/{asset_id}/thumb/480.webp is stored');
select lives_ok($$ update cms.assets set thumb_path = tests.thumb('labak', 'a009', '1280') where id = tests.k('a009') $$,
  'thumb_path: another size of the same form is stored');
create temporary table bad_thumb_paths (label text primary key, path text) on commit drop;
insert into bad_thumb_paths values
  ('another file of the tenant', tests.thumb('labak', 'a001')),
  ('another tenant''s folder', tests.thumb('demo', 'a009')),
  ('another tenant''s file', tests.thumb('demo', 'b001')),
  ('the original''s folder', tests.asset_path(tests.tenant('labak'), tests.k('a009'), '480.webp')),
  ('the original itself', tests.asset_path(tests.tenant('labak'), tests.k('a009'), 'autt.jpg')),
  ('not a WebP name', tests.tenant('labak')::text || '/' || tests.k('a009')::text || '/thumb/480.png'),
  ('a size with a leading zero', tests.thumb('labak', 'a009', '0480')),
  ('a size of five digits', tests.thumb('labak', 'a009', '48000')),
  ('a size that is not a number', tests.thumb('labak', 'a009', 'stor')),
  ('no size', tests.thumb('labak', 'a009', '')),
  ('a deeper path', tests.thumb('labak', 'a009') || '/x.webp'),
  ('a parent segment', tests.tenant('labak')::text || '/' || tests.k('a009')::text || '/thumb/../thumb/480.webp'),
  ('a trailing newline', tests.thumb('labak', 'a009') || E'\n'),
  ('a leading slash', '/' || tests.thumb('labak', 'a009')),
  ('upper case', upper(tests.thumb('labak', 'a009'))),
  ('a dot that is any character', replace(tests.thumb('labak', 'a009'), '.webp', 'xwebp')),
  ('the empty string', '');
grant select on bad_thumb_paths to authenticated;
create function tests.check_thumb_path(p_path text) returns text
language plpgsql
set search_path = ''
as $$
begin
  update cms.assets set thumb_path = p_path where id = tests.k('a009');
  return 'stored';
exception when others then
  return sqlstate;
end;
$$;
select is_empty($$ select label from bad_thumb_paths where tests.check_thumb_path(path) <> '23514' $$,
  'thumb_path: every path that is not the file''s own thumbnail path is refused by the check (23514)');
select is((select count(*)::int from bad_thumb_paths), 17, 'seventeen malformed paths were tried');
update cms.assets set thumb_path = null where id = tests.k('a009');

-- ---------------------------------------------------------------------------
-- 2. asset_list as labak's editor: the in_use truth table (plan section 4.1) and the derived columns.
select tests.act_as(tests.persona('editor_labak'));
select results_eq($$ select id, in_use from api.asset_list order by id $$,
  $$ values (tests.k('a001'), true),   -- a draft only
            (tests.k('a002'), true),   -- a published revision only
            (tests.k('a003'), false),  -- the draft of an archived entry
            (tests.k('a004'), false),  -- older revisions only: history does not count
            (tests.k('a005'), false),  -- nothing
            (tests.k('a006'), true),   -- one entry's draft and another's published revision
            (tests.k('a007'), true),   -- the draft and the published revision of one entry
            (tests.k('a008'), false),  -- archived, nothing
            (tests.k('a009'), false) $$,
  'in_use: a draft of a live entry or a currently published revision; never history, never an archived entry''s draft');
select results_eq($$ select id, kind, missing_alt from api.asset_list order by id $$,
  $$ values (tests.k('a001'), 'image'::text, false), (tests.k('a002'), 'image', false), (tests.k('a003'), 'image', false),
            (tests.k('a004'), 'image', false), (tests.k('a005'), 'image', true), (tests.k('a006'), 'image', false),
            (tests.k('a007'), 'image', false), (tests.k('a008'), 'image', true), (tests.k('a009'), 'image', true) $$,
  'kind is image for the three image types; missing_alt for a null, empty or blank default alt');
select results_eq($$ select bytes, created_at, caption, credit, thumb_path, search_text
     from api.asset_list where id = tests.k('a001') $$,
  $$ values (1000::bigint, '2026-11-01 10:00+00'::timestamptz, 'Rjómabolla á bolludegi'::text, 'Jón Jónsson'::text, null::text,
             E'bolla.jpg\nBolla\nRjómabolla á bolludegi\nJón Jónsson') $$,
  'asset_list: bytes, created_at, caption, credit, thumb_path and search_text of a file');
select is((select search_text from api.asset_list where id = tests.k('a005')), 'snudur.jpg',
  'search_text leaves out the texts a file does not have');
select results_eq($$ select id from api.asset_list where search_text ilike '%JÓN JÓNS%' $$,
  $$ values (tests.k('a001')) $$, 'one ilike over search_text finds a file by its credit, whatever the case');
select results_eq($$ select id from api.asset_list where search_text ilike '%bolludegi%' $$,
  $$ values (tests.k('a001')) $$, '... by its caption');
select results_eq($$ select id from api.asset_list where search_text ilike '%vínarbrauð%' $$,
  $$ values (tests.k('a007')) $$, '... by its default alt');
select results_eq($$ select id from api.asset_list where search_text ilike '%.webp%' $$,
  $$ values (tests.k('a004')) $$, '... and by its file name');
select results_eq($$ select id from api.asset_list where not in_use and archived_at is null order by created_at desc, id $$,
  $$ values (tests.k('a009')), (tests.k('a005')), (tests.k('a004')), (tests.k('a003')) $$,
  'the unused filter: not in use and not archived, newest first');
-- The eleven original columns still read as before (080_api_editor pins the whole row).
select results_eq($$ select id, tenant_id, filename, mime, width, height, focal_x, focal_y, default_alt, original_path, archived_at
     from api.asset_list where id = tests.k('a002') $$,
  $$ values (tests.k('a002'), tests.tenant('labak'), 'braud.jpg'::text, 'image/jpeg'::text, 800, 600, null::real, null::real,
             'Brauð'::text, tests.asset_path(tests.tenant('labak'), tests.k('a002'), 'braud.jpg'), null::timestamptz) $$,
  'asset_list: the original eleven columns are unchanged');

-- in_use and archive_asset never disagree about a published use: the archive is refused for exactly
-- the files a currently published revision names. The attempt is undone either way.
select results_eq($$ select k, tests.archive_cell(k) from unnest(array['a001', 'a002', 'a003', 'a004', 'a005', 'a006', 'a007', 'a009']) k order by k $$,
  $$ values ('a001', 'archived'), ('a002', 'published_reference'), ('a003', 'archived'), ('a004', 'archived'),
            ('a005', 'archived'), ('a006', 'published_reference'), ('a007', 'published_reference'), ('a009', 'archived') $$,
  'archive_asset refuses exactly the files a published revision names (a001 is in a draft only: L7)');
select set_eq($$ select asset_id from api.asset_usage where in_published $$,
  $$ values (tests.k('a002')), (tests.k('a006')), (tests.k('a007')) $$,
  'asset_usage.in_published names the same files');
select is((select count(*)::int from api.asset_list where archived_at is not null), 1, 'the archive attempts were undone');

-- ---------------------------------------------------------------------------
-- 3. asset_usage: one row per file and entry.
select results_eq($$ select asset_id, entry_id, type, title, in_draft, in_published, tenant_id
     from api.asset_usage order by asset_id, entry_id $$,
  $$ values (tests.k('a001'), tests.entry('c171'), 'news'::text, 'Bollufrétt'::text, true, false, tests.tenant('labak')),
            (tests.k('a002'), tests.entry('c172'), 'news', 'Brauðfrétt', false, true, tests.tenant('labak')),
            (tests.k('a006'), tests.entry('c171'), 'news', 'Bollufrétt', true, false, tests.tenant('labak')),
            (tests.k('a006'), tests.entry('c172'), 'news', 'Brauðfrétt', false, true, tests.tenant('labak')),
            (tests.k('a007'), tests.entry('c175'), 'page', 'Vínarbrauð', true, true, tests.tenant('labak')) $$,
  'asset_usage: each file''s entries once, with the draft''s title and where the use is; no history, no archived entry');
select is_empty($$ select 1 from api.asset_list l
     where l.in_use is distinct from exists (select 1 from api.asset_usage u where u.tenant_id = l.tenant_id and u.asset_id = l.id) $$,
  'a file is in use exactly when asset_usage has a row for it');
select is((select count(*)::int from api.asset_usage where asset_id = tests.k('a001')), 1,
  'two references from one draft are one usage row');

-- ---------------------------------------------------------------------------
-- 4a. asset_summary.
select is(api.asset_summary(tests.tenant('labak')),
  '{"files": 8, "bytes": 37000, "images": 8, "documents": 0, "missing_alt": 2, "unused": 4, "archived": 1}'::jsonb,
  'asset_summary: live files and their bytes, kinds, missing alt and unused among them, and the archived count');
select throws_ok($$ select api.asset_summary(tests.tenant('demo')) $$, 'P0001', 'not_found',
  'asset_summary of another tenant: not_found');
select throws_ok($$ select api.asset_summary(null) $$, 'P0001', 'not_found', 'asset_summary of no tenant: not_found');
select throws_ok($$ select api.asset_summary(gen_random_uuid()) $$, 'P0001', 'not_found',
  'asset_summary of a tenant that does not exist: not_found, as for one the caller is not in');

-- ---------------------------------------------------------------------------
-- 4b. The persona cells; a refusal changes nothing.
select tests.act_as_owner();
select set_config('tests.audit_before', (select coalesce(max(id), 0)::text from cms.audit_log), true);

select tests.act_as(tests.persona('editor_demo'));
select is(tests.text_cell(), 'P0001 not_found', 'update_asset_text: demo''s editor on a labak file: not_found');
select is(tests.thumb_cell(), 'P0001 not_found', 'set_asset_thumbnail: demo''s editor on a labak file: not_found');
select is(tests.summary_cell(), 'P0001 not_found', 'asset_summary: demo''s editor on labak: not_found');
select is(tests.view_cell('asset_usage'), '0', 'asset_usage: demo''s editor sees no labak row');
select is(tests.view_cell('asset_list'), '0', 'asset_list: demo''s editor sees no labak row');
select results_eq($$ select tenant_id, asset_id, entry_id, type, title, in_draft, in_published from api.asset_usage $$,
  $$ values (tests.tenant('demo'), tests.k('b001'), tests.entry('c179'), 'news'::text, 'Demo'::text, true, false) $$,
  'asset_usage: demo''s editor sees demo''s one row');
select results_eq($$ select id, in_use, missing_alt, search_text from api.asset_list $$,
  $$ values (tests.k('b001'), true, true, 'demo.png'::text) $$, 'asset_list: demo''s editor sees demo''s one file');
select is(api.asset_summary(tests.tenant('demo')),
  '{"files": 1, "bytes": 500, "images": 1, "documents": 0, "missing_alt": 1, "unused": 0, "archived": 0}'::jsonb,
  'asset_summary: demo''s editor reads demo''s summary');
-- demo's editor may name their own file's thumbnail, never a labak path, even one that exists.
select is(tests.thumb_cell('b001', tests.thumb('labak', 'a001')), 'P0001 forbidden',
  'set_asset_thumbnail: demo''s file pointed at labak''s thumbnail: forbidden');
select is(tests.thumb_cell('b001', tests.thumb('demo', 'b001')), 'ok', 'set_asset_thumbnail: demo''s editor names demo''s own thumbnail');

select tests.act_as(tests.persona('outsider'));
select is(tests.text_cell(), 'P0001 not_found', 'update_asset_text: outsider: not_found');
select is(tests.thumb_cell(), 'P0001 not_found', 'set_asset_thumbnail: outsider: not_found');
select is(tests.summary_cell(), 'P0001 not_found', 'asset_summary: outsider: not_found');
select is(tests.view_cell('asset_usage'), '0', 'asset_usage: outsider sees nothing');
select is((select count(*)::int from api.asset_usage) + (select count(*)::int from api.asset_list), 0,
  'outsider: no row of any tenant in either view');

select tests.act_as(tests.persona('revoked'));
select is(tests.text_cell(), 'P0001 not_found', 'update_asset_text: revoked member: not_found');
select is(tests.thumb_cell(), 'P0001 not_found', 'set_asset_thumbnail: revoked member: not_found');
select is(tests.summary_cell(), 'P0001 not_found', 'asset_summary: revoked member: not_found');
select is(tests.view_cell('asset_usage'), '0', 'asset_usage: revoked member sees nothing');

select tests.act_as(tests.persona('platform_admin'), 'aal2');
select is(tests.text_cell(), 'P0001 not_found', 'update_asset_text: platform admin at aal2 (no membership): not_found');
select is(tests.thumb_cell(), 'P0001 not_found', 'set_asset_thumbnail: platform admin at aal2: not_found');
select is(tests.summary_cell(), 'P0001 not_found', 'asset_summary: platform admin at aal2: not_found');
select is(tests.view_cell('asset_usage'), '0', 'asset_usage: platform admin at aal2 sees nothing (no implicit content access)');
select is(tests.view_cell('asset_list'), '0', 'asset_list: platform admin at aal2 sees nothing');

select tests.act_as_anon();
select matches(tests.text_cell(), '^42501 ', 'update_asset_text: anon has no EXECUTE');
select matches(tests.thumb_cell(), '^42501 ', 'set_asset_thumbnail: anon has no EXECUTE');
select matches(tests.summary_cell(), '^42501 ', 'asset_summary: anon has no EXECUTE');
select is(tests.view_cell('asset_usage'), '42501', 'asset_usage: anon cannot read it');

select tests.act_as_service();
select matches(tests.text_cell(), '^42501 ', 'update_asset_text: service_role has no EXECUTE');
select matches(tests.thumb_cell(), '^42501 ', 'set_asset_thumbnail: service_role has no EXECUTE');
select matches(tests.summary_cell(), '^42501 ', 'asset_summary: service_role has no EXECUTE');
select is(tests.view_cell('asset_usage'), '42501', 'asset_usage: service_role cannot read it');
select is(tests.view_cell('asset_list'), '42501', 'asset_list: service_role still cannot read it');

select tests.act_as_owner();
select results_eq($$ select id, default_alt, caption, credit, thumb_path from cms.assets where id in (tests.k('a001'), tests.k('a005')) order by id $$,
  $$ values (tests.k('a001'), 'Bolla'::text, 'Rjómabolla á bolludegi'::text, 'Jón Jónsson'::text, null::text),
            (tests.k('a005'), null, null, null, null) $$,
  'no refused call changed a labak file');
select is((select count(*)::int from cms.audit_log where id > current_setting('tests.audit_before')::bigint), 0,
  'no refused call, and no thumbnail, wrote an audit event');

-- ---------------------------------------------------------------------------
-- 4c. update_asset_text as labak's editor.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.text_cell(), 'ok', 'update_asset_text: labak''s editor edits a labak file');
select results_eq($$ select default_alt, caption, credit, missing_alt, search_text from api.asset_list where id = tests.k('a005') $$,
  $$ values ('Snúður'::text, 'Kanilsnúður með glassúr'::text, 'Anna Önnudóttir'::text, false,
             E'snudur.jpg\nSnúður\nKanilsnúður með glassúr\nAnna Önnudóttir') $$,
  'the three texts are stored and the derived columns follow');
select is(tests.text_cell(), 'ok', 'update_asset_text: the same texts again');
select lives_ok($$ select api.update_asset_text(tests.k('a005'), 'Snúður', null, '') $$,
  'update_asset_text: null and the empty string are stored as given');
select results_eq($$ select default_alt, caption, credit from api.asset_list where id = tests.k('a005') $$,
  $$ values ('Snúður'::text, null::text, ''::text) $$, 'a null clears a text; the empty string is kept as it came');
select lives_ok($$ select api.update_asset_text(tests.k('a005'), repeat('a', 1000), repeat('b', 1000), repeat('c', 300)) $$,
  'update_asset_text: texts at their limits are stored');
select throws_ok($$ select api.update_asset_text(tests.k('a005'), repeat('a', 1001), 'x', 'x') $$, '23514', null,
  'update_asset_text refuses a default alt of 1001 characters');
select throws_ok($$ select api.update_asset_text(tests.k('a005'), 'x', repeat('b', 1001), 'x') $$, '23514', null,
  'update_asset_text refuses a caption of 1001 characters');
select throws_ok($$ select api.update_asset_text(tests.k('a005'), 'x', 'x', repeat('c', 301)) $$, '23514', null,
  'update_asset_text refuses a credit of 301 characters');
select throws_ok($$ select api.update_asset_text(gen_random_uuid(), 'x', 'x', 'x') $$, 'P0001', 'not_found',
  'update_asset_text: an unknown file: not_found');
select throws_ok($$ select api.update_asset_text(null, 'x', 'x', 'x') $$, 'P0001', 'not_found',
  'update_asset_text: no file: not_found');
select throws_ok($$ select api.update_asset_text(tests.k('b001'), 'x', 'x', 'x') $$, 'P0001', 'not_found',
  'update_asset_text: labak''s editor on a demo file: not_found');
select lives_ok($$ select api.update_asset_text(tests.k('a008'), 'Gamalt', 'Gömul mynd', null) $$,
  'update_asset_text: an archived file can still be edited, as update_asset allows');
select lives_ok($$ select api.update_asset_text(tests.k('a005'), 'Snúður', 'Kanilsnúður', 'Anna') $$, 'update_asset_text: final texts');
-- The focal point is not this function's: update_asset still sets it, and keeps caption and credit.
select lives_ok($$ select api.update_asset(tests.k('a005'), 0.25, 0.75, 'Snúður á diski') $$, 'update_asset still works');
select results_eq($$ select focal_x, focal_y, default_alt, caption, credit from api.asset_list where id = tests.k('a005') $$,
  $$ values (0.25::real, 0.75::real, 'Snúður á diski'::text, 'Kanilsnúður'::text, 'Anna'::text) $$,
  'update_asset changes the focal point and default alt and leaves caption and credit alone');
select lives_ok($$ select api.update_asset_text(tests.k('a005'), 'Snúður', 'Kanilsnúður', 'Anna') $$,
  'update_asset_text leaves the focal point alone');
select results_eq($$ select focal_x, focal_y from api.asset_list where id = tests.k('a005') $$,
  $$ values (0.25::real, 0.75::real) $$, 'the focal point is unchanged');

-- ---------------------------------------------------------------------------
-- 4d. set_asset_thumbnail as labak's editor: only the file's own path, only an object that exists.
select is(tests.thumb_cell('a006'), 'P0001 not_found', 'set_asset_thumbnail: the right path with no stored object: not_found');
select is(tests.thumb_cell('a005'), 'P0001 not_found',
  'set_asset_thumbnail: an object of that name in another bucket does not count: not_found');
select is(tests.thumb_cell('a001', tests.thumb('labak', 'a002')), 'P0001 forbidden',
  'set_asset_thumbnail: another labak file''s thumbnail path, though it exists: forbidden');
select is(tests.thumb_cell('a001', tests.thumb('demo', 'b001')), 'P0001 forbidden',
  'set_asset_thumbnail: another tenant''s thumbnail path: forbidden');
select is(tests.thumb_cell('a001', tests.thumb('demo', 'a001')), 'P0001 forbidden',
  'set_asset_thumbnail: this file''s id under another tenant''s folder: forbidden');
select is(tests.thumb_cell('a001', tests.asset_path(tests.tenant('labak'), tests.k('a001'), 'bolla.jpg')), 'P0001 forbidden',
  'set_asset_thumbnail: the original''s own path, though it exists: forbidden');
-- The same malformed paths, rewritten for a001. The first of them would then be a001's own path,
-- so it is left out before anything is called.
select is_empty($$ with b as materialized (
       select label, replace(path, tests.k('a009')::text, tests.k('a001')::text) as path
       from bad_thumb_paths where label <> 'another file of the tenant')
     select b.label from b where tests.thumb_cell('a001', b.path) <> 'P0001 forbidden' $$,
  'set_asset_thumbnail: every malformed path is forbidden before the object is looked for');
select throws_ok($$ select api.set_asset_thumbnail(tests.k('a001'), null) $$, 'P0001', 'forbidden',
  'set_asset_thumbnail: no path: forbidden (a thumbnail is recorded, never cleared)');
select throws_ok($$ select api.set_asset_thumbnail(gen_random_uuid(), tests.thumb('labak', 'a001')) $$, 'P0001', 'not_found',
  'set_asset_thumbnail: an unknown file: not_found');
select throws_ok($$ select api.set_asset_thumbnail(null, tests.thumb('labak', 'a001')) $$, 'P0001', 'not_found',
  'set_asset_thumbnail: no file: not_found');
select is((select count(*)::int from api.asset_list where thumb_path is not null), 0, 'no refused call recorded a thumbnail');
select is(tests.thumb_cell('a001'), 'ok', 'set_asset_thumbnail: the file''s own path with a stored object is recorded');
select is((select thumb_path from api.asset_list where id = tests.k('a001')), tests.thumb('labak', 'a001'),
  'asset_list shows the thumbnail path');
select is(tests.thumb_cell('a001'), 'ok', 'set_asset_thumbnail: recording the same path again is fine');
select is(tests.thumb_cell('a008'), 'ok', 'set_asset_thumbnail: an archived file can have a thumbnail');

-- ---------------------------------------------------------------------------
-- 5. Audit (§4.7): asset.updated carries caption and credit; a thumbnail is not audited.
select tests.act_as_owner();
select results_eq($$ select actor_id, tenant_id, target_id, details from cms.audit_log
     where id > current_setting('tests.audit_before')::bigint and action = 'asset.updated' order by id $$,
  $$ values
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      '{"focal_x": null, "focal_y": null, "default_alt": "Snúður", "caption": "Kanilsnúður með glassúr", "credit": "Anna Önnudóttir"}'::jsonb),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      '{"focal_x": null, "focal_y": null, "default_alt": "Snúður", "caption": null, "credit": ""}'),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      jsonb_build_object('focal_x', null, 'focal_y', null, 'default_alt', repeat('a', 1000), 'caption', repeat('b', 1000),
                         'credit', repeat('c', 300))),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a008'),
      '{"focal_x": null, "focal_y": null, "default_alt": "Gamalt", "caption": "Gömul mynd", "credit": null}'),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      '{"focal_x": null, "focal_y": null, "default_alt": "Snúður", "caption": "Kanilsnúður", "credit": "Anna"}'),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      '{"focal_x": 0.25, "focal_y": 0.75, "default_alt": "Snúður á diski", "caption": "Kanilsnúður", "credit": "Anna"}'),
     (tests.persona('editor_labak'), tests.tenant('labak'), tests.k('a005'),
      '{"focal_x": 0.25, "focal_y": 0.75, "default_alt": "Snúður", "caption": "Kanilsnúður", "credit": "Anna"}') $$,
  'asset.updated: one event per change, with the new focal point, default alt, caption and credit; none for a call that changed nothing');
select is_empty($$ select 1 from cms.audit_log
     where id > current_setting('tests.audit_before')::bigint
       and (action <> 'asset.updated' or details ? 'thumb_path' or details::text like '%/thumb/%') $$,
  'recording a thumbnail wrote no audit event, and no event names a thumbnail path');
select is_empty($$ select 1 from cms.audit_log
     where char_length(details ->> 'caption') > 1000 or char_length(details ->> 'credit') > 300
        or char_length(details ->> 'default_alt') > 1000 $$,
  'no refused text reached the audit log');
-- Caption alone, and credit alone, are changes worth an event; the trigger's WHEN clause sees both.
select set_config('tests.audit_before', (select max(id)::text from cms.audit_log), true);
update cms.assets set caption = 'Annar myndatexti' where id = tests.k('a002');
update cms.assets set credit = 'Annar ljósmyndari' where id = tests.k('a002');
update cms.assets set thumb_path = tests.thumb('labak', 'a002') where id = tests.k('a002');
update cms.assets set caption = 'Annar myndatexti' where id = tests.k('a002');
select results_eq($$ select action, details from cms.audit_log where id > current_setting('tests.audit_before')::bigint order by id $$,
  $$ values ('system.asset.updated'::text,
             '{"focal_x": null, "focal_y": null, "default_alt": "Brauð", "caption": "Annar myndatexti", "credit": null}'::jsonb),
            ('system.asset.updated',
             '{"focal_x": null, "focal_y": null, "default_alt": "Brauð", "caption": "Annar myndatexti", "credit": "Annar ljósmyndari"}') $$,
  'a caption change and a credit change are each one event; a thumbnail change and an unchanged caption are none');
update cms.assets set thumb_path = null where id = tests.k('a002');

-- ---------------------------------------------------------------------------
-- 4e. A suspended tenant: the two writes are refused after the lock; the reads still answer.
-- (After part 5, because a status change is an audit event of its own.)
update cms.tenants set status = 'suspended' where id = tests.tenant('labak');
select tests.act_as(tests.persona('editor_labak'));
select is(tests.text_cell(), 'P0001 tenant_inactive', 'update_asset_text in a suspended tenant: tenant_inactive');
select is(tests.thumb_cell('a001', tests.thumb('labak', 'a001', '960')), 'P0001 tenant_inactive',
  'set_asset_thumbnail in a suspended tenant: tenant_inactive');
select is(tests.summary_cell(), '8', 'asset_summary still answers for a suspended tenant, as the views do');
select tests.act_as(tests.persona('outsider'));
select is(tests.text_cell(), 'P0001 not_found', 'an outsider still learns nothing about the suspension');
select tests.act_as_owner();
select is((select thumb_path from cms.assets where id = tests.k('a001')), tests.thumb('labak', 'a001'),
  'the suspended tenant''s file is unchanged');
update cms.tenants set status = 'active' where id = tests.tenant('labak');

-- ---------------------------------------------------------------------------
-- 6. worker_private_orphans keeps a named thumbnail and still lists an unnamed one.
-- Named now: a001's 480 (labak's editor), a008's 480 (archived file), b001's 480 (demo's editor).
select tests.act_as_service();
select set_eq($$ select name from api.worker_private_orphans(86400) $$,
  $$ values (tests.thumb('labak', 'a001', '960')), (tests.thumb('labak', 'a002')) $$,
  'worker_private_orphans: a thumbnail an asset row names is kept, in any tenant and for an archived file; an unnamed one is listed');
select is_empty($$ select 1 from api.worker_private_orphans(3600, 1000)
     where name in (tests.thumb('labak', 'a007'), tests.thumb('labak', 'a005'),
                    tests.asset_path(tests.tenant('labak'), tests.k('a001'), 'bolla.jpg')) $$,
  'still not listed: an object inside the grace period, another bucket''s object, a registered original');
-- A newer thumbnail replaces the older one, which then belongs to the sweep.
select tests.act_as(tests.persona('editor_labak'));
select is(tests.thumb_cell('a001', tests.thumb('labak', 'a001', '960')), 'ok',
  'set_asset_thumbnail: another size of the file''s own thumbnail replaces the first');
select tests.act_as_service();
select set_eq($$ select name from api.worker_private_orphans(86400) $$,
  $$ values (tests.thumb('labak', 'a001')), (tests.thumb('labak', 'a002')) $$,
  'worker_private_orphans: the replaced thumbnail is listed, the new one kept');
select results_eq($$ select name from api.worker_private_orphans(86400, 1) $$,
  $$ values (tests.thumb('labak', 'a001')) $$, 'worker_private_orphans: still at most p_limit, in name order within one age');
select throws_ok($$ select * from api.worker_private_orphans(3599) $$, '22023', null,
  'worker_private_orphans: a grace period under an hour is still refused');
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select * from api.worker_private_orphans(86400) $$, '42501', null,
  'worker_private_orphans: an editor still has no EXECUTE');
select tests.act_as_owner();

select * from finish();
rollback;
