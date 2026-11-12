-- A7: live confirmation for content with no page of its own (spec §3.2, §7.4, §7.5;
-- docs/clients/dld/ENHANCEMENTS.md A7).
--
-- A module's site integration may now leave out `path` (a staff list, a home page's settings, shown
-- only on shared pages). Such an entry needs no slug, and an `absent` check of it is never held to
-- 404: a shared page passes once it answers 200 without the entry's marker. All of that is the
-- worker's (TypeScript). What the database learns is which entries had nothing to check.
--
-- An entry whose type has no site integration, or whose checks are empty, can be delivered but is
-- never proven live (§7.4: success is never shown before its proof exists). The worker decides it
-- per release, from the same targets the delivery checks, and records it with the release's other
-- entry-level notes: releases.error.nothingChecked, an array of {entryId}, beside `omitted` and
-- `fallback` (written by api.worker_finish_release as before; no function changes).
--
--   api.publication_status: as in 20261105130000_withdrawal_safety.sql, with one column appended,
--   nothing_checked: true when the request's own release is delivered and records the entry under
--   nothingChecked. Only the request's own release counts: a newer release checked other requests.
--   The editor then shows "published, not confirmed" (or "withdrawn, not confirmed") where every
--   active site accepted the release, never "Birt á vef ✓" or "Tekið af vef".
--
-- Additive and forward-only: no table, column, function or grant changes; nothing is dropped.
-- `create or replace view` keeps the existing columns, their order and the view's grants, and runs
-- as the caller (security_invoker); the tenant comes from the request row.

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
       coalesce(d.live_pending_retry and rel.status = 'delivered', false) as live_retrying,
       newest.id as latest_request_id, newest.action as latest_action,
       -- A7: the request's own delivered release recorded that no page is checked for the entry.
       coalesce(rel.status = 'delivered'
                and pg_catalog.jsonb_typeof(rel.error -> 'nothingChecked') = 'array'
                and rel.error -> 'nothingChecked' @> pg_catalog.jsonb_build_array(
                      pg_catalog.jsonb_build_object('entryId', r.entry_id::text)),
                false) as nothing_checked
from (
  select distinct on (pr.tenant_id, pr.entry_id) pr.*
  from cms.publish_requests pr
  where exists (
    select 1 from cms.memberships m
    where m.tenant_id = pr.tenant_id and m.user_id = (select auth.uid())
  )
    -- A repeat changed nothing: the state to show is the request before it.
    and not (pr.action = 'unpublish' and pr.status = 'superseded')
    -- Nor did a publish a newer request cancelled, when the unpublish before it still applies.
    and not (pr.action = 'publish' and pr.status = 'superseded' and pr.error ? 'newer_request_id'
             and coalesce((select c.action = 'unpublish' from cms.publish_requests c
                           where c.tenant_id = pr.tenant_id and c.entry_id = pr.entry_id
                             and c.status = 'committed' and c.requested_at < pr.requested_at
                           order by c.requested_at desc, c.id desc
                           limit 1), false))
  order by pr.tenant_id, pr.entry_id, pr.requested_at desc, pr.id desc
) as r
cross join lateral (
  -- The entry's newest request, shown or not: a panel waits for it, and it says why a publish ended.
  select n.id, n.action
  from cms.publish_requests n
  where n.tenant_id = r.tenant_id and n.entry_id = r.entry_id
  order by n.requested_at desc, n.id desc
  limit 1
) as newest
left join cms.releases rel on rel.tenant_id = r.tenant_id and rel.id = r.release_id
left join lateral (
  -- The tenant's latest delivered release (for `omitted` only).
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
  -- Whether a newer delivered release superseded the request's delivered release, whether the
  -- request's release is still within its worker's run (SUPERSEDED_GRACE, 420 s since its
  -- delivery), and whether the hour after its delivery ended (W1).
  select coalesce(rel.status = 'delivered' and latest_delivered.number > rel.number, false) as superseded,
         coalesce(rel.delivered_at > pg_catalog.now() - interval '420 seconds', false) as in_run,
         not coalesce(rel.delivered_at > pg_catalog.now() - interval '1 hour', false) as hour_over
) as sup
cross join lateral (
  -- Every active site of the tenant, with the request's own release's delivery for it (none
  -- before the worker has recorded the site). Never the newer release's: it did not check this
  -- entry. When superseded, a site that did not confirm the entry live counts as not_confirmed
  -- with no retry pending and not exhausted (the editor sees "Ekki staðfest á vef"), unless its own
  -- check may still be running (in_run, pending or not recorded yet, notify not failed), or (W1)
  -- the entry is an unpublish the site's delivery still checks (`withdrawals`, kept within the
  -- hour) or confirmed (`withdrawn`, live).
  select pg_catalog.count(*)::int as site_count,
         pg_catalog.count(*) filter (where sd.notify_status = 'ok')::int as sites_notified,
         pg_catalog.count(*) filter (where sd.live_status = 'ok')::int as sites_live_ok,
         pg_catalog.count(*) filter (where sd.live_status = 'not_confirmed')::int as sites_not_confirmed,
         coalesce(pg_catalog.bool_or(sd.kept and sd.notify_status = 'failed' and own.next_attempt_at is null), false) as notify_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.first_failed_at is not null
                                     and sd.next_attempt_at is null), false) as live_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.next_attempt_at is not null), false) as live_pending_retry
  from cms.sites s
  left join cms.site_deliveries own
    on own.tenant_id = s.tenant_id and own.site_id = s.id and own.release_id = r.release_id
  cross join lateral (
    -- The unpublish's own withdrawal state on this site (W1).
    select coalesce(r.action = 'unpublish' and pg_catalog.jsonb_typeof(own.last_error -> 'withdrawn') = 'array'
                    and own.last_error -> 'withdrawn' ? r.entry_id::text, false) as confirmed,
           coalesce(r.action = 'unpublish' and pg_catalog.jsonb_typeof(own.last_error -> 'withdrawals') = 'array'
                    and own.last_error -> 'withdrawals' @> pg_catalog.jsonb_build_array(
                          pg_catalog.jsonb_build_object('entryId', r.entry_id::text)), false) as checking
  ) as w
  cross join lateral (
    select (not sup.superseded
            or own.live_status is not distinct from 'ok'
            or (sup.in_run and coalesce(own.live_status, 'pending') = 'pending'
                and own.notify_status is distinct from 'failed')) as keep_own
  ) as pick
  cross join lateral (
    -- Still checked past the hour: a failure, its retries unseen; exhausted once they ran out.
    select (w.confirmed or w.checking or pick.keep_own) as kept,
           case when w.confirmed then 'ok' else own.notify_status end as notify_status,
           case
             when w.confirmed then 'ok'
             when w.checking and sup.hour_over then 'not_confirmed'
             when w.checking or pick.keep_own then own.live_status
             else 'not_confirmed'
           end as live_status,
           case
             when w.confirmed then null
             when w.checking and sup.hour_over then case when own.next_attempt_at is null then own.first_failed_at end
             when w.checking or pick.keep_own then own.first_failed_at
           end as first_failed_at,
           case
             when w.confirmed or (w.checking and sup.hour_over) then null
             when w.checking or pick.keep_own then own.next_attempt_at
           end as next_attempt_at
  ) as sd
  where s.tenant_id = r.tenant_id and s.active
) as d;
