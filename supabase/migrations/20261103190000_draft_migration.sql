-- Draft migration: the admin api of `migrate-drafts` (spec §5.3, §4.5, §8.2, §9.1; plan M2-13).
--
-- §5.3: on deploy, a migration script applies a type's transforms to all of its drafts, each as a
-- normal versioned draft update; revisions are never rewritten. The script is the CLI
-- (tools/cli `migrate-drafts`), which holds the secret key (§8.2) and so runs as service_role.
-- §4.5 grants service_role "what the worker and CLI need, except UPDATE/DELETE on revisions and
-- audit_log"; this is what the CLI needs to save a draft, and nothing more:
--
-- - UPDATE (data, schema_version, title, sort_at, updated_by) on cms.drafts: the columns
--   api.save_draft writes, with updated_by set to null (a system write, decision 12). version and
--   updated_at stay trigger-owned (drafts_bump_version); service_role already had UPDATE
--   (updated_at) for the worker's row lock (decision 31).
-- - INSERT and DELETE on cms.draft_refs: drafts_sync_refs runs as the invoking role and rebuilds
--   the draft's references when its data changes (§4.3); service_role already had SELECT.
--
-- No grant on cms.revisions changes: the functions below never read or write a revision.
--
-- Both functions are SECURITY INVOKER with search_path = '' and schema-qualified names, executable
-- by service_role only (EXECUTE is revoked from PUBLIC by Task 4's global default privileges).
-- Errors as the other admin_* functions (decision 3): '<code>' with errcode P0001 (not_found,
-- version_conflict); a parameter outside its documented values raises 22023.

grant update (data, schema_version, title, sort_at, updated_by) on cms.drafts to service_role;
grant insert, delete on cms.draft_refs to service_role;

-- The drafts of a tenant's type written below p_current_version, in entry id order, at most
-- p_limit (1–1000, PostgREST's max_rows) after p_after (keyset paging; null starts at the first).
-- p_entry_id, when given, narrows the result to that one entry (the CLI's re-read before a retry).
-- Drafts at or above the current version are never returned. not_found: no such tenant.
create function api.admin_outdated_drafts(p_tenant_slug text, p_type text, p_current_version int, p_after uuid,
                                          p_limit int, p_entry_id uuid default null)
returns table (entry_id uuid, version int, schema_version int, data jsonb)
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  if p_type is null or p_current_version is null or p_current_version < 1 then
    raise exception 'p_type and p_current_version (at least 1) are required' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;
  select t.id into v_tenant_id from cms.tenants t where t.slug = p_tenant_slug;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  return query
    select d.entry_id, d.version, d.schema_version, d.data
    from cms.drafts d
    join cms.entries e on e.tenant_id = d.tenant_id and e.id = d.entry_id
    where d.tenant_id = v_tenant_id
      and e.type = p_type
      and d.schema_version < p_current_version
      and (p_after is null or d.entry_id > p_after)
      and (p_entry_id is null or d.entry_id = p_entry_id)
    order by d.entry_id
    limit p_limit;
end;
$$;

-- One draft brought to a newer schema version: a normal versioned draft update (§5.3, §5.5). It
-- changes the draft only if it is still at p_expected_version and was written at
-- p_from_schema_version, so a draft an editor saved since it was read is never overwritten; the
-- CLI re-reads it and retries once. The new version must be above the old one. Returns the new
-- draft version. version_conflict: the draft has changed; not_found: no draft for that entry.
-- The tenant is the draft's own; no tenant is taken as a parameter.
create function api.admin_migrate_draft(p_entry_id uuid, p_expected_version int, p_from_schema_version int,
                                        p_data jsonb, p_schema_version int, p_title text, p_sort_at timestamptz)
returns int
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_version int;
begin
  if p_from_schema_version is null or p_schema_version is null or p_schema_version <= p_from_schema_version then
    raise exception 'p_schema_version must be above p_from_schema_version' using errcode = '22023';
  end if;
  update cms.drafts d
  set data = p_data, schema_version = p_schema_version, title = p_title, sort_at = p_sort_at, updated_by = null
  where d.entry_id = p_entry_id and d.version = p_expected_version and d.schema_version = p_from_schema_version
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

grant execute on function api.admin_outdated_drafts(text, text, int, uuid, int, uuid) to service_role;
grant execute on function api.admin_migrate_draft(uuid, int, int, jsonb, int, text, timestamptz) to service_role;
