# Task 2 (Local Supabase stack and pgTAP harness): security review, round 2

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01
- Change: fix `50b16c0..20e1748`; plan amendment `169432e..50b16c0`
- Result: **PASS**. F1, F2, F3, M1 (savepoint), M2 (wrapper error) ADDRESSED. New: 1 Important (a contradiction with §4.4, reported, not fixed) and 2 Minor.
- Probes: rolled-back pgTAP files and HTTP probes under `scratchpad/sec-r2-probe/` (keys held in shell variables only). `pnpm db:reset` at the end; admin API `{"users":[]}`; `pnpm db:test` Tests=4 PASS.

## Checklist (verbatim in substance)
1 pass: `tests` has 7 functions, none `prosecdef`, all `search_path=""`, schema-qualified; no migrations. The only function reachable through the Data API is Supabase's own `graphql_public.graphql(...)` (owner supabase_admin, not secdef, a stub returning "pg_graphql extension is not enabled.").
2 pass: `api`, `cms`, `private` do not exist yet. With the publishable key, `Accept-Profile` public, tests, auth, storage, extensions, graphql, vault, realtime, pgbouncer, supabase_functions → 406 PGRST106 ("Only the following schemas are exposed: graphql_public"); `graphql_public` → 200, OpenAPI lists only `/` and `/rpc/graphql`. pg_graphql not installed. `/storage/v1/bucket` → `[]`. Only Supabase's default surface.
3 not applicable; `tests.*` grants exist only inside the test transaction (`hasnt_schema('tests')` and 0 users after rollback).
4–9, 11, 12 not applicable.
10 pass: no key values committed; the fix adds none; the wrapper's new error prints only `result.error.message`.
13 pass: one contradiction reported (N1).
14 pass: no `.claude` change since 169432e.

## Verdicts
- F1 ADDRESSED (`_helpers.sql:99-100`), 30/30: after `act_as(editor,'aal2')` then `act_as_owner()`: `current_user` postgres, `current_setting('role')` 'none'; `auth.uid()`, `auth.jwt()`, `auth.role()`, `auth.email()` all NULL; `request.jwt.claims` ''; legacy `request.jwt.claim.*` unset; same after `act_as_anon` and `act_as_service`; matches the pre-`act_as` baseline; a following `act_as(editor_demo)` sets `sub` and `aal1` cleanly. Round 1's leak assertion now fails as expected. `000_harness.test.sql:11` is not vacuous (`is()` uses IS NOT DISTINCT FROM).
- F2 ADDRESSED (`config.toml:13`): see items 1 and 2.
- F3 ADDRESSED (`config.toml:177,222`): settings `"email":true`, `"disable_signup":true`, anonymous, phone, all OAuth, SAML and passkeys off. For an unknown email every route to a user or a session is refused: `/signup` (email+password, anonymous, phone), `/otp` (`create_user` false, true or omitted; phone), `/magiclink`, `/token` (password, id_token, web3, pkce), `/verify`, `/authorize?provider=github`, `/sso`, `/invite`, `/admin/*` with the publishable key, `/oauth/clients/register`, passkeys; `/recover` and `/resend` return 200 `{}` but send no mail and create no user. A user provisioned through the admin API got `/otp` 200, the sign-in link, and a session from its token_hash on `/verify`.
- M1 ADDRESSED (`_helpers.sql:6`): `supabase test db …/_helpers.sql` stops at line 6 ("SAVEPOINT can only be used in transaction blocks", psql exit 3); `hasnt_schema('tests')` afterwards; a plain full run commits nothing and `pnpm db:test` passes without reset; inside the normal run the savepoint changes nothing (role and claims survive a caught error; rollback removes schema, probe table and users).
- M2 ADDRESSED: with `PATH=/nonexistent`, the wrapper prints "db:test: could not run the Supabase CLI (spawnSync supabase ENOENT). Is `supabase` installed and on PATH?" and exits 1.
- Plan amendment accurate. Round 1's unverified suspicion about `enable_confirmations = false` and email changes is refuted locally: `PUT /user {"email":…}` leaves `email` unchanged, sets `new_email` pending and mails both addresses; the protection is `double_confirm_changes = true` (`config.toml:225`).

## New findings
- **N1 Important (contradiction with §4.4 "No passwords in v1"; reported, not fixed)** `config.toml:222,229,183`: enabling the email provider also enables password sign-in; GoTrue has no separate switch. Probe: after a magic-link sign-in, the provisioned editor ran `PUT /auth/v1/user {"password":"abc123"}` → 200 with no re-authentication (`secure_password_change = false`, `minimum_password_length = 6`); then `POST /token?grant_type=password` → 200 with an access token. Nobody unprovisioned can obtain a session, but any editor, or anyone holding an editor's session, can create a password that bypasses email sign-in (editors have no MFA; the password grant is rate-limited per IP only). The F3 correction (required by §4.4) made this reachable, so it is not a Task 2 checklist failure; the local and hosted configuration need Einar's ruling (e.g. a password-verification hook rejecting every attempt, or `secure_password_change` plus a stronger minimum length).
- Minor `config.toml:177,222`: `/otp` with `create_user:false` distinguishes provisioned (200) from unknown (422 otp_disabled) emails (Supabase default behaviour); relevant to the sign-in UI and hosted runbook; not a spec violation.
- Minor `_helpers.sql:6`: the savepoint guard relies on psql stopping on error (pg_prove and `supabase test db` do); a plain `psql -f _helpers.sql` would continue and commit schema `tests`. Residual and acceptable as documented.

Notes: the reviewer wrote nothing in the repository; the local mail catcher still holds three probe messages (not database state). Out of scope: commit 20e1748's trailer reads "Claude Sonnet 5.5" where the fix list specified "Claude Opus 5.5".
