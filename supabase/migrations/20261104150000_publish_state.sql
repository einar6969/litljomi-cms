-- Publishing truth (security fixes, Thread A; spec §6.2, §6.3, §7.1, §7.4).
--
--   1. api.publication_status never takes a site's `live_status = 'ok'` from a newer release.
--      20261103213000_superseded_status.sql counted, for a superseded request release, each site
--      that had not confirmed the request's own release with its delivery of the newer release.
--      But a release only live-checks the requests linked to it (deliver.ts, liveTargets): the
--      newer release's 'ok' proves nothing about an older entry, so an unpublish whose own check
--      failed showed "Tekið af vef" once any unrelated release went live. §7.4: "Success is never
--      shown before its proof exists." (The plan's M3-15 acceptance line asked for the newer
--      release's state; the spec wins.)
--      Now a superseded request release keeps its own deliveries. A site that confirmed it live
--      stays live. A site that did not is counted not_confirmed, with no retry pending (the sweep
--      never retries a superseded release, M3-02, M3-03), so the editor sees "Ekki staðfest á vef"
--      instead of an "in progress" that never ends, and never a success it has no proof of. The
--      one exception is a fresh delivery still in its worker's run: while the request's release
--      was delivered less than SUPERSEDED_GRACE (420 s: the worker's maxDuration of 300 s plus the
--      120 s margin of decision 37.1, as STALE_RELEASE_SECONDS) ago and the site's own live status
--      is still pending without a failed notification, the site keeps its own pending state, as
--      before the newer release (none recorded yet counts as pending): its own live check may
--      still pass. The newer release's
--      deliveries are not read at all.
--
--   2. api.worker_commit_publish refuses an older publish once a newer request exists for the
--      entry. A publish P1 still validating while a newer unpublish U1 committed could commit
--      after U1 and put back what the editor withdrew. Now, right after the entry is locked (step
--      1), a request for the same entry with a later requested_at marks P1 `superseded` and
--      commits nothing. U1's commit holds the same entry lock, so P1's check, a later statement, sees U1.
--      Everything else in the function is unchanged.
--
--   3. Publish requests stop cycling (§6.3: "retried by the sweeper up to a limit"). An unexpected
--      error at attempt 5 fails the request in the worker (process-request.ts, MAX_ATTEMPTS), but
--      a worker killed mid-request (timeout, crash) left it validating, and every re-claim added an
--      attempt without bound. Both claim functions now fail, instead of claiming, a request that
--      has used its attempts (attempts >= 5, MAX_ATTEMPTS) or is past its deadline (requested more
--      than an hour ago): status `failed`, error {code: 'attempts_exhausted' | 'deadline_exceeded',
--      attempts}. The failed row is returned like a claimed one, so the worker sees status
--      'failed', raises the alert and does not process it. api.worker_claim_requests also claims
--      at most 3 requests per tenant per call (of p_limit in all), so one tenant's backlog does not
--      take a whole sweep. Signatures and result types are unchanged.
--
-- Every function keeps its signature and result type, and the view every column's name, type and
-- position, so `create or replace` keeps the grants (EXECUTE for service_role only; SELECT on the
-- view for authenticated only). No grant changes. All SECURITY INVOKER with search_path = ''; the
-- view stays security_invoker.

-- ---------------------------------------------------------------------------
-- 1. api.publication_status.
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
  -- Whether a newer delivered release superseded the request's delivered release (the sweep no
  -- longer retries the older one), and whether the request's release is still within its worker's
  -- run (SUPERSEDED_GRACE, 420 s since its delivery).
  select coalesce(rel.status = 'delivered' and latest_delivered.number > rel.number, false) as superseded,
         coalesce(rel.delivered_at > pg_catalog.now() - interval '420 seconds', false) as in_run
) as sup
cross join lateral (
  -- Every active site of the tenant, with the request's own release's delivery for it (none
  -- before the worker has recorded the site). Never the newer release's: it did not check this
  -- entry. When superseded, a site that did not confirm the entry live counts as not_confirmed
  -- with no retry pending and not exhausted (the editor sees "Ekki staðfest á vef"), unless its own
  -- check may still be running (in_run, pending or not recorded yet, notify not failed).
  select pg_catalog.count(*)::int as site_count,
         pg_catalog.count(*) filter (where sd.notify_status = 'ok')::int as sites_notified,
         pg_catalog.count(*) filter (where sd.live_status = 'ok')::int as sites_live_ok,
         pg_catalog.count(*) filter (where sd.live_status = 'not_confirmed')::int as sites_not_confirmed,
         coalesce(pg_catalog.bool_or(sd.kept and sd.notify_status = 'failed' and sd.next_attempt_at is null), false) as notify_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.first_failed_at is not null
                                     and sd.next_attempt_at is null), false) as live_exhausted,
         coalesce(pg_catalog.bool_or(sd.live_status = 'not_confirmed' and sd.next_attempt_at is not null), false) as live_pending_retry
  from cms.sites s
  left join cms.site_deliveries own
    on own.tenant_id = s.tenant_id and own.site_id = s.id and own.release_id = r.release_id
  cross join lateral (
    select (not sup.superseded
            or own.live_status is not distinct from 'ok'
            or (sup.in_run and coalesce(own.live_status, 'pending') = 'pending'
                and own.notify_status is distinct from 'failed')) as keep_own
  ) as pick
  cross join lateral (
    select pick.keep_own as kept,
           own.notify_status,
           case when pick.keep_own then own.live_status else 'not_confirmed' end as live_status,
           case when pick.keep_own then own.first_failed_at end as first_failed_at,
           case when pick.keep_own then own.next_attempt_at end as next_attempt_at
  ) as sd
  where s.tenant_id = r.tenant_id and s.active
) as d;

-- ---------------------------------------------------------------------------
-- 2. api.worker_commit_publish: unchanged from 20261102001100_worker_phase3.sql except the
-- newer-request check after the entry lock.
create or replace function api.worker_commit_publish(p_request_id uuid, p_validated_draft_version int,
                                                     p_validated_schema_version int, p_title text,
                                                     p_sort_at timestamptz)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request cms.publish_requests;
  v_newer uuid;
  v_draft_version int;
  v_draft_schema_version int;
  v_draft_data jsonb;
  v_tenant_status text;
  v_paths text[];
  v_refs uuid[];
  v_kinds text[];
  v_entry_ids uuid[];
  v_asset_ids uuid[];
  v_bad jsonb;
  v_revision_id uuid;
begin
  select * into v_request from cms.publish_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_request.action <> 'publish' or v_request.status <> 'validating' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform 1 from cms.entries e
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id
  for update;

  -- A newer request for the entry (any action, any status) decides it: this older publish never
  -- commits over it (a withdrawal committed meanwhile wins). Read after the entry lock, so a
  -- commit of the newer request that held the lock is visible. Newer is a later requested_at:
  -- requested_at is the inserting transaction's now() and no API role can set it, so two
  -- requests share one only when one transaction inserted both (a multi-row insert; each
  -- api.request_* call inserts one). Such a tie is not "newer"; if the publish then commits over
  -- an unpublish, the live check fails it (deliver.ts, liveTargets: still_published).
  select n.id into v_newer
  from cms.publish_requests n
  where n.tenant_id = v_request.tenant_id and n.entry_id = v_request.entry_id
    and n.requested_at > v_request.requested_at
  order by n.requested_at desc, n.id desc
  limit 1;
  if v_newer is not null then
    update cms.publish_requests r
    set status = 'superseded',
        error = pg_catalog.jsonb_build_object('code', 'superseded', 'newer_request_id', v_newer)
    where r.id = p_request_id;
    return 'superseded';
  end if;

  select d.version, d.schema_version, d.data into v_draft_version, v_draft_schema_version, v_draft_data
  from cms.drafts d
  where d.tenant_id = v_request.tenant_id and d.entry_id = v_request.entry_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Step 2.
  if v_draft_version is distinct from v_request.draft_version
     or p_validated_draft_version is distinct from v_request.draft_version then
    update cms.publish_requests r
    set status = 'superseded',
        error = pg_catalog.jsonb_build_object('code', 'superseded', 'requested_version', v_request.draft_version,
                                              'validated_version', p_validated_draft_version,
                                              'draft_version', v_draft_version)
    where r.id = p_request_id;
    return 'superseded';
  end if;

  -- Step 3.
  if p_validated_schema_version is distinct from v_draft_schema_version then
    update cms.publish_requests r
    set status = 'failed_validation',
        error = pg_catalog.jsonb_build_object('code', 'schema_version',
                                              'validated_schema_version', p_validated_schema_version,
                                              'draft_schema_version', v_draft_schema_version)
    where r.id = p_request_id;
    return 'failed_validation';
  end if;

  -- Step 4. The same re-check as in worker_commit_unpublish: keep identical.
  -- The tenant row is locked FOR SHARE (decision 33); the membership is read
  -- unlocked (the accepted race, 20261102001100_worker_phase3.sql).
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

  -- Step 5: extract once, lock the targets, then check them in a new statement.
  -- (unnest with several arrays is special FROM syntax and cannot be
  -- schema-qualified; with search_path = '' it still resolves to pg_catalog.)
  select pg_catalog.array_agg(x.path order by x.path), pg_catalog.array_agg(x.ref order by x.path),
         pg_catalog.array_agg(x.kind order by x.path)
    into v_paths, v_refs, v_kinds
  from private.extract_refs(v_draft_data) as x;
  select pg_catalog.array_agg(x.ref) filter (where x.kind = 'entry'),
         pg_catalog.array_agg(x.ref) filter (where x.kind = 'asset')
    into v_entry_ids, v_asset_ids
  from unnest(v_refs, v_kinds) as x (ref, kind);
  perform 1 from cms.entries t
  where t.tenant_id = v_request.tenant_id and t.id = any (v_entry_ids)
  order by t.id
  for share;
  perform 1 from cms.assets a
  where a.tenant_id = v_request.tenant_id and a.id = any (v_asset_ids)
  order by a.id
  for share;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('path', x.path, 'kind', x.kind, 'id', x.ref,
           'reason', case
                       when x.kind = 'entry' and te.id is null then 'not_found'
                       when x.kind = 'entry' and te.archived_at is not null then 'archived'
                       when x.kind = 'entry' then 'unpublished'
                       when ta.id is null then 'not_found'
                       else 'archived'
                     end)
         order by x.path)
    into v_bad
  from unnest(v_paths, v_refs, v_kinds) as x (path, ref, kind)
  left join cms.entries te on x.kind = 'entry' and te.tenant_id = v_request.tenant_id and te.id = x.ref
  left join cms.assets ta on x.kind = 'asset' and ta.tenant_id = v_request.tenant_id and ta.id = x.ref
  where case
          when x.kind = 'entry' then
            te.id is null
            or (te.id <> v_request.entry_id and (te.published_rev_id is null or te.archived_at is not null))
          else ta.id is null or ta.archived_at is not null
        end;
  if v_bad is not null then
    update cms.publish_requests r
    set status = 'failed_validation',
        error = pg_catalog.jsonb_build_object('code', 'invalid_reference', 'refs', v_bad)
    where r.id = p_request_id;
    return 'failed_validation';
  end if;

  -- Step 6: copy from the locked draft row.
  insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, sort_at, requested_by)
  select d.tenant_id, d.entry_id, d.version, d.schema_version, d.data, p_title, p_sort_at, v_request.requested_by
  from cms.drafts d
  where d.tenant_id = v_request.tenant_id and d.entry_id = v_request.entry_id
  returning id into v_revision_id;

  -- Step 7.
  update cms.entries e
  set published_rev_id = v_revision_id,
      published_draft_version = v_draft_version,
      first_published_at = coalesce(e.first_published_at, pg_catalog.now()),
      last_published_at = pg_catalog.now()
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id;

  -- Step 8.
  update cms.publish_requests r
  set status = 'committed', revision_id = v_revision_id, error = null
  where r.id = p_request_id;
  return 'committed';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The claims. A claimable request (pending, or validating with a claim older than 5 minutes)
-- that has used its 5 attempts or was requested more than an hour ago is failed, not claimed;
-- the others are claimed as before (validating, a new claimed_at, one more attempt). Both kinds
-- are returned, the failed ones with status 'failed', for the worker to alert on.

-- 3a. By id (the fast path).
create or replace function api.worker_claim_request(p_request_id uuid)
returns cms.publish_requests
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request cms.publish_requests;
begin
  with claimable as (
    select r.id
    from cms.publish_requests r
    where r.id = p_request_id
      and (r.status = 'pending'
           or (r.status = 'validating' and r.claimed_at < pg_catalog.now() - interval '5 minutes'))
    for update skip locked
  )
  update cms.publish_requests r
  set status = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                    then 'failed' else 'validating' end,
      error = case when r.attempts >= 5
                     then pg_catalog.jsonb_build_object('code', 'attempts_exhausted', 'attempts', r.attempts)
                   when r.requested_at < pg_catalog.now() - interval '1 hour'
                     then pg_catalog.jsonb_build_object('code', 'deadline_exceeded', 'attempts', r.attempts)
                   else r.error end,
      claimed_at = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                        then r.claimed_at else pg_catalog.now() end,
      attempts = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                      then r.attempts else r.attempts + 1 end
  from claimable c
  where r.id = c.id
  returning r.* into v_request;
  return v_request;
end;
$$;

-- 3b. The sweep's batch: oldest first, at most p_limit in all and 3 per tenant. The candidates are
-- chosen without locks (a window function cannot be combined with FOR UPDATE), then locked with
-- skip locked and the claim condition re-checked on the locked rows: a candidate another worker
-- claimed meanwhile is skipped.
create or replace function api.worker_claim_requests(p_limit int default 10)
returns setof cms.publish_requests
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 then
    raise exception 'p_limit must be at least 1' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select ranked.id
    from (
      select r.id, r.requested_at,
             pg_catalog.row_number() over (partition by r.tenant_id order by r.requested_at, r.id) as nth
      from cms.publish_requests r
      where r.status = 'pending'
         or (r.status = 'validating' and r.claimed_at < pg_catalog.now() - interval '5 minutes')
    ) as ranked
    where ranked.nth <= 3
    order by ranked.requested_at, ranked.id
    limit p_limit
  ), claimable as (
    select r.id
    from cms.publish_requests r
    where r.id in (select c.id from candidates c)
      and (r.status = 'pending'
           or (r.status = 'validating' and r.claimed_at < pg_catalog.now() - interval '5 minutes'))
    for update skip locked
  ), claimed as (
    update cms.publish_requests r
    set status = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                      then 'failed' else 'validating' end,
        error = case when r.attempts >= 5
                       then pg_catalog.jsonb_build_object('code', 'attempts_exhausted', 'attempts', r.attempts)
                     when r.requested_at < pg_catalog.now() - interval '1 hour'
                       then pg_catalog.jsonb_build_object('code', 'deadline_exceeded', 'attempts', r.attempts)
                     else r.error end,
        claimed_at = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                          then r.claimed_at else pg_catalog.now() end,
        attempts = case when r.attempts >= 5 or r.requested_at < pg_catalog.now() - interval '1 hour'
                        then r.attempts else r.attempts + 1 end
    from claimable c
    where r.id = c.id
    returning r.*
  )
  select * from claimed order by claimed.requested_at, claimed.id;
end;
$$;
