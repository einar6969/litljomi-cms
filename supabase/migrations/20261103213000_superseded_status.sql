-- M3-15 (plan M3-15; deferred Minor Task 25 security r1): a superseded release's entries show the
-- newer release's state.
--
-- Until now api.publication_status counted the site deliveries of the request's own release. Once
-- a newer delivered release supersedes that release, the sweep stops retrying it (M3-02, M3-03),
-- so an entry whose request was in it could stay "Í birtingu…" / "Bíður eftir vefnum" (or "live
-- not confirmed") although the newer release, which carries every published entry, is live.
--
-- Now, when the request's release is delivered and the tenant's latest delivered release is newer,
-- each active site that had not confirmed the request's release live counts with its delivery of
-- the latest release instead (in progress, live, retrying or failed, as that release is), in the
-- delivery columns (sites_notified, sites_live_ok, sites_not_confirmed, the exhausted parts of
-- retries_exhausted, live_retrying). A site that confirmed the entry live keeps that: the newer
-- release still carries the entry, and a newer publish elsewhere must not turn a live entry back
-- to "in progress".
-- `omitted` already looked at the latest release (M3-05) and is unchanged; so are release_number
-- and release_status (the request's own release). A request release that is building or failed
-- keeps its own deliveries (none), as before.
--
-- Every column keeps its name, type and position, so `create or replace` keeps the grants (SELECT
-- for authenticated only). Still security_invoker; the latest release is read as the caller, on
-- the request's tenant, as before.

create or replace view api.publication_status with (security_invoker = true) as
select r.id as request_id, r.tenant_id, r.entry_id, r.action, r.status, r.error, r.requested_at,
       rel.number as release_number, rel.status as release_status,
       coalesce(failed.in_request_release
                or (rel.status = 'delivered' and latest_delivered.number > rel.number and failed.in_latest_release),
                false) as omitted,
       case
         when r.status = 'failed_validation' and r.error ->> 'code' = 'asset_missing'
              and pg_catalog.jsonb_typeof(r.error -> 'assetIds') = 'array' then
           (select pg_catalog.array_agg(a.filename order by ids.ord)
            from pg_catalog.jsonb_array_elements_text(r.error -> 'assetIds') with ordinality as ids (id, ord)
            join cms.assets a on a.tenant_id = r.tenant_id and a.id::text = ids.id)
       end as missing_assets,
       d.site_count, d.sites_notified, d.sites_live_ok, d.sites_not_confirmed,
       (d.notify_exhausted
        or d.live_exhausted
        or (r.status = 'committed' and r.release_id is null
            and exists (select 1
                        from (select l.status, l.created_at, l.next_attempt_at from cms.releases l
                              where l.tenant_id = r.tenant_id order by l.number desc limit 1) as latest
                        where latest.status = 'failed' and latest.next_attempt_at is null
                          and latest.created_at >= r.requested_at))) as retries_exhausted,
       coalesce(d.live_pending_retry and rel.status = 'delivered', false) as live_retrying
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
  select lr.id, lr.number, lr.error
  from cms.releases lr
  where lr.tenant_id = r.tenant_id and lr.status = 'delivered'
  order by lr.number desc
  limit 1
) as latest_delivered on true
cross join lateral (
  -- Whether a release's error records the entry under `omitted` or `fallback` (each an array of
  -- objects carrying entryId). Inline: the view runs as the caller, who has no access to private.
  select bool_or(rr.which = 'request' and k.list @> pg_catalog.jsonb_build_array(
                   pg_catalog.jsonb_build_object('entryId', r.entry_id::text))) as in_request_release,
         bool_or(rr.which = 'latest' and k.list @> pg_catalog.jsonb_build_array(
                   pg_catalog.jsonb_build_object('entryId', r.entry_id::text))) as in_latest_release
  from (values ('request', rel.error), ('latest', latest_delivered.error)) as rr (which, error)
  cross join lateral (
    select rr.error -> key as list
    from (values ('omitted'), ('fallback')) as keys (key)
    where pg_catalog.jsonb_typeof(rr.error -> key) = 'array'
  ) as k
) as failed
cross join lateral (
  -- The release that superseded the request's release, if any: the tenant's latest delivered
  -- release when it is newer than a delivered request release (every release carries every
  -- published entry, and the sweep no longer retries the older one; M3-15).
  select case when rel.status = 'delivered' and latest_delivered.number > rel.number then latest_delivered.id end as release_id
) as superseding
cross join lateral (
  -- Every active site of the tenant, with the delivery the entry shows for it, if there is one:
  -- the request's release's, unless a newer release superseded it and the site had not confirmed
  -- the request's release live; then the newer release's (none before the worker has recorded
  -- the site). A site that confirmed the entry live keeps it, so a newer release in progress
  -- elsewhere does not turn a live entry back to "in progress".
  select pg_catalog.count(*)::int as site_count,
         pg_catalog.count(*) filter (where sd.notify_status = 'ok')::int as sites_notified,
         pg_catalog.count(*) filter (where sd.live_status = 'ok')::int as sites_live_ok,
         pg_catalog.count(*) filter (where sd.live_status = 'not_confirmed')::int as sites_not_confirmed,
         coalesce(pg_catalog.bool_or(sd.notify_status = 'failed' and sd.next_attempt_at is null), false) as notify_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.first_failed_at is not null
                                     and sd.next_attempt_at is null), false) as live_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.next_attempt_at is not null), false) as live_pending_retry
  from cms.sites s
  left join cms.site_deliveries own
    on own.tenant_id = s.tenant_id and own.site_id = s.id and own.release_id = r.release_id
  left join cms.site_deliveries newer
    on newer.tenant_id = s.tenant_id and newer.site_id = s.id and newer.release_id = superseding.release_id
  cross join lateral (
    select (superseding.release_id is null or own.live_status is not distinct from 'ok') as keep_own
  ) as pick
  cross join lateral (
    select case when pick.keep_own then own.notify_status else newer.notify_status end as notify_status,
           case when pick.keep_own then own.live_status else newer.live_status end as live_status,
           case when pick.keep_own then own.first_failed_at else newer.first_failed_at end as first_failed_at,
           case when pick.keep_own then own.next_attempt_at else newer.next_attempt_at end as next_attempt_at
  ) as sd
  where s.tenant_id = r.tenant_id and s.active
) as d;
