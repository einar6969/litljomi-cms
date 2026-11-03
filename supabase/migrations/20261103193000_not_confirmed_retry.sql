-- Retries after `not_confirmed` (spec §7.4; plan M3-03; C4 sitting-5 issue 3, go-live item 19,
-- decision 50.4).
--
-- Until now a live status of not_confirmed was final: a site that kept serving a stale pointer
-- stayed stale until the tenant's next publish. From M3-03 a not_confirmed delivery is retried on
-- M3-02's schedule (20261103002000_retry_backoff.sql): the sweep notifies the site again and runs
-- the full live check, until it passes (ok), a newer delivered release supersedes the delivery
-- (§7.4: only the tenant's latest delivered release is retried), or the 24 hours since the
-- delivery's first failure run out. Then the retries are exhausted: the worker alerts the platform
-- admin and the editor sees "delivery failed". Meanwhile the editor sees "live not confirmed,
-- retrying".
--
-- No column is added: the delivery's existing schedule columns hold the state.
--   first_failed_at   the delivery's first failure, a failed notification or a missed live check
--                     (was: its first failed notification); the 24 hours count from it.
--   next_attempt_at   on a not_confirmed delivery, when the sweep notifies and live-checks again;
--                     null once the retries are exhausted.
-- The exponent of the schedule is the delivery's notify_attempts (each retry notifies once), so a
-- delivery that missed its first live check is retried 1 minute later, then 2, 4 … minutes after
-- each further miss, as a failed notification is.
--
--   1. api.worker_record_delivery (same signature and result; create or replace keeps its grants):
--      - a live status of not_confirmed keeps the first failure and schedules the next attempt;
--      - a live status of ok clears next_attempt_at;
--      - a notify status of ok leaves next_attempt_at as it is while the live status is
--        not_confirmed (the retry's own live check reschedules or clears it, and a worker that dies
--        between the two leaves the attempt due, so the next sweep retries it);
--      - retries_exhausted is also true for a not_confirmed delivery with no next attempt.
--   2. api.worker_deliveries_to_retry (same signature and result) also returns a not_confirmed
--      delivery of the tenant's latest delivered release whose next attempt is due at p_now.
--   3. Deliveries that were not_confirmed before this migration: those of each active tenant's
--      latest delivered release whose notification is less than 24 hours old become due now, with
--      that notification as their first failure. Older or superseded ones keep a null schedule and
--      first failure, so they stay "live not confirmed" (final) and raise no alert.
--   4. api.publication_status gains live_retrying (appended, so create or replace keeps its grants):
--      an active site's delivery of the request's release is not_confirmed with a next attempt, and
--      that release is the tenant's latest delivered one. retries_exhausted also covers a
--      not_confirmed delivery whose retries ran out (first failure recorded, no next attempt).
--
-- Both functions stay SECURITY INVOKER with search_path = '' and schema-qualified names, EXECUTE
-- for service_role only (create or replace keeps the M3-02 grants; restated below).

-- ---------------------------------------------------------------------------
-- 1. The delivery record.

create or replace function api.worker_record_delivery(p_release_id uuid, p_site_id uuid, p_notify_status text,
                                                      p_live_status text, p_error jsonb, p_now timestamptz)
returns table (notify_attempts int, next_attempt_at timestamptz, retries_exhausted boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_tenant_id uuid;
  v_attempt int := case when p_notify_status is not null and p_notify_status <> 'pending' then 1 else 0 end;
  v_failed boolean := p_notify_status is not distinct from 'failed';
  v_missed boolean := p_live_status is not distinct from 'not_confirmed';
  v_row cms.site_deliveries;
begin
  if p_now is null then
    raise exception 'p_now is required' using errcode = '22023';
  end if;
  select r.tenant_id into v_tenant_id from cms.releases r where r.id = p_release_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cms.sites s where s.tenant_id = v_tenant_id and s.id = p_site_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  insert into cms.site_deliveries as sd (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at,
                                         live_status, live_confirmed_at, last_error, first_failed_at, next_attempt_at)
  values (p_release_id, p_site_id, v_tenant_id, coalesce(p_notify_status, 'pending'), v_attempt,
          case when p_notify_status = 'ok' then p_now end,
          coalesce(p_live_status, 'pending'),
          case when p_live_status = 'ok' then p_now end,
          p_error,
          case when v_failed or v_missed then p_now end,
          case when v_failed or v_missed then api.worker_next_attempt_at(p_now, greatest(v_attempt, 1), p_now) end)
  on conflict (release_id, site_id) do update
  set notify_status = coalesce(p_notify_status, sd.notify_status),
      notify_attempts = sd.notify_attempts + v_attempt,
      notified_at = case when p_notify_status = 'ok' then p_now else sd.notified_at end,
      live_status = coalesce(p_live_status, sd.live_status),
      live_confirmed_at = case when p_live_status = 'ok' then p_now else sd.live_confirmed_at end,
      last_error = p_error,
      first_failed_at = case when v_failed or v_missed then coalesce(sd.first_failed_at, p_now) else sd.first_failed_at end,
      next_attempt_at = case
                          when v_failed or v_missed then
                            api.worker_next_attempt_at(coalesce(sd.first_failed_at, p_now),
                                                       greatest(sd.notify_attempts + v_attempt, 1), p_now)
                          when p_live_status is not null then null
                          when p_notify_status = 'ok' and sd.live_status = 'not_confirmed' then sd.next_attempt_at
                          when p_notify_status is not null then null
                          else sd.next_attempt_at
                        end
  returning sd.* into v_row;
  return query
  select v_row.notify_attempts, v_row.next_attempt_at,
         (v_row.notify_status = 'failed' or v_row.live_status = 'not_confirmed') and v_row.next_attempt_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The sweep's delivery selection.
--
-- As in 20261103002000_retry_backoff.sql, with one more case: the site's live check missed
-- (not_confirmed) and its next attempt is due (next_attempt_at <= p_now; none once exhausted).
-- A live status of ok is final; so is not_confirmed once its retries are exhausted.

create or replace function api.worker_deliveries_to_retry(p_now timestamptz)
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
  if p_now is null then
    raise exception 'p_now is required' using errcode = '22023';
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
  where (sd.release_id is null and l.delivered_at < p_now - interval '5 minutes')
     or (sd.notify_status = 'failed' and sd.next_attempt_at <= p_now)
     or (sd.release_id is not null and sd.notify_status not in ('ok', 'failed'))
     or (sd.notify_status = 'ok' and sd.live_status = 'pending'
         and sd.notified_at < p_now - interval '5 minutes'
         and (sd.first_failed_at is null or p_now < sd.first_failed_at + interval '24 hours'))
     or (sd.notify_status = 'ok' and sd.live_status = 'not_confirmed' and sd.next_attempt_at <= p_now)
  order by l.tenant_id, s.id;
end;
$$;

revoke execute on function
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_deliveries_to_retry(timestamptz)
  from public, anon, authenticated;
grant execute on function
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_deliveries_to_retry(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Deliveries that were not_confirmed before this migration (final until now).

update cms.site_deliveries sd
set first_failed_at = coalesce(sd.first_failed_at, sd.notified_at),
    next_attempt_at = pg_catalog.now()
where sd.live_status = 'not_confirmed'
  and sd.notify_status = 'ok'
  and coalesce(sd.first_failed_at, sd.notified_at) > pg_catalog.now() - interval '24 hours'
  and sd.release_id = (select r.id from cms.releases r
                       join cms.tenants t on t.id = r.tenant_id and t.status = 'active'
                       where r.tenant_id = sd.tenant_id and r.status = 'delivered'
                       order by r.number desc limit 1);

-- ---------------------------------------------------------------------------
-- 4. api.publication_status: live_retrying, and retries_exhausted for a missed live check.
--
-- Built on 20261103050000_entry_delivery_failed.sql; every existing column keeps its name, type,
-- position and expression except retries_exhausted, which also covers a not_confirmed delivery
-- whose retries ran out. live_retrying is appended, so `create or replace` keeps the view's grants
-- (SELECT for authenticated only). Still security_invoker.

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
       coalesce(d.live_pending_retry
                and rel.status = 'delivered'
                and latest_delivered.number = rel.number, false) as live_retrying
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
  -- Every active site of the tenant, with its delivery of the request's release if there is one
  -- (none before the release exists, or before the worker has recorded the site).
  select pg_catalog.count(*)::int as site_count,
         pg_catalog.count(*) filter (where sd.notify_status = 'ok')::int as sites_notified,
         pg_catalog.count(*) filter (where sd.live_status = 'ok')::int as sites_live_ok,
         pg_catalog.count(*) filter (where sd.live_status = 'not_confirmed')::int as sites_not_confirmed,
         coalesce(pg_catalog.bool_or(sd.notify_status = 'failed' and sd.next_attempt_at is null), false) as notify_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.first_failed_at is not null
                                     and sd.next_attempt_at is null), false) as live_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.next_attempt_at is not null), false) as live_pending_retry
  from cms.sites s
  left join cms.site_deliveries sd
    on sd.tenant_id = s.tenant_id and sd.site_id = s.id and sd.release_id = r.release_id
  where s.tenant_id = r.tenant_id and s.active
) as d;
