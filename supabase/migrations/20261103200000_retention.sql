-- Retention and public-media cleanup (spec §5.6 "Withdrawal", §7.2 "Retention", §8.4 "remove
-- content urgently"; plan M3-06; deferred Minor Task 20 security r1: a failed build's bundle and
-- media at unrecorded public paths).
--
-- Only the current and the previous release stay public. An hour after a release is delivered, the
-- release before the previous one is deleted from `delivery`, together with the `media-public`
-- objects that no remaining release references. A failed build's objects go the same way.
--
-- What a build writes is recorded before it is written:
--   - the bundle: release N of tenant T writes exactly `{T.slug}/releases/{N}.json` (§5.6;
--     worker_finish_release refuses any other bundle path). The release row, inserted by
--     worker_begin_release before the build writes anything, is that record, for a failed build
--     as much as a delivered one.
--   - media: `{T.slug}/{asset_id}/{filename}` (§5.6) for every asset the release references.
--     api.worker_record_release_media stores the asset ids in releases.public_assets while the
--     release is building and before the worker copies anything, including assets that are public
--     already, because a release keeps every image it references public, not only those it copied.
--
-- A release R is expired at the worker's clock p_now when it is not building and the second
-- delivered release numbered above R was delivered at least an hour before p_now: R is then
-- older than the previous release, and the hour has passed (§7.2). Failed releases expire by the
-- same rule, so a pointer a refused finish left on a failed release (decision 37.1 (d)) is never
-- deleted while a site may still read it.
--
--   1. cms.releases gets public_assets (the media the release references, recorded before
--      copying), cleanup_claimed_at and cleanup_assets (a sweep's claim, and the media that sweep
--      deletes), and cleaned_at (the release's public files are gone). The latest delivered
--      release of each tenant is backfilled with every asset that is public now, so media
--      published before this migration is covered: it stays until that release expires, and then
--      goes unless a newer release references it.
--   2. api.worker_record_release_media(p_release_id, p_asset_ids): records the media of a building
--      release and tells the worker, per asset, whether to copy it (public_path is null) and
--      whether a sweep is deleting it right now (the worker waits for that sweep before copying).
--   3. api.worker_claim_release_cleanup(p_now, p_limit): claims up to p_limit expired releases and
--      returns their bundle and the media no unexpired release references. The claimed media's
--      public_path is cleared in the same transaction, so a later build copies it again.
--   4. api.worker_finish_release_cleanup(p_release_ids, p_deleted): marks claimed releases cleaned
--      once the worker deleted their objects, or releases the claim when the deletion failed.
--
-- A build and a sweep never both act on one object:
--   - the claim locks every building release before it reads what they reference, and the record
--     locks its release before it reads the claims. Whichever commits first is seen by the other.
--   - a building release is never expired, so media a build recorded is never claimed.
--   - media a sweep claimed is reported to the recording build as `deleting` until the sweep
--     finishes; the build waits and records again, then copies it (public_path is null by then).
--   - a claim older than 420 seconds is stale (the worker's maxDuration of 300 s plus the 120 s
--     margin of decision 37.1): its sweep is no longer running, so it is ignored by the record and
--     may be claimed again. Claims are timed by the database clock, retention by p_now.
--
-- Storage deletes go through the worker only: the public buckets keep no write or delete policy for
-- any API role, and these functions only list and mark.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE is
-- granted to service_role only; PUBLIC has none through Task 4's global default privileges, and it
-- is revoked from anon and authenticated explicitly as well. The audit trigger on cms.releases
-- fires on status changes only, and none of these updates changes a status.

-- ---------------------------------------------------------------------------
-- 1. The columns.
alter table cms.releases
  add column public_assets uuid[],
  add column cleanup_claimed_at timestamptz,
  add column cleanup_assets uuid[],
  add column cleaned_at timestamptz;

grant update (public_assets, cleanup_claimed_at, cleanup_assets, cleaned_at) on cms.releases to service_role;

update cms.releases r
set public_assets = coalesce((select pg_catalog.array_agg(a.id order by a.id)
                              from cms.assets a
                              where a.tenant_id = r.tenant_id and a.public_path is not null), '{}')
where r.id in (select distinct on (l.tenant_id) l.id
               from cms.releases l
               where l.status = 'delivered'
               order by l.tenant_id, l.number desc);

-- ---------------------------------------------------------------------------
-- 2. The media of a building release, recorded before the worker copies anything. p_asset_ids
-- replaces what an earlier call for the same release recorded (the worker records again after
-- waiting for a sweep). One row per asset, in id order:
--   copy      the asset has no public object the database knows of (public_path is null)
--   deleting  a sweep that is still running claimed the asset's public object
-- 22023 for a null argument, a null element or more than 10,000 ids; not_found for an unknown
-- release; forbidden when the release is not building or an id is not an asset of its tenant.
create function api.worker_record_release_media(p_release_id uuid, p_asset_ids uuid[])
returns table (asset_id uuid, copy boolean, deleting boolean)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_release cms.releases;
  v_given int;
  v_count int;
begin
  if p_release_id is null or p_asset_ids is null or pg_catalog.cardinality(p_asset_ids) > 10000 then
    raise exception 'p_release_id and p_asset_ids (at most 10000) are required' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_asset_ids) as u where u is null) then
    raise exception 'p_asset_ids must not contain null' using errcode = '22023';
  end if;
  -- Locked first: a claim running now holds this lock until it commits, and one starting later
  -- waits for this record (see the header).
  select * into v_release from cms.releases r where r.id = p_release_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_release.status <> 'building' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select pg_catalog.count(distinct u) into v_given from pg_catalog.unnest(p_asset_ids) as u;
  select pg_catalog.count(*) into v_count
  from cms.assets a
  where a.tenant_id = v_release.tenant_id and a.id = any (p_asset_ids);
  if v_count <> v_given then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  update cms.releases r
  set public_assets = coalesce((select pg_catalog.array_agg(distinct u order by u)
                                from pg_catalog.unnest(p_asset_ids) as u), '{}')
  where r.id = v_release.id;

  return query
  select a.id,
         a.public_path is null,
         exists (select 1 from cms.releases c
                 where c.tenant_id = v_release.tenant_id
                   and c.cleaned_at is null
                   and c.cleanup_claimed_at > pg_catalog.now() - interval '420 seconds'
                   and a.id = any (c.cleanup_assets))
  from cms.assets a
  where a.tenant_id = v_release.tenant_id and a.id = any (p_asset_ids)
  order by a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Claims up to p_limit expired releases that are not cleaned and not claimed by a running sweep
-- (oldest first per tenant), and returns what the worker deletes: per release, one row for its
-- bundle (asset_id and filename null) and one per asset of public_assets that no unexpired release
-- of the tenant references. The claimed assets' public_path is cleared. Columns:
--   release_id, tenant_id, tenant_slug, release_number   the release (the bundle path is
--                                                        {tenant_slug}/releases/{release_number}.json)
--   asset_id, filename   a media object ({tenant_slug}/{asset_id}/{filename}), or null
-- 22023 when p_now is null or p_limit is not between 1 and 100.
create function api.worker_claim_release_cleanup(p_now timestamptz, p_limit int default 20)
returns table (release_id uuid, tenant_id uuid, tenant_slug text, release_number int, asset_id uuid, filename text)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_expired uuid[];
  v_claimed uuid[];
begin
  if p_now is null then
    raise exception 'p_now is required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100' using errcode = '22023';
  end if;

  -- Serializes with worker_record_release_media (see the header): every building release is
  -- locked before anything it references is read.
  perform 1 from cms.releases b where b.status = 'building' order by b.id for update;

  -- Every expired release (§7.2): not building, and the second delivered release numbered above
  -- it was delivered at least an hour before p_now.
  select pg_catalog.array_agg(r.id) into v_expired
  from cms.releases r
  where r.status <> 'building'
    and (select d.delivered_at
         from cms.releases d
         where d.tenant_id = r.tenant_id and d.status = 'delivered' and d.number > r.number
         order by d.number
         offset 1 limit 1) <= p_now - interval '1 hour';
  if v_expired is null then
    return;
  end if;

  select pg_catalog.array_agg(c.id) into v_claimed
  from (select r.id
        from cms.releases r
        where r.id = any (v_expired)
          and r.cleaned_at is null
          and (r.cleanup_claimed_at is null or r.cleanup_claimed_at <= pg_catalog.now() - interval '420 seconds')
        order by r.tenant_id, r.number
        limit p_limit
        for update skip locked) as c;
  if v_claimed is null then
    return;
  end if;

  -- The media of each claimed release that no unexpired release of its tenant references (a
  -- building release is never expired, so it protects everything it recorded).
  update cms.releases r
  set cleanup_claimed_at = pg_catalog.now(),
      cleanup_assets = coalesce((select pg_catalog.array_agg(distinct u order by u)
                                 from pg_catalog.unnest(r.public_assets) as u
                                 where not exists (select 1 from cms.releases k
                                                   where k.tenant_id = r.tenant_id
                                                     and not (k.id = any (v_expired))
                                                     and u = any (k.public_assets))), '{}')
  where r.id = any (v_claimed);

  update cms.assets a
  set public_path = null
  where a.public_path is not null
    and exists (select 1 from cms.releases r
                where r.id = any (v_claimed) and r.tenant_id = a.tenant_id and a.id = any (r.cleanup_assets));

  return query
  select r.id, r.tenant_id, t.slug, r.number, null::uuid, null::text
  from cms.releases r
  join cms.tenants t on t.id = r.tenant_id
  where r.id = any (v_claimed)
  union all
  select r.id, r.tenant_id, t.slug, r.number, a.id, a.filename
  from cms.releases r
  join cms.tenants t on t.id = r.tenant_id
  join cms.assets a on a.tenant_id = r.tenant_id and a.id = any (r.cleanup_assets)
  where r.id = any (v_claimed)
  order by 2, 4, 5 nulls first;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Ends the claims on p_release_ids. p_deleted true: the worker deleted every object the claim
-- listed, so the release is cleaned. p_deleted false: the deletion failed, so the claim is released
-- at once (the claimed media's public_path stays null, so a build copies it again) and a later
-- sweep claims the release again. Only claimed, uncleaned releases change. Returns how many did.
-- 22023 for a null argument, a null element or more than 100 ids.
create function api.worker_finish_release_cleanup(p_release_ids uuid[], p_deleted boolean)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count int;
begin
  if p_release_ids is null or p_deleted is null or pg_catalog.cardinality(p_release_ids) > 100 then
    raise exception 'p_release_ids (at most 100) and p_deleted are required' using errcode = '22023';
  end if;
  if exists (select 1 from pg_catalog.unnest(p_release_ids) as u where u is null) then
    raise exception 'p_release_ids must not contain null' using errcode = '22023';
  end if;
  if p_deleted then
    update cms.releases r
    set cleaned_at = pg_catalog.now()
    where r.id = any (p_release_ids) and r.cleaned_at is null and r.cleanup_claimed_at is not null;
  else
    update cms.releases r
    set cleanup_claimed_at = null
    where r.id = any (p_release_ids) and r.cleaned_at is null and r.cleanup_claimed_at is not null;
  end if;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function
  api.worker_record_release_media(uuid, uuid[]),
  api.worker_claim_release_cleanup(timestamptz, int),
  api.worker_finish_release_cleanup(uuid[], boolean)
  from public, anon, authenticated;
grant execute on function
  api.worker_record_release_media(uuid, uuid[]),
  api.worker_claim_release_cleanup(timestamptz, int),
  api.worker_finish_release_cleanup(uuid[], boolean)
  to service_role;
