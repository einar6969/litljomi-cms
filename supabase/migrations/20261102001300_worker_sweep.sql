-- The sweep's two read functions (spec §6.1, §6.3, §7.1, §7.4, §8.4; plan Task 21, decision 34.2).
-- The per-minute sweep picks up what the fast path missed:
--
--   1. api.worker_tenants_to_release(): the active tenants with committed requests that are in no
--      release yet (the fast path's build was busy, failed, or never ran). The sweep builds a
--      release for each; a build links every such request (Task 20).
--   2. api.worker_deliveries_to_retry(p_max_attempts): the deliveries of each active tenant's
--      latest delivered release that still need a notification (or a live check), below the
--      attempt cap, with the requests linked to that release. Only the latest delivered release
--      of a tenant is returned, so a release superseded by a newer delivered one is never retried
--      (§7.4: a newer release supersedes pending work for older ones).
--
-- Both are SECURITY INVOKER with search_path = '' and schema-qualified names, read only (stable),
-- and use only the SELECT grants service_role already has on cms (Tasks 5–10). EXECUTE is granted
-- to service_role only; PUBLIC has none through Task 4's global default privileges, and it is
-- revoked from anon and authenticated explicitly as well. Neither returns a secret: the sweep
-- reads a site's webhook secrets through api.worker_sites.

-- 1. Tenants with committed requests without a release. A suspended tenant is not built
-- (§8.4: suspension stops publishing); its requests wait until it is active again.
create function api.worker_tenants_to_release()
returns table (tenant_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id
  from cms.tenants t
  where t.status = 'active'
    and exists (select 1 from cms.publish_requests pr
                where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null)
  order by t.id
$$;

-- 2. Deliveries to retry. For each active tenant, its latest delivered release (highest number)
-- and each of its active sites, one row when:
--   - the site's notification is not ok (failed, or pending) — retried by every sweep; or
--   - the notification is ok but the live status is still pending, and the notification is older
--     than 5 minutes (the run that notified died before recording the live check; a run still
--     checking is left alone, as the 5-minute re-claim of a request does); or
--   - the site has no delivery row yet and the release was delivered more than 5 minutes ago (the
--     run that delivered died before notifying);
-- and its notify_attempts (0 without a row) is below p_max_attempts. A live status of ok or
-- not_confirmed is final and not retried. Columns:
--   release_id, tenant_id, tenant_slug, release_number, bundle_path     the release
--   previous_bundle_path   the tenant's delivered release before it (null for the first), whose
--                          bundle the live checks compare with (§7.4)
--   site_id, notify_status, notify_attempts, live_status   the delivery ('pending', 0 and
--                          'pending' without a row)
--   requests               the requests linked to the release, in request order:
--                          [{id, entry_id, action}]
-- 22023 when p_max_attempts is null or below 1.
create function api.worker_deliveries_to_retry(p_max_attempts int)
returns table (release_id uuid, tenant_id uuid, tenant_slug text, release_number int, bundle_path text,
               previous_bundle_path text, site_id uuid, notify_status text, notify_attempts int,
               live_status text, requests jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_max_attempts is null or p_max_attempts < 1 then
    raise exception 'p_max_attempts must be at least 1' using errcode = '22023';
  end if;
  return query
  with latest as (
    select distinct on (r.tenant_id) r.id, r.tenant_id, r.number, r.bundle_path, r.delivered_at
    from cms.releases r
    join cms.tenants t on t.id = r.tenant_id and t.status = 'active'
    where r.status = 'delivered'
    order by r.tenant_id, r.number desc
  )
  select l.id, l.tenant_id, t.slug, l.number, l.bundle_path,
         (select p.bundle_path from cms.releases p
          where p.tenant_id = l.tenant_id and p.status = 'delivered' and p.number < l.number
          order by p.number desc limit 1),
         s.id,
         coalesce(sd.notify_status, 'pending'),
         coalesce(sd.notify_attempts, 0),
         coalesce(sd.live_status, 'pending'),
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action)
                          order by pr.requested_at, pr.id)
                   from cms.publish_requests pr
                   where pr.tenant_id = l.tenant_id and pr.release_id = l.id), '[]'::jsonb)
  from latest l
  join cms.tenants t on t.id = l.tenant_id
  join cms.sites s on s.tenant_id = l.tenant_id and s.active
  left join cms.site_deliveries sd on sd.tenant_id = l.tenant_id and sd.release_id = l.id and sd.site_id = s.id
  where coalesce(sd.notify_attempts, 0) < p_max_attempts
    and ((sd.release_id is null and l.delivered_at < pg_catalog.now() - interval '5 minutes')
         or (sd.release_id is not null and sd.notify_status <> 'ok')
         or (sd.notify_status = 'ok' and sd.live_status = 'pending'
             and sd.notified_at < pg_catalog.now() - interval '5 minutes'))
  order by l.tenant_id, s.id;
end;
$$;

revoke execute on function api.worker_tenants_to_release(), api.worker_deliveries_to_retry(int)
  from public, anon, authenticated;
grant execute on function api.worker_tenants_to_release(), api.worker_deliveries_to_retry(int)
  to service_role;
