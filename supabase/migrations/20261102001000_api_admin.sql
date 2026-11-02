-- Provisioning: the admin api the M1 CLI uses (spec §4.3, §4.5, §8.2, §9.2;
-- plan Task 11, decisions 3, 5 and 12).
--
-- A minimal set over service_role-only functions (decision 5): tenant, site,
-- membership. All are SECURITY INVOKER with search_path = '' and
-- schema-qualified names; no SECURITY DEFINER anywhere. EXECUTE is granted to
-- service_role only. They run with service_role's grants (Task 5: insert on
-- tenants and memberships; Task 9: insert on sites), and the audit triggers
-- record membership changes as system events (actor null, decision 12).
--
-- Errors (decision 3): raise exception '<code>' using errcode = 'P0001', with
-- not_found (no such tenant) or slug_taken. A parameter outside its documented
-- values raises 22023. Constraint errors (a malformed slug, 23514; an unknown
-- user, 23503) pass through unchanged.

-- A tenant, active (§4.3). The slug is checked by the table's constraint and
-- is immutable once created (§4.1 rule 7).
create function api.admin_create_tenant(p_slug text, p_name text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_constraint text;
begin
  begin
    insert into cms.tenants (slug, name) values (p_slug, p_name) returning id into v_id;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tenants_slug_key' then
      raise exception 'slug_taken' using errcode = 'P0001';
    end if;
    raise;
  end;
  return v_id;
end;
$$;

-- A site of a tenant (§4.3, §8.2; A9). The webhook secret is stored in
-- Supabase Vault with vault.create_secret, under a name that identifies the
-- site, and cms.sites keeps only the Vault id (webhook_secret_ref). The secret
-- itself is never written to a cms table; the worker reads it back through
-- api.worker_sites. not_found for no such tenant; 22023 for an empty secret.
create function api.admin_create_site(p_tenant_id uuid, p_base_url text, p_revalidate_url text, p_preview_url text,
                                      p_webhook_secret text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_secret_id uuid;
begin
  if not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_webhook_secret is null or p_webhook_secret = '' then
    raise exception 'p_webhook_secret must not be empty' using errcode = '22023';
  end if;
  v_secret_id := vault.create_secret(p_webhook_secret, 'cms.sites/' || v_id::text || '/webhook',
                                     'Webhook secret of cms.sites ' || v_id::text);
  insert into cms.sites (id, tenant_id, base_url, revalidate_url, preview_url, webhook_secret_ref)
  values (v_id, p_tenant_id, p_base_url, p_revalidate_url, p_preview_url, v_secret_id);
  return v_id;
end;
$$;

-- An editor membership (§4.3, §9.2). Adding an existing membership changes
-- nothing. not_found for no such tenant; an unknown user fails the foreign key
-- (23503).
create function api.admin_add_membership(p_tenant_id uuid, p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  insert into cms.memberships (tenant_id, user_id) values (p_tenant_id, p_user_id)
  on conflict (tenant_id, user_id) do nothing;
end;
$$;

grant execute on function
  api.admin_create_tenant(text, text),
  api.admin_create_site(uuid, text, text, text, text),
  api.admin_add_membership(uuid, uuid)
  to service_role;
