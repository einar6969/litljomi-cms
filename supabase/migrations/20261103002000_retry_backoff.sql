-- Exponential retries for 24 hours (spec §6.3, §7.4, §8.4; plan M3-02).
--
-- Replaces M1's fixed schedule (one retry per sweep, up to 10 attempts; decision 36) with
-- exponential backoff capped at 24 hours from the first failure, for release builds and site
-- notifications. When the window has run out the work is no longer retried, the worker alerts the
-- platform admin (retries exhausted), and the editor sees "delivery failed". A newer delivered
-- release still supersedes pending work for older ones (§7.4).
--
-- The schedule (api.worker_next_attempt_at): after the n-th failed attempt the next one is due
-- 2^(n-1) minutes later (1, 2, 4, 8 … minutes), but never later than 24 hours after the first
-- failure; a failure at or after that point exhausts the retries (null). The sweep runs every
-- minute, so an attempt runs at the first sweep at or after its next_attempt_at.
--
--   1. cms.site_deliveries gets first_failed_at (the first failed notification of the delivery)
--      and next_attempt_at (when the sweep may notify again; null when the notification did not
--      fail, and null on a failed notification once the retries are exhausted).
--      api.worker_record_delivery is replaced: it takes the worker's clock (p_now), keeps both
--      columns, and returns the delivery's attempt count, next_attempt_at and whether the retries
--      are exhausted, so the worker alerts exactly when they run out.
--   2. cms.releases gets next_attempt_at, set by a BEFORE UPDATE trigger whenever a release
--      becomes failed (worker_finish_release and worker_fail_stale_releases alike). Its failures
--      are the tenant's failed releases after its latest delivered release (a delivered release
--      ends the run of failures), counted from the first one's created_at. Null on a failed release
--      means the build retries are exhausted. api.worker_release_retry(p_release_id) reads it for
--      the worker's alert.
--   3. api.worker_deliveries_to_retry(p_now) and api.worker_tenants_to_release(p_now) replace the
--      M1 versions and select by next_attempt_at. A tenant whose latest release failed is built
--      again once that release's next attempt is due, or at once when a request was made after
--      that build began (new work gets its own attempt; the fast path normally makes it).
--   4. api.publication_status: notify_attempts (compared with the removed MAX_NOTIFY_ATTEMPTS) is
--      replaced by retries_exhausted, for the editor's "delivery failed".
--
-- The clock parameters (p_now) are the worker's clock, so that tests simulate time through them
-- instead of waiting (plan M3-02); the functions are executable by service_role only, which is
-- trusted with every worker write already. The trigger uses the database clock.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE is
-- granted to service_role only; PUBLIC has none through Task 4's global default privileges, and it
-- is revoked from anon and authenticated explicitly as well. The trigger function lives in private
-- and is granted to no API role (triggers fire without an EXECUTE check).

-- ---------------------------------------------------------------------------
-- The schedule.

-- The next attempt after p_attempts attempts, the last of which failed at p_now, for work whose
-- first failure was at p_first_failed_at: p_now + 2^(p_attempts - 1) minutes, capped at
-- p_first_failed_at + 24 hours; null when p_now is at or past that cap (retries exhausted).
-- 22023 for a null argument or p_attempts below 1.
create function api.worker_next_attempt_at(p_first_failed_at timestamptz, p_attempts int, p_now timestamptz)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_until timestamptz;
begin
  if p_first_failed_at is null or p_attempts is null or p_attempts < 1 or p_now is null then
    raise exception 'p_first_failed_at, p_attempts (at least 1) and p_now are required' using errcode = '22023';
  end if;
  v_until := p_first_failed_at + interval '24 hours';
  if p_now >= v_until then
    return null;
  end if;
  -- 2^11 minutes is over 24 hours, so a larger exponent changes nothing (and cannot overflow).
  return least(p_now + pg_catalog.make_interval(mins => (2 ^ (least(p_attempts, 12) - 1))::int), v_until);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Site deliveries.

alter table cms.site_deliveries
  add column first_failed_at timestamptz,
  add column next_attempt_at timestamptz;

grant update (first_failed_at, next_attempt_at) on cms.site_deliveries to service_role;

-- Rows from before this migration: a failed notification below M1's cap is due now; one at the
-- cap (10 attempts) was already given up and alerted, so its retries stay exhausted.
update cms.site_deliveries
set first_failed_at = pg_catalog.now(),
    next_attempt_at = case when notify_attempts >= 10 then null else pg_catalog.now() end
where notify_status = 'failed';

drop function api.worker_record_delivery(uuid, uuid, text, text, jsonb);

-- Records a release's delivery to one site (§7.4), creating the row on first use. The site must
-- be one of the release's tenant's (forbidden otherwise; not_found for no such release). A null
-- status leaves that status unchanged. Each call with a notify status other than pending counts
-- one notify attempt; notified_at and live_confirmed_at are set (to p_now) when the status becomes
-- ok. last_error is replaced by p_error. A failed notification keeps the delivery's first failure
-- (first_failed_at) and schedules the next attempt (api.worker_next_attempt_at); any other notify
-- status clears next_attempt_at; a null notify status leaves it. Returns the delivery's
-- notify_attempts, next_attempt_at and retries_exhausted (a failed notification with no next
-- attempt). 22023 when p_now is null.
create function api.worker_record_delivery(p_release_id uuid, p_site_id uuid, p_notify_status text,
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
          case when v_failed then p_now end,
          case when v_failed then api.worker_next_attempt_at(p_now, v_attempt, p_now) end)
  on conflict (release_id, site_id) do update
  set notify_status = coalesce(p_notify_status, sd.notify_status),
      notify_attempts = sd.notify_attempts + v_attempt,
      notified_at = case when p_notify_status = 'ok' then p_now else sd.notified_at end,
      live_status = coalesce(p_live_status, sd.live_status),
      live_confirmed_at = case when p_live_status = 'ok' then p_now else sd.live_confirmed_at end,
      last_error = p_error,
      first_failed_at = case when v_failed then coalesce(sd.first_failed_at, p_now) else sd.first_failed_at end,
      next_attempt_at = case
                          when v_failed then api.worker_next_attempt_at(coalesce(sd.first_failed_at, p_now),
                                                                         sd.notify_attempts + v_attempt, p_now)
                          when p_notify_status is not null then null
                          else sd.next_attempt_at
                        end
  returning sd.* into v_row;
  return query
  select v_row.notify_attempts, v_row.next_attempt_at,
         v_row.notify_status = 'failed' and v_row.next_attempt_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Release builds.

alter table cms.releases add column next_attempt_at timestamptz;

-- Releases that failed before this migration: the latest one of each tenant is due now, so the
-- tenant's waiting requests are built by the next sweep (M1 retried them on every sweep).
update cms.releases r
set next_attempt_at = pg_catalog.now()
where r.status = 'failed'
  and r.number = (select pg_catalog.max(x.number) from cms.releases x where x.tenant_id = r.tenant_id);

-- Schedules the tenant's next build when a release becomes failed. The failures are this release
-- and the tenant's other failed releases numbered above its latest delivered one; the first of
-- them (by created_at) starts the 24 hours.
create function private.releases_schedule_retry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_failures int;
  v_first timestamptz;
begin
  select pg_catalog.count(*)::int + 1, least(pg_catalog.min(f.created_at), new.created_at)
  into v_failures, v_first
  from cms.releases f
  where f.tenant_id = new.tenant_id and f.status = 'failed' and f.id <> new.id
    and f.number > coalesce((select pg_catalog.max(d.number) from cms.releases d
                             where d.tenant_id = new.tenant_id and d.status = 'delivered'), 0);
  new.next_attempt_at := api.worker_next_attempt_at(v_first, v_failures, pg_catalog.now());
  return new;
end;
$$;

-- Keep this WHEN clause identical to the function's purpose: only a change to failed.
create trigger releases_schedule_retry
  before update of status on cms.releases
  for each row
  when (new.status = 'failed' and old.status is distinct from 'failed')
  execute function private.releases_schedule_retry();

-- A release's build-retry state, for the worker's alert after a failed build: its status, the
-- tenant's next build attempt (failed releases only) and whether the build retries are exhausted
-- (failed with no next attempt). not_found for no such release.
create function api.worker_release_retry(p_release_id uuid)
returns table (status text, next_attempt_at timestamptz, retries_exhausted boolean)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  select r.status, r.next_attempt_at, r.status = 'failed' and r.next_attempt_at is null
  from cms.releases r
  where r.id = p_release_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The sweep's selections.

drop function api.worker_tenants_to_release();
drop function api.worker_deliveries_to_retry(int);

-- Active tenants with committed requests that are in no release yet, unless the tenant's latest
-- release failed and its next attempt is not due at p_now (or its retries are exhausted) and no
-- such request was made after that build began. A suspended tenant is not built (§8.4).
-- 22023 when p_now is null.
create function api.worker_tenants_to_release(p_now timestamptz)
returns table (tenant_id uuid)
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
  select t.id
  from cms.tenants t
  where t.status = 'active'
    and exists (select 1 from cms.publish_requests pr
                where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null)
    and not exists (
      select 1
      from (select l.status, l.created_at, l.next_attempt_at from cms.releases l
            where l.tenant_id = t.id order by l.number desc limit 1) as latest
      where latest.status = 'failed'
        and (latest.next_attempt_at is null or latest.next_attempt_at > p_now)
        and not exists (select 1 from cms.publish_requests pr
                        where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null
                          and pr.requested_at > latest.created_at))
  order by t.id;
end;
$$;

-- Deliveries to retry at p_now. For each active tenant, its latest delivered release (highest
-- number; a release superseded by a newer delivered one is never retried, §7.4) and each of its
-- active sites, one row when:
--   - the site's notification failed and its next attempt is due (next_attempt_at <= p_now; a
--     delivery whose retries are exhausted has none);
--   - the site's notification is still pending on a row (no attempt recorded);
--   - the notification is ok but the live status is still pending, the notification is older than
--     5 minutes (the run that notified died before recording the live check) and the delivery's
--     24 hours since its first failure, if it had one, have not run out; or
--   - the site has no delivery row yet and the release was delivered more than 5 minutes before
--     p_now (the run that delivered died before notifying).
-- A live status of ok or not_confirmed is final and not retried. Columns as in M1 (Task 21):
--   release_id, tenant_id, tenant_slug, release_number, bundle_path     the release
--   previous_bundle_path   the tenant's delivered release before it (null for the first)
--   site_id, notify_status, notify_attempts, live_status   the delivery ('pending', 0 and
--                          'pending' without a row)
--   requests               the requests linked to the release, in request order:
--                          [{id, entry_id, action}]
-- 22023 when p_now is null.
create function api.worker_deliveries_to_retry(p_now timestamptz)
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
  order by l.tenant_id, s.id;
end;
$$;

revoke execute on function
  api.worker_next_attempt_at(timestamptz, int, timestamptz),
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_release_retry(uuid),
  api.worker_tenants_to_release(timestamptz),
  api.worker_deliveries_to_retry(timestamptz)
  from public, anon, authenticated;
grant execute on function
  api.worker_next_attempt_at(timestamptz, int, timestamptz),
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_release_retry(uuid),
  api.worker_tenants_to_release(timestamptz),
  api.worker_deliveries_to_retry(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. api.publication_status: retries_exhausted replaces notify_attempts.
--
-- retries_exhausted is true when the entry's latest request will not be retried any more:
--   - its release is delivered and an active site's notification failed with its retries
--     exhausted (notify_status 'failed', no next attempt); or
--   - it is committed in no release, and the tenant's latest release, begun after the request was
--     made, failed with its build retries exhausted.
-- Everything else is unchanged from 20261102001500_publication_status.sql: security_invoker, so
-- RLS and the column grants of §4.5 apply to the caller; the latest-request subquery keeps its
-- explicit membership filter; SELECT for authenticated, nothing for PUBLIC, anon or service_role.
-- The column set changes, so the view is dropped and created.

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
       d.site_count, d.sites_notified, d.sites_live_ok, d.sites_not_confirmed,
       (d.notify_exhausted
        or (r.status = 'committed' and r.release_id is null
            and exists (select 1
                        from (select l.status, l.created_at, l.next_attempt_at from cms.releases l
                              where l.tenant_id = r.tenant_id order by l.number desc limit 1) as latest
                        where latest.status = 'failed' and latest.next_attempt_at is null
                          and latest.created_at >= r.requested_at))) as retries_exhausted
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
         coalesce(pg_catalog.bool_or(sd.notify_status = 'failed' and sd.next_attempt_at is null), false) as notify_exhausted
  from cms.sites s
  left join cms.site_deliveries sd
    on sd.tenant_id = s.tenant_id and sd.site_id = s.id and sd.release_id = r.release_id
  where s.tenant_id = r.tenant_id and s.active
) as d;

revoke all on api.publication_status from public, anon, service_role;
grant select on api.publication_status to authenticated;
