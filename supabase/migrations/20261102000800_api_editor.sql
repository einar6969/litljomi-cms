-- The editor's api: functions and views (spec §4.1 rule 4, §4.2, §4.3, §4.5,
-- §4.6, §5.5, §5.6, §6.1; plan Task 10, decisions 3, 11 and 30).
--
-- Every editor write goes through one of these functions (§4.1 rule 4). All are
-- SECURITY INVOKER with search_path = '' and schema-qualified names, so they run
-- as the editor under RLS and the column grants of §4.5: they can do nothing the
-- editor could not do on the tables directly, and they derive the tenant from
-- the row whenever an entry or asset id determines it (§4.5). No SECURITY
-- DEFINER anywhere. EXECUTE is granted to authenticated only (PUBLIC has none
-- through Task 4's global default privileges; anon and service_role get none).
-- The views are security_invoker, so RLS and the column grants apply to the
-- caller; SELECT is granted to authenticated only.
--
-- Errors (decision 3): raise exception '<code>' using errcode = 'P0001', with
-- one of version_conflict, not_found, slug_locked, slug_taken, forbidden,
-- invalid_reference, published_reference, tenant_inactive. The triggers' own
-- errors (slug_locked, invalid_reference, the 23xxx integrity errors, 54000 and
-- 22P02 from reference extraction) pass through unchanged.
--
-- No function lets the caller choose entries.id or drafts.entry_id: create_entry
-- takes the generated id, and save_draft only updates an existing draft (Task 6
-- security r1). assets.id is chosen by the uploading client (§4.3); its
-- collision with another tenant's id is an accepted known limitation
-- (decision 30) and keeps its 23505.

-- An entry and its empty draft (§4.6). The tenant is a parameter here because no
-- id determines it; the caller must be a member (not_found otherwise, as for a
-- tenant that does not exist). A duplicate live slug of the same type gives
-- slug_taken.
create function api.create_entry(p_tenant_id uuid, p_type text, p_slug text default null, p_schema_version int default 1)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  begin
    insert into cms.entries (tenant_id, type, slug)
    values (p_tenant_id, p_type, p_slug)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'entries_tenant_type_slug_key' then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
    -- Deliberate pass-through: any other unique violation keeps its 23505.
    raise;
  end;
  insert into cms.drafts (entry_id, tenant_id, schema_version)
  values (v_id, p_tenant_id, p_schema_version);
  return v_id;
end;
$$;

-- Autosave (§5.5): updates the draft only if its version is still the one the
-- editor last saw, and returns the new version (the trigger adds exactly 1).
-- The update's WHERE is the version check, so it is atomic: a concurrent save
-- or worker commit holding the row makes this one wait and then re-check the
-- version. A draft the caller cannot see (another tenant's, or none) is
-- not_found; a visible draft at another version is version_conflict.
create function api.save_draft(p_entry_id uuid, p_expected_version int, p_data jsonb, p_schema_version int,
                               p_title text, p_sort_at timestamptz)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version int;
begin
  update cms.drafts d
  set data = p_data, schema_version = p_schema_version, title = p_title, sort_at = p_sort_at
  where d.entry_id = p_entry_id and d.version = p_expected_version
  returning d.version into v_version;
  if found then
    return v_version;
  end if;
  if exists (select 1 from cms.drafts d where d.entry_id = p_entry_id) then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  raise exception 'not_found' using errcode = 'P0001';
end;
$$;

-- Changes the slug before first publish (§4.6). The entry row is locked and
-- checked first, so a published entry gives slug_locked even when the new slug
-- is also taken; entries_lock_slug enforces the same rule for every writer.
create function api.set_slug(p_entry_id uuid, p_slug text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_first_published_at timestamptz;
  v_constraint text;
begin
  select e.first_published_at into v_first_published_at
  from cms.entries e
  where e.id = p_entry_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_first_published_at is not null then
    raise exception 'slug_locked' using errcode = 'P0001';
  end if;
  begin
    update cms.entries e set slug = p_slug where e.id = p_entry_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'entries_tenant_type_slug_key' then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
    -- Deliberate pass-through: any other unique violation keeps its 23505.
    raise;
  end;
end;
$$;

-- Archives an entry that is not published (§4.6): forbidden while it has a
-- published revision. The row lock serialises this with the worker's commit,
-- which locks the entry FOR UPDATE (§6.2). Archiving an archived entry changes
-- nothing.
create function api.archive_entry(p_entry_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_published_rev_id uuid;
  v_archived_at timestamptz;
begin
  select e.published_rev_id, e.archived_at into v_published_rev_id, v_archived_at
  from cms.entries e
  where e.id = p_entry_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_published_rev_id is not null then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if v_archived_at is null then
    update cms.entries e set archived_at = pg_catalog.now() where e.id = p_entry_id;
  end if;
end;
$$;

-- Records an uploaded original (§4.6, §5.6). The caller must be a member of
-- p_tenant_id (not_found otherwise). The path must be exactly
-- {tenant_id}/{asset_id}/{filename}, with the tenant and asset ids in their
-- canonical text form and filename a single non-empty segment that is not '.'
-- or '..' (forbidden otherwise; Task 8 security r1, Minor 2). The worker builds
-- the public path from the same filename (§5.6). The row's constraints check
-- MIME type, size and digest (23514).
create function api.register_asset(p_asset_id uuid, p_tenant_id uuid, p_original_path text, p_filename text,
                                   p_mime text, p_bytes bigint, p_width int, p_height int, p_sha256 text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not exists (
    select 1 from cms.memberships m
    where m.tenant_id = p_tenant_id and m.user_id = (select auth.uid())
  ) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_asset_id is null or p_filename is null or p_filename in ('', '.', '..')
     or pg_catalog.strpos(p_filename, '/') > 0
     or p_original_path is distinct from (p_tenant_id::text || '/' || p_asset_id::text || '/' || p_filename) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256)
  values (p_asset_id, p_tenant_id, p_original_path, p_filename, p_mime, p_bytes, p_width, p_height, p_sha256)
  returning id into v_id;
  return v_id;
end;
$$;

-- Edits an asset's focal point and default alt text (§4.6, §5.6). The tenant
-- comes from the row.
create function api.update_asset(p_asset_id uuid, p_focal_x real, p_focal_y real, p_default_alt text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update cms.assets a
  set focal_x = p_focal_x, focal_y = p_focal_y, default_alt = p_default_alt
  where a.id = p_asset_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Archives an asset (§4.6, §5.6): refused with published_reference while any
-- revision that an entry's published_rev_id currently points to references it.
-- The asset row is locked FOR UPDATE first: the worker's commit locks every
-- referenced asset FOR SHARE (§6.2), so a commit referencing this asset either
-- finishes first (and the check below, a new statement, sees its revision) or
-- waits and then finds the asset archived. Archiving an archived asset changes
-- nothing.
create function api.archive_asset(p_asset_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_archived_at timestamptz;
begin
  select a.tenant_id, a.archived_at into v_tenant_id, v_archived_at
  from cms.assets a
  where a.id = p_asset_id
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if exists (
    select 1
    from cms.revision_refs rr
    join cms.entries e on e.tenant_id = rr.tenant_id and e.published_rev_id = rr.revision_id
    where rr.tenant_id = v_tenant_id and rr.target_asset_id = p_asset_id
  ) then
    raise exception 'published_reference' using errcode = 'P0001';
  end if;
  if v_archived_at is null then
    update cms.assets a set archived_at = pg_catalog.now() where a.id = p_asset_id;
  end if;
end;
$$;

-- Requests publication of the draft version the editor last saw (§6.1). The
-- tenant comes from the entry. tenant_inactive unless the tenant is visible and
-- active (fail closed: a tenant row the caller cannot see counts as inactive);
-- version_conflict if the draft has already moved on (a null expected version
-- included). The worker re-checks both at commit (§6.2); these checks only give
-- the editor an early answer.
create function api.request_publish(p_entry_id uuid, p_expected_draft_version int)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_version int;
  v_id uuid;
begin
  select e.tenant_id, d.version into v_tenant_id, v_version
  from cms.entries e
  join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id
  where e.id = p_entry_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not exists (select 1 from cms.tenants t where t.id = v_tenant_id and t.status = 'active') then
    raise exception 'tenant_inactive' using errcode = 'P0001';
  end if;
  if p_expected_draft_version is distinct from v_version then
    raise exception 'version_conflict' using errcode = 'P0001';
  end if;
  insert into cms.publish_requests (tenant_id, entry_id, action, draft_version)
  values (v_tenant_id, p_entry_id, 'publish', p_expected_draft_version)
  returning id into v_id;
  return v_id;
end;
$$;

-- Requests withdrawal of an entry (§6.1, §6.2). The tenant comes from the entry.
-- The worker applies the authorization checks at commit; unpublishing is never
-- refused because of references.
create function api.request_unpublish(p_entry_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_id uuid;
begin
  select e.tenant_id into v_tenant_id
  from cms.entries e
  where e.id = p_entry_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into cms.publish_requests (tenant_id, entry_id, action)
  values (v_tenant_id, p_entry_id, 'unpublish')
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function
  api.create_entry(uuid, text, text, int),
  api.save_draft(uuid, int, jsonb, int, text, timestamptz),
  api.set_slug(uuid, text),
  api.archive_entry(uuid),
  api.register_asset(uuid, uuid, text, text, text, bigint, int, int, text),
  api.update_asset(uuid, real, real, text),
  api.archive_asset(uuid),
  api.request_publish(uuid, int),
  api.request_unpublish(uuid)
  to authenticated;

-- Views. Content tables have no platform-admin clause (§4.5), so entry_list,
-- entry_detail and asset_list show exactly the caller's tenants through RLS.
-- tenants, publish_requests, releases, sites and site_deliveries also carry the
-- console policies, so my_tenants, publication_status and tenant_sites filter
-- by the caller's own memberships as well: they are the editor's views and must
-- never widen to the console rows. A platform admin at aal2 sees there only the
-- tenants they are a member of (no implicit content access, §4.5); console
-- reads are a separate surface.

create view api.my_tenants with (security_invoker = true) as
select t.id, t.slug, t.name, t.status
from cms.tenants t
where exists (
  select 1 from cms.memberships m
  where m.tenant_id = t.id and m.user_id = (select auth.uid())
);

-- status is derived exactly as the table in §4.3, never stored. entry_detail
-- derives it with the same expression; keep the two identical.
create view api.entry_list with (security_invoker = true) as
select e.id, e.tenant_id, e.type, e.slug, d.title, d.sort_at, d.version as draft_version,
       e.published_draft_version,
       case
         when e.archived_at is not null then 'archived'
         when e.published_rev_id is null then 'draft'
         when d.version = e.published_draft_version then 'published'
         when d.version > e.published_draft_version then 'changed'
       end as status,
       e.archived_at, d.updated_at
from cms.entries e
join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id;

create view api.entry_detail with (security_invoker = true) as
select e.id, e.tenant_id, e.type, e.slug, d.data, d.schema_version, d.version as draft_version,
       e.published_draft_version, e.first_published_at,
       case
         when e.archived_at is not null then 'archived'
         when e.published_rev_id is null then 'draft'
         when d.version = e.published_draft_version then 'published'
         when d.version > e.published_draft_version then 'changed'
       end as status
from cms.entries e
join cms.drafts d on d.tenant_id = e.tenant_id and d.entry_id = e.id;

create view api.asset_list with (security_invoker = true) as
select a.id, a.tenant_id, a.filename, a.mime, a.width, a.height, a.focal_x, a.focal_y, a.default_alt,
       a.original_path, a.archived_at
from cms.assets a;

-- The latest request per entry (by requested_at, then id), joined to its
-- release and to that release's delivery to each site: one row per site, or one
-- row with null release and delivery columns before the release exists.
create view api.publication_status with (security_invoker = true) as
select r.id as request_id, r.tenant_id, r.entry_id, r.action, r.status, r.error, r.requested_at,
       rel.number as release_number, rel.status as release_status,
       sd.notify_status, sd.live_status, sd.live_confirmed_at
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
left join cms.site_deliveries sd on sd.tenant_id = r.tenant_id and sd.release_id = r.release_id;

-- The non-secret columns of the caller's sites (§4.5): never revalidate_url or
-- the secret references, which authenticated cannot read in any case.
create view api.tenant_sites with (security_invoker = true) as
select s.id, s.tenant_id, s.base_url, s.preview_url, s.active
from cms.sites s
where exists (
  select 1 from cms.memberships m
  where m.tenant_id = s.tenant_id and m.user_id = (select auth.uid())
);

revoke all on api.my_tenants, api.entry_list, api.entry_detail, api.asset_list, api.publication_status,
  api.tenant_sites from public, anon, service_role;
grant select on api.my_tenants, api.entry_list, api.entry_detail, api.asset_list, api.publication_status,
  api.tenant_sites to authenticated;
