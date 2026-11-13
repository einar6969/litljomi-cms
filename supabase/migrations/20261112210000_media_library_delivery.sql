-- Media library L3: caption and credit reach the site (docs/plans/media-library.md sections 3.3
-- and 8, slice L3; spec §5.2, §7.1, §7.2). The file's caption and credit (L1,
-- 20261112200000_media_library.sql) are delivered with every use of the image: the three worker
-- functions that return asset metadata as JSON return them too, and the release build and the
-- preview endpoint copy them onto the delivered image value.
--
--   1. api.worker_read_request: each asset reference gains caption and credit (the pre-commit
--      projection, §6.2).
--   2. api.worker_release_snapshot: each asset gains caption and credit (the release build, §7.1).
--   3. api.worker_preview_draft: each asset gains caption and credit (preview, §7.5).
--
-- Additive and forward-only, because production has no backups and the worker that is live when
-- this lands must keep working until the next one is deployed:
--   - each function is replaced in place (CREATE OR REPLACE), with the same signature, result type,
--     volatility and grants, and the same body apart from the two keys;
--   - every key an asset object had is still there with the same value, so the live worker, which
--     copies the keys it knows one by one and ignores the rest, builds the same releases from it;
--   - nothing is dropped, no table, column, check or policy changes, and no row is written.
--
-- Each function stays SECURITY INVOKER with search_path = '' and schema-qualified names, executable
-- by service_role only. The tenant is still derived from the row: the request's, the release's or
-- the given entry's tenant, and every asset is looked up in that tenant only, so another tenant's
-- file never lends its caption or credit.

-- Replacing a function waits for nothing a request holds for long; the timeout only bounds the
-- wait, as in the other migrations (docs/runbooks/operations.md §8).
set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. The publish request's read: as in 20261102001100_worker_phase3.sql, with caption and credit
-- in each asset reference (null when the file has none, or is not in the request's tenant).
create or replace function api.worker_read_request(p_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'request', pg_catalog.to_jsonb(r),
           'entry', pg_catalog.to_jsonb(e),
           'tenant', pg_catalog.jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status),
           'draft', pg_catalog.jsonb_build_object('data', d.data, 'version', d.version,
                                                  'schema_version', d.schema_version),
           'refs', coalesce((
             select pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'path', x.path, 'kind', x.kind, 'id', x.ref,
                        'published', case when x.kind = 'entry' then te.published_rev_id is not null
                                          else ta.public_path is not null end,
                        'archived', case when x.kind = 'entry' then te.archived_at is not null
                                         else ta.archived_at is not null end)
                      || case when x.kind = 'entry' then
                           pg_catalog.jsonb_build_object('type', te.type, 'slug', te.slug, 'title', tr.title)
                         else
                           pg_catalog.jsonb_build_object('filename', ta.filename, 'mime', ta.mime,
                                                         'width', ta.width, 'height', ta.height,
                                                         'focal_x', ta.focal_x, 'focal_y', ta.focal_y,
                                                         'default_alt', ta.default_alt,
                                                         'public_path', ta.public_path,
                                                         'caption', ta.caption, 'credit', ta.credit)
                         end
                    order by x.path)
             from private.extract_refs(d.data) as x
             left join cms.entries te on x.kind = 'entry' and te.tenant_id = r.tenant_id and te.id = x.ref
             left join cms.revisions tr on tr.tenant_id = te.tenant_id and tr.entry_id = te.id
                                       and tr.id = te.published_rev_id
             left join cms.assets ta on x.kind = 'asset' and ta.tenant_id = r.tenant_id and ta.id = x.ref
           ), '[]'::jsonb))
    into v_result
  from cms.publish_requests r
  join cms.tenants t on t.id = r.tenant_id
  join cms.entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where r.id = p_request_id;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The build's snapshot: as in 20261105130000_withdrawal_safety.sql, with caption and credit in
-- each asset.
create or replace function api.worker_release_snapshot(p_release_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with rel as (
    select r.id, r.tenant_id, r.number, r.status from cms.releases r where r.id = p_release_id
  ),
  published as (
    select e.id as entry_id, e.tenant_id, e.type, e.slug, e.first_published_at, e.last_published_at,
           v.id as revision_id, v.schema_version, v.data, v.title, v.sort_at
    from rel
    join cms.entries e on e.tenant_id = rel.tenant_id
    join cms.revisions v on v.tenant_id = e.tenant_id and v.entry_id = e.id and v.id = e.published_rev_id
    where e.published_rev_id is not null and e.archived_at is null
  ),
  refs as (
    select rr.revision_id, rr.path, rr.target_entry_id, rr.target_asset_id
    from published p
    join cms.revision_refs rr on rr.tenant_id = p.tenant_id and rr.revision_id = p.revision_id
  )
  select pg_catalog.jsonb_build_object(
           'release', pg_catalog.jsonb_build_object('id', rel.id, 'tenant_id', rel.tenant_id, 'number', rel.number,
                                                    'status', rel.status),
           'tenant', (select pg_catalog.jsonb_build_object('id', t.id, 'slug', t.slug)
                      from cms.tenants t where t.id = rel.tenant_id),
           'entries', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'entry_id', p.entry_id, 'type', p.type, 'slug', p.slug, 'revision_id', p.revision_id,
                      'schema_version', p.schema_version, 'data', p.data, 'title', p.title, 'sort_at', p.sort_at,
                      'first_published_at', p.first_published_at, 'last_published_at', p.last_published_at,
                      'refs', coalesce((
                        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'path', x.path,
                                 'kind', case when x.target_entry_id is not null then 'entry' else 'asset' end,
                                 'id', coalesce(x.target_entry_id, x.target_asset_id))
                               order by x.path)
                        from refs x where x.revision_id = p.revision_id), '[]'::jsonb))
                    order by p.type, p.entry_id)
             from published p), '[]'::jsonb),
           'assets', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', a.id, 'original_path', a.original_path, 'filename', a.filename, 'mime', a.mime,
                      'width', a.width, 'height', a.height, 'focal_x', a.focal_x, 'focal_y', a.focal_y,
                      'default_alt', a.default_alt, 'public_path', a.public_path,
                      'archived', a.archived_at is not null,
                      'caption', a.caption, 'credit', a.credit)
                    order by a.id)
             from cms.assets a
             where a.tenant_id = rel.tenant_id
               and a.id in (select x.target_asset_id from refs x where x.target_asset_id is not null)), '[]'::jsonb),
           'requests', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action, 'revision_id', pr.revision_id,
                      'was_delivered', api.worker_entry_was_delivered(rel.id, pr.entry_id))
                    order by pr.requested_at, pr.id)
             from cms.publish_requests pr
             where pr.tenant_id = rel.tenant_id and pr.status = 'committed' and pr.release_id is null), '[]'::jsonb))
    into v_result
  from rel;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Preview's read: as in 20261103193500_preview_endpoint.sql, with caption and credit in each
-- asset. Shape:
--   { entry:  { id, type, slug, archived, first_published_at, last_published_at },
--     draft:  { data, version, schema_version },
--     assets: [ { id, filename, mime, width, height, focal_x, focal_y, default_alt, original_path,
--                 archived, caption, credit } ] }   -- distinct, ordered by id; only the tenant's
create or replace function api.worker_preview_draft(p_tenant_id uuid, p_entry_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
           'entry', pg_catalog.jsonb_build_object(
                      'id', e.id, 'type', e.type, 'slug', e.slug, 'archived', e.archived_at is not null,
                      'first_published_at', e.first_published_at, 'last_published_at', e.last_published_at),
           'draft', pg_catalog.jsonb_build_object('data', d.data, 'version', d.version,
                                                  'schema_version', d.schema_version),
           'assets', coalesce((
             select pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'id', a.id, 'filename', a.filename, 'mime', a.mime, 'width', a.width,
                        'height', a.height, 'focal_x', a.focal_x, 'focal_y', a.focal_y,
                        'default_alt', a.default_alt, 'original_path', a.original_path,
                        'archived', a.archived_at is not null,
                        'caption', a.caption, 'credit', a.credit)
                    order by a.id)
             from cms.assets a
             where a.tenant_id = e.tenant_id
               and a.id in (select x.ref from private.extract_refs(d.data) as x where x.kind = 'asset')
           ), '[]'::jsonb))
  from cms.entries e
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where e.tenant_id = p_tenant_id and e.id = p_entry_id
$$;

-- Grants: CREATE OR REPLACE keeps each function's ACL (EXECUTE for service_role only, §4.6, §8.1
-- item 2), which supabase/tests/database/118_media_library_delivery.test.sql pins.
