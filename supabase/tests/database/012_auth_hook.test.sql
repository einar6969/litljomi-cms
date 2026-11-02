-- supabase/tests/database/012_auth_hook.test.sql
-- The passwordless Custom Access Token hook (spec §4.4, §4.5 "Auth hook grant";
-- plan decision 18). Reproduces docs/verification/n1-probes/hook_unit.test.sql and
-- amr_shapes.test.sql as exact-result assertions.
--
-- The cases run as the test role (postgres, a grantee). The test role cannot switch
-- to supabase_auth_admin (supautils reserves that membership), so this file proves
-- statically what supabase_auth_admin may do; execution as that role is proven over
-- HTTP through Supabase Auth (Task 4 Step 4b spot check, Task 12; decision 22).
begin;
\ir _helpers.sql
select plan(81);

-- A realistic token-issuing event: Supabase Auth sends user_id, claims and
-- authentication_method. The session amr is email-derived, so the method alone
-- decides the outcome in the method cases.
create temporary table base (claims jsonb) on commit drop;
insert into base values ('{
  "aud": "authenticated", "exp": 1793603600, "iat": 1793600000,
  "iss": "http://127.0.0.1:54321/auth/v1",
  "sub": "00000000-0000-4000-8000-00000000b001", "email": "editor-labak@test.local", "phone": "",
  "app_metadata": {"provider": "email", "providers": ["email"]}, "user_metadata": {},
  "role": "authenticated", "aal": "aal1",
  "amr": [{"method": "otp", "timestamp": 1793600000}],
  "session_id": "00000000-0000-4000-8000-0000000c0001", "is_anonymous": false
}');

create function pg_temp.event(p_method jsonb, p_claims jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('user_id', '00000000-0000-4000-8000-00000000b001', 'claims', p_claims)
         || case when p_method is null then '{}'::jsonb
                 else pg_catalog.jsonb_build_object('authentication_method', p_method) end
$$;

create temporary table cases (label text, event jsonb, allowed boolean) on commit drop;

-- Every allowed method issues the token with the incoming claims unchanged.
insert into cases
select 'method ' || m, pg_temp.event(pg_catalog.to_jsonb(m), b.claims), true
from base b, unnest(array['magiclink', 'otp', 'totp', 'recovery', 'invite', 'email_change', 'token_refresh']) as m;

-- Every other method is refused: the documented non-email methods, the GoTrue v2.197
-- MFA methods v1 does not use, an unknown method, and malformed methods.
insert into cases
select 'method ' || m, pg_temp.event(pg_catalog.to_jsonb(m), b.claims), false
from base b, unnest(array['password', 'oauth', 'sso/saml', 'anonymous', 'email/signup',
  'oauth_provider/authorization_code', 'web3', 'mfa/recovery_code', 'mfa/webauthn', 'mfa/phone',
  'passkey', 'something_new', '', 'OTP']) as m;
insert into cases
select 'method missing', pg_temp.event(null, b.claims), false from base b
union all
select 'method JSON null', pg_temp.event('null'::jsonb, b.claims), false from base b;

-- A refresh or a TOTP step-up continues a session: every amr method must be an email
-- method or totp; a missing or malformed amr is refused (fail closed).
create temporary table amr_cases (label text, amr jsonb, allowed boolean) on commit drop;
insert into amr_cases values
  ('[otp]',                '[{"method": "otp", "timestamp": 1793600000}]', true),
  ('[magiclink]',          '[{"method": "magiclink", "timestamp": 1793600000}]', true),
  ('[recovery]',           '[{"method": "recovery", "timestamp": 1793600000}]', true),
  ('[invite]',             '[{"method": "invite", "timestamp": 1793600000}]', true),
  ('[email_change]',       '[{"method": "email_change", "timestamp": 1793600000}]', true),
  ('[otp, totp]',          '[{"method": "otp", "timestamp": 1793600000}, {"method": "totp", "timestamp": 1793600060}]', true),
  ('amr missing',          null, false),
  ('amr JSON null',        'null', false),
  ('amr an object',        '{"method": "otp"}', false),
  ('amr a string',         '"otp"', false),
  ('amr empty',            '[]', false),
  ('amr string entries',   '["otp"]', false),
  ('amr entry without method', '[{"x": "otp"}]', false),
  ('[password]',           '[{"method": "password", "timestamp": 1793600000}]', false),
  ('[oauth]',              '[{"method": "oauth", "timestamp": 1793600000}]', false),
  ('[sso/saml]',           '[{"method": "sso/saml", "timestamp": 1793600000}]', false),
  ('[anonymous]',          '[{"method": "anonymous", "timestamp": 1793600000}]', false),
  ('[otp, password]',      '[{"method": "otp"}, {"method": "password"}]', false),
  ('[password, otp]',      '[{"method": "password"}, {"method": "otp"}]', false),
  ('[password, totp]',     '[{"method": "password"}, {"method": "totp"}]', false),
  ('[otp, oauth]',         '[{"method": "otp"}, {"method": "oauth"}]', false);

insert into cases
select m || ' with ' || a.label,
       pg_temp.event(pg_catalog.to_jsonb(m),
         case when a.label = 'amr missing' then b.claims - 'amr'
              else pg_catalog.jsonb_set(b.claims, '{amr}', coalesce(a.amr, 'null'::jsonb)) end),
       a.allowed
from base b, amr_cases a, unnest(array['token_refresh', 'totp']) as m;

select is(
  private.passwordless_access_token(c.event),
  case when c.allowed then pg_catalog.jsonb_build_object('claims', c.event->'claims')
       else '{"error": {"http_code": 403, "message": "Only email sign-in is allowed"}}'::jsonb end,
  c.label || case when c.allowed then ': token issued, claims unchanged' else ': refused with 403' end)
from cases c
order by c.label;

-- Definition (decision 18).
select function_lang_is('private', 'passwordless_access_token', array['jsonb'], 'plpgsql', 'hook is plpgsql');
select volatility_is('private', 'passwordless_access_token', array['jsonb'], 'stable', 'hook is stable');
select function_returns('private', 'passwordless_access_token', array['jsonb'], 'jsonb', 'hook returns jsonb');
select isnt_definer('private', 'passwordless_access_token', array['jsonb'], 'hook is not security definer');
select is((select proconfig from pg_catalog.pg_proc where oid = 'private.passwordless_access_token(jsonb)'::regprocedure),
  array['search_path=""'], 'hook pins search_path to empty and sets nothing else');
select function_owner_is('private', 'passwordless_access_token', array['jsonb'], 'postgres', 'hook is owned by postgres');

-- Grants (spec §4.5 "Auth hook grant").
select set_eq(
  $$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'private.passwordless_access_token(jsonb)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('supabase_auth_admin', 'EXECUTE') $$,
  'hook grantees are exactly postgres and supabase_auth_admin (not PUBLIC, anon, authenticated, service_role)');
select ok(has_function_privilege('supabase_auth_admin', 'private.passwordless_access_token(jsonb)', 'execute'),
  'supabase_auth_admin can execute the hook');
select ok(not has_function_privilege('anon', 'private.passwordless_access_token(jsonb)', 'execute'),
  'anon cannot execute the hook');
select ok(not has_function_privilege('authenticated', 'private.passwordless_access_token(jsonb)', 'execute'),
  'authenticated cannot execute the hook');
select ok(not has_function_privilege('service_role', 'private.passwordless_access_token(jsonb)', 'execute'),
  'service_role cannot execute the hook');

-- supabase_auth_admin: usage on private and execute on the hook, nothing else in
-- api, cms or private. (Type privileges are not listed: PUBLIC holds USAGE on types
-- by default, including table row types, and they are unreachable without schema usage.)
select ok(has_schema_privilege('supabase_auth_admin', 'private', 'usage'), 'supabase_auth_admin has usage on private');
select is_empty(
  $$ select s.nspname, p.priv
     from unnest(array['api', 'cms', 'private']) as s(nspname), unnest(array['USAGE', 'CREATE']) as p(priv)
     where has_schema_privilege('supabase_auth_admin', s.nspname, p.priv)
       and not (s.nspname = 'private' and p.priv = 'USAGE') $$,
  'supabase_auth_admin has no other schema privilege on api, cms or private');
select is_empty(
  $$ select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('api', 'cms', 'private')
       and p.oid <> 'private.passwordless_access_token(jsonb)'::regprocedure
       and has_function_privilege('supabase_auth_admin', p.oid, 'execute') $$,
  'supabase_auth_admin executes no other function in api, cms or private');
select is_empty(
  $$ select c.oid::regclass from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('api', 'cms', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and (has_table_privilege('supabase_auth_admin', c.oid,
              'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN')
            or has_any_column_privilege('supabase_auth_admin', c.oid, 'SELECT, INSERT, UPDATE, REFERENCES')) $$,
  'supabase_auth_admin has no table, view or column privilege in api, cms or private');
select is_empty(
  $$ select c.oid::regclass from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('api', 'cms', 'private')
       -- CASE keeps the planner from calling has_sequence_privilege on other relations.
       and case when c.relkind = 'S'
                then has_sequence_privilege('supabase_auth_admin', c.oid, 'USAGE, SELECT, UPDATE')
                else false end $$,
  'supabase_auth_admin has no sequence privilege in api, cms or private');

select * from finish();
rollback;
