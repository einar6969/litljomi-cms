-- api.admin_create_site checks the preview URL (spec §4.6, §7.5; follow-up to fix/preview-url).
--
-- api.admin_set_preview_url (20261104161000) refuses a preview URL that the token route would not
-- send an editor to, but api.admin_create_site stored any p_preview_url it was given: only the
-- `provision site` CLI checked it. Here the database refuses it on creation as well, with the same
-- rule and the same expressions as admin_set_preview_url (token.ts isAllowedPreviewUrl, security
-- review B4): https, or plain http only to a loopback host (localhost, 127.0.0.0/8, [::1]); a host
-- of DNS labels, an IPv4 address or a bracketed IPv6 address, an optional port and path, and no
-- user info, query, fragment, whitespace or backslash; at most 2048 characters. Anything else raises
-- 22023 and no site or Vault secret is created. Null still creates the site without a preview URL.
--
-- api.admin_create_site is replaced in place (create or replace, the same signature, so its grants
-- stay: EXECUTE for service_role only, 20261103010000). It is unchanged from 20261104151000 but for
-- the preview URL check. No function, grant or column is added. Existing rows are not touched.

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
  -- The same check as api.admin_set_preview_url (20261104161000); keep the two identical.
  if p_preview_url is not null and not (
    pg_catalog.char_length(p_preview_url) <= 2048
    and (
      -- https to any host: DNS labels, an IPv4 address or a bracketed IPv6 address.
      p_preview_url ~ '^https://([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()*+,;=:@/-]*)?$'
      -- plain http to a loopback host only.
      or p_preview_url ~ '^http://(localhost|127\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])|\[::1\])(:[0-9]{1,5})?(/[A-Za-z0-9._~%!$&()*+,;=:@/-]*)?$'
    )
  ) then
    raise exception 'p_preview_url must be an https URL, or http to a loopback host' using errcode = '22023';
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
