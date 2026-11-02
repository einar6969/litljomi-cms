-- Passwordless sign-in: the Custom Access Token hook (spec §4.4, §4.5 "Auth hook
-- grant"; plan decision 18). Enabled in supabase/config.toml as
-- [auth.hook.custom_access_token] uri = "pg-functions://postgres/private/passwordless_access_token".
--
-- Supabase Auth calls it, as supabase_auth_admin, before issuing every access token.
-- It issues a token only for the email methods, TOTP step-up and refresh; a refresh
-- or step-up continues an existing session, so every method in the session's amr
-- must be an email method or totp. Anything else, including a missing or malformed
-- method or amr, is refused (fail closed). It reads no tables.
-- Evidence: docs/verification/n1-passwordless-investigation.md. Unlike the hook in that
-- evidence, which let a refresh or step-up through when the amr key was absent (its
-- condition evaluated to NULL), this one refuses it, as decision 18 requires.

create function private.passwordless_access_token(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  allowed constant text[] := array['magiclink', 'otp', 'totp', 'recovery', 'invite', 'email_change'];
  method text := event->>'authentication_method';
  claims jsonb := event->'claims';
  amr jsonb := claims->'amr';
  refused constant jsonb := pg_catalog.jsonb_build_object('error', pg_catalog.jsonb_build_object(
    'http_code', 403, 'message', 'Only email sign-in is allowed'));
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
revoke execute on function private.passwordless_access_token(jsonb) from public, anon, authenticated, service_role;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.passwordless_access_token(jsonb) to supabase_auth_admin;
