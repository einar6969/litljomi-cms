-- N1 investigation only (throwaway project, not the production schema).
-- Custom Access Token hook: issue tokens only for email-based sign-in (spec §4.4, no passwords).
create schema if not exists private;

create function private.passwordless_access_token(event jsonb)
returns jsonb
language plpgsql
stable
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
  -- from must be allowed. Anything malformed is refused (fail closed).
  if method in ('token_refresh', 'totp') and not (
    pg_catalog.jsonb_typeof(amr) = 'array'
    and pg_catalog.jsonb_array_length(amr) > 0
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(amr) as a
      where pg_catalog.jsonb_typeof(a) <> 'object' or coalesce(not ((a->>'method') = any (allowed)), true)
    )
  ) then
    return refused;
  end if;
  -- Probe only: record the method the hook saw, so tokens show it.
  claims := pg_catalog.jsonb_set(claims, '{probe_method}', pg_catalog.to_jsonb(method));
  return pg_catalog.jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.passwordless_access_token(jsonb) to supabase_auth_admin;
revoke execute on function private.passwordless_access_token(jsonb) from public, anon, authenticated;
