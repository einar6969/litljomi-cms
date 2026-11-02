-- api.publication_status, one row per entry (spec §4.5, §6.3, §7.1, §7.4; plan Task 25,
-- decisions 35, 36.1, 36.4 and 37.8).
--
-- Replaces Task 10's view, which returned one row per site delivery. The editor's status display
-- needs, for the entry's latest request: whether its release left the entry out (§7.1, "delivery
-- failed"), how many notification attempts a site that is not yet notified has used (§7.4: when
-- they run out, "delivery failed"), and per-site counts over the tenant's ACTIVE sites, so that
-- "live" is shown only when every active site's live_status is 'ok' (decision 35). A request that
-- failed with asset_missing (decision 36.4) names the missing images by filename.
--
-- Still security_invoker, so RLS and the column grants of §4.5 apply to the caller: the request,
-- release, site, delivery and asset rows are each filtered by the caller's memberships, and only
-- columns authenticated may read are used (sites: id, tenant_id, active). The latest-request
-- subquery keeps Task 10's explicit membership filter, identical to the other editor views, so a
-- platform admin's console policies never widen it. Grants are exactly Task 10's: SELECT for
-- authenticated, nothing for PUBLIC, anon or service_role. No function is added.
--
-- Columns (one row per entry that has a request):
--   request_id … release_status  as before (Task 10)
--   omitted              the request's release recorded this entry in releases.error.omitted
--   missing_assets       asset_missing only: the filenames of the missing images, in the order the
--                        worker recorded them (assets of the entry's tenant only); null otherwise
--   site_count           the tenant's active sites
--   sites_notified       of those, notify_status = 'ok' for the request's release
--   sites_live_ok        of those, live_status = 'ok'
--   sites_not_confirmed  of those, live_status = 'not_confirmed'
--   notify_attempts      the most notification attempts used by an active site whose notification
--                        is not 'ok' (0 when there is none); compared with MAX_NOTIFY_ATTEMPTS
--                        (apps/cms/src/lib/delivery.ts) by the editor
--
-- The column set changes, so the view is dropped and created (create or replace cannot drop
-- columns); nothing in the database depends on it.

drop view api.publication_status;

create view api.publication_status with (security_invoker = true) as
select r.id as request_id, r.tenant_id, r.entry_id, r.action, r.status, r.error, r.requested_at,
       rel.number as release_number, rel.status as release_status,
       coalesce(pg_catalog.jsonb_typeof(rel.error -> 'omitted') = 'array'
                and rel.error -> 'omitted' @> pg_catalog.jsonb_build_array(
                      pg_catalog.jsonb_build_object('entryId', r.entry_id::text)),
                false) as omitted,
       case
         when r.status = 'failed_validation' and r.error ->> 'code' = 'asset_missing'
              and pg_catalog.jsonb_typeof(r.error -> 'assetIds') = 'array' then
           (select pg_catalog.array_agg(a.filename order by ids.ord)
            from pg_catalog.jsonb_array_elements_text(r.error -> 'assetIds') with ordinality as ids (id, ord)
            join cms.assets a on a.tenant_id = r.tenant_id and a.id::text = ids.id)
       end as missing_assets,
       d.site_count, d.sites_notified, d.sites_live_ok, d.sites_not_confirmed, d.notify_attempts
from (
  select distinct on (pr.tenant_id, pr.entry_id) pr.*
  from cms.publish_requests pr
  where exists (
    select 1 from cms.memberships m
    where m.tenant_id = pr.tenant_id and m.user_id = (select auth.uid())
  )
  order by pr.tenant_id, pr.entry_id, pr.requested_at desc, pr.id desc
) as r
left join cms.releases rel on rel.tenant_id = r.tenant_id and rel.id = r.release_id
cross join lateral (
  -- Every active site of the tenant, with its delivery of the request's release if there is one
  -- (none before the release exists, or before the worker has recorded the site).
  select pg_catalog.count(*)::int as site_count,
         pg_catalog.count(*) filter (where sd.notify_status = 'ok')::int as sites_notified,
         pg_catalog.count(*) filter (where sd.live_status = 'ok')::int as sites_live_ok,
         pg_catalog.count(*) filter (where sd.live_status = 'not_confirmed')::int as sites_not_confirmed,
         coalesce(pg_catalog.max(sd.notify_attempts) filter (where sd.notify_status <> 'ok'), 0)::int as notify_attempts
  from cms.sites s
  left join cms.site_deliveries sd
    on sd.tenant_id = s.tenant_id and sd.site_id = s.id and sd.release_id = r.release_id
  where s.tenant_id = r.tenant_id and s.active
) as d;

revoke all on api.publication_status from public, anon, service_role;
grant select on api.publication_status to authenticated;
