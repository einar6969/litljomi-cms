-- Worker recovery (spec §4.6, §7.1; plan Task 30, decisions 36.2 and 37.1). Two functions:
--
--   1. api.worker_fail_stale_releases(): a worker killed mid-build leaves its release building,
--      and at most one release per tenant can be building (§7.1), so every later build of the
--      tenant would be busy forever. The sweep calls this first: it fails every building release
--      older than 420 s (the worker's maxDuration of 300 s plus a 120 s margin) and returns what
--      it failed, so the worker can alert per release. A failed release links no requests (Task
--      20), so its requests are built by the tenant's next release. The status change is audited
--      as system.release.failed by the releases trigger (§4.7), with the error.
--
--      api.worker_finish_release (Task 20) finishes only a building release (forbidden
--      otherwise), so a late worker can never revive a release this function failed.
--
--   2. api.worker_pointer_check(p_release_id): what the worker checks right before it writes a
--      tenant's pointer (decision 37.1 (b)): whether the release is still building, and the
--      tenant's highest delivered release number (null when none). The worker writes the pointer
--      only while its release is building and no delivered release has a number at or above its
--      own, so the pointer only ever moves forward (§7.1). The tenant is the release's (§4.6);
--      an unknown release is not_found.
--
-- Both are SECURITY INVOKER with search_path = '' and schema-qualified names, and use only the
-- grants service_role already has on cms.releases (SELECT, and UPDATE of status and error, from
-- 20261102000600_publishing.sql).
-- EXECUTE is granted to service_role only; PUBLIC has none through Task 4's global default
-- privileges, and it is revoked from anon and authenticated explicitly as well.

-- 1. Stale building releases. The row lock of the UPDATE serialises with worker_finish_release's
-- FOR UPDATE: whichever runs first wins, and the other sees the release no longer building (the
-- UPDATE re-checks its WHERE clause on the locked row; the finish raises forbidden).
create function api.worker_fail_stale_releases()
returns table (release_id uuid, tenant_id uuid, number int, created_at timestamptz)
language plpgsql
volatile
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with failed as (
    update cms.releases r
    set status = 'failed',
        error = pg_catalog.jsonb_build_object('code', 'stale_building', 'maxAgeSeconds', 420)
    where r.status = 'building'
      and r.created_at < pg_catalog.now() - interval '420 seconds'
    returning r.id, r.tenant_id, r.number, r.created_at
  )
  select f.id, f.tenant_id, f.number, f.created_at
  from failed f
  order by f.tenant_id, f.number;
end;
$$;

-- 2. The check before a pointer write. One row: building (the release's status is 'building')
-- and latest_delivered (the highest number among the tenant's delivered releases, or null).
create function api.worker_pointer_check(p_release_id uuid)
returns table (building boolean, latest_delivered int)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select r.status = 'building',
         (select pg_catalog.max(d.number) from cms.releases d
          where d.tenant_id = r.tenant_id and d.status = 'delivered')
  from cms.releases r
  where r.id = p_release_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function api.worker_fail_stale_releases(), api.worker_pointer_check(uuid)
  from public, anon, authenticated;
grant execute on function api.worker_fail_stale_releases(), api.worker_pointer_check(uuid)
  to service_role;
