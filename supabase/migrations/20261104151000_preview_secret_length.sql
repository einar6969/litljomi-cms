-- Preview secrets have at least 32 characters (spec §7.5, §8.2; security review B5).
--
-- A preview secret signs the preview tokens that the token route mints (HMAC-SHA256 over
-- {tenant, entry_id, draft_version, exp}); a short one can be guessed offline from a single token
-- seen in a preview URL. The SDK and the CMS refuse to sign or verify with a secret shorter than
-- 32 characters (MIN_PREVIEW_SECRET_LENGTH), and `provision preview-secret` sends none; here the
-- database refuses to store one as well, so a short secret fails where it is set, not later.
--
-- api.admin_create_site and api.admin_set_preview_secret are replaced in place (create or replace,
-- the same signatures, so their grants stay: EXECUTE for service_role only, 20261103010000). The
-- only change in each is the length check: an empty, null (admin_set_preview_secret) or shorter
-- secret raises 22023. No function, grant or column is added. Existing Vault values are not
-- touched; the application never uses a stored secret shorter than 32 characters.

-- A site of a tenant (§4.3, §8.2; A9). Unchanged from 20261103010000 but for the preview secret's
-- length: given, it must have at least 32 characters (22023); null creates the site without one.
create or replace function api.admin_create_site(p_tenant_id uuid, p_base_url text, p_revalidate_url text, p_preview_url text,
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
  if pg_catalog.char_length(p_preview_secret) < 32 then
    raise exception 'p_preview_secret must have at least 32 characters' using errcode = '22023';
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

-- A preview secret for an existing site, or a new value for it. Unchanged from 20261103010000 but
-- for the length: at least 32 characters (22023), checked before the site is read or locked.
create or replace function api.admin_set_preview_secret(p_site_id uuid, p_preview_secret text)
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
  if pg_catalog.char_length(p_preview_secret) < 32 then
    raise exception 'p_preview_secret must have at least 32 characters' using errcode = '22023';
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
