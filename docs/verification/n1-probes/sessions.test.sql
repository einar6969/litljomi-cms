begin;
select plan(3);
select ok((select count(*) from auth.mfa_amr_claims where authentication_method = 'otp') > 0, 'amr rows are recorded (otp sessions exist), so the next check is not vacuous');
select is((select count(*)::int from auth.mfa_amr_claims where authentication_method = 'password'), 0, 'no session was ever created from a password sign-in');
select is((select count(*)::int from auth.users where email = 'editor@probe.local' and encrypted_password is not null and encrypted_password <> ''), 1, 'the editor does hold a password (set during the probe), yet has no password session');
select * from finish();
rollback;
