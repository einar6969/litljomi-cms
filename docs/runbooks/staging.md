# Staging runbook: hosted environments for M1

## 1. Purpose and status

This runbook sets up the M1 staging environment: the GitHub repository, the hosted Supabase staging project, the email provider, the litljomi.is DNS records and the three Vercel projects. It is the procedure Task 28 follows and Task 29 checks.

**Status.** Written in Task 3 (2026-11-02) as a document only. **Nothing in it was executed in Task 3**: no account, project, record, key or deployment exists because of it. It is executed only in Task 28, one gate at a time (G2, G3, G4, G5, G6). Each gate is approved by Einar in his own words in chat and recorded by the controller in `docs/execution/gates.json` before any step under it runs. Approval of one gate does not cover another. Paid upgrades are Einar's alone; every paid step is marked "**Einar: upgrade when needed**".

**Sources.** `docs/architecture.md` (§2.2, §4.2, §4.4, §7.3, §8.2, §8.4, §11) and the plan `docs/plans/2026-11-01-m0-m1.md` (gates G2–G6, DECISION-SMTP, decisions 16–21, Tasks 28 and 29). If this runbook and the spec disagree, the spec wins: stop and report.

**Conventions.**
- Every step names its **Owner**, the **Settings** to apply and the **Verify** check that shows it worked. A step whose check fails stops the gate: record the result and report to the controller, who reports to Einar.
- **Einar** acts in his own accounts (sign-ups, payment, DNS, provider keys). **Executor** means the agent the controller dispatches, acting only after the gate is recorded.
- "§" numbers refer to the spec (`docs/architecture.md`); "section N" refers to this runbook.
- "**Confirm at execution time**" marks a value or screen this runbook could not verify when it was written (dashboard menu paths, provider record values, CLI details). The executor checks it against the live screen or the provider's current documentation and records what was found; it never guesses.
- Placeholders are in angle brackets: `<cms-staging-host>`, `<demo-staging-host>`, `<labak-staging-host>` (the three staging hostnames in the litljomi.is zone, chosen by Einar at G5), `<project-ref>` (the Supabase staging project's reference), `<hook-test-address>` (a throwaway address Einar controls).
- **No secret, key or token value is ever written** to this repository, a commit, a chat message, a log or a report. Commands read secrets from the environment (`.env.local`, never committed) and never print them. See section 12.

**Off-limits.** `labak.is` DNS, the existing Vercel project `landssamband-bakarameistara`, the hostnames `labak.litljomi.is` and `labak.is`, and the LABAK repository's `main` branch are never touched by this runbook.

## 2. Prerequisites

| # | Prerequisite | Owner | Verify |
|---|---|---|---|
| P1 | Tasks 0–27 complete and green locally (`pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test && pnpm db:reset && pnpm db:test && pnpm test:integration`) | Executor | Every command exits 0; the controller's `state.json` shows Tasks 0–27 done |
| P2 | Task 4's migration (creating `api`, `cms`, `private` and `private.passwordless_access_token`) and its `[api] schemas = ["api"]` are committed | Executor | `git log --oneline -- supabase/migrations` lists it; `grep -n 'schemas = \["api"\]' supabase/config.toml` matches |
| P3 | The LABAK branch `hub-integration` exists (Task 27, G7) | Controller | G7 recorded in `gates.json`; Task 27 done in `state.json` |
| P4 | Einar has accounts he controls at GitHub (`einar6969`), Supabase, Vercel and the chosen email provider, and access to the litljomi.is DNS zone | Einar | Einar confirms in chat at each gate |
| P5 | The hosts each gate needs are allowed for the session: adding a host to `allowedDomains` is a `.claude/**` change that Einar approves, limited to that gate's hosts and removed afterwards unless he decides otherwise | Einar approves; controller applies | The approved diff is recorded; a sandbox refusal is reported, never worked around |
| P6 | Local tools: `git`, `gh`, `supabase` (2.121.0, as in CI), `vercel`, `curl`, `jq`, `openssl`, `dig` | Einar (any install is G1) | `<tool> --version` for each |

## 3. Deployment sequence

Task 28 follows this order. Each step lists what it depends on.

| Order | Step | Gate | Depends on |
|---|---|---|---|
| 1 | G2.1–G2.3: private repository, push `main`, CI green | G2 | P1 |
| 2 | G2.4: pin GitHub Actions to commit SHAs | G2 | G2.1 |
| 3 | G2.5: publish `@litljomi/cms-sdk` and `@litljomi/rich-text` 0.1.0; update `hub-integration` dependencies | G2 (and G7 for the LABAK branch) | G2.3, P3 |
| 4 | G3.1: Supabase organisation and EU staging project | G3 | P4 |
| 5 | G3.2: `supabase link`, `supabase db push` (includes the hook function) | G3 | G3.1, P2 |
| 6 | G3.3: Data API exposes `api` only | G3 | G3.2 (the `api` schema must exist) |
| 7 | G3.4: Auth settings (section 6), except SMTP and the Site URL | G3 | G3.1 |
| 8 | G3.5: enable the passwordless hook, revoke all sessions, run the hook verification (section 7) | G3 | G3.2, G3.4; **before any editor account exists** |
| 9 | G4.1–G4.2: email provider account, sending domain, API key | G4 | DECISION-SMTP made by Einar |
| 10 | G5.1: email authentication records (SPF, DKIM, DMARC) in litljomi.is | G5 | G4.1 (values come from the provider) |
| 11 | G3.6: custom SMTP in Supabase Auth; raise the email rate limit | G3 (G4 credentials) | G4.2, G5.1 verified |
| 12 | G6.1: three Vercel projects; Pro plan for per-minute cron | G6 | G2.3, G2.5, P3 |
| 13 | G5.2: staging hostnames in litljomi.is, added to the Vercel projects | G5 and G6 | G6.1 |
| 14 | G3.7: Auth Site URL and redirect URLs set to `https://<cms-staging-host>` | G3 | G5.2 (hostname chosen) |
| 15 | G6.2–G6.4: environment variables (section 13), deployment protection, cron | G6 | G3.1, G5.2 |
| 16 | G6.5: deploy all three projects | G6 | G6.2 |
| 17 | P-1–P-3: provision tenants, sites (stores webhook secrets in Vault) and a test editor with `tools/cli`; set each site's `CMS_WEBHOOK_SECRETS`; redeploy the sites | G3 (hosted Supabase) and G6 (site variables); the controller confirms coverage before running | G3.6, G3.7, G6.5 |
| 18 | G4.3: the test editor's invitation arrives with SPF, DKIM and DMARC passing | G4 | P-3 |
| 19 | Section 7.2 hook verification again, then Task 29 (section 14) | none beyond those recorded | everything above |

## 4. G2: GitHub repository

### G2.1 Create the private repository
- **Owner:** Einar approves at G2; executor runs `gh`.
- **Settings:** `gh repo create einar6969/litljomi-cms --private --source /Users/einarzoega/litljomi-cms --remote origin` (confirm the flags at execution time against `gh repo create --help`).
- **Verify:** `gh repo view einar6969/litljomi-cms --json visibility -q .visibility` prints `PRIVATE`; `git -C /Users/einarzoega/litljomi-cms remote -v` shows only `origin` → `einar6969/litljomi-cms`.

### G2.2 Push `main` and enable Actions
- **Owner:** Executor, after G2.
- **Settings:** `git push -u origin main`. Actions enabled for the repository (repository Settings → Actions; confirm at execution time). Never force-push.
- **Verify:** `gh api repos/einar6969/litljomi-cms/actions/permissions -q .enabled` prints `true`; `git ls-remote origin main` matches `git rev-parse main`.

### G2.3 CI green on GitHub
- **Owner:** Executor.
- **Settings:** none (the workflow is `.github/workflows/ci.yml`).
- **Verify:** `gh run list --branch main --limit 1 --json conclusion -q '.[0].conclusion'` prints `success`. A failure stops G2.

### G2.4 Pin GitHub Actions to commit SHAs (deferred from Task 1)
- **Owner:** Executor (a normal reviewed commit in the repository).
- **Settings:** in `.github/workflows/ci.yml`, replace each `uses: <action>@<tag>` (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `supabase/setup-cli`) with `<action>@<40-character commit SHA> # <tag>`, the SHA looked up from the action's own repository at execution time (for example `gh api repos/actions/checkout/git/ref/tags/<tag>`; for an annotated tag, dereference to the commit; confirm at execution time).
- **Verify:** `grep -nE 'uses: [^@]+@[0-9a-f]{40}( |$)' .github/workflows/ci.yml` matches every `uses:` line, `grep -c 'uses:'` equals that count, and the next CI run on `main` is `success`.

### G2.5 Publish the SDK packages; update the LABAK branch
- **Owner:** Executor, after G2 (publishing) and G7 (the `hub-integration` branch). Einar creates the GitHub token used to publish and the read token used by Vercel; the executor never sees a token value.
- **Settings:** publish `@litljomi/cms-sdk` and `@litljomi/rich-text` version `0.1.0` to GitHub Packages under `einar6969` (Task 28 Step 1). On `hub-integration`, replace the `link:` dependencies with `0.1.0` and add an `.npmrc` that reads the registry token from an environment variable, never a committed token. **Confirm at execution time:** GitHub Packages' npm registry ties a package's scope to the owning account; if `@litljomi/*` cannot be published under `einar6969`, stop and report (Einar decides on a `litljomi` organisation or another scope). Free allowances for Actions minutes and Packages storage on a private repository: confirm at execution time; **Einar: upgrade when needed**.
- **Verify:** `npm view @litljomi/cms-sdk@0.1.0 version --registry=https://npm.pkg.github.com` and the same for `@litljomi/rich-text` print `0.1.0` (with Einar's read token in the environment); `git grep -nE '_authToken=[^$]' hub-integration` in the LABAK checkout finds nothing (the token is read from a variable).

## 5. G3: Hosted Supabase

### G3.1 Organisation and staging project in an EU region
- **Owner:** Einar (account, organisation, payment); executor reads the result.
- **Settings:**
  - A Litljómi organisation; a staging project in a specific EU region: West EU (Ireland) `eu-west-1`, West EU (Paris) `eu-west-3`, Central EU (Frankfurt) `eu-central-1` or North EU (Stockholm) `eu-north-1`. Not London `eu-west-2` or Zurich `eu-central-2` (not EU member states), and not the generic "Europe" option (it may not map to a specific jurisdiction). Einar chooses the region and project name.
  - Plan: the spec (§2.2) puts the organisation on Pro (daily backups, §8.4). The Custom Access Token hook is available on Free and Pro, so M1 staging does not depend on the plan. **Einar: upgrade when needed.**
  - The database password is set by Einar and kept in his password manager; it is never written anywhere else.
- **Verify:** the project's settings page shows the chosen region code from the list above (Einar reads it out, or a screenshot without keys); the region and project reference are recorded in `docs/verification/m1-report.md` (no secrets).

### G3.2 Link and apply migrations
- **Owner:** Executor; Einar runs `supabase login` and types the database password at the prompt (never in a command line or file).
- **Settings:** `supabase link --project-ref <project-ref>`, then `supabase db push`. Do not use `supabase config push`: it would push local-only values (`site_url` on localhost, the local email rate limit) and, without the hook block, switch the hook off (decision 18). Dashboard settings in section 6 are applied by hand.
- **Verify:** `supabase migration list` shows every local migration applied remotely (no row with a local version and an empty remote column). In the SQL editor: `select to_regprocedure('private.passwordless_access_token(jsonb)') is not null;` returns `true`.

### G3.3 Data API: expose `api` only (decision 16)
- **Owner:** Executor.
- **Settings:** exposed schemas = `api` only, matching `[api] schemas = ["api"]` in `supabase/config.toml` (Data API settings page; confirm the menu path at execution time). Remove `public` and `graphql_public` if listed. **Never** run Supabase's custom-schema `GRANT ALL` recipe for any schema; grants come only from the migrations (§4.2, §4.5).
- **Verify:** with the publishable key, `curl -s -o /dev/null -w '%{http_code}' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Accept-Profile: <schema>"` returns `406` for `public`, `cms`, `private` and `graphql_public`; a call that Task 4's local verification makes against `api` succeeds the same way on staging (use Task 4's request; confirm at execution time).

### G3.4 Auth settings
- **Owner:** Executor.
- **Settings:** every row of section 6 except SMTP (G3.6), the rate limit (G3.6) and the URLs (G3.7).
- **Verify:** as listed per row in section 6.

### G3.5 Passwordless hook
- **Owner:** Executor; Einar is told the result before G3 continues.
- **Settings and verify:** Section 7.1 (enable, revoke all sessions), then section 7.2 (verification). Runs before any editor account exists on the project.

### G3.6 Custom SMTP and the email rate limit
- **Owner:** Einar enters the SMTP password (the provider API key) in the dashboard; executor sets the other fields and the rate limit.
- **Settings:** Section 8 (SMTP fields for the chosen provider); Auth **Rate Limits** page: emails sent per hour raised from **30** (imposed once custom SMTP is enabled) to **100**. Reason: M1 staging sends only invitations and magic links for a few test editors, and acceptance runs repeat sign-ins; 30 per hour could block a test run, while 100 stays bounded. The provider's own limit still applies (Resend free plan: 100 a day). Einar may choose another value at G3; record the value used.
- **Verify:** the SMTP page shows custom SMTP enabled with the host, port, user and sender of section 8 (password hidden); the Rate Limits page shows 100 emails per hour; the end-to-end check is G4.3.

### G3.7 Site URL and redirect URLs
- **Owner:** Executor.
- **Settings:** Site URL `https://<cms-staging-host>`; redirect URLs: exactly `https://<cms-staging-host>/auth/callback` (the CMS's `emailRedirectTo`, `${CMS_PUBLIC_URL}/auth/callback`). No wildcard, no localhost (URL configuration page; confirm the menu path at execution time).
- **Verify:** the URL configuration page shows those two values only; in the section 7.2 run, the `generate_link` response's `redirect_to` field (printed alone, never the action link) equals `https://<cms-staging-host>`.

## 6. Supabase Auth configuration

Applied on the hosted project by hand (G3.4, G3.6, G3.7). Local equivalents are in `supabase/config.toml` and are regression-tested in `tools/checks/__tests__/supabase-config.test.ts`. Dashboard menu paths, other than the SMTP and Rate Limits pages, are confirmed at execution time.

`$PK` below is `$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `$URL` is `$NEXT_PUBLIC_SUPABASE_URL`, both from `.env.local`. `GET $URL/auth/v1/settings -H "apikey: $PK"` returns public settings only.

| Setting | Hosted value | Local equivalent | Why | Verify |
|---|---|---|---|---|
| Self sign-up | **Off** ("allow new users to sign up" disabled) | `[auth] enable_signup = false` | §4.4: editors are invited by the CLI | `/auth/v1/settings` → `"disable_signup": true`; `POST $URL/auth/v1/signup` for a new address → 422 `signup_disabled` |
| Email provider | **On** (magic link and one-time code) | `[auth.email] enable_signup = true` | Decision 17: turning the provider off disables email sign-in | `/auth/v1/settings` → `"external": {"email": true, …}` |
| Other providers | All off: phone, anonymous, OAuth, SAML, WebAuthn/passkeys | defaults in `config.toml` | Decision 18: enabling any of them needs the hook's allowlist revisited | `/auth/v1/settings` → every other `external` entry `false` |
| Confirm email | **On** | `[auth.email] enable_confirmations = true` | Decision 19 | `/auth/v1/settings` → `"mailer_autoconfirm": false` |
| Secure email change (double confirmation) | **On** | `[auth.email] double_confirm_changes = true` | Decision 19: an email change needs both the old and the new address; with confirmations off it has no effect, so both stay on | The setting shows on; Task 29 criterion 11 checks the behaviour |
| Secure password change | **On** | `[auth.email] secure_password_change = true` | Decision 21: additional protection, not a substitute for the hook | The setting shows on (behaviour below) |
| TOTP MFA | Enrolment and verification **on** | `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true` | §4.4: platform admins enrol TOTP; console needs `aal2` | The MFA settings show TOTP enabled |
| JWT expiry | **3600** seconds, recorded and kept | `[auth] jwt_expiry = 3600` | Decision 18: bounds how long a token issued before the hook stays valid | The setting shows 3600; in section 7.2 the magic-link response has `"expires_in": 3600`; value recorded in `m1-report.md` |
| Site URL, redirect URLs | `https://<cms-staging-host>`; `https://<cms-staging-host>/auth/callback` | `site_url`, `additional_redirect_urls` (localhost) | Magic links land on the staging CMS only | G3.7 |
| Exposed schemas | `api` only | `[api] schemas = ["api"]` | Decision 16, §4.2 | G3.3 |
| Custom SMTP | Provider of DECISION-SMTP (section 8) | `[local_smtp]` (local mail catcher) | §4.4: the built-in sender delivers only to the team's addresses, about 2 an hour, not for production | G3.6, G4.3 |
| Email rate limit | **100** per hour (from the post-SMTP default of 30) | `[auth.rate_limit] email_sent = 2` | G3.6 | G3.6 |
| Custom Access Token hook | **Enabled**, Postgres function `private.passwordless_access_token` | `[auth.hook.custom_access_token] enabled = true`, `uri = "pg-functions://postgres/private/passwordless_access_token"` | Decision 18 | Section 7 |
| Email templates | Icelandic, Litljómi-branded | Task 22 | §4.4 | Task 22 and A11 (not part of this runbook) |

**Secure password change: verified behaviour** (Supabase Auth v2.197.0, `internal/api/user.go`, verified locally on 2026-11-02 in `docs/verification/decision-21-secure-password-change.md`):
- A session **less than 24 hours old** changes the password with no reauthentication (200).
- A session **missing or more than 24 hours old** is refused without a nonce: HTTP 400 `reauthentication_needed` ("Password update requires reauthentication"). `GET /auth/v1/reauthenticate` emails a 6-digit code; the update carrying it as `nonce` succeeds; a wrong nonce gets 422.
- A user with MFA enrolled needs an `aal2` session (HTTP 401 `insufficient_aal` on `aal1`).
- Every password change revokes the user's other sessions; the session that made the change stays valid.
- It is **additional protection only**: it does not stop a recent session from setting a password, it is not fresh email verification for every change, and it does not stop a password from signing in. The passwordless hook (section 7) is the control that keeps passwords from signing in. The Supabase CLI reference describes the setting as requiring "the user's current password"; that is not what the verified version does.
- Whether the hosted project runs the same Auth version: confirm at execution time (the version is shown in the project's settings or Auth logs); if it differs, record it and re-check the behaviour before relying on this description.

## 7. Passwordless Auth hook (decisions 18 and 20)

The hook `private.passwordless_access_token(event jsonb) returns jsonb` (Task 4) issues a token only for the email methods, TOTP step-up and refresh, with the fail-closed `amr` rule; anything else gets `{"error": {"http_code": 403, "message": "Only email sign-in is allowed"}}`. It is part of the Auth configuration, not of a migration, so it must be enabled and verified on every hosted project.

### 7.1 Enabling it (first time, G3.5)
1. **Function present.** Owner: executor. Applied by G3.2 (`supabase db push`). Verify: G3.2's `to_regprocedure` check returns `true`.
2. **Grants.** Owner: executor. Verify in the SQL editor:
   ```sql
   select p.proowner::regrole as owner, p.proacl
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'passwordless_access_token';
   select r as role, has_function_privilege(r, 'private.passwordless_access_token(jsonb)', 'execute') as can_execute
   from unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) r;
   ```
   Success: `proacl` grants `EXECUTE` only to the owner and `supabase_auth_admin`; `can_execute` is `true` for `supabase_auth_admin` only. `supabase_auth_admin` also has `usage` on `private` (`select has_schema_privilege('supabase_auth_admin', 'private', 'usage')` → `true`).
3. **Enable the hook.** Owner: executor. Settings: Authentication hooks page (confirm the menu path at execution time): Custom Access Token hook → enabled, type Postgres, schema `private`, function `passwordless_access_token`. If the page cannot select a function in `private`, **stop and report**; do not move the function or change its grants. Verify: the page shows the hook enabled with that schema and function.
4. **Revoke all sessions** (immediately after step 3, still before any editor exists). Owner: executor, in the SQL editor:
   ```sql
   -- The role used must be allowed to delete there; confirm before relying on it.
   select current_user, has_table_privilege(current_user, 'auth.sessions', 'delete');
   delete from auth.sessions;
   select count(*) from auth.sessions;        -- must be 0
   select count(*) from auth.refresh_tokens;  -- expected 0 (the delete cascades)
   select count(*) from auth.mfa_amr_claims;  -- expected 0 (the delete cascades)
   ```
   Success: `has_table_privilege` is `true` and all three counts are `0`. If the privilege is `false` or a count is not `0`, stop and report. Access tokens already issued stay valid until they expire, at most `jwt_expiry` (3600 seconds, section 6); a refresh then fails, and the fail-closed `amr` rule refuses any earlier password session on refresh. Record the time of the revocation; nothing issued before it is relied on for one hour.
5. **Verify** with section 7.2.

### 7.2 Verification procedure (decision 20)

**When to run it:** after enabling the hook (section 7.1); after any change to hosted Auth settings (dashboard or Management API) or any configuration push; and before each acceptance run (Task 29 and later acceptances). **Recurring automation is deferred** until staging exists (Task 28 or later, by a separate decision; decision 20).

**Owner:** executor runs it; Einar is told the result. **Record** each run (date, who, trigger, each check's result) in `docs/verification/m1-report.md` during M1.

**Checks and expected results:**

| # | Check | Expected |
|---|---|---|
| H1 | Authentication hooks page | Custom Access Token hook **enabled**, Postgres, `private.passwordless_access_token` |
| H2 | Function grants (section 7.1 step 2 queries) | Execute only for the owner and `supabase_auth_admin` |
| H3 | Password sign-in for a test account that has a password | HTTP **403** ("Only email sign-in is allowed") |
| H4 | Magic-link sign-in for the same account | HTTP **200** with an access token; `expires_in` is `3600`; its refresh succeeds |
| H5 | `select count(*) from auth.mfa_amr_claims where authentication_method = 'password';` (SQL editor, after H3–H4) | **0** |
| H6 | Test account deleted (the Auth admin API cannot clear a password, so the account is never reused) | `select count(*) from auth.users where email = '<hook-test-address>';` → **0** |

H3, H4 and H6 run as one script from Einar's machine, with `.env.local` loaded into the environment (confirm at execution time that the hosted Auth admin endpoints accept the secret key in the `apikey` and `Authorization` headers as below). It prints only HTTP codes and the `redirect_to` field; the password, tokens, one-time code and action link are never printed or stored:

```sh
set -eu
: "${NEXT_PUBLIC_SUPABASE_URL:?}" "${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:?}" "${SUPABASE_SECRET_KEY:?}"
URL="$NEXT_PUBLIC_SUPABASE_URL"; PK="$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"; SK="$SUPABASE_SECRET_KEY"
EMAIL='<hook-test-address>'
PW="$(openssl rand -base64 24)"
admin() { curl -s -H "apikey: $SK" -H "Authorization: Bearer $SK" -H 'Content-Type: application/json' "$@"; }

# Test account with a password (the admin API can set one even with sign-up off).
USER_ID="$(admin -X POST "$URL/auth/v1/admin/users" \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PW" '{email: $e, password: $p, email_confirm: true}')" | jq -r '.id // empty')"
[ -n "$USER_ID" ] || { echo 'test account not created: stop'; exit 1; }
cleanup() { admin -o /dev/null -w 'H6 delete: %{http_code}\n' -X DELETE "$URL/auth/v1/admin/users/$USER_ID"; }
trap cleanup EXIT

# H3: password sign-in must be refused by the hook.
curl -s -o /dev/null -w 'H3 password sign-in: %{http_code} (expect 403)\n' -X POST \
  "$URL/auth/v1/token?grant_type=password" -H "apikey: $PK" -H 'Content-Type: application/json' \
  -d "$(jq -n --arg e "$EMAIL" --arg p "$PW" '{email: $e, password: $p}')"

# H4: magic-link sign-in must succeed (admin generate_link sends no email).
LINK="$(admin -X POST "$URL/auth/v1/admin/generate_link" -d "$(jq -n --arg e "$EMAIL" '{type: "magiclink", email: $e}')")"
printf 'redirect_to: %s\n' "$(printf '%s' "$LINK" | jq -r .redirect_to)"
SESSION="$(curl -s -X POST "$URL/auth/v1/verify" -H "apikey: $PK" -H 'Content-Type: application/json' \
  -d "$(printf '%s' "$LINK" | jq '{type: "magiclink", token_hash: .hashed_token}')")"
printf '%s' "$SESSION" | jq -e '(.access_token | length > 0) and .expires_in == 3600' >/dev/null \
  && echo 'H4 magic-link sign-in: ok (expires_in 3600)' || echo 'H4 magic-link sign-in: FAILED'
curl -s -o /dev/null -w 'H4 refresh: %{http_code} (expect 200)\n' -X POST \
  "$URL/auth/v1/token?grant_type=refresh_token" -H "apikey: $PK" -H 'Content-Type: application/json' \
  -d "$(printf '%s' "$SESSION" | jq '{refresh_token: .refresh_token}')"
```

Success: H3 prints `403`, H4 prints `ok` and `200`, `redirect_to` is `https://<cms-staging-host>` (once G3.7 is done), H6 prints `200`; then H5 and H6's SQL in the SQL editor both return `0`. A wrong password would get 400 instead of 403 (a known limitation, section 15), so H3 must use the account's real password.

**If any check fails:** stop; do not provision or invite anyone and do not continue the gate or the acceptance. Re-enable the hook with the right function (section 7.1 step 3), revoke all sessions again (section 7.1 step 4), delete any test account left behind, re-run section 7.2, record the failure and the fix in `m1-report.md`, and tell Einar through the controller.

## 8. Email delivery (G4; DECISION-SMTP open until G4)

Einar chooses Resend or Twilio SendGrid at G4 (the plan recommends Resend: free plan 3,000 emails a month, 100 a day, 3 domains; SendGrid has a 60-day trial, then Essentials from $19.95 a month). Supabase needs SPF, DKIM and DMARC on the sending domain and a dedicated From address.

### G4.1 Provider account and sending domain
- **Owner:** Einar.
- **Settings:** an account at the chosen provider; a sending domain in the litljomi.is zone (litljomi.is itself or a subdomain the provider proposes; Einar chooses). SendGrid after its trial: **Einar: upgrade when needed**. Resend beyond its free plan: **Einar: upgrade when needed**.
- **Verify:** the provider's domain page lists the sending domain with the DNS records it requires (they are added in G5.1).

### G4.2 API key for SMTP
- **Owner:** Einar creates the key and enters it as the SMTP password in Supabase (G3.6); it is never pasted into chat, a file or a command line.
- **Settings:** Resend: an API key (sending access). SendGrid: a restricted API key with at least "Mail" permissions.
- **Verify:** the provider lists the key (name only); G4.3.

### SMTP settings in Supabase Auth (applied in G3.6)

| Field | Resend | Twilio SendGrid |
|---|---|---|
| Host | `smtp.resend.com` | `smtp.sendgrid.net` |
| Port | `465` | `587` (TLS, recommended) or `465` (SSL) |
| Username | `resend` | `apikey` (the literal string) |
| Password | the Resend API key (Einar enters it) | the SendGrid API key (Einar enters it) |
| Sender email | a dedicated no-reply address on the verified sending domain (Einar chooses the exact address) | same |
| Sender name | `Litljómi` | same |

Both provider pages were checked on 2026-11-02; the provider's current Supabase instructions are confirmed at execution time.

### G4.3 A test invitation arrives
- **Owner:** Executor runs `cms provision editor … --email <Einar's test address>` (P-3); Einar checks his mailbox.
- **Verify:** the invitation arrives within a few minutes, from the sender in section 8, with the link pointing to `https://<cms-staging-host>`; the message headers ("show original" or equivalent) report `spf=pass`, `dkim=pass` and `dmarc=pass`. Real LABAK editors are **not** invited in M1.

## 9. DNS in the litljomi.is zone (G5)

All records are in the **litljomi.is** zone only. **`labak.is` DNS is off-limits**, and no record is created for `labak.litljomi.is`. Before adding anything, Einar lists the zone's existing records so nothing in use (the litljomi.is website, existing mail) is changed.

### G5.1 Email authentication records
- **Owner:** Einar.
- **Settings** (types and hosts named here; the values come from the provider's domain-verification screen at execution time and are never invented):
  - **SPF:** a TXT record at the host the provider names (`v=spf1 …`, the include given by the provider). One SPF record per host: if one already exists at that host, merge the provider's include into it instead of adding a second record.
  - **DKIM:** the TXT or CNAME record(s) at `<selector>._domainkey.<sending domain>` exactly as the provider shows them.
  - **Return-path / bounce** records (MX or CNAME) if the provider requires them, exactly as shown.
  - **DMARC:** a TXT record at `_dmarc.litljomi.is` (and at `_dmarc.<subdomain>` if the provider asks for one there). If a DMARC record already exists, keep it. If none exists, Einar chooses the policy (a monitoring policy, `v=DMARC1; p=none` with a report address he chooses, is the usual start; confirm at execution time).
- **Verify:** `dig +short TXT <spf host>` shows exactly one `v=spf1` record including the provider; `dig +short TXT <selector>._domainkey.<sending domain>` (or `CNAME`) matches the provider's value; `dig +short TXT _dmarc.litljomi.is` shows one `v=DMARC1` record; the provider's domain page shows the domain **verified**.

### G5.2 Staging hostnames
- **Owner:** Einar chooses `<cms-staging-host>`, `<demo-staging-host>` and `<labak-staging-host>` under litljomi.is (never `labak.litljomi.is`, never anything in `labak.is`) and creates the records; the executor adds the domains to the Vercel projects (G6).
- **Settings:** for each hostname, the record type and target that Vercel's domain screen shows for that project (confirm at execution time).
- **Verify:** `dig +short <host>` resolves to the target Vercel showed; the project's Domains page shows the domain valid with a certificate issued; `curl -sI https://<host>/` completes a TLS handshake.

## 10. Vercel projects, domains, deployment protection and cron (G6)

### G6.1 Projects and plan
- **Owner:** Einar (team plan); executor creates and configures the projects after G6.
- **Settings:**

  | Project | Source | Root directory | Production branch | Hostname |
  |---|---|---|---|---|
  | `litljomi-cms-staging` | `einar6969/litljomi-cms` | `apps/cms` | `main` | `<cms-staging-host>` |
  | `litljomi-demo-site` | `einar6969/litljomi-cms` | `apps/demo-site` | `main` | `<demo-staging-host>` |
  | `labak-hub-staging` | LABAK repository, branch `hub-integration` | as the LABAK repository needs (confirm at execution time) | `hub-integration` | `<labak-staging-host>` |

  - Node.js 22 for every project; pnpm is detected from the lockfile (confirm both at execution time in project Settings).
  - `labak-hub-staging` is a **new** project. **Never** the existing `landssamband-bakarameistara` project, never `main` of the LABAK repository, never `labak.litljomi.is` or `labak.is`. It also gets the GitHub Packages read token (section 12).
  - Plan: Vercel Hobby allows cron at most once a day (a more frequent schedule fails the deployment), and Hobby is for non-commercial use (§2.2). Per-minute cron (A8) needs Pro. **Einar: upgrade when needed** (before G6.4 is deployed).
- **Verify:** `vercel project ls` (in Einar's team scope) lists the three projects; each project's settings show the root directory, Node 22 and production branch above; the team shows the Pro plan before the cron deploys.

### G6.2 Environment variables
- **Owner:** Executor sets non-secret values; **Einar enters secret values** (section 12) in the project's Environment Variables settings, so no secret passes through an agent session. Production environment only (the staging hostnames are the projects' production domains); secret values marked sensitive if the option is offered (confirm at execution time).
- **Settings:** exactly the variables in section 13 for each project, plus the GitHub Packages read token on `labak-hub-staging`.
- **Verify:** `vercel env ls production` in each project lists exactly the names in section 13 for that project (values are not shown); no other Supabase variable is present on a site project.

### G6.3 Deployment protection off for the staging domains
- **Owner:** Executor (project Settings → Deployment Protection).
- **Settings:** for each of the three projects, Vercel Authentication either disabled or set to Standard Protection (which protects every deployment except production domains, so the staging hostname stays public). Not "All Deployments". No Password Protection (paid per project and unnecessary). The live check (A15) must read the sites' public pages without credentials; "Protection Bypass for Automation" is not needed while the production domains are unprotected.
- **Verify:** from a machine with no Vercel session, `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` (not `401`, and not a redirect to a Vercel login) for all three hostnames, after G6.5.

### G6.4 Cron for the worker sweep
- **Owner:** Executor; the Pro plan is Einar's (G6.1).
- **Settings:** `apps/cms/vercel.json` (Task 17): `{ "crons": [{ "path": "/api/cron/sweep", "schedule": "* * * * *" }] }`. `CRON_SECRET` set on `litljomi-cms-staging` (random, at least 32 bytes; Vercel recommends at least 16 characters); Vercel sends it as `Authorization: Bearer <CRON_SECRET>` and the route compares it (`verifyCronSecret`). Cron delivery is best effort: a run can be missed or duplicated, there are no retries and redirects are not followed, so the sweep is idempotent and the route must not redirect.
- **Verify:** project Settings → Cron Jobs lists `/api/cron/sweep` with `* * * * *`; `curl -s -o /dev/null -w '%{http_code}' https://<cms-staging-host>/api/cron/sweep` without the header returns `401`; the project's logs show the sweep invoked about once a minute (A8 is measured over 10 minutes in Task 29).

### G6.5 Deploy
- **Owner:** Executor.
- **Settings:** deploy each project's production branch (a push to the production branch, or a redeploy from the dashboard after G6.2).
- **Verify:** each project's latest production deployment is Ready; `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` for all three hostnames.

## 11. Tenants, sites and test editors (Task 28 Step 5)

The CLI (`tools/cli`) reads the staging URL and secret key from Einar's local environment (`.env.local`, never committed). Run after G3.6, G3.7 and G6.5.

- **P-1 Tenants.** Owner: executor. `cms provision tenant labak`, `cms provision tenant demo`. Verify: SQL editor `select slug from cms.tenants order by slug;` lists `demo` and `labak` (confirm the table and column names against the migrations at execution time).
- **P-2 Sites.** Owner: executor; Einar generates each site's webhook secret and supplies it to the CLI without it being printed (for example piped from `openssl rand -base64 32`; confirm the CLI's input method at execution time). `cms provision site …` once per staging site, with base URL `https://<demo-staging-host>` or `https://<labak-staging-host>` and the site's revalidate route (`/api/cms/revalidate` on the demo site; the LABAK branch's route, confirm at execution time). The secret is stored in Supabase Vault (`api.admin_create_site` keeps only its ID). Einar then sets the same secret as that site's `CMS_WEBHOOK_SECRETS` (G6.2) and the site is redeployed. Verify: `select count(*) from vault.secrets;` increased by one per site (never select decrypted values); the site's `CMS_WEBHOOK_SECRETS` is listed by `vercel env ls production`.
- **P-3 Test editor.** Owner: executor. `cms provision editor … --email <Einar's test address>` for each tenant used in Task 29. Real LABAK editors are not invited in M1. Verify: G4.3.
- **Record** every created resource (names, regions, domains, project references; no secrets) in `docs/verification/m1-report.md` (Task 28 Step 6). Owner: executor. Verify: `git grep -nE 'sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}' -- docs/verification/m1-report.md` finds nothing.

## 12. Secrets

No secret is ever committed, logged, printed in an agent session, pasted into chat or written into a report. `.env*` files other than `.env.example` are never committed. Rotation: the SDK accepts two webhook secrets during rotation (§8.2).

| Secret | Created where | Stored where | Who may read it |
|---|---|---|---|
| Supabase secret key | Supabase project API keys (G3.1) | `litljomi-cms-staging` server environment (`SUPABASE_SECRET_KEY`); Einar's local `.env.local` for `tools/cli` | Code under `apps/cms/src/privileged/**` and `tools/cli` only (lint-enforced). Never in client bundles, sites or module code |
| Internal worker-trigger secret | Generated randomly by Einar (at least 32 bytes) | `litljomi-cms-staging` (`CMS_INTERNAL_SECRET`) | The CMS server: the trigger and `verifyInternalSecret` |
| Cron secret | Generated randomly by Einar (at least 32 bytes) | `litljomi-cms-staging` (`CRON_SECRET`) | Vercel Cron (sends it) and `verifyCronSecret` |
| Per-site webhook secret | Generated randomly by Einar, one per site (P-2) | Supabase Vault (by `cms provision site`) and the site's environment (`CMS_WEBHOOK_SECRETS`) | The worker through `service_role`-only functions (A9); the site's revalidation route |
| Per-site preview secret | Not created in M1 (preview is M3) | Vault and the site's environment, when M3 adds it | Privileged zone only (§8.2) |
| SMTP credentials (provider API key) | The email provider (G4.2) | Supabase Auth SMTP settings (G3.6) | Supabase Auth. §8.2 also lists the CMS environment; M1 code sends no email itself, so no variable is defined (section 16) |
| Supabase database password | Einar at project creation (G3.1) | Einar's password manager | Einar, typed at the `supabase link`/`db push` prompt only |
| Supabase CLI access token | `supabase login` by Einar | The Supabase CLI's local credential store | Einar's machine only |
| JWT signing secret or keys | Supabase (managed) | Supabase | Nobody exports it; holders could issue tokens without the hook (section 15) |
| GitHub Packages publish token | Einar (GitHub, package write scope) | Einar's local environment while publishing (G2.5) | Einar's machine only |
| GitHub Packages read token | Einar (GitHub, package read scope) | `labak-hub-staging` environment, under the variable name the `hub-integration` `.npmrc` reads (Task 28 Step 1; confirm at execution time) | Vercel's install step for that project |
| Vercel and GitHub sessions | `vercel login`, `gh auth login` by Einar | The CLIs' local credential stores | Einar's machine only |

## 13. Environment variables

The same set as `.env.example` (`tools/checks/__tests__/env-example.test.ts` checks that the first column of this table and the `NAME=` lines of `.env.example` match both ways). Values are set per Vercel project (G6.2) and, for local work and `tools/cli`, in `.env.local`.

| Variable | Used by | Secret | Value and where it comes from | Set on |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | CMS app; `tools/cli` locally | No (public) | `https://<project-ref>.supabase.co`, the project URL on the API settings page (confirm at execution time) | `litljomi-cms-staging`; `.env.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | CMS app (browser and server) | No (public by design; RLS and grants protect data) | The project's publishable key (API keys page) | `litljomi-cms-staging`; `.env.local` |
| `SUPABASE_SECRET_KEY` | `apps/cms/src/privileged/**`, `tools/cli` | **Yes** | The project's secret key (API keys page); entered by Einar | `litljomi-cms-staging`; Einar's `.env.local` |
| `CMS_INTERNAL_SECRET` | CMS app (worker trigger, header `x-cms-internal-secret`) | **Yes** | Random, at least 32 bytes; entered by Einar | `litljomi-cms-staging` |
| `CRON_SECRET` | CMS app (`/api/cron/sweep`), Vercel Cron | **Yes** | Random, at least 32 bytes; entered by Einar | `litljomi-cms-staging` |
| `CMS_PUBLIC_URL` | CMS app (worker trigger URL, magic-link redirect) | No | `https://<cms-staging-host>` | `litljomi-cms-staging` |
| `CMS_DELIVERY_BASE_URL` | Sites (SDK release reading) | No | Public URL of the `delivery` bucket, as Storage shows it (expected `https://<project-ref>.supabase.co/storage/v1/object/public/delivery`; confirm at execution time) | `litljomi-demo-site`, `labak-hub-staging` |
| `CMS_TENANT` | Sites | No | The site's tenant slug: `demo` or `labak` | `litljomi-demo-site` (`demo`), `labak-hub-staging` (`labak`) |
| `CMS_WEBHOOK_SECRETS` | Sites (revalidation route) | **Yes** | The site's webhook secret from P-2; two, comma-separated, during rotation; entered by Einar | Each site project, its own secret only |
| `CMS_MEDIA_HOST` | Sites (`next/image` `remotePatterns`) | No | The host of `media-public` public URLs (expected `<project-ref>.supabase.co`; confirm at execution time) | `litljomi-demo-site`, `labak-hub-staging` |

Sites hold no Supabase credentials and no API URL (§8.1): they read only public Storage files (`delivery`, `media-public`) and receive signed webhooks.

## 14. Validation procedures (Task 29)

Before Task 29, run the full local suite (Task 29 Step 1) and the hook verification (section 7.2). Task 29 then runs `apps/cms/e2e/m1-acceptance.spec.ts` against staging, one test per M1 criterion of spec §13.2, and writes the results to **`docs/verification/m1-report.md`**: each criterion pass or fail with evidence (commands, request IDs, timestamps, screenshots at 375, 768 and 1440 px), each validation gate with its result, and every known limitation.

| What Task 29 checks | Depends on (this runbook) | Gate |
|---|---|---|
| Magic-link sign-in delivered by custom SMTP with Icelandic templates | Section 8, G3.6, G5.1 | A11 |
| Publish reaches "Birt á vef ✓" on `labak-hub-staging` within 60 s | G6.3, G6.5, P-2 | A7, A15 |
| Image public only after publish; republish moves Live; unpublish passes every `absent` check | Section 11 | — |
| Isolation both ways through the API and storage (`http-boundary.test.ts`, `storage-boundary.test.ts` against staging) | G3.2, G3.3 | A1, A4 |
| Malformed RPC never committed; stale save rejected; changed draft `superseded` | G3.2 | — |
| With the CMS deployment paused, both sites keep serving (Einar pauses it or approves pausing, G6) | G6.5 | — |
| `current.json` overwritten and polled: new release within about a minute | `CMS_DELIVERY_BASE_URL` | A6 |
| Cron log shows the sweep every minute for 10 minutes | G6.4 | A8 |
| Passwordless and email change: hook enabled; password sign-in 403; magic link works; no `password` row in `auth.mfa_amr_claims`; an email change needs both addresses | Sections 6 and 7 | Decisions 18, 19 |

Each run's secrets come from the local environment only; the report records results, never values.

## 15. Known limitations

The full list is decision 18's (plan, "Implementation-level decisions") and decision 21's; the ones that matter when operating staging:
- A password can still be set on an account (by the user's own session, or by the admin API); it never signs in.
- A correct password gets 403 and a wrong one 400, so the password endpoint answers differently for them; it also reveals `user_banned` and `email_not_confirmed` (Supabase default).
- Refused password attempts leave no row in `auth.audit_log_entries`; they appear only in the Auth logs.
- The hook lives in the Auth configuration: a dashboard change or a configuration push without it switches it off silently, so section 7.2 is re-run after every Auth configuration change or configuration push, and on every hosted project.
- Sign-in fails closed if the hook cannot run (it must answer within 2 seconds): a slow or unavailable database blocks sign-in rather than allowing passwords.
- Holders of the JWT secret or the Supabase secret key can issue tokens without the hook (by design, §8.1).
- Access tokens issued before the hook was enabled stay valid until they expire (at most `jwt_expiry`, 3600 seconds); hence the revocation in section 7.1.
- Secure password change is additional protection only (section 6): a session under 24 hours old can set a password without a nonce, and any password change revokes the user's other sessions, so a session holder can sign the editor out elsewhere (the editor signs in again by email).
- Enabling sign-up, MFA recovery codes, WebAuthn, phone MFA or passkeys needs the hook's allowlist revisited.
- The hook and secure password change were verified on local Supabase Auth v2.197.0 only until Task 29.
- Vercel Cron is best effort (missed or duplicate runs possible, no retries); the sweep is idempotent.
- The live check cannot confirm a site behind deployment protection (§7.4); G6.3 keeps the staging domains public.
- Withdrawal from third-party caches is best-effort, and M1 has no fallback rule for failed entries (Task 29 reports both).

## 16. Open items

| Item | Owner | When |
|---|---|---|
| DECISION-SMTP: Resend (recommended) or SendGrid | Einar | G4 |
| Region (one of the four EU regions in G3.1) and project name for the Supabase staging project | Einar | G3 |
| The three staging hostnames under litljomi.is | Einar | G5 |
| Sending domain, sender address and, if no DMARC record exists, the DMARC policy | Einar | G4, G5 |
| Who enters secret values: this runbook proposes Einar, so no secret passes through an agent session | Einar confirms | G3, G6 |
| The email rate limit value (proposed 100 per hour) | Einar confirms | G3 |
| SMTP credentials in the CMS environment (§8.2): no M1 code needs them, so no variable is defined; to be named when code that sends email is planned | Controller raises with Einar | When such code is planned |
| GitHub Packages scope for `@litljomi/*` under `einar6969` (G2.5) | Einar | G2 |
| Pin GitHub Actions to commit SHAs (deferred from Task 1) | Executor | G2.4 |
| Recurring automation of the hook verification (decision 20) | Einar, by a separate decision | Task 28 or later |
| Optional staging check of the 24-hour secure-password-change path (needs a session's `created_at` moved back in `auth.sessions`, as in the local verification) | Einar decides | G3 |
| Paid plans: Supabase Pro (§2.2), Vercel Pro (per-minute cron), email provider beyond its free tier. **Einar: upgrade when needed** | Einar | G3, G4, G6 |
| The production Supabase project and `cms.litljomi.is` (spec §2.2, §13) are outside this staging runbook | Controller raises with Einar | After M1 |
