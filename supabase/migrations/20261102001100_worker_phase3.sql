-- The worker's Phase 3 additions (spec §4.3, §4.5, §4.6, §4.7, §6.1–6.3,
-- §8.1; plan Task 19, decisions 10, 12, 31, 33 and 34).
--
--   1. Decision 33: service_role's UPDATE on cms.tenants is narrowed to
--      (name, status), and both commit functions lock the tenant row FOR SHARE
--      before re-checking its status.
--   2. Decision 34.1: a 10 s statement_timeout for service_role, applied by
--      PostgREST to every request made with the secret key.
--   3. Decision 34.2: api.worker_claim_request, api.worker_read_request
--      extended with the tenant and the references' targets, and
--      api.worker_record_alert.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified
-- names; EXECUTE is granted to service_role only (PUBLIC has none through
-- Task 4's global default privileges; anon and authenticated get none). Errors
-- follow decision 3 (P0001 not_found / forbidden; 22023 for a parameter
-- outside its documented values).

-- ---------------------------------------------------------------------------
-- 1. Decision 33 (Einar, 2026-11-02). service_role kept table-level UPDATE on
-- cms.tenants from Task 5, so it could change tenants.id, the storage-path
-- prefix (Task 5 security r1, Minor 2). The CLI and the worker need only name
-- and status (suspension), and UPDATE on one column is also what lets the
-- commit functions below take a row lock on the tenant (decision 31's rule).
-- The slug stays locked by tenants_lock_slug for every writer, the owner
-- included; service_role now cannot even name it in an UPDATE (42501).
revoke update on cms.tenants from service_role;
grant update (name, status) on cms.tenants to service_role;

-- ---------------------------------------------------------------------------
-- 2. Decision 34.1 (Einar, 2026-11-02): a statement_timeout on the role, not
-- on a connection of the worker's own. PostgREST applies the settings of the
-- role it impersonates (the JWT's role claim, here service_role) at the start
-- of every request's transaction, after the authenticator login role's own
-- settings (statement_timeout 8s and lock_timeout 8s on the local stack), so
-- every call made with the secret key runs with 10 s. Statements run directly
-- as service_role on a database connection (SET ROLE in pgTAP and the
-- integration tests' pgAs) do not apply role settings and are unaffected.
-- A role setting is cluster-wide (pg_db_role_setting, no database). The
-- notification makes PostgREST re-read role settings without a restart; it is
-- delivered when this migration commits. tests/integration proves the timeout
-- over the REST API (service-role-timeout.test.ts).
alter role service_role set statement_timeout = '10s';
notify pgrst, 'reload config';

-- ---------------------------------------------------------------------------
-- 3a. Claim one request by id (decision 34.2, decision 35's processRequestById):
-- the claim rule of worker_claim_requests for a single request. A pending
-- request, or a validating one whose claim is older than 5 minutes (a worker
-- that died mid-request), moves to validating with a new claimed_at and one
-- more attempt. skip locked: a request another worker is claiming or
-- committing is left to it. Returns the claimed row, or a row of nulls when
-- the request does not exist or is not claimable (callers test id is null).
create function api.worker_claim_request(p_request_id uuid)
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
  set status = 'validating', claimed_at = pg_catalog.now(), attempts = r.attempts + 1
  from claimable c
  where r.id = c.id
  returning r.* into v_request;
  return v_request;
end;
$$;

-- 3b. Everything the worker needs to validate and project a request, read in
-- one statement (one snapshot). Replaces Task 11's version, adding:
--   tenant   {id, slug, status} of the request's tenant
--   refs[]   per reference, its target's metadata for the pre-commit
--            projection (decision 35, shared with the release build):
--              entry: type, slug, title (the published revision's title, null
--                     when not published)
--              asset: filename, mime, width, height, focal_x, focal_y,
--                     default_alt, public_path
--            all null when the target does not exist in the request's tenant.
-- Everything else is unchanged: request and entry are the rows; draft is
-- {data, version, schema_version}; the references are extracted from the
-- draft's data, never read from draft_refs (which editors can write), so they
-- are exactly the ones the commit will check; published: an entry target has a
-- published revision, an asset target a public_path; archived: the target's
-- archived_at is set. Targets are looked up in the request's tenant only.
create or replace function api.worker_read_request(p_request_id uuid)
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
           'tenant', pg_catalog.jsonb_build_object('id', t.id, 'slug', t.slug, 'status', t.status),
           'draft', pg_catalog.jsonb_build_object('data', d.data, 'version', d.version,
                                                  'schema_version', d.schema_version),
           'refs', coalesce((
             select pg_catalog.jsonb_agg(
                      pg_catalog.jsonb_build_object(
                        'path', x.path, 'kind', x.kind, 'id', x.ref,
                        'published', case when x.kind = 'entry' then te.published_rev_id is not null
                                          else ta.public_path is not null end,
                        'archived', case when x.kind = 'entry' then te.archived_at is not null
                                         else ta.archived_at is not null end)
                      || case when x.kind = 'entry' then
                           pg_catalog.jsonb_build_object('type', te.type, 'slug', te.slug, 'title', tr.title)
                         else
                           pg_catalog.jsonb_build_object('filename', ta.filename, 'mime', ta.mime,
                                                         'width', ta.width, 'height', ta.height,
                                                         'focal_x', ta.focal_x, 'focal_y', ta.focal_y,
                                                         'default_alt', ta.default_alt,
                                                         'public_path', ta.public_path)
                         end
                    order by x.path)
             from private.extract_refs(d.data) as x
             left join cms.entries te on x.kind = 'entry' and te.tenant_id = r.tenant_id and te.id = x.ref
             left join cms.revisions tr on tr.tenant_id = te.tenant_id and tr.entry_id = te.id
                                       and tr.id = te.published_rev_id
             left join cms.assets ta on x.kind = 'asset' and ta.tenant_id = r.tenant_id and ta.id = x.ref
           ), '[]'::jsonb))
    into v_result
  from cms.publish_requests r
  join cms.tenants t on t.id = r.tenant_id
  join cms.entries e on e.tenant_id = r.tenant_id and e.id = r.entry_id
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where r.id = p_request_id;
  if v_result is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return v_result;
end;
$$;

-- 3c. Alerts (decisions 10 and 12): the worker's alert() writes each one to the
-- audit log as the system event system.alert.<event>, with a null actor (no
-- requester; audit_force_actor keeps it null because auth.uid() is null for
-- the secret key) and the database clock. Inputs:
--   p_tenant_id  the tenant the alert concerns, or null for a platform alert;
--                a tenant that does not exist is not_found (P0001)
--   p_event      a dotted lowercase name, e.g. publish_request.failed or
--                release.entry_omitted: segments of [a-z0-9_] starting with a
--                letter, joined by '.', at most 100 characters (22023
--                otherwise), so the action is always a well-formed name
--   p_details    a JSON object or null, at most 64 KB as text (22023
--                otherwise): an alert is a pointer to a problem, not a dump
-- target_type is 'alert' and target_id null; what the alert concerns is in
-- details.
create function api.worker_record_alert(p_tenant_id uuid, p_event text, p_details jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_event is null or pg_catalog.length(p_event) > 100
     or p_event !~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$' then
    raise exception 'p_event must be a dotted lowercase name of at most 100 characters' using errcode = '22023';
  end if;
  if p_details is not null
     and (pg_catalog.jsonb_typeof(p_details) <> 'object' or pg_catalog.octet_length(p_details::text) > 65536) then
    raise exception 'p_details must be a JSON object of at most 64 KB' using errcode = '22023';
  end if;
  if p_tenant_id is not null and not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
  values (p_tenant_id, null, 'system.alert.' || p_event, 'alert', null, p_details);
end;
$$;

-- ---------------------------------------------------------------------------
-- 1 (continued). The commit functions, unchanged from Task 11 except step 4:
-- the tenant row is now locked FOR SHARE before its status is read (decision
-- 33), after the request, entry and draft locks (the same order in both
-- functions). A concurrent suspension (UPDATE of tenants.status) therefore
-- waits for an in-flight commit, and a commit that starts after a suspension
-- committed sees it and is rejected; the two are serialised.
--
-- Accepted race (decision 33, Einar 2026-11-02): the requester's membership is
-- read, not locked, and service_role has no grant on cms.memberships beyond
-- SELECT, INSERT and DELETE. A revocation that commits while a commit is
-- between its membership check and its own commit (milliseconds) does not stop
-- that publish. Under the threat model (editors are trusted staff of paying
-- clients) this is accepted and documented, not locked against.
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

  -- Step 4. The same re-check as in worker_commit_unpublish: keep identical.
  -- The tenant row is locked FOR SHARE (decision 33); the membership is read
  -- unlocked (the accepted race above).
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

create or replace function api.worker_commit_unpublish(p_request_id uuid)
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

grant execute on function
  api.worker_claim_request(uuid),
  api.worker_record_alert(uuid, text, jsonb)
  to service_role;
