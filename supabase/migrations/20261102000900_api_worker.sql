-- The worker's api: claim, read, commit, release and delivery functions (spec
-- §4.3, §4.5, §4.6, §6.1–6.3, §7.1, §7.4, §8.1, §8.2; plan Task 11, decisions
-- 3, 4, 10, 11 and 12; "Exactness: what M1 proves").
--
-- The worker reads and writes through these functions only, because cms is not
-- exposed even to the secret key's REST client (decision 4). All are SECURITY
-- INVOKER with search_path = '' and schema-qualified names; no SECURITY DEFINER
-- anywhere. EXECUTE is granted to service_role only (PUBLIC has none through
-- Task 4's global default privileges; anon and authenticated get none), so they
-- run with the grants Tasks 5–10 gave service_role and nothing more.
--
-- The secret key bypasses RLS, so every function checks tenant and
-- authorization explicitly (§4.6): the tenant is always derived from the row an
-- id names (a request, an entry, a release), and every other id a caller passes
-- (request ids, asset ids, a site id) must belong to that tenant, or the call
-- raises forbidden and changes nothing. A tenant id is a parameter only where no
-- other id determines it (worker_begin_release, worker_previous_release,
-- worker_sites).
--
-- Errors (decision 3): raise exception '<code>' using errcode = 'P0001', with
-- not_found (no such row) or forbidden (wrong state, wrong action, or an id of
-- another tenant). A parameter outside its documented values raises 22023
-- (invalid_parameter_value). The outcomes of a commit are not errors: they are
-- the request's final status, returned and recorded with an error object.
--
-- Also here (deferred Minors owned by Task 11):
--   entries.first_published_at is write-once (Task 6 security r1), so the slug
--   lock cannot be undone by clearing it; revisions.data carries the same JSON
--   object and 1 MB check as drafts.data (Task 7 security r3); the commit
--   validates the references of the data it copies, never draft_refs, which
--   editors can write (Task 7 security r1, Minor 1).

-- ---------------------------------------------------------------------------
-- Integrity additions.

-- first_published_at locks the slug (§4.3, entries_lock_slug). Once set it
-- never changes, for any writer: unpublish leaves it alone (§6.2), and nobody
-- can clear it to unlock the slug. An AFTER UPDATE row trigger on every UPDATE,
-- like the slug locks: it sees the final row whatever BEFORE triggers did. The
-- WHEN clause only avoids calling the function; the function re-checks.
create function private.entries_lock_first_published_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.first_published_at is not null and new.first_published_at is distinct from old.first_published_at then
    raise exception 'entries.first_published_at is write-once' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger entries_lock_first_published_at
  after update on cms.entries
  for each row
  when (old.first_published_at is not null and old.first_published_at is distinct from new.first_published_at)
  execute function private.entries_lock_first_published_at();

-- revisions.data: a JSON object of at most 1 MB, as drafts.data (§4.3). The
-- commit copies a draft, which already satisfies it.
alter table cms.revisions
  add constraint revisions_data_check
  check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1048576);

-- Plan decision 31 (Einar, 2026-11-02, "Grant one column"): a row lock needs
-- UPDATE privilege on at least one column of the table, and Task 6 gave
-- service_role SELECT only on drafts. This grant exists only so that
-- worker_commit_publish can lock the draft FOR UPDATE (§6.2 step 1); the worker
-- never updates drafts. updated_at is the column whose value the draft
-- triggers own anyway (drafts_bump_version sets it to now()).
grant update (updated_at) on cms.drafts to service_role;

-- ---------------------------------------------------------------------------
-- Claim (§6.1, §6.3): pending requests, and validating requests whose claim is
-- older than 5 minutes (a worker that died mid-request), oldest first, up to
-- p_limit. Each is moved to validating with a new claimed_at and one more
-- attempt. skip locked: requests another worker is claiming or committing are
-- left to it, so concurrent claims never return the same request.
create function api.worker_claim_requests(p_limit int default 10)
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
  with claimable as (
    select r.id
    from cms.publish_requests r
    where r.status = 'pending'
       or (r.status = 'validating' and r.claimed_at < pg_catalog.now() - interval '5 minutes')
    order by r.requested_at, r.id
    limit p_limit
    for update skip locked
  )
  update cms.publish_requests r
  set status = 'validating', claimed_at = pg_catalog.now(), attempts = r.attempts + 1
  from claimable c
  where r.id = c.id
  returning r.*;
end;
$$;

-- Everything the worker needs to validate and project a request, read in one
-- statement (one snapshot): the request, its entry, the entry's draft (data,
-- version, schema_version) and the draft's references with their targets'
-- state. The references are extracted from the draft's data, not read from
-- draft_refs (which editors can write), so they are exactly the ones the commit
-- will check. published: an entry target has a published revision, an asset
-- target has a public_path; archived: the target's archived_at is set.
create function api.worker_read_request(p_request_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  select pg_catalog.jsonb_build_object(
           'request', pg_catalog.to_jsonb(r),
           'entry', pg_catalog.to_jsonb(e),
           'draft', pg_catalog.jsonb_build_object('data', d.data, 'version', d.version,
                                                  'schema_version', d.schema_version),
           'refs', coalesce((
             select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                      'path', x.path, 'kind', x.kind, 'id', x.ref,
                      'published', case when x.kind = 'entry' then te.published_rev_id is not null
                                        else ta.public_path is not null end,
                      'archived', case when x.kind = 'entry' then te.archived_at is not null
                                       else ta.archived_at is not null end)
                    order by x.path)
             from private.extract_refs(d.data) as x
             left join cms.entries te on x.kind = 'entry' and te.tenant_id = r.tenant_id and te.id = x.ref
             left join cms.assets ta on x.kind = 'asset' and ta.tenant_id = r.tenant_id and ta.id = x.ref
           ), '[]'::jsonb))
    into v_result
  from cms.publish_requests r
  join cms.entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where r.id = p_request_id;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- The commit (§6.2 steps 1–8), in the caller's transaction. Returns the
-- request's final status: committed, superseded, failed_validation or
-- rejected. Only a validating publish request can be committed (forbidden
-- otherwise; not_found for no such request).
--
--   1. Locks the request, the entry and its draft FOR UPDATE, in that order
--      (the same order as worker_commit_unpublish; save_draft locks only the
--      draft). A save_draft in flight either commits first, so the version
--      check below sees it, or waits for this transaction.
--   2. superseded unless the draft's version is the requested version and the
--      version the worker validated.
--   3. failed_validation unless the draft's schema_version is the one the
--      worker validated against.
--   4. rejected unless the tenant is active and the requester still holds a
--      membership in it (read now, never cached).
--   5. Extracts the references from the draft's data, the data it is about to
--      copy (never from draft_refs), locks every referenced entry and asset FOR
--      SHARE in id order, then checks them in a new statement, which sees every
--      change committed before the locks were granted: an entry target must be
--      this entry or published and not archived (a release includes exactly
--      those, §7.1); an asset target must not be archived. Otherwise
--      failed_validation with the offending references. A concurrent unpublish
--      or archive of a target is serialised with the commit.
--   6. Inserts the revision by copying data, version and schema_version from
--      the locked cms.drafts row, never from a parameter; title and sort_at are
--      the worker's (§6.2). The revision trigger writes revision_refs from the
--      copied data, so they equal the draft's references at that version.
--   7. Moves the pointer: published_rev_id, published_draft_version,
--      first_published_at if null (locks the slug), last_published_at.
--   8. Sets the request committed with its revision_id. The audit event
--      (publish_request.<status>, actor: the requester) is written by the
--      publish_requests trigger, for every outcome.
create function api.worker_commit_publish(p_request_id uuid, p_validated_draft_version int,
                                          p_validated_schema_version int, p_title text, p_sort_at timestamptz)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request cms.publish_requests;
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

  -- Step 4.
  select t.status into v_tenant_status from cms.tenants t where t.id = v_request.tenant_id;
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

-- Unpublish (§6.2): the same request and entry locks and authorization checks
-- as the commit, then the pointer is cleared. Never refused because other
-- entries reference this one: withdrawal takes precedence, and releases resolve
-- such references to null (§7.1). first_published_at is kept (the slug stays
-- locked); last_published_at records the last publication. Unpublishing an
-- entry that is not published commits and changes nothing else.
create function api.worker_commit_unpublish(p_request_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request cms.publish_requests;
  v_tenant_status text;
begin
  select * into v_request from cms.publish_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_request.action <> 'unpublish' or v_request.status <> 'validating' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  perform 1 from cms.entries e
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id
  for update;

  select t.status into v_tenant_status from cms.tenants t where t.id = v_request.tenant_id;
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

  update cms.entries e
  set published_rev_id = null, published_draft_version = null
  where e.tenant_id = v_request.tenant_id and e.id = v_request.entry_id
    and (e.published_rev_id is not null or e.published_draft_version is not null);
  update cms.publish_requests r
  set status = 'committed', error = null
  where r.id = p_request_id;
  return 'committed';
end;
$$;

-- Ends a validating request the worker could not commit (§6.3):
-- failed_validation (strict validation or projection failed, with field
-- errors) or failed (an unexpected error). Any other status raises 22023; a
-- request that is not validating raises forbidden.
create function api.worker_reject_request(p_request_id uuid, p_status text, p_error jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_status is null or p_status not in ('failed_validation', 'failed') then
    raise exception 'p_status must be failed_validation or failed' using errcode = '22023';
  end if;
  select r.status into v_status from cms.publish_requests r where r.id = p_request_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'validating' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update cms.publish_requests r
  set status = p_status, error = p_error
  where r.id = p_request_id;
end;
$$;

-- Starts a release for a tenant (§7.1): number = the tenant's highest number
-- + 1, status building. Returns null if the tenant already has a building
-- release. The tenant row is locked FOR UPDATE first, so concurrent calls for
-- one tenant run one after the other: the second sees the first's release when
-- it gets the lock, and the partial unique index (releases_one_building_per_tenant)
-- refuses its insert, which is caught here. not_found for no such tenant.
create function api.worker_begin_release(p_tenant_id uuid)
returns cms.releases
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_release cms.releases;
  v_constraint text;
begin
  perform 1 from cms.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  begin
    insert into cms.releases (tenant_id, number, status)
    select p_tenant_id, coalesce(pg_catalog.max(rel.number), 0) + 1, 'building'
    from cms.releases rel
    where rel.tenant_id = p_tenant_id
    returning * into v_release;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'releases_one_building_per_tenant' then
      return null;
    end if;
    raise;
  end;
  return v_release;
end;
$$;

-- Everything a release build reads, in one statement, so one consistent
-- snapshot (§7.1). The tenant is the release's.
--   release   {id, tenant_id, number, status}
--   tenant    {id, slug}
--   entries   every entry of the tenant with published_rev_id not null and
--             archived_at null (withdrawal always wins: nothing else is
--             included), with its published revision: {entry_id, type, slug,
--             revision_id, schema_version, data, title, sort_at,
--             first_published_at, last_published_at, refs: [{path, kind, id}]}
--   assets    every asset those revisions reference, with archived status:
--             {id, original_path, filename, mime, width, height, focal_x,
--             focal_y, default_alt, public_path, archived}
--   requests  the tenant's committed requests not yet in a release:
--             {id, entry_id, action, revision_id}
-- Referenced entries are resolved by the worker from entries (a target that is
-- not there is no longer published and resolves to null, §6.2).
create function api.worker_release_snapshot(p_release_id uuid)
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
                      'id', pr.id, 'entry_id', pr.entry_id, 'action', pr.action, 'revision_id', pr.revision_id)
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

-- Ends a building release (§7.1): status delivered or failed (22023
-- otherwise), the bundle path and error; delivered_at when delivered. Only a
-- building release can be finished (forbidden otherwise). Everything else is
-- scoped to the release's tenant, and a call that names anything outside it
-- changes nothing and raises forbidden:
--   p_bundle_path        null, or exactly {tenant_slug}/releases/{number}.json (§5.6)
--   p_request_ids        the tenant's committed requests with no release yet;
--                        each gets release_id
--   p_public_assets      a JSON array of {"id": <asset uuid>, "public_path": <text>}
--                        (or null): the tenant's assets, each public_path
--                        exactly {tenant_slug}/{asset_id}/{filename} (§5.6).
--                        Public files never change, so a public_path already
--                        set stays as it is.
create function api.worker_finish_release(p_release_id uuid, p_status text, p_bundle_path text, p_error jsonb,
                                          p_request_ids uuid[], p_public_assets jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_release cms.releases;
  v_slug text;
  v_count int;
  v_given int;
begin
  if p_status is null or p_status not in ('delivered', 'failed') then
    raise exception 'p_status must be delivered or failed' using errcode = '22023';
  end if;
  if p_public_assets is not null and pg_catalog.jsonb_typeof(p_public_assets) <> 'array' then
    raise exception 'p_public_assets must be a JSON array' using errcode = '22023';
  end if;
  select * into v_release from cms.releases r where r.id = p_release_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_release.status <> 'building' then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select t.slug into v_slug from cms.tenants t where t.id = v_release.tenant_id;
  if p_bundle_path is not null
     and p_bundle_path is distinct from (v_slug || '/releases/' || v_release.number::text || '.json') then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Requests: every given id must be a committed request of this tenant that is
  -- in no release yet.
  if exists (select 1 from pg_catalog.unnest(p_request_ids) as u where u is null) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select pg_catalog.count(distinct u) into v_given from pg_catalog.unnest(p_request_ids) as u;
  update cms.publish_requests pr
  set release_id = v_release.id
  where pr.id = any (p_request_ids)
    and pr.tenant_id = v_release.tenant_id and pr.status = 'committed' and pr.release_id is null;
  get diagnostics v_count = row_count;
  if v_count <> v_given then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Assets: every element must name an asset of this tenant with its one
  -- public path.
  v_given := coalesce(pg_catalog.jsonb_array_length(p_public_assets), 0);
  select pg_catalog.count(*) into v_count
  from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)
  join cms.assets a
    on pg_catalog.jsonb_typeof(x.item) = 'object'
   and a.tenant_id = v_release.tenant_id
   and a.id::text = x.item ->> 'id'
   and (x.item ->> 'public_path') = (v_slug || '/' || a.id::text || '/' || a.filename);
  if v_count <> v_given
     or v_given <> (select pg_catalog.count(distinct x.item ->> 'id')
                    from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update cms.assets a
  set public_path = x.item ->> 'public_path'
  from pg_catalog.jsonb_array_elements(coalesce(p_public_assets, '[]'::jsonb)) as x (item)
  where a.tenant_id = v_release.tenant_id and a.id::text = x.item ->> 'id' and a.public_path is null;

  update cms.releases r
  set status = p_status,
      bundle_path = p_bundle_path,
      error = p_error,
      delivered_at = case when p_status = 'delivered' then pg_catalog.now() end
  where r.id = v_release.id;
end;
$$;

-- The tenant's latest delivered release (highest number), or null: the
-- previous release that live checks compare with (§7.4) and that stays in the
-- delivery bucket (§7.2).
create function api.worker_previous_release(p_tenant_id uuid)
returns cms.releases
language sql
stable
security invoker
set search_path = ''
as $$
  select r.*
  from cms.releases r
  where r.tenant_id = p_tenant_id and r.status = 'delivered'
  order by r.number desc
  limit 1
$$;

-- The tenant's active sites, with their webhook secrets read from Vault by
-- webhook_secret_ref (§8.2; A9). The secrets leave the database only through
-- this service_role-only function; cms.sites holds only the Vault id. An array,
-- because the SDK accepts two secrets during rotation (§8.2); in M1 a site has
-- one. A reference with no Vault secret gives an empty array.
create function api.worker_sites(p_tenant_id uuid)
returns table (id uuid, base_url text, revalidate_url text, webhook_secrets text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.base_url, s.revalidate_url,
         coalesce((select pg_catalog.array_agg(ds.decrypted_secret order by ds.id)
                   from vault.decrypted_secrets ds
                   where ds.id = s.webhook_secret_ref and ds.decrypted_secret is not null),
                  '{}'::text[])
  from cms.sites s
  where s.tenant_id = p_tenant_id and s.active
  order by s.id
$$;

-- Records a release's delivery to one site (§7.4), creating the row on first
-- use. The site must be one of the release's tenant's (forbidden otherwise;
-- not_found for no such release). A null status leaves that status unchanged.
-- Each call with a notify status other than pending counts one notify attempt;
-- notified_at and live_confirmed_at are set when the status becomes ok.
-- last_error is replaced by p_error.
create function api.worker_record_delivery(p_release_id uuid, p_site_id uuid, p_notify_status text,
                                           p_live_status text, p_error jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_attempt int := case when p_notify_status is not null and p_notify_status <> 'pending' then 1 else 0 end;
begin
  select r.tenant_id into v_tenant_id from cms.releases r where r.id = p_release_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cms.sites s where s.tenant_id = v_tenant_id and s.id = p_site_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  insert into cms.site_deliveries as sd (release_id, site_id, tenant_id, notify_status, notify_attempts, notified_at,
                                         live_status, live_confirmed_at, last_error)
  values (p_release_id, p_site_id, v_tenant_id, coalesce(p_notify_status, 'pending'), v_attempt,
          case when p_notify_status = 'ok' then pg_catalog.now() end,
          coalesce(p_live_status, 'pending'),
          case when p_live_status = 'ok' then pg_catalog.now() end,
          p_error)
  on conflict (release_id, site_id) do update
  set notify_status = coalesce(p_notify_status, sd.notify_status),
      notify_attempts = sd.notify_attempts + v_attempt,
      notified_at = case when p_notify_status = 'ok' then pg_catalog.now() else sd.notified_at end,
      live_status = coalesce(p_live_status, sd.live_status),
      live_confirmed_at = case when p_live_status = 'ok' then pg_catalog.now() else sd.live_confirmed_at end,
      last_error = p_error;
end;
$$;

grant execute on function
  api.worker_claim_requests(int),
  api.worker_read_request(uuid),
  api.worker_commit_publish(uuid, int, int, text, timestamptz),
  api.worker_commit_unpublish(uuid),
  api.worker_reject_request(uuid, text, jsonb),
  api.worker_begin_release(uuid),
  api.worker_release_snapshot(uuid),
  api.worker_finish_release(uuid, text, text, jsonb, uuid[], jsonb),
  api.worker_previous_release(uuid),
  api.worker_sites(uuid),
  api.worker_record_delivery(uuid, uuid, text, text, jsonb)
  to service_role;
