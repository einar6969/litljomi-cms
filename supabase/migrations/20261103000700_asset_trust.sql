-- M3-07: private-media orphans and asset-function locks (spec §4.5, §4.6, §5.6; deferred Minors
-- Task 24 security r1 and P4 follow-up security r1; decision 50.5).
--
--   1. api.register_asset and api.update_asset lock the asset's tenant row FOR SHARE before they
--      read its status, so a suspension (an UPDATE of tenants.status, which takes a conflicting
--      row lock) either waits for the asset write to commit or commits first and is then seen as
--      tenant_inactive. Before, the status was read without a lock (P4 follow-up security r1).
--
--      A row lock needs UPDATE privilege on at least one column of the table, and under RLS an
--      UPDATE policy whose USING admits the row (PostgreSQL applies UPDATE policies to SELECT ...
--      FOR SHARE). §4.5 gives authenticated SELECT only on cms.tenants, so this migration adds,
--      as decision 31 did for service_role on cms.drafts (Einar, 2026-11-03, M3-07 thread:
--      "Lock-only grant (FOR SHARE)"):
--        - UPDATE (name) on cms.tenants to authenticated: the one column the lock needs;
--        - tenants_lock_member: an UPDATE policy for authenticated whose USING is the member
--          predicate of tenants_select_member and whose WITH CHECK is false. Every UPDATE an
--          editor could attempt fails (42501, new row violates the policy), so the grant lets an
--          editor lock their own tenant's row and change nothing. cms is not exposed through the
--          Data API, so the only route to the lock is these two functions.
--
--   2. api.worker_asset_metadata(p_tenant_id, p_asset_ids): the stored metadata of the given
--      assets of one tenant (mime, bytes, width, height, sha256), for the worker's re-derivation
--      at publish (decision 50.5: editor-declared metadata is a gap in trust). The metadata
--      columns are immutable for every role but the owner (no UPDATE grant on them), so a row read
--      before the commit is the row the commit publishes.
--
--   3. api.worker_private_orphans(p_grace_seconds, p_limit): media-private objects with no assets
--      row (refused, abandoned or never-registered uploads, including a suspended tenant's) older
--      than the grace period. The worker's sweep removes them through the Storage API. The grace
--      period must be at least an hour, so a fresh upload whose registration is still on its way
--      is never listed.
--
-- Everything is SECURITY INVOKER with search_path = '' and schema-qualified names. The editor
-- functions keep their signatures, owner and ACL (CREATE OR REPLACE). The worker functions are
-- executable by service_role only.

-- ---------------------------------------------------------------------------
-- 1. The lock-only grant and policy.
grant update (name) on cms.tenants to authenticated;

create policy tenants_lock_member on cms.tenants
  for update to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = tenants.id
      and m.user_id = (select auth.uid())
  ))
  with check (false);

-- register_asset: membership first (not_found, so a non-member learns nothing about the tenant),
-- then the tenant row locked FOR SHARE and its status read; a row the caller cannot see or lock
-- counts as inactive (fail closed, as before).
create or replace function api.register_asset(p_asset_id uuid, p_tenant_id uuid, p_original_path text, p_filename text,
                                              p_mime text, p_bytes bigint, p_width int, p_height int, p_sha256 text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
begin
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select t.status into v_status from cms.tenants t where t.id = p_tenant_id for share;
  if v_status is distinct from 'active' then
    raise exception 'tenant_inactive' using errcode = 'P0001';
  end if;
  if p_asset_id is null or p_filename is null or p_filename in ('', '.', '..')
     or pg_catalog.strpos(p_filename, '/') > 0
     or p_original_path is distinct from (p_tenant_id::text || '/' || p_asset_id::text || '/' || p_filename) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256)
  values (p_asset_id, p_tenant_id, p_original_path, p_filename, p_mime, p_bytes, p_width, p_height, p_sha256)
  returning id into v_id;
  return v_id;
end;
$$;

-- update_asset: the tenant comes from the asset row (not_found when the caller cannot see it),
-- then the tenant row is locked FOR SHARE and its status read, as in register_asset.
create or replace function api.update_asset(p_asset_id uuid, p_focal_x real, p_focal_y real, p_default_alt text)
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
  set focal_x = p_focal_x, focal_y = p_focal_y, default_alt = p_default_alt
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Stored metadata of a tenant's assets, for the publish-time re-derivation. Only assets of
-- p_tenant_id are returned (an id of another tenant is silently absent), in id order. 22023 when
-- either argument is null or more than 1,000 ids are asked for (decision 28's reference cap).
create function api.worker_asset_metadata(p_tenant_id uuid, p_asset_ids uuid[])
returns table (id uuid, original_path text, mime text, bytes bigint, width int, height int, sha256 text)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_asset_ids is null or pg_catalog.cardinality(p_asset_ids) > 1000 then
    raise exception 'p_tenant_id and p_asset_ids (at most 1000) are required' using errcode = '22023';
  end if;
  return query
  select a.id, a.original_path, a.mime, a.bytes, a.width, a.height, a.sha256
  from cms.assets a
  where a.tenant_id = p_tenant_id and a.id = any (p_asset_ids)
  order by a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. media-private objects without an assets row, older than p_grace_seconds (at least 3600),
-- oldest first, at most p_limit (1 to 1000, Storage's batch delete limit). 22023 otherwise.
-- The index keeps the per-object lookup of an assets row cheap.
create index assets_original_path_idx on cms.assets (original_path);

create function api.worker_private_orphans(p_grace_seconds int, p_limit int default 100)
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
  order by o.created_at, o.name
  limit p_limit;
end;
$$;

revoke execute on function api.worker_asset_metadata(uuid, uuid[]), api.worker_private_orphans(int, int)
  from public, anon, authenticated;
grant execute on function api.worker_asset_metadata(uuid, uuid[]), api.worker_private_orphans(int, int)
  to service_role;
