# Task 2 (Local Supabase stack and pgTAP harness): security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01. Task 2 is not on the plan's security-sensitive list; the controller ran this review because every later security test relies on the impersonation helpers, config.toml sets auth and Data API exposure, and the task carried a sandbox change.
- Change: `c35e720..7933579` (7933579) and the controller's settings commit 7c36be8
- Result: **PASS** (no checklist item fails), with 3 Important findings that come from the plan's own text (two reported as possible contradictions with the spec) and 6 Minor.
- Probes: rolled-back pgTAP files under `scratchpad/sec-r1-probe/`; HTTP against the local stack; a fresh `supabase init` diff. The database was reset after the plain-run reproduction; stack left running.

## Checklist (verbatim in substance)
1 pass: schema `tests` has 7 functions, none `prosecdef`, all `search_path=""`, all plpgsql, all names schema-qualified; no migration exists.
2 pass as written: `cms`, `private`, `api` do not exist yet; `tests` not exposed (`Accept-Profile: tests` → PGRST106). See F2.
3 not applicable (no application grants yet). Note: `tests.*` carry the default PUBLIC EXECUTE inside the test transaction until Task 4's global revoke.
4–9, 11, 12 not applicable.
10 pass: no secret patterns in Task 2 files; `supabase/.temp` and `.branches` ignored and untracked; config.toml holds only `env(...)` placeholders; the wrapper logs no environment.
13 pass, with two contradictions reported (F2, F3).
14 pass: `git show 7c36be8` changes only `.claude/settings.json` and matches the approved diff (m1-gates.md) line for line; the implementer's range touches no `.claude/**`; the broader reach is recorded as accepted.

## Impersonation fidelity
`b_main.test.sql` 22/22: after `act_as`, `current_user` and `current_setting('role')` are `authenticated`, `auth.uid()` is the persona, `auth.role()` is `authenticated`, `aal` defaults to `aal1`; a second `act_as` replaces `sub`; on a test RLS table each editor sees only its row, an `aal2` policy shows the row for `aal2` and hides it for `aal1`, `anon` sees 0 rows with `auth.uid()` null, `service_role` sees all (bypassrls, as in real requests); helpers stay callable after switching to `anon`; claims do not carry across files; after rollback the schema, users and table are gone. The role switch works because session user `postgres` is a member of the three roles.

## Findings (verbatim in substance)

Important
- F1 `_helpers.sql:91-98`: `act_as_owner()` runs only `reset role`, so the previous persona's `request.jwt.claims` stays set. Probe: `act_as(editor_labak); act_as_owner();` → `auth.uid()` still `editor_labak` with `current_user = postgres`. No real request is "owner with a user's JWT". Under decisions 11 and 12 the actor triggers stamp `auth.uid()` whenever it is not null, so owner-context fixtures written after any `act_as` get the last persona as actor (e.g. `publish_requests.requested_by = revoked` rewritten to `editor_labak`), misleading revoked-membership and system-event tests. Plan line 586 already uses `act_as_owner()` right after `act_as(platform_admin,'aal2')`. The code follows the plan's interface ("`act_as_owner()` (`reset role`)") verbatim; changing it needs a controller ruling.
- F2 (possible contradiction) `config.toml:13`: `schemas = []` makes PostgREST fall back to `public`. Anon probe: `Accept-Profile: public` returns the OpenAPI document; `graphql_public`, `auth`, `storage`, `tests` → PGRST106 "Only the following schemas are exposed: public". `public` is empty now (0 relations, 0 functions), so nothing is reachable, but decision 16 says "no application schema exposed" and "At no point is anything exposed beyond §4.2"; Supabase's default privileges would expose to `anon` any table created in `public` before Task 4. Suggested: Task 4 Step 4a also asserts `Accept-Profile: public` is rejected.
- F3 (contradiction with §4.4) `config.toml:220-222`: `[auth.email] enable_signup = false` turns off the email provider entirely: `GET /auth/v1/settings` → `"email":false`; `POST /auth/v1/otp` → `422 email_provider_disabled` "Email logins are disabled". §4.4 requires editor sign-in by email magic link / one-time code. Fails closed (not a loosening). The value is verbatim from the plan, so it is a plan defect. Self sign-up is disabled as intended (`/signup` → `signup_disabled`; anonymous sign-ins refused).

Minor
- `_helpers.sql:5,100-101`: a plain `supabase test db` runs `_helpers.sql` outside a transaction and commits schema `tests` with USAGE and EXECUTE for `anon`, `authenticated`, `service_role`; `authenticator` is a member of those roles, so if `tests` were ever exposed an anon caller could `set local role service_role`. Fails loudly (next `pnpm db:test` fails) and is documented in V-HELPERS. Optional hardening: make the first statement something that errors outside a transaction block (e.g. `savepoint`); pg_prove stops at the first error.
- `000_harness.test.sql:10`: `isnt(current_user,'authenticated')` would also pass if the role were left as `anon` or `service_role` (probe confirms it returns to `postgres`). Verbatim from the plan.
- `act_as*`: claims carry only `sub`, `role`, `aal` as specified; real JWTs also carry `is_anonymous`, `session_id`, `amr`, `email`, and PostgREST sets `search_path` to the exposed schemas. Later policies reading those claims, or tests with unqualified names, would not behave like a real request.
- `tools/db/test.mjs:14-18`: no shell, array arguments, names from `readdirSync` filtered to `*.test.sql` and prefixed with the directory, `process.argv` ignored (so `--linked` cannot be passed). `result.error` is not reported (a missing binary exits 1 silently); paths are cwd-relative. Every planned pgTAP file ends in `.test.sql`.
- `config.toml:227`: `enable_confirmations = false` reports `mailer_autoconfirm: true`; possibly lets email changes apply without confirmation (unverified). Fine locally; must not carry over to the hosted config.
- Outside the diff: `.claude/settings.local.json` is untracked (modified 22:11, before Task 2) and contains broad allow rules such as `Bash(git apply *)`. Not part of any reviewed diff; for awareness.

## Controller pre-checks for the findings (2026-11-01, throwaway project in the scratchpad, sandboxed)
- F2 alternative `[api] schemas = ["graphql_public"]`: stack healthy; `Accept-Profile: public` → 406 (not exposed); `Accept-Profile: graphql_public` → 200.
- F3 alternative `[auth] enable_signup = false` with `[auth.email] enable_signup = true`: `/auth/v1/settings` → `"email":true`, `"disable_signup":true`; `/signup` → 422 `signup_disabled`; `/otp` for an unknown email with `create_user:false` → 422 `otp_disabled` ("Signups not allowed for otp"); a user created through the admin API (secret key) → `/otp` 200 and a "Your sign-in link" message in the local mail catcher.
- F1, F2 and F3 change plan text (Task 2's config list and helper interface, decision 16, Task 4 Step 4a), and F3 is a plan/spec conflict: per CLAUDE.md they go to Einar for a decision before any fix.
