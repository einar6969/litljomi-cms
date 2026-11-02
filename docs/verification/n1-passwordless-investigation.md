# N1 investigation: passwordless-only sign-in with a Custom Access Token hook

- Date: 2026-11-02. Requested by Einar ("conduct a narrowly scoped, local investigation of whether a Custom Access Token hook can enforce passwordless-only authentication").
- Status: **investigation only.** No change to `docs/architecture.md`, the plan, the repository's migrations or `supabase/config.toml`. N1 stays open until Einar decides.
- Where: a throwaway local Supabase project in the controller's scratchpad (`…/scratchpad/n1probe/`), separate from the repository. Local GoTrue v2.197.0, Supabase CLI 2.121.0, OrbStack. Keys used on the command line only.
- Independent check: a fresh `cms-security-reviewer` (Opus) tried to break the result (report: `docs/execution/reviews/n1-investigation-security.md`); the controller reproduced its main finding and re-ran every probe on the final hook.

## Official documentation (fetched 2026-11-02)
- supabase.com/docs/guides/auth/auth-hooks: Custom Access Token hook available on **Free, Pro**; Password Verification Attempt hook **Teams and Enterprise** only. Postgres hooks are configured as `[auth.hook.<name>]` with `uri = "pg-functions://postgres/<schema>/<function>"`; grant `execute` and schema `usage` to `supabase_auth_admin`, revoke from other roles; the docs recommend against `security definer`. A Postgres hook refuses with `{"error": {"http_code": …, "message": …}}`.
- supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook: the hook receives `user_id`, `claims` and `authentication_method`, documented as `oauth`, `password`, `otp`, `totp`, `recovery`, `invite`, `sso/saml`, `magiclink`, `email/signup`, `email_change`, `token_refresh`, `oauth_provider/authorization_code`, `anonymous`.

## The hook tested (final version)
An allowlist, failing closed: issue a token only for `magiclink`, `otp`, `totp`, `recovery`, `invite`, `email_change` and `token_refresh`; for `token_refresh` and `totp` (which continue an existing session) every `amr` method must be in the allowlist, and a missing, empty or malformed `amr` is refused. `plpgsql`, `stable`, `search_path = ''`, not `security definer`, in schema `private`; `execute` only for `supabase_auth_admin`. SQL in the appendix (the `probe_method` claim was for evidence only and is not part of a proposal).

## Results against Einar's six questions

| # | Question | Result | Evidence |
|---|---|---|---|
| 1 | A provisioned editor can sign in by magic link or email code | **Verified** | Magic link (implicit POST and GET `/verify`, PKCE), email one-time code, invite acceptance and admin `generate_link` all return a session. The hook sees `otp` for implicit links, codes, recovery and invites, and `magiclink`/`recovery` for PKCE. |
| 2 | Password sign-in fails, including after setting one | **Verified** | Password set by the editor's own session, by the admin API, or through a `generate_link` sign-up: `grant_type=password` → 403 "Only email sign-in is allowed". The hook runs inside the transaction that creates the session (GoTrue `tokens/service.go`), so nothing is left behind: no `password` row in `auth.mfa_amr_claims`, no login audit row. |
| 3 | Existing legitimate sessions refresh | **Verified** | Magic-link, code, PKCE, invite and recovery sessions refresh repeatedly (rotation). `amr` on refresh is computed by the server from `auth.mfa_amr_claims`; the client cannot supply it. |
| 4 | MFA and recovery keep working | **Verified** | TOTP enrol + verify → `aal2`; `aal2` survives refresh; a later magic-link sign-in is `aal1` and steps up again. Recovery email signs the editor in, and the session refreshes. |
| 5 | No bypass through another method | **Verified for the Auth API**, with the limits below | Sign-up, anonymous, phone, `id_token`, web3, forged PKCE, SAML SSO and OAuth give no token; `/reauthenticate` gives none. By source reading, every token GoTrue issues goes through `GenerateAccessToken`, which calls the hook. If the hook errors, times out (2 s) or returns no claims, Auth returns 500: it fails closed. Direct unit test of the function: 30/30 (every documented method, unknown and missing methods, and malformed `amr` on refresh and TOTP). |
| 6 | Works locally and is available on Pro | **Local: verified. Pro: documented, not tested** | Works on local GoTrue v2.197.0. The docs list the hook for Free and Pro. Hosted behaviour and version are unverified (no hosted access before G3). |

Final runs on the hardened hook with email confirmations on: HTTP probe 25/25; unit test 30/30; session checks pass; the reviewer's adversarial scripts show the same behaviour.

## Found during the investigation
- **Email change completes on one click (Important; affects the repository's current config).** With `[auth.email] enable_confirmations = false`, `double_confirm_changes = true` has no effect (GoTrue applies the two-step confirmation only when auto-confirm is off). Reproduced by the controller: `PUT /user {email: new}` from an editor's session, then clicking only the new address's link → the account's email becomes the new address and the old link expires. Anyone holding an editor's session could move the account to their own mailbox. With `enable_confirmations = true`, the new link alone is not enough ("proceed to confirm link sent to the other email"); the email changes only after both links; all 25 passwordless checks still pass. This also corrects `task-02-r2-security.md`, which credited `double_confirm_changes` alone, and the "local only" note on `enable_confirmations = false` in plan decision 17.
- **Password-correctness oracle (Minor, cannot be closed on Pro).** GoTrue checks the password before the hook runs: correct password → 403, wrong → 400 (same timing). The password is useless for sign-in, but the response confirms a guess (relevant only if an editor reuses it elsewhere). Refused attempts leave no audit row; they appear only in the Auth logs.
- **A session holder can sign the editor out elsewhere (Minor).** `PUT /user {password}` needs no re-authentication (`secure_password_change = false`) and revokes the user's other sessions; the editor signs in again by magic link. Not tested: whether `secure_password_change = true` changes this.

## Limitations
1. Enforcement lives in the Auth configuration, not in a migration. Turning the hook off in the dashboard, or a config push without it, silently allows passwords again. A hosted check would catch it: a password grant for a test editor with a password must return 403, and `auth.mfa_amr_claims` must hold no `password` rows.
2. Anyone with the JWT signing secret or the Supabase secret key can issue tokens without the hook (for example `generate_link`); that is by design and matches §8.1.
3. Access tokens issued before the hook is switched on stay valid until they expire (up to an hour); sign everyone out when enabling it.
4. Passwords can still be set, and the 403/400 oracle remains; only the Teams/Enterprise Password Verification Attempt hook could address the attempt itself.
5. The allowlist refuses methods GoTrue has but v1 does not use (`mfa/recovery_code`, WebAuthn, phone MFA, passkeys, sign-up). Enabling any of them later needs the allowlist revisited.
6. The hook must answer within 2 seconds; if the database is unavailable, sign-in fails (closed) rather than allowing passwords.
7. Everything was verified on local GoTrue v2.197.0 only.

## Not in the current architecture or plan (for Einar's decision)
- §4.5 lists the grants for `authenticated` and `service_role`; the hook needs `usage` on `private` and `execute` on one function for `supabase_auth_admin` (Supabase's own Auth role). §4.2 describes `private` as "trigger functions and internal helpers".
- The catalog tests, the local `config.toml`, the Task 3 runbook (enable the hook on hosted, the verification check, sign everyone out) and the staging acceptance would each need a line.

## Appendix: the hook as finally tested (throwaway migration)
```sql
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
  return pg_catalog.jsonb_build_object('claims', claims);
end;
$$;

grant usage on schema private to supabase_auth_admin;
grant execute on function private.passwordless_access_token(jsonb) to supabase_auth_admin;
revoke execute on function private.passwordless_access_token(jsonb) from public, anon, authenticated;
```
(Two evidence-only lines that added a `probe_method` claim are omitted above.)

Throwaway config differences from the repository's `supabase/config.toml`: `[auth.hook.custom_access_token] enabled = true, uri = "pg-functions://postgres/private/passwordless_access_token"`; `[auth.email] enable_confirmations = true`; a magic-link template that includes `{{ .Token }}` (the default local template has only the link); `[auth.rate_limit] email_sent = 100` for the probe.
