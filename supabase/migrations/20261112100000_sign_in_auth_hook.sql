-- Password sign-in: the Custom Access Token hook (spec §4.4, §4.5 "Auth hook grant";
-- plan decisions 72 and 72.1, docs/plans/passwords.md PW-01). Replaces decision 18's
-- private.passwordless_access_token, which refused passwords. Enabled in
-- supabase/config.toml as
-- [auth.hook.custom_access_token] uri = "pg-functions://postgres/private/sign_in_access_token".
--
-- Supabase Auth calls it, as supabase_auth_admin, before issuing every access token.
-- It issues a token only for what the CMS uses: a password, `otp`, TOTP step-up and
-- refresh. Auth reports every link verified by token hash as `otp`, whatever its type
-- (invite, recovery, email change and magic link alike; decision 72.1, observed on
-- GoTrue v2.197.0), so the hook cannot tell a magic link from an invitation: magic links
-- and email codes are stopped in the email instead (supabase/templates/magic_link.html
-- carries no link, token hash or code). `magiclink`, `recovery` and `invite` arrive only
-- from a PKCE exchange, which the CMS does not use, and are refused like every other
-- method. A refresh or step-up continues an existing session, so every method in the
-- session's amr must be `password`, `otp` or `totp`. Anything else, including a missing
-- or malformed method or amr, is refused (fail closed), with a message that names no
-- method. It reads no tables.

create function private.sign_in_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  allowed constant text[] := array['password', 'otp', 'totp'];
  method text := event->>'authentication_method';
  claims jsonb := event->'claims';
  amr jsonb := claims->'amr';
  refused constant jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Sign-in not allowed'));
begin
  if method is null or not (method = any (allowed || array['token_refresh'])) then
    return refused;
  end if;
  -- A refresh or an MFA step-up continues an existing session: every method it was built
  -- from must be allowed. Anything malformed is refused (fail closed). The checks are
  -- separate statements so that no NULL can make a condition fall through: an absent
  -- amr key is SQL NULL, unlike JSON null, and must be refused too.
  if method in ('token_refresh', 'totp') then
    if amr is null or pg_catalog.jsonb_typeof(amr) <> 'array' then
      return refused;
    end if;
    if pg_catalog.jsonb_array_length(amr) = 0 or exists (
      select 1 from pg_catalog.jsonb_array_elements(amr) as a
      where pg_catalog.jsonb_typeof(a) <> 'object' or coalesce(not ((a->>'method') = any (allowed)), true)
    ) then
      return refused;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('claims', claims);
end;
$$;

-- Only Supabase Auth's role may call it (and postgres, its owner). EXECUTE from PUBLIC
-- is already withheld by the global default revoke; revoked explicitly as well, and
-- from service_role, so the grantees are exactly postgres and supabase_auth_admin.
-- supabase_auth_admin already has usage on private (20261102000110); granted again so
-- that this migration states the whole grant.
revoke execute on function private.sign_in_access_token(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.sign_in_access_token(jsonb) to supabase_auth_admin;

-- The hook it replaces. Auth must call the new one from the same moment (config.toml locally;
-- the dashboard on a hosted project, set in the same minute as this migration is pushed).
drop function private.passwordless_access_token(jsonb);
