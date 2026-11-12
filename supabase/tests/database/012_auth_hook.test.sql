-- supabase/tests/database/012_auth_hook.test.sql
-- The sign-in Custom Access Token hook (spec §4.4, §4.5 "Auth hook grant"; plan
-- decisions 18, 72 and 72.1, docs/plans/passwords.md PW-01). It replaces decision 18's
-- passwordless hook: a password, `otp` (every link verified by token hash: invite,
-- recovery, email change), TOTP step-up and refresh. Everything else is refused, the
-- PKCE-only `magiclink`, `recovery` and `invite` included. Magic links and email codes
-- are stopped in the email (decision 72.1; tools/checks/__tests__/supabase-config.test.ts).
--
-- The cases run as the test role (postgres, a grantee). The test role cannot switch
-- to supabase_auth_admin (supautils reserves that membership), so this file proves
-- statically what supabase_auth_admin may do; execution as that role is proven over
-- HTTP through Supabase Auth (tests/integration/src/auth-sign-in.test.ts; decision 22).
begin;
\ir _helpers.sql
-- 351 assertions:
--   275 method cases: 25 methods (4 allowed, 18 refused, missing, JSON null and a number),
--       each with 11 amr shapes (a valid amr, missing, empty and 8 malformed);
--    56 session cases: 28 amr method lists, each for token_refresh and totp;
--     2 claims cases, 1 check that the refusal names no method, 1 check that the
--       passwordless hook is gone, 6 definition checks, 5 grant checks and 5 checks
--       on supabase_auth_admin.
select plan(351);

-- The refusal Auth passes on as HTTP 403. Its message names no method.
create temporary table refusal (value jsonb) on commit drop;
insert into refusal values ('{"error": {"http_code": 403, "message": "Sign-in not allowed"}}');

-- A realistic token-issuing event: Supabase Auth sends user_id, claims and
-- authentication_method. The session amr below is replaced per case.
create temporary table base (claims jsonb) on commit drop;
insert into base values ('{
  "aud": "authenticated", "exp": 1793603600, "iat": 1793600000,
  "iss": "http://127.0.0.1:54321/auth/v1",
  "sub": "00000000-0000-4000-8000-00000000b001", "email": "editor-labak@test.local", "phone": "",
  "app_metadata": {"provider": "email", "providers": ["email"]}, "user_metadata": {},
  "role": "authenticated", "aal": "aal1",
  "amr": [{"method": "password", "timestamp": 1793600000}],
  "session_id": "00000000-0000-4000-8000-0000000c0001", "is_anonymous": false
}');

create function pg_temp.event(p_method jsonb, p_claims jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('user_id', '00000000-0000-4000-8000-00000000b001', 'claims', p_claims)
         || case when p_method is null then '{}'::jsonb
                 else pg_catalog.jsonb_build_object('authentication_method', p_method) end
$$;

-- The claims with the amr replaced; a SQL NULL amr removes the key.
create function pg_temp.with_amr(p_claims jsonb, p_amr jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_amr is null then p_claims - 'amr'
              else pg_catalog.jsonb_set(p_claims, '{amr}', p_amr) end
$$;

-- Every method Auth may send. "fresh": a new sign-in, issued whatever the amr holds.
-- "session": a refresh or a TOTP step-up, which continues a session, so it is issued
-- only when the session's amr is valid. "refused": never issued, whatever the amr.
create temporary table methods (label text, method jsonb, kind text) on commit drop;
insert into methods
select m, pg_catalog.to_jsonb(m), 'fresh' from unnest(array['password', 'otp']) as m
union all
select m, pg_catalog.to_jsonb(m), 'session' from unnest(array['token_refresh', 'totp']) as m
union all
-- The PKCE exchanges the CMS does not use (magiclink, recovery, invite, email_change),
-- the other documented methods, the GoTrue v2.197 MFA methods v1 does not use, an
-- unknown method and malformed methods.
select m, pg_catalog.to_jsonb(m), 'refused' from unnest(array['magiclink', 'recovery', 'invite', 'email_change', 'oauth',
  'sso/saml', 'anonymous', 'email/signup', 'oauth_provider/authorization_code', 'web3', 'mfa/recovery_code',
  'mfa/webauthn', 'mfa/phone', 'passkey', 'something_new', '', 'PASSWORD', ' otp']) as m
union all
values ('missing', null::jsonb, 'refused'), ('JSON null', 'null'::jsonb, 'refused'), ('a number', '1'::jsonb, 'refused');

-- The amr shapes every method is tried with: one valid, missing, empty and malformed.
create temporary table shapes (label text, amr jsonb, valid boolean) on commit drop;
insert into shapes values
  ('a valid amr',          '[{"method": "password", "timestamp": 1793600000}]', true),
  ('amr missing',          null, false),
  ('amr empty',            '[]', false),
  ('amr JSON null',        'null', false),
  ('amr an object',        '{"method": "password"}', false),
  ('amr a string',         '"password"', false),
  ('amr string entries',   '["password"]', false),
  ('amr [null]',           '[null]', false),
  ('amr entry without method', '[{"x": "password"}]', false),
  ('amr method JSON null', '[{"method": null}]', false),
  ('amr method a number',  '[{"method": 1}]', false);

create temporary table cases (label text, event jsonb, allowed boolean) on commit drop;
insert into cases
select 'method ' || m.label || ' with ' || s.label,
       pg_temp.event(m.method, pg_temp.with_amr(b.claims, s.amr)),
       m.kind = 'fresh' or (m.kind = 'session' and s.valid)
from base b, methods m, shapes s;

-- A refresh or a TOTP step-up: every method in the session's amr must be password,
-- otp or totp. A session that a PKCE exchange or any other method started, alone or
-- with an allowed method, cannot continue.
create temporary table sessions (label text, amr jsonb, allowed boolean) on commit drop;
insert into sessions values
  ('[password]',              '[{"method": "password", "timestamp": 1793600000}]', true),
  ('[otp]',                   '[{"method": "otp", "timestamp": 1793600000}]', true),
  ('[totp]',                  '[{"method": "totp", "timestamp": 1793600000}]', true),
  ('[password, totp]',        '[{"method": "password", "timestamp": 1793600000}, {"method": "totp", "timestamp": 1793600060}]', true),
  ('[totp, password]',        '[{"method": "totp"}, {"method": "password"}]', true),
  ('[otp, totp]',             '[{"method": "otp"}, {"method": "totp"}]', true),
  ('[totp, otp]',             '[{"method": "totp"}, {"method": "otp"}]', true),
  ('[otp, password]',         '[{"method": "otp"}, {"method": "password"}]', true),
  ('[password, otp, totp]',   '[{"method": "password"}, {"method": "otp"}, {"method": "totp"}]', true),
  ('[magiclink]',             '[{"method": "magiclink", "timestamp": 1793600000}]', false),
  ('[recovery]',              '[{"method": "recovery", "timestamp": 1793600000}]', false),
  ('[invite]',                '[{"method": "invite", "timestamp": 1793600000}]', false),
  ('[email_change]',          '[{"method": "email_change", "timestamp": 1793600000}]', false),
  ('[magiclink, totp]',       '[{"method": "magiclink"}, {"method": "totp"}]', false),
  ('[recovery, totp]',        '[{"method": "recovery"}, {"method": "totp"}]', false),
  ('[password, magiclink]',   '[{"method": "password"}, {"method": "magiclink"}]', false),
  ('[magiclink, password]',   '[{"method": "magiclink"}, {"method": "password"}]', false),
  ('[otp, invite]',           '[{"method": "otp"}, {"method": "invite"}]', false),
  ('[oauth]',                 '[{"method": "oauth"}]', false),
  ('[sso/saml]',              '[{"method": "sso/saml"}]', false),
  ('[anonymous]',             '[{"method": "anonymous"}]', false),
  ('[email/signup]',          '[{"method": "email/signup"}]', false),
  ('[token_refresh]',         '[{"method": "token_refresh"}]', false),
  ('[PASSWORD]',              '[{"method": "PASSWORD"}]', false),
  ('[OTP]',                   '[{"method": "OTP"}]', false),
  ('[password, oauth]',       '[{"method": "password"}, {"method": "oauth"}]', false),
  ('[password, null]',        '[{"method": "password"}, null]', false),
  ('[password, no method]',   '[{"method": "password"}, {"x": "totp"}]', false);

insert into cases
select m || ' with ' || s.label, pg_temp.event(pg_catalog.to_jsonb(m), pg_temp.with_amr(b.claims, s.amr)), s.allowed
from base b, sessions s, unnest(array['token_refresh', 'totp']) as m;

select is(
  private.sign_in_access_token(c.event),
  case when c.allowed then pg_catalog.jsonb_build_object('claims', c.event->'claims') else (select value from refusal) end,
  c.label || case when c.allowed then ': token issued, claims unchanged' else ': refused with 403' end)
from cases c
order by c.label;

-- The refusal does not tell a caller which methods would work.
select is_empty(
  $$ select m from refusal, unnest(array['password', 'magic', 'link', 'otp', 'code', 'email', 'recovery', 'invite', 'totp']) as m
     where pg_catalog.strpos(pg_catalog.lower(value->'error'->>'message'), m) > 0 $$,
  'the refusal message names no method');

-- An allowed method with no claims, or JSON-null claims, returns {"claims": null}.
-- Supabase Auth always sends claims; if it ever did not, it rejects a hook result
-- without claims and answers 500, so sign-in fails closed (N1 investigation,
-- question 5). Pinned here so a change to this behaviour is deliberate.
select is(private.sign_in_access_token('{"authentication_method": "password"}'::jsonb),
  '{"claims": null}'::jsonb, 'allowed method without claims: {"claims": null} (Auth answers 500)');
select is(private.sign_in_access_token('{"authentication_method": "password", "claims": null}'::jsonb),
  '{"claims": null}'::jsonb, 'allowed method with JSON-null claims: {"claims": null} (Auth answers 500)');

-- The hook it replaces is gone.
select hasnt_function('private', 'passwordless_access_token', array['jsonb'], 'the passwordless hook (decision 18) is dropped');

-- Definition (decision 18, kept by PW-01).
select function_lang_is('private', 'sign_in_access_token', array['jsonb'], 'plpgsql', 'hook is plpgsql');
select volatility_is('private', 'sign_in_access_token', array['jsonb'], 'stable', 'hook is stable');
select function_returns('private', 'sign_in_access_token', array['jsonb'], 'jsonb', 'hook returns jsonb');
select isnt_definer('private', 'sign_in_access_token', array['jsonb'], 'hook is not security definer');
select is((select proconfig from pg_catalog.pg_proc where oid = 'private.sign_in_access_token(jsonb)'::regprocedure),
  array['search_path=""'], 'hook pins search_path to empty and sets nothing else');
select function_owner_is('private', 'sign_in_access_token', array['jsonb'], 'postgres', 'hook is owned by postgres');

-- Grants (spec §4.5 "Auth hook grant").
select set_eq(
  $$ select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, a.privilege_type
     from pg_catalog.pg_proc p, pg_catalog.aclexplode(p.proacl) a
     where p.oid = 'private.sign_in_access_token(jsonb)'::regprocedure $$,
  $$ values ('postgres', 'EXECUTE'), ('supabase_auth_admin', 'EXECUTE') $$,
  'hook grantees are exactly postgres and supabase_auth_admin (not PUBLIC, anon, authenticated, service_role)');
select ok(has_function_privilege('supabase_auth_admin', 'private.sign_in_access_token(jsonb)', 'execute'),
  'supabase_auth_admin can execute the hook');
select ok(not has_function_privilege('anon', 'private.sign_in_access_token(jsonb)', 'execute'),
  'anon cannot execute the hook');
select ok(not has_function_privilege('authenticated', 'private.sign_in_access_token(jsonb)', 'execute'),
  'authenticated cannot execute the hook');
select ok(not has_function_privilege('service_role', 'private.sign_in_access_token(jsonb)', 'execute'),
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
       and p.oid <> 'private.sign_in_access_token(jsonb)'::regprocedure
       and has_function_privilege('supabase_auth_admin', p.oid, 'execute') $$,
  'supabase_auth_admin executes no other function in api, cms or private');
select is_empty(
  $$ select c.oid::regclass from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname in ('api', 'cms', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       -- MAINTAIN exists from PostgreSQL 17 (config.toml [db] major_version = 17).
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
