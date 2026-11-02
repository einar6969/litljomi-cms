begin;
select plan(30);
-- direct calls of the hook for every documented authentication_method
create temporary table cases (method text, amr jsonb, allowed boolean);
insert into cases values
  ('otp', null, true), ('magiclink', null, true), ('totp', '[{"method":"otp"}]', true), ('recovery', null, true), ('totp', null, false), ('totp', '[{"method":"password"}]', false), ('token_refresh', null, false), ('token_refresh', '[]', false), ('token_refresh', '["otp"]', false), ('token_refresh', '[{"x":1}]', false),
  ('invite', null, true), ('email_change', null, true),
  ('password', null, false), ('oauth', null, false), ('sso/saml', null, false), ('anonymous', null, false),
  ('email/signup', null, false), ('oauth_provider/authorization_code', null, false), ('web3', null, false),
  ('something_new', null, false), (null, null, false),
  ('token_refresh', '[{"method":"otp"}]', true),
  ('token_refresh', '[{"method":"otp"},{"method":"totp"}]', true),
  ('token_refresh', '[{"method":"password"}]', false),
  ('token_refresh', '[{"method":"otp"},{"method":"password"}]', false),
  ('token_refresh', '[{"method":"oauth"}]', false);
select is(
  (private.passwordless_access_token(pg_catalog.jsonb_build_object(
     'user_id', gen_random_uuid(), 'authentication_method', c.method,
     'claims', pg_catalog.jsonb_build_object('sub', 'x', 'role', 'authenticated', 'aal', 'aal1', 'amr', c.amr)
   )) ? 'claims'),
  c.allowed,
  pg_catalog.format('method %s amr %s -> %s', coalesce(c.method, '<null>'), coalesce(c.amr::text, '-'), case when c.allowed then 'allowed' else 'refused' end))
from cases c;
-- grants and exposure
select ok(not has_function_privilege('anon', 'private.passwordless_access_token(jsonb)', 'execute'), 'anon cannot execute the hook');
select ok(not has_function_privilege('authenticated', 'private.passwordless_access_token(jsonb)', 'execute'), 'authenticated cannot execute the hook');
select ok(has_function_privilege('supabase_auth_admin', 'private.passwordless_access_token(jsonb)', 'execute'), 'supabase_auth_admin can execute the hook');
select is((select prosecdef from pg_proc where oid = 'private.passwordless_access_token(jsonb)'::regprocedure), false, 'hook is not security definer');
select * from finish();
rollback;
