-- api.publication_status: "delivery failed for this entry" after a fallback or a later omission
-- (spec §7.1, §7.4; plan M3-05).
--
-- From M3-05 the release build records a failed entry in releases.error under one of two keys:
-- `omitted` (left out of the release) or `fallback` (its projection from the previous release was
-- reused, §7.1 conditions 1 and 2). Either way the editor sees the entry as "delivery failed",
-- never as live. Such failures are usually later regressions (a faulty code or transform deploy):
-- the entry's latest request was linked to an older release, and a newer release built from
-- unchanged content is the one that failed it. So the `omitted` column is now true when the
-- request's release recorded the entry under either key (as before, for `omitted`), or when the
-- tenant's latest delivered release, if newer than the request's, did. A later release that
-- builds the entry again clears it.
--
-- Only the expression of `omitted` changes: same columns, names and types, so `create or replace`
-- keeps the view's grants (SELECT for authenticated only). Still security_invoker: the latest
-- delivered release is read under the caller's RLS, from the request's own tenant. No function is
-- added (the caller has no usage on the private schema).

create or replace view api.publication_status with (security_invoker = true) as
select r.id as request_id, r.tenant_id, r.entry_id, r.action, r.status, r.error, r.requested_at,
       rel.number as release_number, rel.status as release_status,
       coalesce(failed.in_request_release
                or (rel.status = 'delivered' and latest.number > rel.number and failed.in_latest_release),
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
left join lateral (
  -- The tenant's latest delivered release.
  select lr.number, lr.error
  from cms.releases lr
  where lr.tenant_id = r.tenant_id and lr.status = 'delivered'
  order by lr.number desc
  limit 1
) as latest on true
cross join lateral (
  -- Whether a release's error records the entry under `omitted` or `fallback` (each an array of
  -- objects carrying entryId). Inline: the view runs as the caller, who has no access to private.
  select bool_or(rr.which = 'request' and k.list @> pg_catalog.jsonb_build_array(
                   pg_catalog.jsonb_build_object('entryId', r.entry_id::text))) as in_request_release,
         bool_or(rr.which = 'latest' and k.list @> pg_catalog.jsonb_build_array(
                   pg_catalog.jsonb_build_object('entryId', r.entry_id::text))) as in_latest_release
  from (values ('request', rel.error), ('latest', latest.error)) as rr (which, error)
  cross join lateral (
    select rr.error -> key as list
    from (values ('omitted'), ('fallback')) as keys (key)
    where pg_catalog.jsonb_typeof(rr.error -> key) = 'array'
  ) as k
) as failed
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
