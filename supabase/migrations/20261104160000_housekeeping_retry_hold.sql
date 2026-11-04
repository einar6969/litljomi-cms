-- The housekeeping release waits for the withdrawing release's live-check retries (spec §5.6
-- "Withdrawal", §7.2 "Housekeeping release", §7.4, §8.4; security fix, Thread E).
--
-- 20261104153000_housekeeping_release lists a tenant for a housekeeping release as soon as its
-- latest delivered release D withdrew something, so the sweep builds release D+1 within about a
-- minute. Only the tenant's latest delivered release is retried (M3-03, §7.4), so a site whose live
-- check of D missed was never retried: the unpublish (or the image-replacing publish) stayed "live
-- not confirmed" for good, and no alert was raised.
--
-- Now the housekeeping listing is held while D still has a site whose delivery is unsettled, for at
-- most one hour after D was delivered:
--   - a not_confirmed delivery with a next attempt scheduled (M3-03's retry), or a failed
--     notification with a next attempt scheduled (M3-02's retry);
--   - a delivery whose first live check has not been recorded yet (no row for an active site, or a
--     live status still pending after a notification that did not fail). The fast path's first
--     check runs for up to 60 seconds before it records a miss, and a sweep in that window would
--     otherwise build D+1 before the miss exists.
-- A delivery that is live ok, or whose retries are exhausted (next attempt null after a failure),
-- is settled. Within the hour the sweep's retries of D run as usual (D is still the latest delivered
-- release), and a retry that passes settles the site. The hold ends when every active site is
-- settled, or one hour after D's delivery, whichever comes first; it never holds anything else.
--
-- A newly committed request still lists its tenant at once, hold or not, as before: its release is
-- built and supersedes D like any other.
--
-- When the hold ended by the hour with sites still unsettled, the row also names D
-- (unconfirmed_release_id, unconfirmed_release_number) and those sites (unconfirmed_site_ids, in id
-- order). The sweep builds the housekeeping release and raises one alert per release and site
-- (`delivery.withdrawal_unconfirmed`, emailed once per incident, M3-04). Otherwise the three columns
-- are null.
--
-- Withdrawn content therefore leaves public storage about an hour after the housekeeping release:
-- about an hour after the withdrawal, or about two hours when a site's live check keeps failing.
--
-- The return type gains three columns, so the function is dropped and created again: same name,
-- argument, language, stable, SECURITY INVOKER, search_path = ''; EXECUTE for service_role only,
-- revoked from PUBLIC, anon and authenticated (restated below, as M3-02 set them). No new function,
-- table, column or grant. Nothing else depends on the function.

drop function api.worker_tenants_to_release(timestamptz);

create function api.worker_tenants_to_release(p_now timestamptz)
returns table (tenant_id uuid, unconfirmed_release_id uuid, unconfirmed_release_number int, unconfirmed_site_ids uuid[])
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
  select c.id,
         case when c.hold_over then c.w_id end,
         case when c.hold_over then c.w_number end,
         case when c.hold_over then c.unsettled end
  from (
    select t.id,
           exists (select 1 from cms.publish_requests pr
                   where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null) as committed,
           w.id as w_id,
           w.number as w_number,
           u.site_ids as unsettled,
           -- The hold: D withdrew something and a site is unsettled, less than an hour after D.
           (w.id is not null and u.site_ids is not null and w.delivered_at > p_now - interval '1 hour') as held,
           -- The hold ended by the hour with sites still unsettled.
           (w.id is not null and u.site_ids is not null
            and not (w.delivered_at > p_now - interval '1 hour')) as hold_over
    from cms.tenants t
    left join lateral (
      -- D: the latest delivered release, when it withdrew something from the delivered release
      -- before it (an unpublish linked to it, or media that release referenced and it does not).
      select d.id, d.number, d.delivered_at
      from (select d.id, d.number, d.delivered_at, d.public_assets from cms.releases d
            where d.tenant_id = t.id and d.status = 'delivered'
            order by d.number desc limit 1) as d
      join lateral (select p.public_assets from cms.releases p
                    where p.tenant_id = t.id and p.status = 'delivered' and p.number < d.number
                    order by p.number desc limit 1) as p on true
      where exists (select 1 from cms.publish_requests u
                    where u.tenant_id = t.id and u.release_id = d.id and u.action = 'unpublish')
         or not (coalesce(p.public_assets, '{}') <@ coalesce(d.public_assets, '{}'))
    ) as w on true
    left join lateral (
      -- D's active sites whose delivery is unsettled (null when there are none).
      select pg_catalog.array_agg(s.id order by s.id) as site_ids
      from cms.sites s
      left join cms.site_deliveries sd on sd.tenant_id = s.tenant_id and sd.release_id = w.id and sd.site_id = s.id
      where w.id is not null
        and s.tenant_id = t.id and s.active
        and (sd.release_id is null
             or (sd.live_status <> 'ok' and sd.next_attempt_at is not null)
             or (sd.live_status = 'pending' and sd.notify_status <> 'failed'))
    ) as u on true
    where t.status = 'active'
  ) as c
  where (c.committed or (c.w_id is not null and not c.held))
    and not exists (
      select 1
      from (select l.status, l.created_at, l.next_attempt_at from cms.releases l
            where l.tenant_id = c.id order by l.number desc limit 1) as latest
      where latest.status = 'failed'
        and (latest.next_attempt_at is null or latest.next_attempt_at > p_now)
        and not exists (select 1 from cms.publish_requests pr
                        where pr.tenant_id = c.id and pr.status = 'committed' and pr.release_id is null
                          and pr.requested_at > latest.created_at))
  order by c.id;
end;
$$;

revoke execute on function api.worker_tenants_to_release(timestamptz) from public, anon, authenticated;
grant execute on function api.worker_tenants_to_release(timestamptz) to service_role;
