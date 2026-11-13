-- supabase/tests/database/118_media_library_delivery.test.sql
-- Media library L3 (20261112210000_media_library_delivery.sql; docs/plans/media-library.md
-- sections 3.3 and 8; spec §5.2, §7.1, §7.2): the three worker functions that return asset
-- metadata as JSON also return the file's caption and credit, so the release build and preview
-- deliver them with every use of the image.
--   1. Catalog: the same three signatures, still jsonb, invoker, search_path pinned, service_role
--      only.
--   2. Each asset object keeps every key it had (the worker that is live while the migration lands
--      reads them) and gains exactly caption and credit.
--   3. The values are the row's; null when the file has none; another tenant's file never lends
--      its caption or credit.
--
-- Fixtures (owner context; tests.k('xxxx') = 00000000-0000-4000-8000-00000000xxxx):
--   labak assets  m401 snudur.jpg   caption and credit
--                 m402 kleina.jpg   neither
--   demo asset    m403 leynd.jpg    caption and credit
--   c401 labak news: published revision d401 referencing m401 and m402; its draft references both,
--        and (forged with the refs trigger off) demo's m403
--   c402 demo news: draft referencing m403
--   e401 pending publish request for c401
begin;
\ir _helpers.sql
select plan(23);

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
create function tests.img(p_key text) returns jsonb
language sql
set search_path = ''
as $$ select pg_catalog.jsonb_build_object('_ref', tests.k(p_key), '_kind', 'asset', 'alt', 'Notkun') $$;
grant execute on function tests.k(text), tests.img(text) to anon, authenticated, service_role;

select tests.seed();
insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, default_alt,
                        caption, credit, created_by)
  select tests.k(k), tests.tenant(t), tests.tenant(t)::text || '/' || tests.k(k)::text || '/' || f, f, 'image/jpeg',
         1000, 800, 600, repeat('a', 64), 'Sjálfgefið', c, cr, tests.persona('editor_' || t)
  from (values ('4401', 'labak', 'snudur.jpg', 'Kanilsnúðar á bakka', 'Anna Önnudóttir'),
               ('4402', 'labak', 'kleina.jpg', null, null),
               ('4403', 'demo', 'leynd.jpg', 'Leyndur myndatexti', 'Leyndur ljósmyndari')) as v(k, t, f, c, cr);
insert into cms.entries (id, tenant_id, type, slug, created_by) values
  (tests.entry('c401'), tests.tenant('labak'), 'news', 'snudar', tests.persona('editor_labak')),
  (tests.entry('c402'), tests.tenant('demo'), 'news', null, tests.persona('editor_demo'));
insert into cms.drafts (entry_id, tenant_id, schema_version, data, updated_by) values
  (tests.entry('c401'), tests.tenant('labak'), 1,
   jsonb_build_object('title', 'Snúðar', 'image', tests.img('4401'), 'secondaryImage', tests.img('4402')),
   tests.persona('editor_labak')),
  (tests.entry('c402'), tests.tenant('demo'), 1, jsonb_build_object('image', tests.img('4403')),
   tests.persona('editor_demo'));
insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
  values (tests.revision('d401'), tests.tenant('labak'), tests.entry('c401'), 1, 1,
          jsonb_build_object('title', 'Snúðar', 'image', tests.img('4401'), 'secondaryImage', tests.img('4402')),
          'Snúðar', tests.persona('editor_labak'));
update cms.entries set published_rev_id = tests.revision('d401'), published_draft_version = 1,
                       first_published_at = now(), last_published_at = now()
  where id = tests.entry('c401');
-- (A draft cannot hold another tenant's reference: draft_refs' composite foreign keys refuse it.
-- The cross-tenant case is set up with the refs trigger off for one update, as 090 does.)
alter table cms.drafts disable trigger drafts_sync_refs_on_update;
update cms.drafts set data = data || jsonb_build_object('other', tests.img('4403')) where entry_id = tests.entry('c401');
alter table cms.drafts enable trigger drafts_sync_refs_on_update;
insert into cms.publish_requests (id, tenant_id, entry_id, action, draft_version, requested_by, status, claimed_at, attempts)
  values (tests.k('e401'), tests.tenant('labak'), tests.entry('c401'), 'publish', 2, tests.persona('editor_labak'),
          'pending', null, 0);

-- ---------------------------------------------------------------------------
-- 1. Catalog: replaced in place, so the signatures, result type and grants are the ones the live
-- worker calls.
create temporary table delivery_functions (sig text primary key) on commit drop;
insert into delivery_functions values
  ('api.worker_read_request(uuid)'), ('api.worker_release_snapshot(uuid)'), ('api.worker_preview_draft(uuid,uuid)');
select is_empty($$ select sig from delivery_functions where to_regprocedure(sig) is null $$,
  'the three functions keep their signatures');
select is_empty($$ select sig from delivery_functions
     where pg_catalog.pg_get_function_result(to_regprocedure(sig)) <> 'jsonb' $$,
  'all three still return jsonb');
select is_empty($$ select sig from delivery_functions f join pg_catalog.pg_proc p on p.oid = to_regprocedure(f.sig)
     where p.prosecdef or not coalesce(p.proconfig @> array['search_path=""'], false) $$,
  'all three are security invoker with search_path pinned to ''''');
select set_eq($$ select p.oid::regprocedure::text,
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid in (select to_regprocedure(sig) from delivery_functions) $$,
  $$ select to_regprocedure(sig)::text, g, 'EXECUTE' from delivery_functions, (values ('postgres'), ('service_role')) as o(g) $$,
  'EXECUTE: service_role only (postgres owns them)');
select is((select p.provolatile::text from pg_catalog.pg_proc p where p.oid = 'api.worker_preview_draft(uuid,uuid)'::regprocedure),
  's', 'worker_preview_draft is still stable');

-- Nobody else can call them.
select tests.act_as(tests.persona('editor_labak'));
select throws_ok($$ select api.worker_preview_draft(tests.tenant('labak'), tests.entry('c401')) $$, '42501', null,
  'an editor of the tenant cannot read a draft with its captions');
select throws_ok($$ select api.worker_read_request(tests.k('e401')) $$, '42501', null,
  'an editor cannot read a publish request');
select tests.act_as_anon();
select throws_ok($$ select api.worker_preview_draft(tests.tenant('labak'), tests.entry('c401')) $$, '42501', null,
  'anon cannot either');

-- ---------------------------------------------------------------------------
-- 2 and 3. api.worker_read_request: each asset reference gains caption and credit.
select tests.act_as_service();
create temporary table read_refs on commit drop as
  select x from jsonb_array_elements(api.worker_read_request(tests.k('e401')) -> 'refs') as x;
select is((select array_agg(k order by k) from read_refs, jsonb_object_keys(x) as k where x ->> 'path' = '$."image"'),
  array['archived', 'caption', 'credit', 'default_alt', 'filename', 'focal_x', 'focal_y', 'height', 'id', 'kind', 'mime',
        'path', 'public_path', 'published', 'width'],
  'read_request: an asset reference keeps its keys and gains exactly caption and credit');
select is((select x from read_refs where x ->> 'path' = '$."image"'),
  jsonb_build_object('path', '$."image"', 'kind', 'asset', 'id', tests.k('4401'), 'published', false, 'archived', false,
                     'filename', 'snudur.jpg', 'mime', 'image/jpeg', 'width', 800, 'height', 600, 'focal_x', null,
                     'focal_y', null, 'default_alt', 'Sjálfgefið', 'public_path', null,
                     'caption', 'Kanilsnúðar á bakka', 'credit', 'Anna Önnudóttir'),
  'read_request: the caption and credit are the row''s');
select is((select x - array['path', 'id', 'filename'] from read_refs where x ->> 'path' = '$."secondaryImage"'),
  jsonb_build_object('kind', 'asset', 'published', false, 'archived', false, 'mime', 'image/jpeg', 'width', 800,
                     'height', 600, 'focal_x', null, 'focal_y', null, 'default_alt', 'Sjálfgefið', 'public_path', null,
                     'caption', null, 'credit', null),
  'read_request: null for a file with neither');
select is((select x - 'path' from read_refs where x ->> 'path' = '$."other"'),
  jsonb_build_object('kind', 'asset', 'id', tests.k('4403'), 'published', false, 'archived', false, 'filename', null,
                     'mime', null, 'width', null, 'height', null, 'focal_x', null, 'focal_y', null, 'default_alt', null,
                     'public_path', null, 'caption', null, 'credit', null),
  'read_request: another tenant''s file reads as missing, with no caption or credit');

-- ---------------------------------------------------------------------------
-- api.worker_release_snapshot: each asset gains caption and credit.
create temporary table ids (name text primary key, id uuid) on commit drop;
grant select, insert on ids to service_role;
insert into ids select 'labak', r.id from api.worker_begin_release(tests.tenant('labak')) as r;
select isnt((select id from ids where name = 'labak'), null, 'a labak release is building');
create temporary table snap_assets on commit drop as
  select x from jsonb_array_elements(api.worker_release_snapshot((select id from ids where name = 'labak')) -> 'assets') as x;
select is((select array_agg(k order by k) from snap_assets, jsonb_object_keys(x) as k where (x ->> 'id')::uuid = tests.k('4401')),
  array['archived', 'caption', 'credit', 'default_alt', 'filename', 'focal_x', 'focal_y', 'height', 'id', 'mime',
        'original_path', 'public_path', 'width'],
  'snapshot: an asset keeps its keys and gains exactly caption and credit');
select is((select x from snap_assets where (x ->> 'id')::uuid = tests.k('4401')),
  jsonb_build_object('id', tests.k('4401'), 'original_path', tests.tenant('labak')::text || '/' || tests.k('4401')::text || '/snudur.jpg',
                     'filename', 'snudur.jpg', 'mime', 'image/jpeg', 'width', 800, 'height', 600, 'focal_x', null,
                     'focal_y', null, 'default_alt', 'Sjálfgefið', 'public_path', null, 'archived', false,
                     'caption', 'Kanilsnúðar á bakka', 'credit', 'Anna Önnudóttir'),
  'snapshot: the caption and credit are the row''s');
select is((select array[x -> 'caption', x -> 'credit'] from snap_assets where (x ->> 'id')::uuid = tests.k('4402')),
  array['null'::jsonb, 'null'::jsonb], 'snapshot: null for a file with neither');
select is((select count(*)::int from snap_assets where (x ->> 'id')::uuid = tests.k('4403')), 0,
  'snapshot: another tenant''s file is not in it');
select is_empty($$ select x from snap_assets where not (x ? 'caption' and x ? 'credit') $$,
  'snapshot: every asset of the release carries both keys, older files included');

-- ---------------------------------------------------------------------------
-- api.worker_preview_draft: each asset gains caption and credit.
create temporary table preview_assets on commit drop as
  select x from jsonb_array_elements(api.worker_preview_draft(tests.tenant('labak'), tests.entry('c401')) -> 'assets') as x;
select is((select array_agg(k order by k) from preview_assets, jsonb_object_keys(x) as k where (x ->> 'id')::uuid = tests.k('4401')),
  array['archived', 'caption', 'credit', 'default_alt', 'filename', 'focal_x', 'focal_y', 'height', 'id', 'mime',
        'original_path', 'width'],
  'preview: an asset keeps its keys and gains exactly caption and credit');
select is((select array[x ->> 'caption', x ->> 'credit'] from preview_assets where (x ->> 'id')::uuid = tests.k('4401')),
  array['Kanilsnúðar á bakka', 'Anna Önnudóttir'], 'preview: the caption and credit are the row''s');
select is((select array[x -> 'caption', x -> 'credit'] from preview_assets where (x ->> 'id')::uuid = tests.k('4402')),
  array['null'::jsonb, 'null'::jsonb], 'preview: null for a file with neither');
select is(array(select (x ->> 'id')::uuid from preview_assets order by 1), array[tests.k('4401'), tests.k('4402')],
  'preview: another tenant''s file referenced by the draft is not in it');
select is((select a ->> 'caption' from jsonb_array_elements(api.worker_preview_draft(tests.tenant('demo'), tests.entry('c402')) -> 'assets') a),
  'Leyndur myndatexti', 'preview: the demo entry gets its own tenant''s file and caption');

select * from finish();
rollback;
