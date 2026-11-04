-- A preview URL for an existing site (spec §4.6, §7.5; Thread F, fix/preview-url).
--
-- The token route sends the editor to the site's preview URL with the token in its query, so a
-- site previews only with both a preview secret and a preview URL. api.admin_set_preview_secret
-- (20261103010000) gives an existing site the secret; until now nothing could give it the URL,
-- because `provision site` creates sites with none and no function changed it afterwards (the gap
-- left open by security review B, PR #37).
--
--   api.admin_set_preview_url(p_site_id, p_preview_url) sets the URL, or clears it with null.
--   The URL follows the token route's rule (apps/cms/src/privileged/preview/token.ts,
--   isAllowedPreviewUrl; security review B4): https, or plain http only to a loopback host
--   (localhost, 127.0.0.0/8, [::1]). The check here is stricter in form than the URL parser there,
--   so every URL it stores is one the token route accepts: a lowercase scheme, a host of DNS labels,
--   an IPv4 address or a bracketed IPv6 address, an optional port and path, and no user info,
--   query, fragment, whitespace or backslash; at most 2048 characters. Anything else raises 22023
--   before the site is read. not_found for no such site.
--
-- SECURITY INVOKER with search_path = '' and schema-qualified names. EXECUTE for service_role only;
-- PUBLIC has none through Task 4's global default privileges, and it is revoked from anon and
-- authenticated explicitly as well. service_role gets UPDATE on cms.sites.preview_url only, for it.

create function api.admin_set_preview_url(p_site_id uuid, p_preview_url text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
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
  update cms.sites s set preview_url = p_preview_url where s.id = p_site_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
end;
$$;

-- Grants: service_role only (§4.6, §8.1 item 2).
revoke all on function api.admin_set_preview_url(uuid, text) from public, anon, authenticated;
grant execute on function api.admin_set_preview_url(uuid, text) to service_role;

-- admin_set_preview_url sets the URL; no other column of cms.sites becomes updatable.
grant update (preview_url) on cms.sites to service_role;
