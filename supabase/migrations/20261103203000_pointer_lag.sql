-- Pointer lag recorded per release (plan M3-08; spec §7.4, §11.1 A6; decision 49.1;
-- docs/verification/m1-report.md "Known limitation").
--
-- After a delivered build writes the pointer, the worker polls the pointer's public URL until it
-- serves the release, within a bound (decision 49.1, apps/cms/src/privileged/worker/pointer-fresh.ts),
-- and only then notifies the sites. How long that took is the pointer lag: the Storage CDN served
-- the previous pointer for 0.6–54 s in sitting 6. The lag stays a measured limitation (decision
-- 50.5): nothing here changes the pointer's max-age or the SDK's pointer read. This migration only
-- keeps the measurement, per release, where the platform admin can see it.
--
--   1. cms.releases gets pointer_lag_ms (from the pointer write to the first public read that
--      served the release, or to the end of the bound) and pointer_fresh (true: the public URL
--      served the release; false: the bound was reached first). Both are null until the worker
--      records them, and stay null for a release that was never polled (a failed build, or a
--      tenant with no active site, which has no one to notify and so no wait). Both or neither.
--   2. api.worker_record_pointer_lag(p_release_id, p_lag_ms, p_fresh): stores them on a delivered
--      release, once. Returns true when it stored them, false when the release already has a lag
--      (the first measurement stands). 22023 for a null or negative argument; not_found for an
--      unknown release; forbidden when the release is not delivered.
--   3. api.release_pointer_lag: a security_invoker view of every release with its tenant's slug
--      and the lag. RLS on cms.releases and cms.tenants decides the rows: a platform admin at aal2
--      sees every tenant's (the console policies, §4.5), an editor only their own tenants', as in
--      cms.releases itself. anon has nothing.
--
-- The function is SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE is
-- granted to service_role only; PUBLIC has none through Task 4's global default privileges, and it
-- is revoked from anon and authenticated explicitly as well. service_role gets UPDATE on the two
-- new columns only. The audit trigger on cms.releases fires on status changes only, and this
-- update changes no status.

-- ---------------------------------------------------------------------------
-- 1. The columns.
alter table cms.releases
  add column pointer_lag_ms int check (pointer_lag_ms >= 0),
  add column pointer_fresh boolean,
  add constraint releases_pointer_lag_complete check ((pointer_lag_ms is null) = (pointer_fresh is null));

grant update (pointer_lag_ms, pointer_fresh) on cms.releases to service_role;

-- ---------------------------------------------------------------------------
-- 2. The worker records a delivered release's lag once.
create function api.worker_record_pointer_lag(p_release_id uuid, p_lag_ms int, p_fresh boolean)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_release cms.releases;
begin
  if p_release_id is null or p_lag_ms is null or p_lag_ms < 0 or p_fresh is null then
    raise exception 'p_release_id, p_lag_ms (at least 0) and p_fresh are required' using errcode = '22023';
  end if;
  select * into v_release from cms.releases r where r.id = p_release_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_release.status <> 'delivered' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_release.pointer_lag_ms is not null then
    return false;
  end if;
  update cms.releases r
  set pointer_lag_ms = p_lag_ms, pointer_fresh = p_fresh
  where r.id = v_release.id;
  return true;
end;
$$;

revoke execute on function api.worker_record_pointer_lag(uuid, int, boolean) from public, anon, authenticated;
grant execute on function api.worker_record_pointer_lag(uuid, int, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The platform view: the lag per release.
create view api.release_pointer_lag with (security_invoker = true) as
select rel.id as release_id, rel.tenant_id, t.slug as tenant_slug, rel.number, rel.status,
       rel.created_at, rel.delivered_at, rel.pointer_lag_ms, rel.pointer_fresh
from cms.releases rel
join cms.tenants t on t.id = rel.tenant_id;

revoke all on api.release_pointer_lag from public, anon;
grant select on api.release_pointer_lag to authenticated;
