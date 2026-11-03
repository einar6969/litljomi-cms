-- Singletons: one live entry per singleton type and tenant (spec §3.2 `structure`, §10.1; plan
-- M2-09, decision 50.5 "the database enforces invariants").
--
-- Which types are singletons is declared in the tenant's module (TypeScript, §4.1 rule 1). The
-- database learns it from the entries themselves: an entry created as a singleton carries
-- `singleton = true`, and from then on its type is a singleton in that tenant.
--
--   * A partial unique index allows at most one live singleton entry per tenant and type. It is
--     what holds under any interleaving: a second concurrent insert waits for the first and then
--     fails with 23505.
--   * An AFTER row trigger refuses mixing: a non-singleton entry of a type that has a live
--     singleton entry (`singleton_exists`, which is also what `api.create_entry` answers), and a
--     singleton entry of a type that already has live non-singleton entries (`singleton_mismatch`).
--     It sees the final row, so it does not depend on BEFORE-trigger name order, and it takes a
--     transaction-scoped advisory lock on (tenant, type) first, so two concurrent writers of the
--     same type are checked one after the other (each statement in the function takes a fresh
--     snapshot under READ COMMITTED, the isolation PostgREST uses).
--   * `api.create_singleton_entry` opens a singleton type: it returns the type's one live entry,
--     creating it (and its empty draft) on first open. Two concurrent first opens both get the same
--     id and neither sees an error.
--
-- Archived entries do not count, as for slugs (§4.3): archiving a singleton entry frees its type.
-- Editors may set `singleton` on insert (the function runs as the editor); doing so directly gives
-- them nothing the function does not, and the checks above apply to every writer. Nothing changes
-- for anon or service_role.
--
-- Errors (decision 3, extended): `singleton_exists` and `singleton_mismatch`, P0001.

alter table cms.entries add column singleton boolean not null default false;

create unique index entries_tenant_type_singleton_key on cms.entries (tenant_id, type)
  where singleton and archived_at is null;

grant insert (singleton) on cms.entries to authenticated;

create function private.entries_check_singleton()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.archived_at is not null then
    return null;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.tenant_id::text || '/' || new.type, 0));
  if not new.singleton and exists (
    select 1 from cms.entries e
    where e.tenant_id = new.tenant_id and e.type = new.type and e.singleton and e.archived_at is null and e.id <> new.id
  ) then
    raise exception 'singleton_exists' using errcode = 'P0001';
  end if;
  if new.singleton and exists (
    select 1 from cms.entries e
    where e.tenant_id = new.tenant_id and e.type = new.type and not e.singleton and e.archived_at is null and e.id <> new.id
  ) then
    raise exception 'singleton_mismatch' using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger entries_check_singleton
  after insert or update of tenant_id, type, singleton, archived_at on cms.entries
  for each row
  execute function private.entries_check_singleton();

-- Opens a singleton type (§10.1): the id of the tenant's one live entry of the type, created with
-- an empty draft on first open. The caller must be a member (not_found otherwise, as in
-- create_entry). A type with live non-singleton entries is singleton_mismatch.
create function api.create_singleton_entry(p_tenant_id uuid, p_type text, p_schema_version int default 1)
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
  select e.id into v_id from cms.entries e
  where e.tenant_id = p_tenant_id and e.type = p_type and e.singleton and e.archived_at is null;
  if found then
    return v_id;
  end if;
  begin
    insert into cms.entries (tenant_id, type, singleton)
    values (p_tenant_id, p_type, true)
    returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'entries_tenant_type_singleton_key' then
      raise;
    end if;
    -- A concurrent first open committed the entry while this insert waited on the index; this
    -- statement's fresh snapshot sees it.
    select e.id into v_id from cms.entries e
    where e.tenant_id = p_tenant_id and e.type = p_type and e.singleton and e.archived_at is null;
    if not found then
      raise;
    end if;
    return v_id;
  end;
  insert into cms.drafts (entry_id, tenant_id, schema_version)
  values (v_id, p_tenant_id, p_schema_version);
  return v_id;
end;
$$;

grant execute on function api.create_singleton_entry(uuid, text, int) to authenticated;
