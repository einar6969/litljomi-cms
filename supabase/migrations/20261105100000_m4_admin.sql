-- The admin functions one person needs to operate the Hub (spec §4.6, §4.7, §8.2, §8.4; plan
-- M4-01, decision 53). The CLI calls them with the secret key (M4-02).
--
--   api.admin_set_webhook_secret   rotates a site's webhook secret in place
--   api.admin_set_tenant_status    suspends or reactivates a tenant
--   api.admin_remove_membership    revokes an editor; RLS reads memberships on every request (§4.5)
--   api.admin_create_tenant        replaced in place: a rerun finishes the job (§9.2)
--   private.audit_tenants          records a status change (§4.7)
--
-- All are SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE is for
-- service_role only: PUBLIC has none through Task 4's global default privileges, and
-- admin_create_tenant keeps its grant (create or replace, the same signature). No table grant is
-- added: service_role already holds UPDATE (name, status) on cms.tenants and DELETE on
-- cms.memberships, and the FOR UPDATE on cms.sites needs only the UPDATE it holds on other columns.
--
-- Errors (decision 3): raise exception '<code>' using errcode = 'P0001', with not_found or
-- slug_taken; a parameter outside its documented values raises 22023.

-- A new value for a site's webhook secret, in the Vault row the site already has, so
-- webhook_secret_ref does not change. At least 32 characters (22023), checked before the site is
-- read or locked, as in admin_set_preview_secret. not_found for no such site, and for a reference
-- with no Vault row: vault.update_secret alone would change nothing and report success.
create function api.admin_set_webhook_secret(p_site_id uuid, p_webhook_secret text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  if p_webhook_secret is null or p_webhook_secret = '' then
    raise exception 'p_webhook_secret must not be empty' using errcode = '22023';
  end if;
  if pg_catalog.char_length(p_webhook_secret) < 32 then
    raise exception 'p_webhook_secret must have at least 32 characters' using errcode = '22023';
  end if;
  select s.webhook_secret_ref into v_ref from cms.sites s where s.id = p_site_id for update;
  if not found or not exists (select 1 from vault.decrypted_secrets v where v.id = v_ref) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  perform vault.update_secret(v_ref, p_webhook_secret);
end;
$$;

-- Suspends or reactivates a tenant (§8.4). The worker re-checks the status at commit, with the
-- tenant row locked FOR SHARE (§6.2 step 4), so this waits for a commit in progress and every later
-- one is rejected with tenant_inactive. The status is checked before the tenant is read. not_found
-- for no such tenant. Setting the status a tenant already has changes nothing and audits nothing.
create function api.admin_set_tenant_status(p_tenant_id uuid, p_status text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status is null or p_status not in ('active', 'suspended') then
    raise exception 'p_status must be active or suspended' using errcode = '22023';
  end if;
  update cms.tenants t set status = p_status where t.id = p_tenant_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Revokes an editor (§8.4). memberships_audit records the removal. not_found for no such tenant;
-- removing an absent membership changes nothing, as admin_add_membership does on a duplicate.
create function api.admin_remove_membership(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  delete from cms.memberships m where m.tenant_id = p_tenant_id and m.user_id = p_user_id;
end;
$$;

-- A tenant, active (§4.3, §4.6). Unchanged from 20261102001000 but for a slug that exists: the same
-- name returns the existing id, so a rerun finishes the job; another name raises slug_taken. The
-- existing row is read after the insert fails, so two concurrent calls agree too.
create or replace function api.admin_create_tenant(p_slug text, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_name text;
  v_constraint text;
begin
  begin
    insert into cms.tenants (slug, name) values (p_slug, p_name) returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint <> 'tenants_slug_key' then
      raise;
    end if;
    select t.id, t.name into v_id, v_name from cms.tenants t where t.slug = p_slug;
    if v_name is distinct from p_name then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
  end;
  return v_id;
end;
$$;

-- A tenant status change (§4.7). Made by the CLI, so it has no actor: audit_force_actor gives the
-- action its system. prefix, and the event is system.tenant.status_changed. tenant_id and target_id
-- are both the tenant's id.
create function private.audit_tenants()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into cms.audit_log (tenant_id, actor_id, action, target_type, target_id, details)
  values (new.id, null, 'tenant.status_changed', 'tenant', new.id,
          pg_catalog.jsonb_build_object('from', old.status, 'to', new.status));
  return null;
end;
$$;

create trigger tenants_audit_update
  after update on cms.tenants
  for each row
  when (old.status is distinct from new.status)
  execute function private.audit_tenants();

grant execute on function
  api.admin_set_webhook_secret(uuid, text),
  api.admin_set_tenant_status(uuid, text),
  api.admin_remove_membership(uuid, uuid)
  to service_role;
