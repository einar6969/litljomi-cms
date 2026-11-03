-- The preview endpoint's reads (spec §7.5, §13.2; plan M3-11).
--
-- /api/preview/{tenant} is privileged code: it holds the secret key and "reads drafts with the secret
-- key and returns only data scoped by the verified token" (§7.5). Only api is exposed, so it reads
-- through two service_role-only functions, in this order:
--
--   1. api.worker_preview_tenant(p_slug) gives the id of the active tenant with that slug, or null
--      (no such tenant, or suspended). The endpoint then reads the tenant's preview secrets with
--      M3-10's api.worker_preview_sites and verifies the token with them. Nothing about a draft is
--      read before the token is verified.
--   2. api.worker_preview_draft(p_tenant_id, p_entry_id) gives the entry the verified token names,
--      in that tenant only, with its draft and the assets the draft references, or null. The
--      references are extracted from the draft's data (private.extract_refs), never read from
--      draft_refs (which editors can write), as in api.worker_read_request; assets are looked up in
--      the same tenant only.
--
-- Both are SECURITY INVOKER with search_path = '' and schema-qualified names; they run with the
-- SELECT grants service_role already has on cms.tenants, entries, drafts and assets (Tasks 5–8).
-- EXECUTE is granted to service_role only; PUBLIC has none through Task 4's global default
-- privileges, and it is revoked from anon and authenticated explicitly as well.

-- 1. The active tenant with the slug, or null.
create function api.worker_preview_tenant(p_slug text)
returns uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id from cms.tenants t where t.slug = p_slug and t.status = 'active'
$$;

-- 2. The entry of the tenant, with its draft and the draft's assets, or null when the tenant has no
-- such entry. Shape:
--   { entry:  { id, type, slug, archived, first_published_at, last_published_at },
--     draft:  { data, version, schema_version },
--     assets: [ { id, filename, mime, width, height, focal_x, focal_y, default_alt, original_path,
--                 archived } ] }   -- distinct, ordered by id; only assets of the tenant
create function api.worker_preview_draft(p_tenant_id uuid, p_entry_id uuid)
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
                        'archived', a.archived_at is not null)
                    order by a.id)
             from cms.assets a
             where a.tenant_id = e.tenant_id
               and a.id in (select x.ref from private.extract_refs(d.data) as x where x.kind = 'asset')
           ), '[]'::jsonb))
  from cms.entries e
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where e.tenant_id = p_tenant_id and e.id = p_entry_id
$$;

-- Grants: service_role only (§4.6, §8.1 item 2).
revoke all on function
  api.worker_preview_tenant(text),
  api.worker_preview_draft(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  api.worker_preview_tenant(text),
  api.worker_preview_draft(uuid, uuid)
  to service_role;
