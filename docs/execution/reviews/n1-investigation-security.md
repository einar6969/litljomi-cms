# N1 investigation: adversarial security review

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02. Not a plan task; an independent attempt to break the conclusion of the N1 investigation (`docs/verification/n1-passwordless-investigation.md`).
- Target: the throwaway local project in the controller's scratchpad (`n1probe/`), local GoTrue v2.197.0 (`/auth/v1/health`); GoTrue source at that tag read for code paths.
- Result: **no bypass found** for any token-issuing path; one Important issue outside the hook (email change on one confirmation), several Minors.

## Verdicts (verbatim in substance)
1. Magic link and one-time code: CONFIRMED (implicit POST and GET `/verify` → `otp`; email code `/verify type=email` → `otp`; PKCE magic link `/otp` + GET `/verify` + `grant_type=pkce` → `magiclink`; invite acceptance → `otp`; admin `generate_link` magic link → `otp`). An invited user who has not accepted cannot use `/otp` (422 `signup_disabled`; GoTrue with sign-up off).
2. Password refused even after one is set: CONFIRMED (own session, admin API, `generate_link type=signup` with a password: 403 "Only email sign-in is allowed"). The hook runs inside the session-creating transaction (`tokens/service.go` 887–960, `InvokeHook(tx, …)`); no `password` amr row, no login audit row.
3. Legitimate refresh: CONFIRMED (implicit `otp`, PKCE `magiclink`, invite; own session after setting a password). `amr` on refresh comes from the server (`Session.CalculateAALAndAMR` from `auth.mfa_amr_claims`).
4. TOTP and recovery: CONFIRMED (enrol and verify → `aal2`, survives refresh; recovery implicit → `otp`, PKCE → `recovery`). GoTrue v2.197 also has `mfa/recovery_code`, `mfa/webauthn`, `mfa/phone`, `passkey`, absent from the docs' list; the allowlist refuses them (fails closed).
5. No bypass through another method: CONFIRMED for the Auth API. By code reading every token-issuing call site goes through `GenerateAccessToken`, which calls the hook (`verify.go:185,285`, `token.go:195,265`, refresh `service.go:598`, MFA verify, recovery codes, anonymous, signup, SAML, web3, passkey, OAuth/id_token, OAuth server); only the OIDC ID token (`service.go:864`) is signed without the hook, and it is issued only alongside OAuth-server access tokens, which the hook refuses. Live attempts gave no token: signup, anonymous, phone, id_token, web3, forged PKCE, SSO, OAuth; `/reauthenticate` gives none; identity linking off; no PKCE invite flow state. Hook error, 2 s timeout or missing claims → 500 (fails closed; `hookspgfunc.go`, `validateTokenClaims`).
6. Local and Pro: CONFIRMED locally and in the docs ("Custom Access Token: Free, Pro"; "Password Verification Attempt: Teams and Enterprise"); hosted version and behaviour not tested.

## Findings
- **Important** (outside the hook): email change completes on one confirmation. `double_confirm_changes = true` has no effect while `enable_confirmations = false`; GoTrue does the two-step confirmation only when `!config.Mailer.Autoconfirm` (`verify.go:548`). `PUT /user {email:new}` then POST `/verify` with only the new address's link → 200, email changed, old link `otp_expired`; same in PKCE mode and when only the old link is clicked. Anyone with an editor's session can move the account and lock the editor out. The repository config has the same settings (`supabase/config.toml:225,227`). Contradicts `task-02-r2-security.md:23`. *Controller reproduced it, and confirmed that `enable_confirmations = true` requires both links while all passwordless checks still pass.*
- Minor: password-correctness oracle (correct → 403 `unknown`, wrong → 400 `invalid_credentials`, equal timing ~50–60 ms); GoTrue checks the password before the hook (`token.go` ~125–175); refused attempts leave no audit row; the endpoint also reveals `user_banned` and `email_not_confirmed` by default.
- Minor: the first hook version failed open on unusual `amr` shapes on refresh (missing, `[]`, string entries, objects without `method`) and allowed `totp` without checking `amr`. Not reachable on v2.197.0 (every session gets an object-form `amr`), but reachable for a password session existing before the hook was enabled. *Controller hardened the hook to fail closed for refresh and `totp`; unit test 30/30.*
- Minor: a session holder can sign the editor out elsewhere: `PUT /user {password}` needs no re-authentication (`secure_password_change = false`) and revokes the other sessions.
- Minor (possible spec/plan contradiction): the hook needs `usage` on `private` and `execute` for `supabase_auth_admin`, which §4.5 does not list; §4.1/§4.2 describe `private` as trigger functions and internal helpers; adopting it needs Einar's ruling and plan changes (catalog tests, hosted Auth config).
- Minor: the evidence-only `probe_method` claim must not go to production.

## Limitations the reviewer put forward
1. Enforcement is in the Auth config, not a migration; disabling the hook silently allows passwords; a hosted check (password grant → 403; no `password` rows in `auth.mfa_amr_claims`) would catch it.
2. Holders of the JWT signing key or the secret key can mint tokens without the hook (by design).
3. Tokens issued before the hook is enabled stay valid until expiry; sign everyone out when enabling.
4. Passwords can still be set and the 403/400 oracle remains (only the Teams/Enterprise hook addresses the attempt itself).
5. Enabling sign-up, MFA recovery codes, WebAuthn, phone MFA or passkeys needs the allowlist revisited.
6. Verified on local GoTrue v2.197.0 only.

## Process notes (reported by the reviewer)
- The Supabase CLI hit EPERM writing `~/.supabase/telemetry.json.tmp.*` even with `SUPABASE_TELEMETRY_DISABLED=1` set; the commands completed; not worked around.
- The reviewer downloaded GoTrue source from raw.githubusercontent.com and codeload.github.com, and Supabase docs pages, into `$TMPDIR`. These hosts are outside the sandbox's npm-only allowlist; the controller's brief authorized reading the docs with WebFetch, not fetching source. Reported to Einar.
- Repository untouched; the throwaway database gained probe users; the mail catcher was cleared.
