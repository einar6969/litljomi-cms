-- Preview secrets per site (spec §7.5, §8.2; plan M3-10; A9; deferred row 28 Step 0).
--
-- A site's preview secret signs the preview tokens that the privileged token route
-- (/api/preview-token) mints: HMAC over {tenant, entry_id, draft_version, exp}, valid 10 minutes.
-- Like the webhook secret it lives in Supabase Vault, cms.sites keeps only its Vault id
-- (preview_secret_ref, a column since Task 6 that authenticated can never read), and it leaves the
-- database only through a service_role-only function. The same value is set in the site's
-- environment, where the site verifies the token (§7.5, M3-12).
--
--   1. api.admin_create_site gains p_preview_secret (default null, so the five-argument callers keep
--      working): given, it is stored in Vault with the site, as the webhook secret is; empty is
--      refused (22023); null creates the site without one.
--   2. api.admin_set_preview_secret(p_site_id, p_preview_secret) gives an existing site a preview
--      secret, or replaces it (rotation): the staging sites created in M1 have none (local
--      acceptance step 1). service_role gets UPDATE on cms.sites.preview_secret_ref only, for it.
--   3. api.worker_preview_sites(p_tenant_id) returns the tenant's active sites that can preview (a
--      preview URL and a preview secret in Vault), with the secret, for the token route.
--
-- Every function is SECURITY INVOKER with search_path = '' and schema-qualified names (vault's
-- own functions are Supabase's, used as §8.2 decides; decision 32). EXECUTE is granted to
-- service_role only; PUBLIC has none through Task 4's global default privileges, and it is revoked
-- from anon and authenticated explicitly as well.

-- 1. admin_create_site with the preview secret.
drop function api.admin_create_site(uuid, text, text, text, text);

-- A site of a tenant (§4.3, §8.2; A9). The webhook secret, and the preview secret when given, are
-- stored in Supabase Vault with vault.create_secret, under names that identify the site, and
-- cms.sites keeps only their Vault ids. Neither secret is written to a cms table; the worker reads
-- the webhook secret back through api.worker_sites, the token route the preview secret through
-- api.worker_preview_sites. not_found for no such tenant; 22023 for an empty secret.
create function api.admin_create_site(p_tenant_id uuid, p_base_url text, p_revalidate_url text, p_preview_url text,
                                      p_webhook_secret text, p_preview_secret text default null)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := pg_catalog.gen_random_uuid();
  v_secret_id uuid;
  v_preview_id uuid;
begin
  if not exists (select 1 from cms.tenants t where t.id = p_tenant_id) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if p_webhook_secret is null or p_webhook_secret = '' then
    raise exception 'p_webhook_secret must not be empty' using errcode = '22023';
  end if;
  if p_preview_secret = '' then
    raise exception 'p_preview_secret must not be empty' using errcode = '22023';
  end if;
  v_secret_id := vault.create_secret(p_webhook_secret, 'cms.sites/' || v_id::text || '/webhook',
                                     'Webhook secret of cms.sites ' || v_id::text);
  if p_preview_secret is not null then
    v_preview_id := vault.create_secret(p_preview_secret, 'cms.sites/' || v_id::text || '/preview',
                                        'Preview secret of cms.sites ' || v_id::text);
  end if;
  insert into cms.sites (id, tenant_id, base_url, revalidate_url, preview_url, webhook_secret_ref, preview_secret_ref)
  values (v_id, p_tenant_id, p_base_url, p_revalidate_url, p_preview_url, v_secret_id, v_preview_id);
  return v_id;
end;
$$;

-- 2. A preview secret for an existing site, or a new value for it. The site row is locked so two
-- calls cannot both create a Vault secret for it. not_found for no such site; 22023 for an empty
-- secret.
create function api.admin_set_preview_secret(p_site_id uuid, p_preview_secret text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ref uuid;
begin
  if p_preview_secret is null or p_preview_secret = '' then
    raise exception 'p_preview_secret must not be empty' using errcode = '22023';
  end if;
  select s.preview_secret_ref into v_ref from cms.sites s where s.id = p_site_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_ref is not null and exists (select 1 from vault.decrypted_secrets v where v.id = v_ref) then
    perform vault.update_secret(v_ref, p_preview_secret);
  else
    v_ref := vault.create_secret(p_preview_secret, 'cms.sites/' || p_site_id::text || '/preview',
                                 'Preview secret of cms.sites ' || p_site_id::text);
    update cms.sites set preview_secret_ref = v_ref where id = p_site_id;
  end if;
end;
$$;

-- 3. The tenant's active sites that can preview, with their preview secrets read from Vault by
-- preview_secret_ref (§7.5, §8.2; A9). A site with no preview URL, no reference, or a reference
-- with no Vault secret is left out. The secrets leave the database only through this
-- service_role-only function.
create function api.worker_preview_sites(p_tenant_id uuid)
returns table (id uuid, preview_url text, preview_secret text)
language sql
stable
security invoker
set search_path = ''
as $$
  select s.id, s.preview_url, ds.decrypted_secret
  from cms.sites s
  join vault.decrypted_secrets ds on ds.id = s.preview_secret_ref
  where s.tenant_id = p_tenant_id and s.active and s.preview_url is not null
    and ds.decrypted_secret is not null and ds.decrypted_secret <> ''
  order by s.id
$$;

-- Grants: service_role only (§4.6, §8.1 item 2).
revoke all on function
  api.admin_create_site(uuid, text, text, text, text, text),
  api.admin_set_preview_secret(uuid, text),
  api.worker_preview_sites(uuid)
  from public, anon, authenticated;
grant execute on function
  api.admin_create_site(uuid, text, text, text, text, text),
  api.admin_set_preview_secret(uuid, text),
  api.worker_preview_sites(uuid)
  to service_role;

-- admin_set_preview_secret sets the reference; no other column of cms.sites becomes updatable.
grant update (preview_secret_ref) on cms.sites to service_role;
