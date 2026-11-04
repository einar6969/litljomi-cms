-- W1: keep checking an unconfirmed withdrawal after its release is superseded (spec §5.6
-- "Withdrawal", §7.2, §7.4, §8.4; security fix; decision 52.4).
--
-- Until now only a tenant's latest delivered release was retried (M3-03), and a release live-checks
-- only the requests linked to it (deliver.ts, liveTargets). So when a newer release superseded a
-- withdrawing release D whose live check had missed (the housekeeping release once the hold's hour
-- ended, or any release built for a request committed during the hold), the withdrawn entry was
-- never checked again: the editor kept seeing "Ekki staðfest á vef" although the entry had left the
-- site, and a withdrawal still on the site after a committed request raised no alert at all.
--
-- Now each site's delivery of D keeps its own withdrawal state, in last_error (no new table,
-- column or grant):
--   withdrawals         the withdrawal checks the site has not confirmed yet, one per entry:
--                       { entryId, requestIds, checks: [{ path, expect }], ownPath }. The checks are
--                       computed once, while D's bundle and the one before it exist, so a later
--                       check never needs them (retention may have removed them).
--   withdrawn           the entry ids whose withdrawal the site confirmed.
--   withdrawals_others  whether anything else in D (a publish) was unconfirmed on the site, so a
--                       withdrawal-only check never records the whole delivery live.
--   withdrawal_alerted  set once `delivery.withdrawal_unconfirmed` was raised for D and the site.
-- The worker writes them (deliver.ts); the database keeps them across the records that do not
-- settle the delivery, and the sweep reads them back.
--
--   1. api.worker_record_delivery (same signature and result; create or replace keeps its grants):
--      - those four keys of last_error are kept when p_error does not name them, until a live ok
--        record (which still replaces last_error with p_error);
--      - a record with neither status (p_notify_status and p_live_status null) is an annotation:
--        p_error, an object, is merged into an existing row's last_error and nothing else changes;
--        no row is created. The worker marks a raised withdrawal alert this way.
--   2. api.worker_deliveries_to_retry (same argument; two result columns appended, so it is dropped
--      and created again): as before for the latest delivered release, with notify_release_number
--      = its number and withdrawal null. And, for an older (superseded) delivered release D of an
--      active tenant, each active site's delivery that is not live ok, still has a next attempt
--      (M3-02's 24 hours not run out) and stores withdrawals, listing only the stored withdrawals
--      whose entry's latest request is still D's unpublish (published again, or withdrawn again
--      later: no longer checked here), when that list is not empty and either the next attempt is
--      due or the hour after D's delivery ended with no withdrawal alert raised yet. Such a row
--      names no bundle (bundle_path, previous_bundle_path null; requests '[]'),
--      notify_release_number is the tenant's latest delivered release (the release the site is
--      told about: the webhook carries no instruction, so it never changes the live release), and
--      withdrawal = { pending, withdrawn, others, alerted, hourOver }.
--   3. api.worker_tenants_to_release (same signature and result; create or replace): the hold and
--      the listing are unchanged (§5.6, §7.2 and §8.4's one-hour and two-hour bounds stay); the
--      sites named in unconfirmed_site_ids leave out those already alerted (withdrawal_alerted), so
--      the alert is raised once per release and site when the tenant is listed again.
--   4. api.publication_status (every column as before; create or replace keeps its grants): for an
--      unpublish, a site whose delivery of the request's release lists the entry in `withdrawn`
--      counts as live ok (notified, confirmed), even when that delivery is not_confirmed for
--      another entry or superseded. A site whose delivery still lists the entry in `withdrawals`
--      keeps its own delivery state while the hour after the release lasts, superseded or not
--      (in progress, "retrying"); after the hour it counts as not confirmed with no retry shown
--      ("Ekki staðfest á vef", the failure the alert reported), or as exhausted once the retries
--      ran out ("Birting á vef mistókst"). The checks themselves go on until they confirm or the
--      24 hours run out. Deliveries without that state (recorded before this migration) show as
--      before.
--
-- All functions stay SECURITY INVOKER with search_path = '' and schema-qualified names, EXECUTE
-- for service_role only (restated below); the view stays security_invoker, SELECT for
-- authenticated only. Nothing else depends on api.worker_deliveries_to_retry.

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

  -- An annotation: neither status, p_error merged into an existing row's last_error.
  if p_notify_status is null and p_live_status is null then
    if p_error is null or pg_catalog.jsonb_typeof(p_error) <> 'object' then
      raise exception 'p_error must be an object when no status is recorded' using errcode = '22023';
    end if;
    update cms.site_deliveries as sd
    set last_error = case when pg_catalog.jsonb_typeof(sd.last_error) = 'object' then sd.last_error else '{}'::jsonb end || p_error
    where sd.release_id = p_release_id and sd.site_id = p_site_id
    returning sd.* into v_row;
    if not found then
      return;
    end if;
    return query
    select v_row.notify_attempts, v_row.next_attempt_at,
           (v_row.notify_status = 'failed' or v_row.live_status = 'not_confirmed') and v_row.next_attempt_at is null;
    return;
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
      -- The withdrawal state outlives every record but a live ok one (W1).
      last_error = case
                     when p_live_status = 'ok'
                          or pg_catalog.jsonb_typeof(sd.last_error) is distinct from 'object'
                          or (p_error is not null and pg_catalog.jsonb_typeof(p_error) <> 'object') then p_error
                     else (select nullif(coalesce(pg_catalog.jsonb_object_agg(k.key, sd.last_error -> k.key), '{}'::jsonb)
                                           || coalesce(p_error, '{}'::jsonb), '{}'::jsonb)
                           from pg_catalog.unnest(array['withdrawals', 'withdrawn', 'withdrawals_others', 'withdrawal_alerted']) as k (key)
                           where sd.last_error ? k.key)
                   end,
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

drop function api.worker_deliveries_to_retry(timestamptz);

create function api.worker_deliveries_to_retry(p_now timestamptz)
returns table (release_id uuid, tenant_id uuid, tenant_slug text, release_number int, bundle_path text,
               previous_bundle_path text, site_id uuid, notify_status text, notify_attempts int,
               live_status text, requests jsonb, notify_release_number int, withdrawal jsonb)
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
  -- The latest delivered release: as in 20261103193000_not_confirmed_retry.sql.
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
                   where pr.tenant_id = l.tenant_id and pr.release_id = l.id), '[]'::jsonb),
         l.number,
         null::jsonb
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
  union all
  -- An older (superseded) release's withdrawals that a site has not confirmed (W1).
  select d.id, d.tenant_id, t.slug, d.number, null::text, null::text, s.id,
         sd.notify_status, sd.notify_attempts, sd.live_status, '[]'::jsonb,
         l.number,
         pg_catalog.jsonb_build_object(
           'pending', pend.list,
           'withdrawn', case when pg_catalog.jsonb_typeof(sd.last_error -> 'withdrawn') = 'array'
                             then sd.last_error -> 'withdrawn' else '[]'::jsonb end,
           'others', coalesce(sd.last_error -> 'withdrawals_others' = 'true'::jsonb, false),
           'alerted', sd.last_error ? 'withdrawal_alerted',
           'hourOver', coalesce(d.delivered_at <= p_now - interval '1 hour', false))
  from latest l
  join cms.tenants t on t.id = l.tenant_id
  join cms.releases d on d.tenant_id = l.tenant_id and d.status = 'delivered' and d.number < l.number
  join cms.site_deliveries sd on sd.tenant_id = d.tenant_id and sd.release_id = d.id
  join cms.sites s on s.tenant_id = sd.tenant_id and s.id = sd.site_id and s.active
  cross join lateral (
    -- The stored withdrawals whose entry's latest request is still D's unpublish.
    select pg_catalog.jsonb_agg(x.w order by x.ord) as list
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(sd.last_error -> 'withdrawals') = 'array'
                                              then sd.last_error -> 'withdrawals' else '[]'::jsonb end)
         with ordinality as x (w, ord)
    where exists (select 1
                  from (select pr.action, pr.release_id from cms.publish_requests pr
                        where pr.tenant_id = d.tenant_id and pr.entry_id::text = x.w ->> 'entryId'
                        order by pr.requested_at desc, pr.id desc limit 1) as lr
                  where lr.action = 'unpublish' and lr.release_id = d.id)
  ) as pend
  where sd.live_status <> 'ok'
    and sd.next_attempt_at is not null
    and pg_catalog.jsonb_typeof(sd.last_error -> 'withdrawals') = 'array'
    and pend.list is not null
    and (sd.next_attempt_at <= p_now
         or (d.delivered_at <= p_now - interval '1 hour' and not (sd.last_error ? 'withdrawal_alerted')))
  order by 2, 4, 7;
end;
$$;

revoke execute on function api.worker_deliveries_to_retry(timestamptz) from public, anon, authenticated;
grant execute on function api.worker_deliveries_to_retry(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 3. The build selection: as in 20261104160000_housekeeping_retry_hold.sql, except that
-- unconfirmed_site_ids leaves out sites already alerted.

create or replace function api.worker_tenants_to_release(p_now timestamptz)
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
         case when c.hold_over and c.to_alert is not null then c.w_id end,
         case when c.hold_over and c.to_alert is not null then c.w_number end,
         case when c.hold_over then c.to_alert end
  from (
    select t.id,
           exists (select 1 from cms.publish_requests pr
                   where pr.tenant_id = t.id and pr.status = 'committed' and pr.release_id is null) as committed,
           w.id as w_id,
           w.number as w_number,
           u.to_alert,
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
      -- D's active sites whose delivery is unsettled (null when there are none), and those of them
      -- not alerted yet (null when there are none).
      select pg_catalog.array_agg(s.id order by s.id) as site_ids,
             pg_catalog.array_agg(s.id order by s.id)
               filter (where not coalesce(sd.last_error ? 'withdrawal_alerted', false)) as to_alert
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

revoke execute on function
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_tenants_to_release(timestamptz)
  from public, anon, authenticated;
grant execute on function
  api.worker_record_delivery(uuid, uuid, text, text, jsonb, timestamptz),
  api.worker_tenants_to_release(timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 4. api.publication_status: as in 20261104150000_publish_state.sql, with an unpublish's own
-- withdrawal state per site.

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
