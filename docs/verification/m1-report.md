# M1 report: staging (Tasks 28 and 29)

Results only: no secret, key or token value is ever written here. Created resources and how to undo them: `docs/verification/m1-gates.md`, "Hosted items and how to undo them".

## Task 28: provisioning record

### G3 Supabase staging (2026-11-03)

- **Project:** organisation "Litljómi" (Free), project "staging", reference `rwpgpfsmhhtimauvpoyt`, Central EU (Frankfurt). Created by Einar.
- **G3.4 Auth settings** (controller in the browser pane, Einar signed in; each value read back after save and reload): sign-up **off**; confirm email on; anonymous sign-ins and manual linking off; Email the only provider (Phone, SAML, Web3 and all OAuth providers disabled); secure email change on; secure password change **on** (was off); Email OTP expiration 3600 s; TOTP enrol and verify enabled, SMS MFA off; access token (JWT) expiry 3600 s. Not in the runbook, left at defaults: Email OTP length 8 (the mail carries no code); "Require current password when updating" off.
- **G3.2a (decision 36.7, before `db push`):** `alter role service_role set statement_timeout = '10s';` accepted; `rolconfig` = `{statement_timeout=10s}`.
- **G3.2b:** Einar ran `supabase login`, `supabase link --project-ref rwpgpfsmhhtimauvpoyt`, `supabase db push` (17 migrations applied); `supabase migration list`: all 17 versions in Local and Remote. `to_regprocedure('private.passwordless_access_token(jsonb)') is not null` → `true`.
- **G3.3:** exposed schemas `api` only (`public` and `graphql_public` removed), saved and confirmed after reload. Order correction: G3.2c needs `api` exposed, so G3.3 was done before G3.2c's REST call (Einar: "Yes, do G3.3 first"). Left unchanged and raised with Einar: the Data API page's "Automatically expose new tables" is on.
- **G3.2c (decision 36.7, over REST):** c1: `service_role` `{statement_timeout=10s}`; `authenticator` `{session_preload_libraries=supautils, safeupdate, statement_timeout=8s, lock_timeout=8s}`. Runs of c4 (Einar's `timeout-check.sh`, target `rwpgpfsmhhtimauvpoyt.supabase.co`):
  1. `HTTP 406, 0.56 s, PGRST106`: `api` not yet exposed (stop; G3.3 done first).
  2. `HTTP 500, 8.50 s, 55P03`: timing missed; c3 never started (the SQL editor did not start a second tab's query in the same page while c2 ran).
  3. Repeat with c3 in a separate browser tab: **`HTTP 500, 10.57 s, 57014`. Pass.**
