-- Publish requests, releases, sites, site deliveries (spec §4.1 rule 3, §4.3,
-- §4.5, §6.1–6.3, §7.1, §8.2; plan Task 9, decisions 3, 10, 11 and 12).
--
-- All four are tenant tables (§4.3): tenant_id not null, and every foreign key
-- between them and the other tenant tables is composite with tenant_id, so a
-- cross-tenant reference cannot exist (§4.1 rule 3). Grants for authenticated
-- are exactly those in §4.5, per column where it says so; nothing for anon.
-- RLS is enabled on every table, with the tenant membership policy for each
-- command granted to authenticated, plus the console SELECT policies of §4.5
-- (platform_admins membership and aal2). No SECURITY DEFINER anywhere, and no
-- new function: the actor triggers are Task 6's invoker functions in private.

-- Releases (§7.1): one bundle per release, per tenant; numbers unique per
-- tenant; at most one building release per tenant (partial unique index below).
create table cms.releases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references cms.tenants (id),
  number int not null,
  status text not null check (status in ('building', 'delivered', 'failed')),
  bundle_path text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  error jsonb,
  unique (tenant_id, number),
  -- Target of the composite foreign keys from publish_requests and site_deliveries.
  unique (tenant_id, id)
);

-- Serialized per tenant (§7.1): a second building release violates this
-- (23505), which worker_begin_release (Task 11) catches.
create unique index releases_one_building_per_tenant on cms.releases (tenant_id)
  where status = 'building';

-- Publish requests (§4.3, §6.3): editors insert and read; only the worker
-- updates. requested_by is forced to auth.uid() (decision 11, triggers below);
-- status, claimed_at, attempts, error, revision_id and release_id are
-- worker-owned (no editor grant).
create table cms.publish_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entry_id uuid not null,
  action text not null check (action in ('publish', 'unpublish')),
  draft_version int,
  requested_by uuid not null default auth.uid(),
  requested_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'validating', 'committed', 'failed_validation', 'superseded', 'rejected', 'failed')),
  claimed_at timestamptz,
  attempts int not null default 0,
  error jsonb,
  revision_id uuid,
  release_id uuid,
  foreign key (tenant_id, entry_id) references cms.entries (tenant_id, id),
  -- The committed revision is a revision of this request's entry and tenant;
  -- the release is one of this tenant's. MATCH SIMPLE: null is not checked.
  foreign key (tenant_id, entry_id, revision_id) references cms.revisions (tenant_id, entry_id, id),
  foreign key (tenant_id, release_id) references cms.releases (tenant_id, id)
);

-- The worker claims by status in request order (Task 11, worker_claim_requests).
create index publish_requests_status_requested_at_idx on cms.publish_requests (status, requested_at);
-- The latest request per entry (Task 10, api.publication_status) and the
-- entry foreign key.
create index publish_requests_tenant_entry_idx on cms.publish_requests (tenant_id, entry_id, requested_at);

-- Sites (§4.3, §8.2): secrets live in Vault; the table holds only their IDs,
-- which authenticated can never read (column grant below).
create table cms.sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references cms.tenants (id),
  base_url text not null,
  revalidate_url text not null,
  preview_url text,
  webhook_secret_ref uuid not null,
  preview_secret_ref uuid,
  active boolean not null default true,
  -- Target of the composite foreign key from site_deliveries.
  unique (tenant_id, id)
);

-- Per-site delivery of a release (§7.4). The release and the site belong to the
-- row's tenant (composite foreign keys).
create table cms.site_deliveries (
  release_id uuid not null,
  site_id uuid not null,
  tenant_id uuid not null,
  notify_status text not null default 'pending',
  notify_attempts int not null default 0,
  notified_at timestamptz,
  live_status text not null default 'pending',
  live_confirmed_at timestamptz,
  last_error jsonb,
  primary key (release_id, site_id),
  foreign key (tenant_id, release_id) references cms.releases (tenant_id, id),
  foreign key (tenant_id, site_id) references cms.sites (tenant_id, id)
);

-- Actor column cannot be spoofed (decision 11): force_actor rewrites
-- requested_by with auth.uid() whenever it is not null; check_actor refuses a
-- final row where a later BEFORE trigger changed it. requested_by is not
-- updatable by any API role, so insert only (as assets.created_by). The worker
-- re-checks this requester's membership at commit (§6.2 step 4).
create trigger publish_requests_force_actor
  before insert on cms.publish_requests
  for each row
  execute function private.force_actor('requested_by');

create trigger publish_requests_check_actor
  after insert on cms.publish_requests
  for each row
  execute function private.check_actor('requested_by');

-- RLS (§4.5): access requires a membership in the row's tenant. The subquery runs
-- under the memberships policy, which permits the user's own rows.
-- Keep every membership predicate below identical (and identical to those of the
-- other tenant tables): a change to one copy is a change to tenant isolation.
-- Likewise keep every console predicate identical to tenants_select_console.
alter table cms.publish_requests enable row level security;
alter table cms.releases enable row level security;
alter table cms.sites enable row level security;
alter table cms.site_deliveries enable row level security;

create policy publish_requests_select_member on cms.publish_requests
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = publish_requests.tenant_id and m.user_id = (select auth.uid())
  ));

create policy publish_requests_insert_member on cms.publish_requests
  for insert to authenticated
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = publish_requests.tenant_id and m.user_id = (select auth.uid())
  ));

create policy releases_select_member on cms.releases
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = releases.tenant_id and m.user_id = (select auth.uid())
  ));

create policy sites_select_member on cms.sites
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = sites.tenant_id and m.user_id = (select auth.uid())
  ));

create policy site_deliveries_select_member on cms.site_deliveries
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = site_deliveries.tenant_id and m.user_id = (select auth.uid())
  ));

-- Console reads (§4.5): every tenant's rows, SELECT only, for a platform admin
-- at aal2. sites is still limited to its non-secret columns by the column grant.
create policy publish_requests_select_console on cms.publish_requests
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

create policy releases_select_console on cms.releases
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

create policy sites_select_console on cms.sites
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

create policy site_deliveries_select_console on cms.site_deliveries
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

-- Grants for authenticated (§4.5). INSERT on publish_requests is per column, so
-- editors never set status, revision_id, release_id or the worker's claim
-- columns. sites: SELECT on the non-secret columns only; webhook_secret_ref,
-- preview_secret_ref and revalidate_url are never readable. anon: none.
grant select on cms.publish_requests, cms.releases, cms.site_deliveries to authenticated;
grant insert (tenant_id, entry_id, action, draft_version, requested_by) on cms.publish_requests to authenticated;
grant select (id, tenant_id, base_url, preview_url, active) on cms.sites to authenticated;

-- service_role: what Task 11's worker and admin functions need, nothing more.
--   publish_requests  read; update the worker-owned columns (claim, status,
--                     error, revision_id, release_id). Editors create requests;
--                     no insert, no delete.
--   releases          read; insert (worker_begin_release); update status,
--                     bundle_path, delivered_at, error (worker_finish_release).
--                     number and tenant_id never change; no delete.
--   sites             read every column (worker_sites reads webhook_secret_ref
--                     to look up Vault); insert (admin_create_site). No update
--                     or delete in M1.
--   site_deliveries   read; insert and update the status columns
--                     (worker_record_delivery). No delete.
grant select on cms.publish_requests, cms.releases, cms.sites, cms.site_deliveries to service_role;
grant update (status, claimed_at, attempts, error, revision_id, release_id) on cms.publish_requests to service_role;
grant insert on cms.releases to service_role;
grant update (status, bundle_path, delivered_at, error) on cms.releases to service_role;
grant insert on cms.sites to service_role;
grant insert on cms.site_deliveries to service_role;
grant update (notify_status, notify_attempts, notified_at, live_status, live_confirmed_at, last_error)
  on cms.site_deliveries to service_role;
