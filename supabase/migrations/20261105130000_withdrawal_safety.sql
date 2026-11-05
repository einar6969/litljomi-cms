-- M5-01: withdrawal safety (findings 1 and 2 of docs/verification/m5-review.md; spec §6.2, §7.4;
-- decision 65).
--
-- Finding 1. A repeat unpublish was accepted, committed and linked to a newer release. There the
-- entry is in neither bundle, so the worker had nothing to check and confirmed it, while the first
-- unpublish's stored checks stopped: "Tekið af vef" with nothing checked, on a site that had not
-- confirmed the withdrawal. Finding 2. The withdrawal state reached the delivery only with the
-- run's last record, so a run killed during the pointer poll or the live window left a release
-- whose withdrawal no later check or alert knew about, once a newer release superseded it.
--
--   1. api.request_unpublish refuses an entry that is not published and has no publish in flight
--      (a publish request still pending or validating; §6.3's other statuses are final): P0001
--      `not_published`, no request row. An unpublish in flight is no publish.
--   2. api.worker_commit_unpublish ends the request of an entry that is already unpublished as
--      `superseded`, with error {code: 'not_published'}: only a committed request is linked to a
--      release. This is what two requests accepted before either ran reach.
--   3. api.worker_deliveries_to_retry: a stored withdrawal stops only on the entry's latest
--      committed request (decision 65); a pending, failed or superseded request stops nothing.
--   4. api.worker_entry_was_delivered (new; service_role only): whether an earlier release reached
--      a site with the entry. §7.4 confirms a withdrawal with nothing to check only when no
--      delivered release ever contained the entry, and a withdrawal is checked from the record in
--      the release before it, so an entry may be on a site with no such record (a publish and an
--      unpublish coalesced into one build after an earlier withdrawal). It is delivered when:
--      - a committed publish of it is linked to a delivered release other than the one in hand; or
--      - it was committed before the end of a failed release earlier than the one in hand whose
--        pointer may be written: a failed release links no request, so its publish is linked
--        later, or never. releases.error.pointerWritten says so (build-release.ts): true, null when
--        the read-back could not tell, or missing on a stale_building release, which a killed
--        worker may have left after the pointer write. Only false rules it out. A build ends within
--        420 s (STALE_RELEASE_SECONDS), and its snapshot before that, which bounds the commit.
--      Both branches read the entry's requests through publish_requests_tenant_entry_idx, and
--      releases through their tenant-scoped keys. api.worker_release_snapshot and
--      api.worker_deliveries_to_retry give the answer with each request (`was_delivered`, a key
--      added, same signatures). The worker then keeps a withdrawal with no record unconfirmed
--      (deliver.ts, `withdrawal_unchecked`), and confirms one that no site ever had.
--   5. api.worker_record_delivery (same signature and result): a record with notify status
--      'pending', no live status and p_error naming `withdrawals` is the state the worker stores
--      before the run's pointer poll and live window. It creates the delivery, pending, with no
--      attempt and no failure, its next attempt in five minutes (the worker's maxDuration, the same
--      grace as a delivery with no row); on a delivery that already has the state or is live ok it
--      changes nothing. The notification keeps a next attempt on a delivery with the state, five
--      minutes on, because the superseded branch of the retry selection needs one. Once the first
--      miss or failure is recorded the schedule is M3-02's as before. The state's shape is W1's.
--   6. api.worker_deliveries_to_retry leaves a pending delivery alone until that next attempt.
--
-- §6.2's refusal of a repeat unpublish and its `superseded` end are under decision 65.
--
-- No new table or column. All functions stay SECURITY INVOKER with search_path = '' and
-- schema-qualified names; `create or replace` keeps their grants, and nothing is dropped. The one
-- new function's grants are at its definition.

-- ---------------------------------------------------------------------------
-- 1. The editor's request.

create or replace function api.request_unpublish(p_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_published_rev_id uuid;
  v_id uuid;
begin
  select e.tenant_id, e.published_rev_id into v_tenant_id, v_published_rev_id
  from cms.entries e
  where e.id = p_entry_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_published_rev_id is null and not exists (
    select 1 from cms.publish_requests r
    where r.tenant_id = v_tenant_id and r.entry_id = p_entry_id
      and r.action = 'publish' and r.status in ('pending', 'validating')
  ) then
    raise exception 'not_published' using errcode = 'P0001';
  end if;
  insert into cms.publish_requests (tenant_id, entry_id, action)
  values (v_tenant_id, p_entry_id, 'unpublish')
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. The commit: as in 20261102001100_worker_phase3.sql, with the repeat ended after the re-check.

create or replace function api.worker_commit_unpublish(p_request_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request cms.publish_requests;
  v_tenant_status text;
  v_published_rev_id uuid;
begin
  select * into v_request from cms.publish_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_request.action <> 'unpublish' or v_request.status <> 'validating' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select e.published_rev_id into v_published_rev_id from cms.entries e
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id
  for update;

  -- The same re-check as worker_commit_publish's step 4: keep identical.
  select t.status into v_tenant_status from cms.tenants t where t.id = v_request.tenant_id for share;
  if v_tenant_status is distinct from 'active' then
    update cms.publish_requests r
    set status = 'rejected', error = pg_catalog.jsonb_build_object('code', 'tenant_inactive')
    where r.id = p_request_id;
    return 'rejected';
  end if;
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = v_request.tenant_id and m.user_id = v_request.requested_by
  ) then
    update cms.publish_requests r
    set status = 'rejected', error = pg_catalog.jsonb_build_object('code', 'forbidden')
    where r.id = p_request_id;
    return 'rejected';
  end if;

  -- Nothing to withdraw: the request ends here and no release links it.
  if v_published_rev_id is null then
    update cms.publish_requests r
    set status = 'superseded', error = pg_catalog.jsonb_build_object('code', 'not_published')
    where r.id = p_request_id;
    return 'superseded';
  end if;

  update cms.entries e
  set published_rev_id = null, published_draft_version = null
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id;
  update cms.publish_requests r
  set status = 'committed', error = null
  where r.id = p_request_id;
  return 'committed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Whether an earlier release reached a site with the entry.

create function api.worker_entry_was_delivered(p_release_id uuid, p_entry_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from cms.releases hand
    join cms.publish_requests p
      on p.tenant_id = hand.tenant_id and p.entry_id = p_entry_id
     and p.action = 'publish' and p.status = 'committed'
    where hand.id = p_release_id
      and (exists (select 1 from cms.releases d
                   where d.tenant_id = p.tenant_id and d.id = p.release_id
                     and d.id <> hand.id and d.status = 'delivered')
           or exists (select 1
                      from cms.revisions v
                      join cms.releases f on f.tenant_id = v.tenant_id
                      where v.tenant_id = p.tenant_id and v.id = p.revision_id
                        and f.number < hand.number and f.status = 'failed'
                        and f.error ->> 'pointerWritten' is distinct from 'false'
                        and v.committed_at < f.created_at + interval '420 seconds')));
$$;

revoke execute on function api.worker_entry_was_delivered(uuid, uuid) from public, anon, authenticated;
grant execute on function api.worker_entry_was_delivered(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The delivery record: as in 20261104180000_withdrawal_confirmation.sql, with the state stored
-- before a run and the notification's next attempt.

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

  -- The withdrawal state, stored before the run's pointer poll and live window: a pending delivery
  -- whose first attempt is due once the run cannot be alive any more. A delivery that already has
  -- the state, or a record of its own, keeps them (a retry starts here too).
  if p_notify_status = 'pending' and p_live_status is null
     and pg_catalog.jsonb_typeof(p_error -> 'withdrawals') = 'array' then
    insert into cms.site_deliveries as sd (release_id, site_id, tenant_id, notify_status, notify_attempts, live_status,
                                           last_error, next_attempt_at)
    values (p_release_id, p_site_id, v_tenant_id, 'pending', 0, 'pending', p_error, p_now + interval '5 minutes')
    on conflict (release_id, site_id) do update
    set last_error = case when pg_catalog.jsonb_typeof(sd.last_error) = 'object' then sd.last_error else '{}'::jsonb end || p_error,
        next_attempt_at = coalesce(sd.next_attempt_at, p_now + interval '5 minutes')
    where sd.live_status <> 'ok' and not coalesce(sd.last_error ? 'withdrawals', false)
    returning sd.* into v_row;
    if not found then
      return;
    end if;
    return query select v_row.notify_attempts, v_row.next_attempt_at, false;
    return;
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
                          -- Notified, with withdrawals to confirm: a run killed in the live window is retried.
                          when p_notify_status = 'ok' and sd.last_error ? 'withdrawals' then p_now + interval '5 minutes'
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
-- 5. The sweep's delivery selection: as in 20261104180000_withdrawal_confirmation.sql, with the
-- requests' was_delivered, the latest committed request, and a pending delivery left to its run.

create or replace function api.worker_deliveries_to_retry(p_now timestamptz)
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
  -- The latest delivered release: as in 20261104180000_withdrawal_confirmation.sql, but a pending
  -- delivery whose next attempt is still to come is left to its run.
  select l.id, l.tenant_id, t.slug, l.number, l.bundle_path,
         (select p.bundle_path from cms.releases p
          where p.tenant_id = l.tenant_id and p.status = 'delivered' and p.number < l.number
          order by p.number desc limit 1),
         s.id,
         coalesce(sd.notify_status, 'pending'),
         coalesce(sd.notify_attempts, 0),
         coalesce(sd.live_status, 'pending'),
         coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action,
                            'was_delivered', api.worker_entry_was_delivered(l.id, pr.entry_id))
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
     or (sd.release_id is not null and sd.notify_status not in ('ok', 'failed')
         and (sd.next_attempt_at is null or sd.next_attempt_at <= p_now))
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
    -- The stored withdrawals whose entry's latest committed request is still D's unpublish.
    select pg_catalog.jsonb_agg(x.w order by x.ord) as list
    from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(sd.last_error -> 'withdrawals') = 'array'
                                              then sd.last_error -> 'withdrawals' else '[]'::jsonb end)
         with ordinality as x (w, ord)
    where exists (select 1
                  from (select pr.action, pr.release_id from cms.publish_requests pr
                        where pr.tenant_id = d.tenant_id and pr.entry_id::text = x.w ->> 'entryId'
                          and pr.status = 'committed'
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

-- ---------------------------------------------------------------------------
-- 6. The build's snapshot: as in 20261102000900_api_worker.sql, with the requests' was_delivered.

create or replace function api.worker_release_snapshot(p_release_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  with rel as (
    select r.id, r.tenant_id, r.number, r.status from cms.releases r where r.id = p_release_id
  ),
  published as (
    select e.id as entry_id, e.tenant_id, e.type, e.slug, e.first_published_at, e.last_published_at,
           v.id as revision_id, v.schema_version, v.data, v.title, v.sort_at
    from rel
    join cms.entries e on e.tenant_id = rel.tenant_id
    join cms.revisions v on v.tenant_id = e.tenant_id and v.entry_id = e.id and v.id = e.published_rev_id
    where e.published_rev_id is not null and e.archived_at is null
  ),
  refs as (
    select rr.revision_id, rr.path, rr.target_entry_id, rr.target_asset_id
    from published p
    join cms.revision_refs rr on rr.tenant_id = p.tenant_id and rr.revision_id = p.revision_id
  )
  select pg_catalog.jsonb_build_object(
           'release', pg_catalog.jsonb_build_object('id', rel.id, 'tenant_id', rel.tenant_id, 'number', rel.number,
                                                    'status', rel.status),
           'tenant', (select pg_catalog.jsonb_build_object('id', t.id, 'slug', t.slug)
                      from cms.tenants t where t.id = rel.tenant_id),
           'entries', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'entry_id', p.entry_id, 'type', p.type, 'slug', p.slug, 'revision_id', p.revision_id,
                      'schema_version', p.schema_version, 'data', p.data, 'title', p.title, 'sort_at', p.sort_at,
                      'first_published_at', p.first_published_at, 'last_published_at', p.last_published_at,
                      'refs', coalesce((
                        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                                 'path', x.path,
                                 'kind', case when x.target_entry_id is not null then 'entry' else 'asset' end,
                                 'id', coalesce(x.target_entry_id, x.target_asset_id))
                               order by x.path)
                        from refs x where x.revision_id = p.revision_id), '[]'::jsonb))
                    order by p.type, p.entry_id)
             from published p), '[]'::jsonb),
           'assets', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', a.id, 'original_path', a.original_path, 'filename', a.filename, 'mime', a.mime,
                      'width', a.width, 'height', a.height, 'focal_x', a.focal_x, 'focal_y', a.focal_y,
                      'default_alt', a.default_alt, 'public_path', a.public_path,
                      'archived', a.archived_at is not null)
                    order by a.id)
             from cms.assets a
             where a.tenant_id = rel.tenant_id
               and a.id in (select x.target_asset_id from refs x where x.target_asset_id is not null)), '[]'::jsonb),
           'requests', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action, 'revision_id', pr.revision_id,
                      'was_delivered', api.worker_entry_was_delivered(rel.id, pr.entry_id))
                    order by pr.requested_at, pr.id)
             from cms.publish_requests pr
             where pr.tenant_id = rel.tenant_id and pr.status = 'committed' and pr.release_id is null), '[]'::jsonb))
    into v_result
  from rel;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;
