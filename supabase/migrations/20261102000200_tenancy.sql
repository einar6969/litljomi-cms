-- Tenancy: tenants, memberships, platform admins (spec §4.1 rules 3 and 7, §4.3,
-- §4.5; plan Task 5, decisions 2 and 3).
--
-- Grants are exactly those in §4.5: SELECT for authenticated (RLS restricts the
-- rows); service_role gets what the worker and CLI need. Nothing for anon. RLS is
-- enabled on every table. No SECURITY DEFINER anywhere: the policies below read
-- memberships and platform_admins under those tables' own-row policies.

create table cms.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

-- Single v1 role (§4.3).
create type cms.membership_role as enum ('editor');

-- A tenant table (§4.3): tenant_id not null. Its only foreign key to another
-- cms table points at tenants, which is not a tenant table (§4.1 rule 3).
-- created_by has no foreign key.
create table cms.memberships (
  tenant_id uuid not null references cms.tenants (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role cms.membership_role not null default 'editor',
  created_at timestamptz not null default now(),
  created_by uuid,
  primary key (tenant_id, user_id)
);

-- RLS lookups filter memberships by user (the primary key leads with tenant_id).
create index memberships_user_id_idx on cms.memberships (user_id);

-- user_id references auth.users without `on delete cascade` (memberships.user_id
-- cascades). Deleting a platform admin's auth user therefore fails until its row
-- here is removed.
create table cms.platform_admins (
  user_id uuid primary key references auth.users (id)
);

-- Tenant slugs are immutable once provisioned (§4.1 rule 7): they appear in
-- public storage paths and site configuration. Fires for every writer,
-- including service_role and the owner.
--
-- An AFTER UPDATE row trigger sees the final row, after every BEFORE UPDATE
-- trigger has run, so the lock does not depend on trigger name order (a BEFORE
-- trigger named after the lock could otherwise still change NEW.slug). It is on
-- every UPDATE, not `UPDATE OF slug` (which looks only at the SET list). The
-- WHEN clause only avoids calling the function; the function re-checks the
-- condition itself, so it stays correct if the WHEN clause is ever dropped.
create function private.tenants_lock_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'slug_locked' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger tenants_lock_slug
  after update on cms.tenants
  for each row
  when (old.slug is distinct from new.slug)
  execute function private.tenants_lock_slug();

-- RLS (§4.5).
alter table cms.tenants enable row level security;
alter table cms.memberships enable row level security;
alter table cms.platform_admins enable row level security;

-- memberships: a user sees only their own rows; no other access for authenticated.
create policy memberships_select_own on cms.memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

-- platform_admins: a user sees only their own row.
create policy platform_admins_select_own on cms.platform_admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- tenants: rows the user is a member of. The subquery runs under the
-- memberships policy above, which permits the user's own rows.
create policy tenants_select_member on cms.tenants
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = tenants.id
      and m.user_id = (select auth.uid())
  ));

-- tenants, console read: every tenant, for a platform admin at aal2 only.
create policy tenants_select_console on cms.tenants
  for select to authenticated
  using (
    (select auth.jwt() ->> 'aal') = 'aal2'
    and exists (
      select 1 from cms.platform_admins pa
      where pa.user_id = (select auth.uid())
    )
  );

-- Grants (§4.5). anon: none.
grant select on cms.tenants, cms.memberships, cms.platform_admins to authenticated;
grant select, insert, update on cms.tenants to service_role;
grant select, insert, delete on cms.memberships, cms.platform_admins to service_role;
