-- Media library L1: library data and API (docs/plans/media-library.md sections 3, 4 and 8, slice
-- L1; spec §4.3, §4.5, §4.6, §4.7, §5.6; Einar's ruling of 2026-11-12, which overrides v1's
-- exclusion of a media library). Nothing an editor sees yet: the page, the thumbnails and the
-- delivery of caption and credit are later slices.
--
--   1. cms.assets gains caption, credit and thumb_path, with their checks, and authenticated may
--      update those three columns.
--   2. Four indexes, so "is this file in use" is an index lookup and "newest first" needs no sort.
--   3. api.asset_list gains nine columns, appended.
--   4. api.asset_usage: the entries that use a file.
--   5. api.asset_summary: a tenant's counts.
--   6. api.update_asset_text and api.set_asset_thumbnail.
--   7. api.worker_private_orphans keeps an object an asset row names as its thumbnail.
--   8. The audit event asset.updated records caption and credit.
--
-- Additive and forward-only, because production has no backups and the app that is live when this
-- lands must keep working until the next one is deployed:
--   - nothing is dropped, no function changes its signature, and no row is rewritten;
--   - the only new CHECKs are on the three new columns, which are null on every existing row, so
--     no preflight is needed (a CHECK runs on every update of a row: 20261105140000_editor_limits);
--   - api.asset_list keeps its eleven columns, names, types and order, and so its grants (CREATE OR
--     REPLACE VIEW), and api.worker_private_orphans keeps its signature, result and grants.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified names; the views
-- are security_invoker, so RLS on the tables decides the rows, and no table gets a new policy. The
-- editor's functions and views are for authenticated only, the worker's function for service_role
-- only. Errors follow decision 3: P0001 with not_found, tenant_inactive or forbidden.

-- ---------------------------------------------------------------------------
-- 1 and 2. The table changes, in the order the live app takes the same tables' locks, so this
-- migration and a request in flight wait for each other in turn and never in a ring:
--   - a draft save writes cms.draft_refs and then checks its foreign key into cms.assets;
--   - the worker's commit locks its assets FOR SHARE and then writes cms.revision_refs.
-- So: draft_refs first, then assets, then revision_refs. An index build blocks writes to its
-- table and the ALTER blocks everything on cms.assets, each for the moment a small table takes.

-- 2a. The refs tables' only indexes were their primary keys, which lead with the referring entry
-- or revision; this one and 2c's lead with the file that is referred to (plan section 4.3).
create index draft_refs_tenant_target_asset_idx on cms.draft_refs (tenant_id, target_asset_id)
  where target_asset_id is not null;

-- 1. Per-file texts and the thumbnail (plan section 3.1).
--
-- caption and credit are per file and, from L3, delivered with every use of the image. Their
-- limits are in characters, like default_alt's. thumb_path is editor-only: the one place in
-- media-private where this file's thumbnail may be, {tenant_id}/{asset_id}/thumb/{n}.webp, with
-- {n} the size as one to four digits (L2 makes 480). The ids are in their canonical lowercase
-- text form, as in original_path, and hold no character with a meaning in a regular expression.
-- An original is always three segments (api.register_asset refuses a '/' in the file name), so a
-- thumbnail path can never name one. The check holds for every writer, so a file's thumbnail can
-- never point into another tenant's folder or at another file's.
alter table cms.assets
  add column caption text,
  add column credit text,
  add column thumb_path text,
  add constraint assets_caption_length check (char_length(caption) <= 1000),
  add constraint assets_credit_length check (char_length(credit) <= 300),
  add constraint assets_thumb_path_form check (
    thumb_path ~ ('^' || tenant_id::text || '/' || id::text || '/thumb/[1-9][0-9]{0,3}[.]webp$')
  );

-- §4.5: three more UPDATE columns. Nothing new for INSERT: registration is unchanged. cms is not
-- exposed, so the only route to these columns is the two functions of part 6.
grant update (caption, credit, thumb_path) on cms.assets to authenticated;

-- 2b. Newest first without a sort, and part 7's lookup of an object's name among the thumbnails,
-- as assets_original_path_idx serves the lookup among the originals.
create index assets_tenant_created_at_idx on cms.assets (tenant_id, created_at desc, id);
create index assets_thumb_path_idx on cms.assets (thumb_path) where thumb_path is not null;

-- 2c. The same lookup by file for published revisions and history.
create index revision_refs_tenant_target_asset_idx on cms.revision_refs (tenant_id, target_asset_id)
  where target_asset_id is not null;

-- ---------------------------------------------------------------------------
-- 3. api.asset_list, built on the definition in 20261102000800_api_editor.sql. The nine new
-- columns are appended and every other column keeps its name, type and position, so `create or
-- replace` keeps the view's grants (SELECT for authenticated only) and the deployed app's reads.
-- The option is repeated: a replace without it would clear security_invoker.
--
--   kind         derived from mime, never stored. Every file is an image today; `document` arrives
--                when the mime check admits one (L11).
--   missing_alt  an image whose default alt is null, empty or only white space.
--   in_use       plan section 4.1. A file is in use when either holds:
--                  1. the current draft of an entry that is not archived refers to it; or
--                  2. the revision an entry's published_rev_id points to refers to it.
--                Older revisions do not count: history never shrinks, so counting it would make
--                every file ever published used for good. Clause 2 is api.archive_asset's own
--                test: entries_published_rev_fkey makes an entry's published revision one of its
--                own, so "this revision is the published one of the entry it belongs to" is the
--                same rows as archive_asset's join on published_rev_id.
--   search_text  file name, default alt, caption and credit, one per line, for one ilike. No
--                full-text index (§4.3): a substring match over short, bounded text in one tenant.
-- "Unused" is `not in_use and archived_at is null`. PostgREST lets a caller filter any column with
-- a pattern of their choice; the editor's 3 s statement timeout bounds that, as for the other views.
--
-- in_use is computed for every file a request passes over: the whole tenant for the unused
-- filter and the summary, and every skipped row of a deep page. So each step of it is a lookup
-- by key with one table per level (the references by file, then the entry, or the revision and
-- its entry, by their unique keys), as scalar subqueries, which leave the planner no join order
-- to choose. Written as joins, it could start from all of the tenant's entries instead, and did
-- so whenever its statistics did not yet know the tenant's size (just after a large import):
-- every entry was then read once per file, and 5,000 files with 1,000 entries took 5.7 s, past
-- the editor's timeout. Which index serves the first lookup is still the planner's choice from
-- its statistics; media-library.test.ts measures with fresh ones, as autovacuum keeps them.
create or replace view api.asset_list with (security_invoker = true) as
select a.id, a.tenant_id, a.filename, a.mime, a.width, a.height, a.focal_x, a.focal_y, a.default_alt,
       a.original_path, a.archived_at,
       a.bytes, a.created_at, a.caption, a.credit, a.thumb_path,
       case when a.mime like 'image/%' then 'image' else 'document' end as kind,
       (a.mime like 'image/%' and coalesce(a.default_alt !~ '\S', true)) as missing_alt,
       (exists (
          select 1
          from cms.draft_refs dr
          where dr.tenant_id = a.tenant_id and dr.target_asset_id = a.id
            and (select e.archived_at is null
                 from cms.entries e
                 where e.tenant_id = dr.tenant_id and e.id = dr.entry_id)
        )
        or exists (
          select 1
          from cms.revision_refs rr
          where rr.tenant_id = a.tenant_id and rr.target_asset_id = a.id
            and rr.revision_id = (
              select e.published_rev_id
              from cms.entries e
              where e.tenant_id = rr.tenant_id
                and e.id = (select r.entry_id
                            from cms.revisions r
                            where r.tenant_id = rr.tenant_id and r.id = rr.revision_id))
        )) as in_use,
       pg_catalog.concat_ws(E'\n', a.filename, a.default_alt, a.caption, a.credit) as search_text
from cms.assets a;

-- ---------------------------------------------------------------------------
-- 4. api.asset_usage: one row per file and entry that uses it, by in_use's two clauses. in_draft:
-- the entry is not archived and its current draft refers to the file. in_published: the entry's
-- published revision does. title is the draft's, as in api.entry_list, which the row links to.
-- Several references from one document are one row. Every lookup carries tenant_id, and
-- composite foreign keys already make a reference across tenants impossible (§4.1 rule 3). No
-- `data` column is read (decision 65).
--
-- Written like in_use: the references first, then each row's entry, revision, type and title by
-- their unique keys, as scalar subqueries. A filter on asset_id and tenant_id reaches the refs
-- tables through the grouping, so one file's usage starts at its few references. With joins the
-- planner was free to start from every entry of the tenant, several levels deep.
create view api.asset_usage with (security_invoker = true) as
select u.tenant_id, u.asset_id, u.entry_id,
       (select e.type from cms.entries e where e.tenant_id = u.tenant_id and e.id = u.entry_id) as type,
       (select d.title from cms.drafts d where d.tenant_id = u.tenant_id and d.entry_id = u.entry_id) as title,
       u.in_draft, u.in_published
from (
  select x.tenant_id, x.asset_id, x.entry_id,
         pg_catalog.bool_or(x.in_draft) as in_draft, pg_catalog.bool_or(x.in_published) as in_published
  from (
    select dr.tenant_id, dr.target_asset_id as asset_id, dr.entry_id, true as in_draft, false as in_published
    from cms.draft_refs dr
    where dr.target_asset_id is not null
      and (select e.archived_at is null
           from cms.entries e
           where e.tenant_id = dr.tenant_id and e.id = dr.entry_id)
    union all
    select p.tenant_id, p.asset_id, p.entry_id, false, true
    from (
      select rr.tenant_id, rr.target_asset_id as asset_id, rr.revision_id,
             (select r.entry_id
              from cms.revisions r
              where r.tenant_id = rr.tenant_id and r.id = rr.revision_id) as entry_id
      from cms.revision_refs rr
      where rr.target_asset_id is not null
    ) p
    where p.revision_id = (select e.published_rev_id
                           from cms.entries e
                           where e.tenant_id = p.tenant_id and e.id = p.entry_id)
  ) x
  group by x.tenant_id, x.asset_id, x.entry_id
) u;

revoke all on api.asset_usage from public, anon, service_role;
grant select on api.asset_usage to authenticated;

-- ---------------------------------------------------------------------------
-- 5. api.asset_summary: the library's head line as one JSON value. The tenant is a parameter
-- because no id determines it, so the caller must be a member (not_found otherwise, as for a
-- tenant that does not exist). files, bytes, images, documents, missing_alt and unused count the
-- files that are not archived, which is what the library lists; archived counts the rest. The
-- columns are the view's, so kind, missing_alt and in_use keep one definition.
create function api.asset_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_summary jsonb;
begin
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select pg_catalog.jsonb_build_object(
    'files', count(*) filter (where l.archived_at is null),
    'bytes', coalesce(sum(l.bytes) filter (where l.archived_at is null), 0)::bigint,
    'images', count(*) filter (where l.archived_at is null and l.kind = 'image'),
    'documents', count(*) filter (where l.archived_at is null and l.kind = 'document'),
    'missing_alt', count(*) filter (where l.archived_at is null and l.missing_alt),
    'unused', count(*) filter (where l.archived_at is null and not l.in_use),
    'archived', count(*) filter (where l.archived_at is not null))
  into v_summary
  from api.asset_list l
  where l.tenant_id = p_tenant_id;
  return v_summary;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. The two writes. Both have api.update_asset's shape (20261103000700_asset_trust.sql): the
-- tenant comes from the asset row (not_found when the caller cannot see it), then the tenant row
-- is locked FOR SHARE through the lock-only grant and its status read, so a suspension either
-- waits for this write or is seen as tenant_inactive.

-- The three texts of a file, stored as given: null clears one. The focal point stays
-- api.update_asset's. A text past its limit is refused by the column's check (23514), before the
-- audit trigger copies it.
create function api.update_asset_text(p_asset_id uuid, p_default_alt text, p_caption text, p_credit text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_status text;
begin
  select a.tenant_id into v_tenant_id
  from cms.assets a
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select t.status into v_status from cms.tenants t where t.id = v_tenant_id for share;
  if v_status is distinct from 'active' then
    raise exception 'tenant_inactive' using errcode = 'P0001';
  end if;
  update cms.assets a
  set default_alt = p_default_alt, caption = p_caption, credit = p_credit
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Records a file's thumbnail (plan section 5). The path must be the one the column's check
-- allows for this file (forbidden otherwise, as api.register_asset answers a wrong path), and
-- the object must already be in media-private (not_found otherwise). storage.objects is read as
-- the caller, under the storage policies, so only an object in a tenant the caller belongs to
-- can be found. A thumbnail is recorded or replaced, never cleared: a null path is forbidden.
-- What the object holds is not checked: a member can store any image as their own tenant's
-- thumbnail, which only that tenant's editors see and which is never published (accepted, plan
-- section 5).
create function api.set_asset_thumbnail(p_asset_id uuid, p_thumb_path text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_status text;
begin
  select a.tenant_id into v_tenant_id
  from cms.assets a
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select t.status into v_status from cms.tenants t where t.id = v_tenant_id for share;
  if v_status is distinct from 'active' then
    raise exception 'tenant_inactive' using errcode = 'P0001';
  end if;
  if p_thumb_path is null
     or p_thumb_path !~ ('^' || v_tenant_id::text || '/' || p_asset_id::text || '/thumb/[1-9][0-9]{0,3}[.]webp$') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'media-private' and o.name = p_thumb_path
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  update cms.assets a
  set thumb_path = p_thumb_path
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function api.asset_summary(uuid), api.update_asset_text(uuid, text, text, text),
  api.set_asset_thumbnail(uuid, text) from public, anon, service_role;
grant execute on function api.asset_summary(uuid), api.update_asset_text(uuid, text, text, text),
  api.set_asset_thumbnail(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. api.worker_private_orphans, as in 20261103000700_asset_trust.sql plus one condition: an
-- object that an asset row names as its thumb_path is kept. Without it the sweep would delete
-- every thumbnail a day after it was made. The comparison is of whole object names, and both
-- columns are fixed to the row's own tenant folder by their checks, so one tenant's row can
-- never keep another tenant's object. It only ever lists fewer objects than before. Same
-- signature, default, result, owner and grants (CREATE OR REPLACE): service_role only.
create or replace function api.worker_private_orphans(p_grace_seconds int, p_limit int default 100)
returns table (name text, created_at timestamptz)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_grace_seconds is null or p_grace_seconds < 3600 then
    raise exception 'p_grace_seconds must be at least 3600' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  return query
  select o.name, o.created_at
  from storage.objects o
  where o.bucket_id = 'media-private'
    and o.created_at < pg_catalog.now() - pg_catalog.make_interval(secs => p_grace_seconds)
    and not exists (select 1 from cms.assets a where a.original_path = o.name)
    and not exists (select 1 from cms.assets a where a.thumb_path = o.name)
  order by o.created_at, o.name
  limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Audit (§4.7): asset.updated also fires for, and records, caption and credit. Both are
-- bounded by their checks, which run before this AFTER trigger. A thumbnail is not audited: it
-- is derived from the file, not a decision about it. The function is as in
-- 20261102000700_audit.sql otherwise; the trigger is replaced in place, which touches no row.
create or replace function private.audit_assets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.registered', 'asset', new.id,
            pg_catalog.jsonb_build_object('filename', new.filename, 'mime', new.mime, 'bytes', new.bytes));
    return null;
  end if;
  if (new.focal_x, new.focal_y, new.default_alt, new.caption, new.credit)
     is distinct from (old.focal_x, old.focal_y, old.default_alt, old.caption, old.credit) then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.updated', 'asset', new.id,
            pg_catalog.jsonb_build_object('focal_x', new.focal_x, 'focal_y', new.focal_y,
                                          'default_alt', new.default_alt, 'caption', new.caption,
                                          'credit', new.credit));
  end if;
  if old.archived_at is null and new.archived_at is not null then
    insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
    values (new.tenant_id, null, 'asset.archived', 'asset', new.id, null);
  end if;
  return null;
end;
$$;

-- Keep this WHEN clause identical to the function's IF conditions above.
create or replace trigger assets_audit_update
  after update on cms.assets
  for each row
  when ((old.focal_x, old.focal_y, old.default_alt, old.caption, old.credit)
          is distinct from (new.focal_x, new.focal_y, new.default_alt, new.caption, new.credit)
        or (old.archived_at is null and new.archived_at is not null))
  execute function private.audit_assets();
