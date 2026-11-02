-- api.register_asset and api.update_asset refuse a tenant that is not active (spec §4.5, §4.6;
-- plan decisions 3 and 39.3).
--
-- Task 10's functions recorded and edited assets in a suspended tenant. They now raise
-- tenant_inactive (SQLSTATE P0001, decision 3) before any write when the asset's tenant is not
-- 'active', with the same fail-closed rule as api.request_publish: a tenant row the caller cannot
-- see counts as inactive. register_asset checks membership first (not_found, as before), so a
-- non-member learns nothing about the tenant's status; update_asset takes the tenant from the
-- asset row (not_found when the caller cannot see it, as before). Everything else is unchanged.
--
-- Same signatures, still SECURITY INVOKER with search_path = '' and schema-qualified names.
-- CREATE OR REPLACE keeps each function's owner and ACL, so EXECUTE stays exactly Task 10's:
-- authenticated only (080_api_editor and 101_asset_tenant_active check it).

create or replace function api.register_asset(p_asset_id uuid, p_tenant_id uuid, p_original_path text, p_filename text,
                                              p_mime text, p_bytes bigint, p_width int, p_height int, p_sha256 text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cms.tenants t where t.id = p_tenant_id and t.status = 'active') then
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

create or replace function api.update_asset(p_asset_id uuid, p_focal_x real, p_focal_y real, p_default_alt text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select a.tenant_id into v_tenant_id
  from cms.assets a
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cms.tenants t where t.id = v_tenant_id and t.status = 'active') then
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
