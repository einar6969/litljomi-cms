-- Entries, drafts, revisions (spec §4.1 rules 3 and 5, §4.3, §4.5, §5.5; plan
-- Task 6, decisions 2, 3, 11 and 17).
--
-- All three are tenant tables (§4.3): tenant_id not null, and every foreign key
-- between them is composite with tenant_id, so a cross-tenant reference cannot
-- exist (§4.1 rule 3). Grants are exactly those in §4.5, per column where it
-- says so; nothing for anon. RLS is enabled on every table, with the tenant
-- membership policy for each command that is granted to authenticated. No
-- platform-admin clause on content tables (§4.5). No SECURITY DEFINER anywhere:
-- trigger functions live in private, run as the invoking role, and are granted
-- to no API role (triggers fire without an EXECUTE check).

create table cms.entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references cms.tenants (id),
  type text not null,
  slug text check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  published_rev_id uuid,
  published_draft_version int,
  first_published_at timestamptz,
  last_published_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  archived_at timestamptz,
  -- Target of the composite foreign keys from drafts and revisions.
  unique (tenant_id, id)
);

-- A slug is unique per tenant and type among live entries; an archived entry's
-- slug is free again (§4.3).
create unique index entries_tenant_type_slug_key on cms.entries (tenant_id, type, slug)
  where slug is not null and archived_at is null;

-- One mutable draft per entry (§5.5). data is a JSON object of at most 1 MB (§4.3).
create table cms.drafts (
  entry_id uuid primary key,
  tenant_id uuid not null,
  schema_version int not null,
  data jsonb not null default '{}',
  title text,
  sort_at timestamptz,
  version int not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  foreign key (tenant_id, entry_id) references cms.entries (tenant_id, id),
  check (jsonb_typeof(data) = 'object' and octet_length(data::text) <= 1048576)
);

-- Published history, append-only (§4.3): no UPDATE or DELETE for anon,
-- authenticated or service_role; only the table owner (migrations) keeps them.
create table cms.revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  entry_id uuid not null,
  draft_version int not null,
  schema_version int not null,
  data jsonb not null,
  title text,
  sort_at timestamptz,
  requested_by uuid not null,
  committed_at timestamptz not null default now(),
  -- Target of the publish pointer's composite foreign key.
  unique (tenant_id, entry_id, id),
  foreign key (tenant_id, entry_id) references cms.entries (tenant_id, id)
);

-- The publish pointer must name a revision of the same entry and tenant (§4.3).
-- MATCH SIMPLE (the default): a null published_rev_id is not checked.
alter table cms.entries
  add constraint entries_published_rev_fkey
  foreign key (tenant_id, id, published_rev_id) references cms.revisions (tenant_id, entry_id, id);

-- Draft version (§4.3): increments by exactly 1 on every update, whatever the
-- writer sets, so data cannot change without it. updated_at is the database clock.
create function private.drafts_bump_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger drafts_bump_version
  before update on cms.drafts
  for each row
  execute function private.drafts_bump_version();

-- The bump above is a BEFORE trigger, so a BEFORE trigger whose name sorts after
-- it could still change NEW.version. This AFTER UPDATE row trigger sees the
-- final row and refuses anything but old.version + 1, whatever the trigger
-- order and whoever writes.
create function private.drafts_check_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.version is distinct from old.version + 1 then
    raise exception 'drafts.version must increase by exactly 1' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger drafts_check_version
  after update on cms.drafts
  for each row
  execute function private.drafts_check_version();

-- Entry slugs are immutable once first_published_at is set (§4.3; decision 3's
-- slug_locked). Like tenants_lock_slug, an AFTER UPDATE row trigger on every
-- UPDATE: it sees the final row after every BEFORE UPDATE trigger has run, so it
-- does not depend on trigger name order. The WHEN clause only avoids calling the
-- function; the function re-checks the condition itself.
create function private.entries_lock_slug()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.first_published_at is not null and new.slug is distinct from old.slug then
    raise exception 'slug_locked' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger entries_lock_slug
  after update on cms.entries
  for each row
  when (old.first_published_at is not null and old.slug is distinct from new.slug)
  execute function private.entries_lock_slug();

-- Actor columns cannot be spoofed (decision 11): the column named by the trigger
-- argument is overwritten with auth.uid() whenever auth.uid() is not null. In
-- owner context and for the service role (no sub claim) auth.uid() is null and
-- the written value is kept (decisions 12 and 17). Tasks 8 and 9 attach it, and
-- private.check_actor below, to assets.created_by and publish_requests.requested_by.
create function private.force_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  -- A missing or misspelt column name would otherwise be ignored silently. The
  -- catalog lookup avoids serialising the whole row (drafts.data is up to 1 MB).
  if tg_nargs <> 1 or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = tg_relid and a.attname = tg_argv[0] and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'private.force_actor: the trigger argument must name a column of %.%',
      tg_table_schema, tg_table_name;
  end if;
  if v_uid is not null then
    new := pg_catalog.jsonb_populate_record(new, pg_catalog.jsonb_build_object(tg_argv[0], v_uid));
  end if;
  return new;
end;
$$;

create trigger entries_force_actor
  before insert on cms.entries
  for each row
  execute function private.force_actor('created_by');

create trigger drafts_force_actor
  before insert or update on cms.drafts
  for each row
  execute function private.force_actor('updated_by');

-- force_actor is a BEFORE trigger, so a BEFORE trigger whose name sorts after it
-- could still rewrite the actor column. This AFTER row trigger sees the final
-- row: whenever auth.uid() is not null, the column named by the trigger argument
-- must equal it. Attached with the same events as force_actor.
create function private.check_actor()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_actor uuid;
begin
  if tg_nargs <> 1 or not exists (
    select 1 from pg_catalog.pg_attribute a
    where a.attrelid = tg_relid and a.attname = tg_argv[0] and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'private.check_actor: the trigger argument must name a column of %.%',
      tg_table_schema, tg_table_name;
  end if;
  if v_uid is not null then
    execute pg_catalog.format('select ($1).%I', tg_argv[0]) into v_actor using new;
    if v_actor is distinct from v_uid then
      raise exception '%.% must equal auth.uid()', tg_table_name, tg_argv[0] using errcode = '23514';
    end if;
  end if;
  return null;
end;
$$;

create trigger entries_check_actor
  after insert on cms.entries
  for each row
  execute function private.check_actor('created_by');

create trigger drafts_check_actor
  after insert or update on cms.drafts
  for each row
  execute function private.check_actor('updated_by');

-- RLS (§4.5): access requires a membership in the row's tenant. The subquery runs
-- under the memberships policy, which permits the user's own rows.
-- Keep every membership predicate below identical (and identical to those of the
-- other tenant tables): a change to one copy is a change to tenant isolation.
alter table cms.entries enable row level security;
alter table cms.drafts enable row level security;
alter table cms.revisions enable row level security;

create policy entries_select_member on cms.entries
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = entries.tenant_id and m.user_id = (select auth.uid())
  ));

create policy entries_insert_member on cms.entries
  for insert to authenticated
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = entries.tenant_id and m.user_id = (select auth.uid())
  ));

create policy entries_update_member on cms.entries
  for update to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = entries.tenant_id and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = entries.tenant_id and m.user_id = (select auth.uid())
  ));

create policy drafts_select_member on cms.drafts
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = drafts.tenant_id and m.user_id = (select auth.uid())
  ));

create policy drafts_insert_member on cms.drafts
  for insert to authenticated
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = drafts.tenant_id and m.user_id = (select auth.uid())
  ));

create policy drafts_update_member on cms.drafts
  for update to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = drafts.tenant_id and m.user_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from cms.memberships m
    where m.tenant_id = drafts.tenant_id and m.user_id = (select auth.uid())
  ));

create policy revisions_select_member on cms.revisions
  for select to authenticated
  using (exists (
    select 1 from cms.memberships m
    where m.tenant_id = revisions.tenant_id and m.user_id = (select auth.uid())
  ));

-- Grants (§4.5). INSERT and UPDATE for authenticated are per column, so editors
-- can never set worker-owned columns or the draft version. anon: none.
grant select on cms.entries, cms.drafts, cms.revisions to authenticated;
grant insert (tenant_id, type, slug, created_by) on cms.entries to authenticated;
grant update (slug, archived_at) on cms.entries to authenticated;
grant insert (entry_id, tenant_id, schema_version, data, title, sort_at, updated_by) on cms.drafts to authenticated;
grant update (data, schema_version, title, sort_at, updated_at, updated_by) on cms.drafts to authenticated;

-- service_role (the worker): reads all three, appends revisions, moves the
-- publish pointer and timestamps. Never UPDATE or DELETE on revisions.
grant select on cms.entries, cms.drafts, cms.revisions to service_role;
grant insert on cms.revisions to service_role;
grant update (published_rev_id, published_draft_version, first_published_at, last_published_at)
  on cms.entries to service_role;
