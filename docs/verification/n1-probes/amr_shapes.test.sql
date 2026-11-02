begin;
select plan(6);
create temporary table c (label text, method text, claims jsonb);
insert into c values
 ('refresh, amr absent', 'token_refresh', '{"sub":"x","role":"authenticated","aal":"aal1"}'),
 ('refresh, amr empty array', 'token_refresh', '{"sub":"x","role":"authenticated","aal":"aal1","amr":[]}'),
 ('refresh, amr string form ["password"]', 'token_refresh', '{"sub":"x","role":"authenticated","aal":"aal1","amr":["password"]}'),
 ('refresh, amr object without method key', 'token_refresh', '{"sub":"x","role":"authenticated","aal":"aal1","amr":[{"x":"password"}]}'),
 ('totp step-up on a password-derived session', 'totp', '{"sub":"x","role":"authenticated","aal":"aal2","amr":[{"method":"password"},{"method":"totp"}]}'),
 ('mfa/recovery_code (GoTrue v2.197 method)', 'mfa/recovery_code', '{"sub":"x","role":"authenticated","aal":"aal2","amr":[{"method":"otp"}]}');
select diag(label || ' -> ' || case when private.passwordless_access_token(jsonb_build_object('user_id', gen_random_uuid(), 'authentication_method', method, 'claims', claims)) ? 'claims' then 'ALLOWED' else 'refused' end) from c;
select pass(label) from c;
select * from finish();
rollback;
