# Staging runbook: hosted environments for M1

**Contents.** The execution order is section 3; sections 4–11 are the reference for each gate's steps.

1. Purpose and status: scope, conventions, off-limits resources, the LABAK repository and Vercel
2. Prerequisites
3. Deployment sequence (the order Task 28 follows)
4. G2: GitHub repository
5. G3: Hosted Supabase
6. Supabase Auth configuration (every hosted Auth setting, with the step that applies it)
7. Passwordless Auth hook: enabling it (7.1) and the verification procedure (7.2)
8. Email delivery (G4)
9. DNS in the litljomi.is zone (G5)
10. Vercel projects, domains, deployment protection and cron (G6)
11. Tenants, sites and test editors (Task 28 Step 5)
12. Secrets
13. Environment variables
14. Validation procedures (Task 29)
15. Known limitations
16. Open items

## 1. Purpose and status

This runbook sets up the M1 staging environment: the GitHub repository, the hosted Supabase staging project, the email provider, the litljomi.is DNS records and the three Vercel projects. It is the procedure Task 28 follows and Task 29 checks.

**Status.** Written in Task 3 (2026-11-02) as a document only. **Nothing in it was executed in Task 3**: no account, project, record, key or deployment exists because of it. It is executed only in Task 28, one gate at a time (G2, G3, G4, G5, G6). Each gate is approved by Einar in his own words in chat and recorded by the controller in `docs/execution/gates.json` before any step under it runs. Approval of one gate does not cover another. Paid upgrades are Einar's alone; every paid step is marked "**Einar: upgrade when needed**".

**Sources.** `docs/architecture.md` (§2.2, §4.2, §4.4, §7.3, §8.2, §8.4, §11) and the plan `docs/plans/2026-11-01-m0-m1.md` (gates G2–G6, DECISION-SMTP, decisions 16–21, Tasks 28 and 29). If this runbook and the spec disagree, the spec wins: stop and report.

**Conventions.**
- Every step names its **Owner**, the **Settings** to apply and the **Verify** check that shows it worked. A step whose check fails stops the gate: record the result and report to the controller, who reports to Einar.
- **Einar** acts in his own accounts (sign-ups, payment, DNS, provider keys). The **executor** is the agent the controller dispatches, acting only after the gate is recorded (written "Executor" only at the start of a sentence or table cell).
- **Who runs a step that needs a secret.** Every step that needs the Supabase secret key, the database password, a provider API key, a GitHub token or any other secret value is **Einar's**, run in his own terminal or dashboard session. Agents cannot read `.env.local` (the project's permission settings and the sandbox deny it) and never receive a secret value. The executor owns the steps that need no secret; the two public values it needs for checks (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, public by design) are given to it by Einar, never read from `.env.local`.
- **The dashboard and the SQL editor reach secret values.** The Supabase dashboard's API keys page can reveal the secret key, Vault (`vault.decrypted_secrets`) holds the per-site webhook secrets in clear, and the SQL editor runs as `postgres`, which can read both. The executor **never reveals a secret value** there: it does not reveal or copy a key on the API keys page or any other settings page (database password, SMTP password, JWT secret), never selects from `vault.decrypted_secrets`, and never selects token, password-hash or secret columns. In the SQL editor it runs **only the queries this runbook gives**, as written apart from the placeholders. A query that seems needed but is not here is reported to the controller first, never improvised.
- **SQL blocks.** Each SQL block or inline query holds exactly one statement; where a step has several, they are numbered (for example 2a, 2b). Run each statement on its own and record its result before running the next. The SQL editor may show only the last result when several statements run together (confirm its behaviour at execution time), so statements are never combined into one run.
- "§" numbers refer to the spec (`docs/architecture.md`); "section N" refers to this runbook. **A1–A15** are the spec's validation gates (§11.1, the A-numbered table). "**Task 29 item N**" is item N of Task 29 Step 2 in the plan (one M1 acceptance test each). The two numberings are unrelated: Task 29 item 11 is the passwordless and email-change test, A11 is custom SMTP delivery.
- "**Confirm at execution time**" marks a value or screen this runbook could not verify when it was written (dashboard menu paths, provider record values, CLI details). The executor checks it against the live screen or the provider's current documentation and records what was found; it never guesses.
- Placeholders are in angle brackets: `<cms-staging-host>`, `<demo-staging-host>`, `<labak-staging-host>` (the three staging hostnames in the litljomi.is zone, chosen by Einar at G5), `<project-ref>` (the Supabase staging project's reference), `<hook-test-address>` and `<signup-test-address>` (throwaway addresses Einar controls, used only by the checks in sections 6 and 7), `<test-account-id>` (the id that section 7.2 part 1 prints; not secret).
- **No secret, key or token value is ever written** to this repository, a commit, a chat message, a log or a report. Commands read secrets from `.env.local` (never committed) without executing it, or from a hidden prompt, never print them and never put them on a command line (sections 4 and 7.2 show how). `.env.local` is **never sourced** (`. ./.env.local`): that would run its lines as shell code in a shell that holds the secret key. See section 12.

**Off-limits.** `labak.is` DNS, the existing Vercel project `landssamband-bakarameistara`, the hostnames `labak.litljomi.is` and `labak.is`, and the LABAK repository's `main` branch are never touched by this runbook.

**The LABAK repository and Vercel (G6 and G7).** This paragraph is the one statement of this approval; other sections point here. Creating `labak-hub-staging` (G6.1) connects the LABAK repository to Vercel. That installs the Vercel GitHub integration on the LABAK repository (or adds the repository to an existing installation), after which Vercel can build any branch, including `main`, and post deployment statuses and comments there. This goes beyond creating and pushing `hub-integration`, so it needs **Einar's explicit approval at G6 and at G7**, named as such, before the project is connected; the controller records both. When approved, builds are limited to `hub-integration` (G6.1) and every deployment other than the production domain stays protected (G6.3).

**The existing Vercel project and `hub-integration`.** If the existing project `landssamband-bakarameistara` is connected to the LABAK repository, a push of `hub-integration` could build inside it and post statuses on the branch, which would touch an off-limits project. So nothing is pushed to `hub-integration` until G6.0 (section 10) has passed: **any** Git connection of that project to the LABAK repository stops the push. G6.0 states the check, when it runs and who raises it.

## 2. Prerequisites

| # | Prerequisite | Owner | Verify |
|---|---|---|---|
| P1 | Tasks 0–27 complete and green locally (`pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test && pnpm db:reset && pnpm db:test && pnpm test:integration`) | Executor | Every command exits 0; the controller's `state.json` shows Tasks 0–27 done |
| P2 | Task 4's migration (creating `api`, `cms`, `private` and `private.passwordless_access_token`) and its `[api] schemas = ["api"]` are committed | Executor | `git log --oneline -- supabase/migrations` lists it; `grep -n 'schemas = \["api"\]' supabase/config.toml` matches |
| P3 | The LABAK branch `hub-integration` exists (Task 27, G7), and if it was pushed, G6.0 passed before that push | Controller | G7 recorded in `gates.json`; Task 27 done in `state.json`; the G6.0 result recorded |
| P4 | Einar has accounts he controls at GitHub (`einar6969`), Supabase, Vercel and the chosen email provider, and access to the litljomi.is DNS zone | Einar | Einar confirms in chat at each gate |
| P5 | The hosts each gate needs are allowed for the session: adding a host to `allowedDomains` is a `.claude/**` change that Einar approves, limited to that gate's hosts and removed afterwards unless he decides otherwise | Einar approves; controller applies | The approved diff is recorded; a sandbox refusal is reported, never worked around |
| P6 | Local tools: `git`, `gh`, `supabase` (2.121.0, as in CI), `vercel`, `curl`, `jq`, `openssl`, `dig` | Einar (any install is G1) | `<tool> --version` for each |

## 3. Deployment sequence

Task 28 follows this order. Each step lists what it depends on.

| Order | Step | Gate | Depends on |
|---|---|---|---|
| 0 | G6.0: the existing Vercel project `landssamband-bakarameistara` has no Git connection to the LABAK repository; **before the first push of `hub-integration`** (at Task 27 if G7 includes the push, otherwise before G2.5 pushes it) | G7 (raised with the G7 request), repeated under G6 | none |
| 1 | G2.1–G2.3: private repository, push `main`, CI green | G2 | P1 |
| 2 | G2.4: pin GitHub Actions to commit SHAs | G2 | G2.1 |
| 3 | G2.5: publish `@litljomi/cms-sdk` and `@litljomi/rich-text` 0.1.0; update `hub-integration` dependencies | G2 (and G7 for the LABAK branch) | G2.3, P3, G6.0 (before any push of `hub-integration`) |
| 4 | G3.1: Supabase organisation and EU staging project | G3 | P4 |
| 5 | G3.4: the Auth settings G3.4 lists (the section 6 rows whose Step is G3.4); **right after G3.1**, because sign-up is open on a new project until it is turned off | G3 | G3.1 |
| 6 | G3.2: `supabase link`, `supabase db push` (includes the hook function) | G3 | G3.4, P2 |
| 7 | G3.3: Data API exposes `api` only | G3 | G3.2 (the `api` schema must exist) |
| 8 | G3.5: check that no account exists, enable the passwordless hook, revoke all sessions, run the hook verification (section 7) | G3 | G3.2, G3.4; **before any editor account exists** (`select count(*) from auth.users` → 0) |
| 9 | G4.1–G4.2: email provider account, sending domain, API key | G4 | DECISION-SMTP made by Einar |
| 10 | G5.1: email authentication records (SPF, DKIM, DMARC) in litljomi.is | G5 | G4.1 (values come from the provider) |
| 11 | G3.6: custom SMTP in Supabase Auth; raise the email rate limit | G3 (G4 credentials) | G4.2, G5.1 verified |
| 12 | G6.0 again, then G6.1: three Vercel projects (connecting the LABAK repository needs the approvals in section 1); Pro plan for per-minute cron, **Einar: upgrade when needed** | G6 (and G7 for the LABAK repository) | G2.3, G2.5, P3, G6.0 |
| 13 | G5.2: staging hostnames in litljomi.is, added to the Vercel projects | G5 and G6 | G6.1 |
| 14 | G3.7: Auth Site URL and redirect URLs set to `https://<cms-staging-host>` | G3 | G5.2 (hostname chosen) |
| 15 | G6.2–G6.4 settings: environment variables (section 13, except each site's `CMS_WEBHOOK_SECRETS`, which P-2 sets), deployment protection, cron. Their live checks (G6.3's and G6.4's `curl` requests) run after G6.5 | G6 | G3.1, G5.2 |
| 16 | G6.5: deploy all three projects (the sites without `CMS_WEBHOOK_SECRETS`, on purpose); then G6.3's and G6.4's live checks | G6 | G6.2–G6.4 settings |
| 17 | P-1–P-3: Einar provisions tenants, sites (stores webhook secrets in Vault) and a test editor with `tools/cli`; sets each site's `CMS_WEBHOOK_SECRETS` and the site is redeployed (P-2 verifies it) | G3 (hosted Supabase) and G6 (site variables); the controller confirms coverage before running | G3.6, G3.7, G6.5 |
| 18 | G4.3: the test editor's invitation arrives with SPF, DKIM and DMARC passing | G4 | P-3 |
| 19 | Section 7.2 hook verification again, then Task 29 (section 14) | none beyond those recorded | everything above |

## 4. G2: GitHub repository

### G2.1 Create the private repository
- **Owner:** Einar approves at G2; executor runs `gh`.
- **Settings:** `gh repo create einar6969/litljomi-cms --private --source /Users/einarzoega/litljomi-cms --remote origin` (confirm the flags at execution time against `gh repo create --help`).
- **Verify:** `gh repo view einar6969/litljomi-cms --json visibility -q .visibility` prints `PRIVATE`; `git -C /Users/einarzoega/litljomi-cms remote -v` shows only `origin` → `einar6969/litljomi-cms`.

### G2.2 Push `main` and enable Actions
- **Owner:** Executor, after G2.
- **Settings:** `git push -u origin main`. Actions enabled for the repository (repository Settings → Actions; confirm at execution time). Workflow permissions (repository Settings → Actions → General; confirm at execution time): the default `GITHUB_TOKEN` permission is **read** repository contents only, and "Allow GitHub Actions to create and approve pull requests" is **off** (the workflow also declares `permissions: contents: read`). Never force-push.
- **Verify:** `gh api repos/einar6969/litljomi-cms/actions/permissions -q .enabled` prints `true`; `gh api repos/einar6969/litljomi-cms/actions/permissions/workflow` shows `"default_workflow_permissions": "read"` and `"can_approve_pull_request_reviews": false`; `git ls-remote origin main` matches `git rev-parse main`.

### G2.3 CI green on GitHub
- **Owner:** Executor.
- **Settings:** none (the workflow is `.github/workflows/ci.yml`).
- **Verify:** `gh run list --branch main --limit 1 --json conclusion -q '.[0].conclusion'` prints `success`. A failure stops G2.

### G2.4 Pin GitHub Actions to commit SHAs (deferred from Task 1)
- **Owner:** Executor (a normal reviewed commit in the repository).
- **Settings:** in `.github/workflows/ci.yml`, replace each `uses: <action>@<tag>` (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `supabase/setup-cli`) with `<action>@<40-character commit SHA> # <tag>`, the SHA looked up from the action's own repository at execution time (for example `gh api repos/actions/checkout/git/ref/tags/<tag>`; for an annotated tag, dereference to the commit; confirm at execution time).
- **Verify:** `grep -nE 'uses: [^@]+@[0-9a-f]{40}( |$)' .github/workflows/ci.yml` matches every `uses:` line, `grep -c 'uses:'` equals that count, and the next CI run on `main` is `success`. The G2.2 workflow-permission check still shows `read` and `false`.

### G2.5 Publish the SDK packages; update the LABAK branch
- **Owner:** Einar publishes (the publish token is a secret, so it stays in his terminal); the executor prepares the packages for publishing and, after G7, edits the `hub-integration` branch. Einar creates both tokens; the executor never sees a token value.
- **Settings:**
  - Publish `@litljomi/cms-sdk` and `@litljomi/rich-text` version `0.1.0` to GitHub Packages under `einar6969` (Task 28 Step 1), with the publish token entered as shown below ("Entering a token"), for those commands only.
  - **Tokens** (GitHub personal access tokens, classic; GitHub Packages' npm registry authenticates with them; confirm at execution time whether a fine-grained token is accepted instead). This list is the one statement of their scopes and expiry; section 12 points here:
    - publish token: scope `write:packages` only, the shortest expiry GitHub offers that covers G2.5 (for example 7 days), **revoked by Einar as soon as G2.5 is verified**;
    - read token: scope `read:packages` only, an expiry Einar chooses for the M1 staging period, used only by `labak-hub-staging` (section 12). Vercel environment variables are available to the build and also at runtime, so the site's server code can read it too; that is why it is limited to `read:packages`.
    - If GitHub requires a further scope for packages of a private repository, stop and report (Einar decides).
  - On `hub-integration`, replace the `link:` dependencies with `0.1.0` and add an `.npmrc` that reads the registry token from an environment variable, never a committed token. Before that branch is pushed for the first time, G6.0 must have passed (section 1).
  - **Entering a token** (the same pattern as P-2 in section 11). Einar types or pastes the token at a hidden prompt (`read -rs`, no echo, nothing in shell history); it lives in a variable of a subshell only, is exported only to the commands inside it (never on a command line, never in a file), and is unset at the end; leaving the subshell drops it too. If he pasted it, he clears the clipboard afterwards. The variable is the one the `.npmrc` reads, as `//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}` (`NODE_AUTH_TOKEN` here; confirm the name and the `.npmrc` that applies at execution time). Publishing, in Einar's terminal from the repository root:
    ```sh
    (
      printf 'GitHub Packages publish token: '; read -rs NODE_AUTH_TOKEN; echo
      export NODE_AUTH_TOKEN
      # The publish command for each package, as the executor prepared it (no token in it).
      unset NODE_AUTH_TOKEN
    )
    ```
  - **Confirm at execution time:** GitHub Packages' npm registry ties a package's scope to the owning account; if `@litljomi/*` cannot be published under `einar6969`, stop and report (Einar decides on a `litljomi` organisation or another scope). Free allowances for Actions minutes and Packages storage on a private repository: confirm at execution time; **Einar: upgrade when needed**.
- **Verify:** Einar, with the **read** token entered the same way, where an `.npmrc` with the line above applies:
  ```sh
  (
    printf 'GitHub Packages read token: '; read -rs NODE_AUTH_TOKEN; echo
    export NODE_AUTH_TOKEN
    npm view @litljomi/cms-sdk@0.1.0 version --registry=https://npm.pkg.github.com
    npm view @litljomi/rich-text@0.1.0 version --registry=https://npm.pkg.github.com
    unset NODE_AUTH_TOKEN
  )
  ```
  Both print `0.1.0`. The executor runs `git grep -nE '_authToken=[^$]' hub-integration` in the LABAK checkout and finds nothing (the token is read from a variable). Einar confirms the publish token is revoked (GitHub's token list shows it gone).

## 5. G3: Hosted Supabase

### G3.1 Organisation and staging project in an EU region
- **Owner:** Einar (account, organisation, payment); executor reads the result.
- **Settings:**
  - A Litljómi organisation; a staging project in a specific EU region: West EU (Ireland) `eu-west-1`, West EU (Paris) `eu-west-3`, Central EU (Frankfurt) `eu-central-1` or North EU (Stockholm) `eu-north-1`. Not London `eu-west-2` or Zurich `eu-central-2` (not EU member states), and not the generic "Europe" option (it may not map to a specific jurisdiction). Einar chooses the region and project name.
  - Plan: the spec (§2.2) puts the organisation on Pro (daily backups, §8.4). The Custom Access Token hook is available on Free and Pro, so M1 staging does not depend on the plan. **Einar: upgrade when needed.**
  - The database password is set by Einar and kept in his password manager; it is never written anywhere else.
- **Verify:** the project's settings page shows the chosen region code from the list above (Einar reads it out, or a screenshot without keys); the region and project reference are recorded in `docs/verification/m1-report.md` (no secrets).

### G3.2 Link and apply migrations
- **Owner:** Einar runs the commands in his terminal (`supabase login`, and the database password typed at the prompt, never in a command line or file); the executor reads the output he shares (no secrets in it) and runs the SQL check.
- **Settings:** `supabase link --project-ref <project-ref>`, then `supabase db push`. **Do not use `supabase config push`:** `supabase/config.toml` describes the local stack, so a push would send local-only values to staging (the localhost Site URL and redirect URLs, the local email rate limit, and no SMTP block), while the hosted Auth settings are set by hand (section 6); a push is also an Auth configuration change that makes section 7.2 due again. Dashboard settings in section 6 are applied by hand.
- **Verify:** Einar runs `supabase migration list`: every local migration is applied remotely (no row with a local version and an empty remote column). The executor, in the SQL editor: `select to_regprocedure('private.passwordless_access_token(jsonb)') is not null;` returns `true`.

### G3.3 Data API: expose `api` only (decision 16)
- **Owner:** Executor (with the public URL and publishable key from Einar).
- **Settings:** exposed schemas = `api` only, matching `[api] schemas = ["api"]` in `supabase/config.toml` (Data API settings page; confirm the menu path at execution time). Remove `public` and `graphql_public` if listed. **Never** run Supabase's custom-schema `GRANT ALL` recipe for any schema; grants come only from the migrations (§4.2, §4.5).
- **Verify:** in the same shell command as the URL check in section 6 (so a mismatch stops it), with the publishable key, `curl -s -o /dev/null -w '%{http_code}' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Accept-Profile: <schema>"` returns `406` for `public`, `cms`, `private` and `graphql_public`; a call that Task 4's local verification makes against `api` succeeds the same way on staging (use Task 4's request; confirm at execution time).

### G3.4 Auth settings
- **Owner:** Executor.
- **When:** right after G3.1, before G3.2. Sign-up is open on a new project until it is turned off, so nothing else happens on the project first.
- **Settings:** the section 6 rows whose Step is G3.4: self sign-up, email provider, other providers, confirm email, secure email change, secure password change, TOTP MFA and JWT expiry. The other rows belong to other steps: exposed schemas (G3.3) and the hook (G3.5) need the migrations of G3.2 first; custom SMTP and the email rate limit are G3.6; the Site URL and redirect URLs are G3.7; email templates are Task 22's.
- **Verify:** as listed in section 6 for each of those rows.

### G3.5 Passwordless hook
- **Owner:** Executor (SQL editor and dashboard); Einar runs the section 7.2 scripts, which need the secret key. Einar is told the result before G3 continues.
- **Settings and verify:** Section 7.1 (check that no account exists, enable, revoke all sessions), then section 7.2 (verification). Runs before any editor account exists on the project: `select count(*) from auth.users;` returns `0` (section 7.1 step 0).

### G3.6 Custom SMTP and the email rate limit
- **Owner:** Einar enters the SMTP password (the provider API key) in the dashboard; executor sets the other fields and the rate limit.
- **Settings:** Section 8 (SMTP fields for the chosen provider); Auth **Rate Limits** page: emails sent per hour raised from **30** (imposed once custom SMTP is enabled) to **100**. Reason: M1 staging sends only invitations and magic links for a few test editors, and acceptance runs repeat sign-ins; 30 per hour could block a test run, while 100 stays bounded. The provider's own limit still applies (Resend free plan: 100 a day). Einar may choose another value at G3; record the value used. This is the one statement of the value and its reason; sections 6 and 16 point here.
- **Verify:** the SMTP page shows custom SMTP enabled with the host, port, user and sender of section 8 (password hidden); the Rate Limits page shows 100 emails per hour; the end-to-end check is G4.3.

### G3.7 Site URL and redirect URLs
- **Owner:** Executor.
- **Settings:** Site URL `https://<cms-staging-host>`; redirect URLs: exactly `https://<cms-staging-host>/auth/callback` (the CMS's `emailRedirectTo`, `${CMS_PUBLIC_URL}/auth/callback`). No wildcard, no localhost (URL configuration page; confirm the menu path at execution time).
- **Verify:** the URL configuration page shows those two values only; Einar's next section 7.2 part 1 run, with `EXPECT_REDIRECT='https://<cms-staging-host>'`, asserts that the `generate_link` response's `redirect_to` field (the only field of it printed, never the action link) equals it.

## 6. Supabase Auth configuration

Applied on the hosted project by hand, each row in the step its Step column names (G3.3–G3.7). Local equivalents are in `supabase/config.toml` and are regression-tested in `tools/checks/__tests__/supabase-config.test.ts`. Dashboard menu paths, other than the SMTP and Rate Limits pages, are confirmed at execution time.

`$NEXT_PUBLIC_SUPABASE_URL` and `$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` below (and in G3.3) are the two public values Einar gives the executor (section 1). `GET $NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` returns public settings only.

**URL check.** Before any request in this section or in G3.3, the executor checks that `$NEXT_PUBLIC_SUPABASE_URL` is a hosted project URL and is the staging project's, and prints the target host (a local-stack URL such as `http://127.0.0.1:54321` is refused; `<project-ref>` is the reference Einar reads from his Supabase dashboard or his own records; the value recorded at G3.1 in `docs/verification/m1-report.md` is for the record only, never the source of the check). It exits 1 on a mismatch, so it runs at the start of the same shell command as the requests it guards, and nothing after it runs:

```sh
if [ "$NEXT_PUBLIC_SUPABASE_URL" = 'https://<project-ref>.supabase.co' ] \
  && printf '%s\n' "$NEXT_PUBLIC_SUPABASE_URL" | grep -Eqx 'https://[a-z0-9]{20}\.supabase\.co'
then printf 'target: %s (ok)\n' "${NEXT_PUBLIC_SUPABASE_URL#https://}"
else echo 'NEXT_PUBLIC_SUPABASE_URL is not the staging project: stop'; exit 1; fi
```

**Sign-up check, safely.** Owner: executor. In the same shell command as the URL check above, after it prints `(ok)`. It uses `<signup-test-address>`, a throwaway address Einar controls, never a real editor's, and a random password that is piped, never on a command line, and never used again:

```sh
openssl rand -hex 16 | jq -Rc '{email: "<signup-test-address>", password: .}' \
  | curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" \
      -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' --data @- \
  | jq -r '.error_code // "no error_code: sign-up may be on"'
```

Expected: `signup_disabled` (HTTP 422), and `select count(*) from auth.users where email = '<signup-test-address>';` returns `0`. If the call instead succeeds, sign-up is on: an account now exists and a confirmation email may have been sent. Stop, turn sign-up off, have Einar delete that account (section 7.2 part 2, with its id from `select id from auth.users where email = '<signup-test-address>';`), record it, and tell Einar.

| Setting | Step | Hosted value | Local equivalent | Why | Verify |
|---|---|---|---|---|---|
| Self sign-up | G3.4 | **Off** ("allow new users to sign up" disabled) | `[auth] enable_signup = false` | §4.4: editors are invited by the CLI | `/auth/v1/settings` → `"disable_signup": true`; the sign-up check above → 422 `signup_disabled` and no account created |
| Email provider | G3.4 | **On** (magic link and one-time code) | `[auth.email] enable_signup = true` | Decision 17: turning the provider off disables email sign-in | `/auth/v1/settings` → `"external": {"email": true, …}` |
| Other providers | G3.4 | All off: phone, anonymous, OAuth, SAML, WebAuthn/passkeys | defaults in `config.toml` | Decision 18: enabling any of them needs the hook's allowlist revisited | `/auth/v1/settings` → every other `external` entry `false` |
| Confirm email | G3.4 | **On** | `[auth.email] enable_confirmations = true` | Decision 19 | `/auth/v1/settings` → `"mailer_autoconfirm": false` |
| Secure email change (double confirmation) | G3.4 | **On** | `[auth.email] double_confirm_changes = true` | Decision 19: an email change needs both the old and the new address; with confirmations off it has no effect, so both stay on | The setting shows on; Task 29 item 11 checks the behaviour |
| Secure password change | G3.4 | **On**, set by the executor in the dashboard's Auth settings for the email provider ("Secure password change"; confirm the location at execution time). The dashboard is the executor's only route. If the dashboard does not offer the setting, stop and report: the other route, the Management API, needs a personal access token (a secret), so it is Einar's (below) | `[auth.email] secure_password_change = true` | Decision 21: additional protection, not a substitute for the hook | The dashboard shows the setting on, or Einar's Management API check below prints `true` (behaviour below); record which route was used |
| TOTP MFA | G3.4 | Enrolment and verification **on** | `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true` | §4.4: platform admins enrol TOTP; console needs `aal2` | The MFA settings show TOTP enabled |
| JWT expiry | G3.4 | **3600** seconds, recorded and kept | `[auth] jwt_expiry = 3600` | Decision 18: bounds how long a token issued before the hook stays valid | The setting shows 3600; in section 7.2 the magic-link response has `"expires_in": 3600`; value recorded in `m1-report.md` |
| Exposed schemas | G3.3 | `api` only | `[api] schemas = ["api"]` | Decision 16, §4.2 | G3.3 |
| Custom Access Token hook | G3.5 | **Enabled**, Postgres function `private.passwordless_access_token` | `[auth.hook.custom_access_token] enabled = true`, `uri = "pg-functions://postgres/private/passwordless_access_token"` | Decision 18 | Section 7 |
| Custom SMTP | G3.6 | Provider of DECISION-SMTP (section 8) | `[local_smtp]` (local mail catcher) | §4.4: the built-in sender delivers only to the team's addresses, about 2 an hour, not for production | G3.6, G4.3 |
| Email rate limit | G3.6 | The value G3.6 sets | `[auth.rate_limit] email_sent = 2` | Acceptance runs repeat sign-ins, and the post-SMTP default could block one (G3.6) | G3.6 |
| Site URL, redirect URLs | G3.7 | `https://<cms-staging-host>`; `https://<cms-staging-host>/auth/callback` | `site_url`, `additional_redirect_urls` (localhost) | Magic links land on the staging CMS only | G3.7 |
| Email templates | Task 22 (not this runbook) | Icelandic, Litljómi-branded | Task 22 | §4.4 | Task 22 and A11 |

**Secure password change through the Management API (Einar only).** Used only if the dashboard does not offer the setting (the row above). The Management API (`PATCH /v1/projects/<project-ref>/config/auth`) needs a Supabase personal access token, a secret, so Einar runs it in his own terminal, never an agent. He creates a token for this step (Supabase account settings, Access Tokens; confirm at execution time) and revokes it once the setting is verified. `<field-name>` is the Management API's name for the setting, taken from Supabase's current Management API reference at execution time, never guessed. The token is entered as in G2.5 ("Entering a token"): at a hidden prompt (`read -rs`), in a subshell, never exported, never on a command line (curl reads its headers from a configuration on standard input, written by the builtin `printf`, as in section 7.2), then unset. The commands print only an HTTP code and the setting's value:

```sh
(
  printf 'Supabase personal access token: '; read -rs SUPABASE_PAT; echo
  {
    printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$SUPABASE_PAT"
    printf 'request = "PATCH"\nurl = "https://api.supabase.com/v1/projects/%s/config/auth"\n' '<project-ref>'
    printf 'silent\nshow-error\noutput = "/dev/null"\nwrite-out = "PATCH: %%{http_code}\\n"\n'
    jq -nr '{"<field-name>": true} | tojson | "data = \(tojson)"'
  } | curl -q --config -
  {
    printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_PAT"
    printf 'url = "https://api.supabase.com/v1/projects/%s/config/auth"\nsilent\nshow-error\n' '<project-ref>'
  } | curl -q --config - | jq '.["<field-name>"]' 2>/dev/null
  unset SUPABASE_PAT
)
```

Expected: `PATCH: 200`, then `true`. Anything else: stop and report (the response body is never printed, since the Auth configuration can hold secret settings). Einar confirms the token is revoked. It is an Auth configuration change: if it is made after section 7.1, section 7.2 is run again (section 7.2, "When to run it").

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
0. **No account exists yet.** Owner: executor. Verify in the SQL editor: `select count(*) from auth.users;` returns `0`. If not, stop and report: an account was created before the hook (for example while sign-up was open), and Einar decides what happens to it before anything continues.
1. **Function present.** Owner: executor. Applied by G3.2 (`supabase db push`). Verify: G3.2's `to_regprocedure` check returns `true`.
2. **Function and grants (§4.5, "Auth hook grant").** Owner: executor. Verify in the SQL editor with the five statements below, each run on its own with its result recorded (section 1, "SQL blocks"). Any result other than the expected one: stop and report; do not change grants on the hosted project by hand.
   - **2a.** The function: owner, ACL, not `SECURITY DEFINER`, `search_path` pinned to `''`.
     ```sql
     select p.proowner::regrole as owner, p.proacl, p.prosecdef,
            'search_path=""' = any(p.proconfig) as search_path_empty
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'passwordless_access_token';
     ```
     Expected: `proacl` grants `EXECUTE` only to the owner and `supabase_auth_admin`; `prosecdef` is `false`; `search_path_empty` is `true`.
   - **2b.** Who may execute it.
     ```sql
     select r as role, has_function_privilege(r, 'private.passwordless_access_token(jsonb)', 'execute') as can_execute
     from unnest(array['anon', 'authenticated', 'service_role', 'supabase_auth_admin']) r;
     ```
     Expected: `can_execute` is `true` for `supabase_auth_admin` only.
   - **2c.** `supabase_auth_admin` has nothing else in `api`, `cms` or `private`: schema privileges.
     ```sql
     select s as schema, has_schema_privilege('supabase_auth_admin', s, 'usage') as usage,
            has_schema_privilege('supabase_auth_admin', s, 'create') as can_create
     from unnest(array['api', 'cms', 'private']) s;
     ```
     Expected: `usage` is `true` for `private` only; `can_create` is `false` for all three schemas.
   - **2d.** Functions it may execute.
     ```sql
     select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('api', 'cms', 'private')
       and has_function_privilege('supabase_auth_admin', p.oid, 'execute');
     ```
     Expected: exactly one row, `private.passwordless_access_token(jsonb)`.
   - **2e.** Tables, views, their columns and sequences (one statement: three parts joined by `union all`).
     ```sql
     select c.oid::regclass, priv
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) priv
     where n.nspname in ('api', 'cms', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_table_privilege('supabase_auth_admin', c.oid, priv)
     union all
     -- Column-level grants, which has_table_privilege does not see.
     select c.oid::regclass, 'column ' || priv
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['select', 'insert', 'update', 'references']) priv
     where n.nspname in ('api', 'cms', 'private') and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_any_column_privilege('supabase_auth_admin', c.oid, priv)
     union all
     select c.oid::regclass, priv
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['usage', 'select', 'update']) priv
     where n.nspname in ('api', 'cms', 'private') and c.relkind = 'S'
       and has_sequence_privilege('supabase_auth_admin', c.oid, priv);
     ```
     Expected: no rows.
3. **Enable the hook.** Owner: executor. Settings: Authentication hooks page (confirm the menu path at execution time): Custom Access Token hook → enabled, type Postgres, schema `private`, function `passwordless_access_token`. If the page cannot select a function in `private`, **stop and report**; do not move the function or change its grants. Verify: the page shows the hook enabled with that schema and function.
4. **Revoke all sessions** (immediately after step 3, still before any editor exists; again in step 3 of section 7.2's failure handling). Owner: executor, in the SQL editor, the statements below in order, each run on its own with its result recorded (section 1, "SQL blocks"):
   - **4a.** The role used must be allowed to delete there. Run this on its own first; **4b runs only if it returns `true`**.
     ```sql
     select current_user, has_table_privilege(current_user, 'auth.sessions', 'delete') as can_delete;
     ```
     Expected: `can_delete` is `true` (record `current_user`). If it is `false`, stop and report; do not run 4b.
   - **4b.** Only after 4a returned `true`:
     ```sql
     delete from auth.sessions;
     ```
     Record the number of rows deleted and the time.
   - **4c.** Expected `0`:
     ```sql
     select count(*) from auth.sessions;
     ```
   - **4d.** Expected `0` (the delete cascades):
     ```sql
     select count(*) from auth.refresh_tokens;
     ```
   - **4e.** Expected `0` (the delete cascades):
     ```sql
     select count(*) from auth.mfa_amr_claims;
     ```

   Success: 4a is `true` and 4c, 4d and 4e are each `0`. If 4a is `false` or a count is not `0`, stop and report. Access tokens already issued stay valid until they expire, at most `jwt_expiry` (3600 seconds, section 6); a refresh then fails, and the fail-closed `amr` rule refuses any earlier password session on refresh. Record the time of the revocation; nothing issued before it is relied on for one hour.
5. **Verify** with section 7.2.

### 7.2 Verification procedure (decision 20)

**When to run it:** after enabling the hook (section 7.1); after any change to hosted Auth settings (dashboard or Management API) or any configuration push; and before each acceptance run (Task 29 and later acceptances). **Recurring automation is deferred** until staging exists (Task 28 or later, by a separate decision; decision 20).

**Owners:** the executor runs the dashboard and SQL editor checks (H1, H2, H5, and H6's query); **Einar** runs the two scripts (H3, H4 and H6's deletion), because they need the secret key. Einar is told the result. **Record** each run (date, who, trigger, each check's result, the test account's id) in `docs/verification/m1-report.md` during M1.

**Checks, in this order, and expected results:**

| # | Check | Owner | Expected |
|---|---|---|---|
| H1 | Authentication hooks page | Executor | Custom Access Token hook **enabled**, Postgres, `private.passwordless_access_token` |
| H2 | Function and grants (section 7.1 step 2, statements 2a–2e, each on its own) | Executor | As in section 7.1 step 2: execute only for the owner and `supabase_auth_admin`, which has nothing else in `api`, `cms` or `private` (no schema, function, table, column or sequence privilege beyond `usage` on `private` and the hook); not `SECURITY DEFINER`; `search_path` empty |
| H3 | Part 1 script: creates the test account (with a password) and tries a password sign-in with its real password | Einar | HTTP **403** with the hook's message ("Only email sign-in is allowed") |
| H4 | Part 1 script: magic-link sign-in for the same account, then a refresh | Einar | Sign-in HTTP **200** with an access token and `expires_in` **3600**; refresh HTTP **200**; `redirect_to` as expected once G3.7 is done |
| H5 | SQL editor (H5a, H5b), **while the test account still exists**, with the id part 1 printed | Executor | **0** `password` rows on the project; for the test account, **0** `password` rows and **at least 1** row in all (its H4 session, so the check is not vacuous) |
| H6 | Part 2 script deletes the test account (the Auth admin API cannot clear a password, so the account is never reused); then the SQL check | Einar (deletion), executor (SQL) | Deletion HTTP **200**; the account is gone (H6a and H6b below each **0**) |

**Keeping secrets off command lines.** A command line is visible to every user of the machine (`ps`) and to process auditing; a pipe is not. So in both scripts curl reads its headers, URL and body as a configuration on standard input (`curl -q --config -`; `-q` first, so `~/.curlrc` is not read), written by `printf`, a shell builtin, so its arguments never become a program's command line; request bodies are built by `jq` from values it reads on standard input; responses stay in shell variables. The values read from `.env.local` stay in the script's own shell variables and are never exported, so no process's environment holds them either. The secret key, the generated password, the token hash and the refresh token therefore never appear on any command line, and nothing is written to a file (pipes only: no temporary files and no here-documents). Never run the scripts with `bash -x` or `set -x`. They print only the target host, HTTP codes (or a curl error number), `true`/`false` results, `redirect_to` and the test account's id (not a secret).

**Reading `.env.local` without executing it.** The scripts never source `.env.local` (`. ./.env.local` runs every line as shell code in a shell that holds the secret key, and a later duplicate line silently wins, which could send the key to another host). Each script reads only the names it needs, line by line, and refuses to send anything when:
- a name is assigned zero times or more than once, or not on a plain `NAME=value` line (an `export NAME=…` line or spaces around `=` count as assignments and are refused; comment lines are ignored);
- a value contains characters that cannot occur in it: `NEXT_PUBLIC_SUPABASE_URL` must be exactly `https://`, 20 lowercase letters or digits (the project reference) and `.supabase.co`, with nothing before or after; the keys may contain only letters, digits, `.`, `_` and `-` (this also keeps quotes, spaces, `$`, `%`, `\` and a stray carriage return out of the curl configuration);
- the URL is not the staging project's: Einar passes the project reference as `EXPECT_REF`, taken from his Supabase dashboard (or his own records), never from a repository file (the value recorded at G3.1 in `docs/verification/m1-report.md` is for the record only), and the URL must be `https://$EXPECT_REF.supabase.co`.

A refusal prints a `FAILED:` line naming the variable, never its value. Before its first request, each script prints the target host (`target: <project-ref>.supabase.co`). A local-stack URL (for example `http://127.0.0.1:54321`, as `.env.local` holds for local work) is refused, so the checks can never run against, or delete an account on, the local stack by mistake; for these runs `.env.local` holds the staging values (how Einar keeps the local and staging values apart is his choice; confirm at execution time). **Confirm at execution time** that the staging project's reference has 20 characters and that the publishable and secret keys contain only the characters above. If the hosted URL or a key has another shape, stop and report; do not loosen the check.

**How Einar runs them.** He copies each script, as shown, into a file outside the repository (the scripts hold no secret; for example `~/hook-check-1.sh` and `~/hook-check-2.sh`) and runs it with `bash`. The scripts read `/Users/einarzoega/litljomi-cms/.env.local` by its full path, so the directory he runs them from does not matter; nothing is loaded into his interactive shell:

```sh
EXPECT_REF='<project-ref>' EXPECT_REDIRECT='https://<cms-staging-host>' bash ~/hook-check-1.sh
EXPECT_REF='<project-ref>' bash ~/hook-check-2.sh '<test-account-id>'
```

Before G3.7 is done, leave out `EXPECT_REDIRECT=…`; part 1 then prints `redirect_to` without asserting it. Confirm at execution time that the hosted Auth admin endpoints accept the secret key in the `apikey` and `Authorization` headers as below.

**Part 1 (H3, H4).** It creates the test account and **does not delete it**. It checks every expected result and exits non-zero on any mismatch; a curl transport error or a failed sign-in is a mismatch too, so every failure ends with the `FAILED:` line and its hint.

```bash
#!/usr/bin/env bash
# Section 7.2, part 1 (H3, H4). Run by Einar only. Never with `bash -x` or `set -x`.
# Prints only the target host, HTTP codes, true/false results, redirect_to and the test account's id.
set -eu
ENV_FILE='/Users/einarzoega/litljomi-cms/.env.local'
REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'

# env_value NAME ERE: prints NAME's value from ENV_FILE without executing the file. Refuses, naming
# only NAME, unless NAME is assigned exactly once, on a plain NAME=value line, with a value matching
# ERE. Never prints a refused value. Part 2 has an identical copy: keep the two identical.
env_value() {
  local assigned="^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" allowed="$2" line value='' n=0 plain=0
  [ -f "$ENV_FILE" ] || { echo "FAILED: $ENV_FILE not found; nothing was sent" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ $assigned ]]; then
      n=$((n + 1))
      case "$line" in "$1="*) plain=1; value="${line#*=}" ;; *) plain=0 ;; esac
    fi
  done < "$ENV_FILE"
  if [ "$n" -ne 1 ] || [ "$plain" -ne 1 ]; then
    echo "FAILED: $1 must be on exactly one plain $1=value line in .env.local (found $n); nothing was sent" >&2
    return 1
  fi
  if ! [[ $value =~ $allowed ]]; then
    echo "FAILED: $1 in .env.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
  fi
  printf '%s' "$value"
}

REF="${EXPECT_REF:-}"
if ! [[ $REF =~ $REF_RE ]]; then
  echo "FAILED: set EXPECT_REF to the staging project's reference (from your Supabase dashboard); nothing was sent" >&2
  exit 1
fi
URL="$(env_value NEXT_PUBLIC_SUPABASE_URL "$URL_RE")"
PK="$(env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$KEY_RE")"
SK="$(env_value SUPABASE_SECRET_KEY "$KEY_RE")"
if [ "$URL" != "https://$REF.supabase.co" ]; then
  echo "FAILED: .env.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent"; exit 1
fi
printf 'target: %s\n' "${URL#https://}"
EXPECT_REDIRECT="${EXPECT_REDIRECT:-}"
EMAIL='<hook-test-address>'
PW="$(openssl rand -base64 24)"
FAILED=0

# call KEY METHOD PATH [DATA_LINE]: one request. curl reads headers, URL and body as a config on
# stdin (--config -), written by printf (a builtin), so no secret is on a command line.
# KEY is "secret" (Auth admin endpoints) or "public". Sets CODE and BODY; prints nothing itself.
# A transport error does not stop the script: CODE becomes "curl error <n>" and BODY is empty.
call() {
  local resp rc=0
  resp="$(
    {
      if [ "$1" = secret ]; then
        printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SK" "$SK"
      else
        printf 'header = "apikey: %s"\n' "$PK"
      fi
      printf 'header = "Content-Type: application/json"\nrequest = "%s"\nurl = "%s%s"\n' "$2" "$URL" "$3"
      printf 'silent\nshow-error\nwrite-out = "\\n%%{http_code}"\n'
      if [ -n "${4:-}" ]; then printf '%s\n' "$4"; fi
    } | curl -q --config -
  )" || rc=$?
  if [ "$rc" -ne 0 ]; then CODE="curl error $rc"; BODY=''; return 0; fi
  CODE="${resp##*$'\n'}"
  BODY="${resp%$'\n'*}"
}
# data_line FILTER: builds a JSON request body with jq from values on stdin; prints it as a curl
# config line (data = "...").
# jq's error messages can quote its input, so they are discarded (a missing body fails the request).
data_line() { jq -nr "$1"' | tojson | "data = \(tojson)"' 2>/dev/null; }
# jq_or_false FILTER: applies a jq filter to a response on stdin; prints its result, or false.
jq_or_false() { jq -r "$1" 2>/dev/null || echo false; }
# expect LABEL ACTUAL EXPECTED: prints the result; a mismatch marks the run as failed.
expect() {
  if [ "$2" = "$3" ]; then printf '%s: %s (ok)\n' "$1" "$2"
  else printf '%s: %s (expected %s) FAILED\n' "$1" "$2" "$3"; FAILED=1; fi
}

# The test account, with a password (the admin API can set one even with sign-up off).
call secret POST /auth/v1/admin/users \
  "$(printf '%s\n%s\n' "$EMAIL" "$PW" | jq -R . | data_line '[inputs] | {email: .[0], password: .[1], email_confirm: true}')"
USER_ID="$(printf '%s' "$BODY" | jq_or_false '.id // ""')"
if [ "$CODE" != 200 ]; then USER_ID=''; fi
case "$USER_ID" in
  '' | *[!0-9a-f-]*)
    echo "test account: HTTP $CODE, no valid id"
    echo "FAILED: the account may exist anyway; run 'If any check fails' from step 1 (look it up by email)"; exit 1 ;;
esac
echo "test account id: $USER_ID (keep it for H5 and part 2)"

# H3: a password sign-in with the account's real password must be refused by the hook.
call public POST '/auth/v1/token?grant_type=password' \
  "$(printf '%s\n%s\n' "$EMAIL" "$PW" | jq -R . | data_line '[inputs] | {email: .[0], password: .[1]}')"
expect 'H3 password sign-in, HTTP' "$CODE" 403
expect 'H3 refused with the hook message' \
  "$(printf '%s' "$BODY" | jq_or_false 'tostring | contains("Only email sign-in is allowed")')" true

# H4: a magic-link sign-in must succeed (admin generate_link sends no email), and so must its refresh.
call secret POST /auth/v1/admin/generate_link \
  "$(printf '%s\n' "$EMAIL" | jq -R . | data_line 'input | {type: "magiclink", email: .}')"
expect 'H4 generate_link, HTTP' "$CODE" 200
LINK="$BODY"
REDIRECT="$(printf '%s' "$LINK" | jq_or_false '.redirect_to // "missing"')"
if [ -n "$EXPECT_REDIRECT" ]; then expect 'redirect_to' "$REDIRECT" "$EXPECT_REDIRECT"
else printf 'redirect_to: %s (not asserted)\n' "$REDIRECT"; fi
if [ "$CODE" = 200 ]; then
  call public POST /auth/v1/verify \
    "$(printf '%s' "$LINK" | data_line 'input | {type: "magiclink", token_hash: .hashed_token}')"
  expect 'H4 magic-link sign-in, HTTP' "$CODE" 200
  expect 'H4 access token issued, expires_in 3600' \
    "$(printf '%s' "$BODY" | jq_or_false '(.access_token | type == "string" and length > 0) and .expires_in == 3600')" true
  if [ "$CODE" = 200 ]; then
    SESSION="$BODY"
    call public POST '/auth/v1/token?grant_type=refresh_token' \
      "$(printf '%s' "$SESSION" | data_line 'input | {refresh_token: .refresh_token}')"
    expect 'H4 refresh, HTTP' "$CODE" 200
  else
    echo 'H4 refresh: skipped (the magic-link sign-in failed)'
  fi
else
  echo 'H4 magic-link sign-in and refresh: skipped (generate_link failed)'
fi
unset PW LINK SESSION BODY PK SK

if [ "$FAILED" -ne 0 ]; then
  echo "FAILED: keep the test account ($USER_ID) as evidence; run H5, then 'If any check fails'"; exit 1
fi
echo "H3 and H4 passed. Next: H5 with id $USER_ID, then part 2."
```

**H5 (executor, SQL editor), before part 2.** Two statements, each run on its own with its result recorded (section 1, "SQL blocks").

- **H5a.** On the whole project: no session has ever been started by a password. Expected `0`.
  ```sql
  select count(*) from auth.mfa_amr_claims where authentication_method = 'password';
  ```
- **H5b.** For the test account (its id from part 1): no password row, and its H4 session is there. Expected `password_rows` `0` and `all_rows` at least `1`.
  ```sql
  select count(*) filter (where c.authentication_method = 'password') as password_rows,
         count(*) as all_rows
  from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id
  where s.user_id = '<test-account-id>';
  ```

Run H5 even when part 1 failed: its counts are part of the evidence.

**Part 2 (H6).** Only after H5 has passed and been recorded, or, after a failure, when the failure handling below reaches its deletion step.

```bash
#!/usr/bin/env bash
# Section 7.2, part 2 (H6): deletes the test account by its id. Run by Einar only, after H5 is
# recorded. Never with `bash -x` or `set -x`. Prints only the target host and the HTTP code.
set -eu
ENV_FILE='/Users/einarzoega/litljomi-cms/.env.local'
REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'

# env_value NAME ERE: identical to part 1's copy; keep the two identical (reads ENV_FILE without
# executing it; never prints a refused value).
env_value() {
  local assigned="^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" allowed="$2" line value='' n=0 plain=0
  [ -f "$ENV_FILE" ] || { echo "FAILED: $ENV_FILE not found; nothing was sent" >&2; return 1; }
  while IFS= read -r line || [ -n "$line" ]; do
    if [[ $line =~ $assigned ]]; then
      n=$((n + 1))
      case "$line" in "$1="*) plain=1; value="${line#*=}" ;; *) plain=0 ;; esac
    fi
  done < "$ENV_FILE"
  if [ "$n" -ne 1 ] || [ "$plain" -ne 1 ]; then
    echo "FAILED: $1 must be on exactly one plain $1=value line in .env.local (found $n); nothing was sent" >&2
    return 1
  fi
  if ! [[ $value =~ $allowed ]]; then
    echo "FAILED: $1 in .env.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
  fi
  printf '%s' "$value"
}

USER_ID="${1:-}"
case "$USER_ID" in
  '' | *[!0-9a-f-]*) echo 'FAILED: usage: bash hook-check-2.sh <test-account-id>; nothing was sent'; exit 1 ;;
esac
REF="${EXPECT_REF:-}"
if ! [[ $REF =~ $REF_RE ]]; then
  echo "FAILED: set EXPECT_REF to the staging project's reference (from your Supabase dashboard); nothing was sent" >&2
  exit 1
fi
URL="$(env_value NEXT_PUBLIC_SUPABASE_URL "$URL_RE")"
SK="$(env_value SUPABASE_SECRET_KEY "$KEY_RE")"
if [ "$URL" != "https://$REF.supabase.co" ]; then
  echo "FAILED: .env.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent"; exit 1
fi
printf 'target: %s\n' "${URL#https://}"
# curl reads headers and URL as a config on stdin (--config -), so the secret key is on no command line.
# A transport error does not stop the script before its FAILED line.
CODE="$(
  {
    printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SK" "$SK"
    printf 'request = "DELETE"\nurl = "%s/auth/v1/admin/users/%s"\n' "$URL" "$USER_ID"
    printf 'silent\nshow-error\noutput = "/dev/null"\nwrite-out = "%%{http_code}"\n'
  } | curl -q --config -
)" || CODE="curl error $?"
unset SK
if [ "$CODE" = 200 ]; then echo "H6 delete: $CODE (ok)"; exit 0; fi
echo "H6 delete: $CODE (expected 200) FAILED"
echo "FAILED: the account may still exist; run the H6 query, record both, then 'If any check fails'"; exit 1
```

**H6 query (executor, SQL editor), after part 2.** Two statements, each run on its own with its result recorded (section 1, "SQL blocks").

- **H6a.** Expected `0`.
  ```sql
  select count(*) from auth.users where id = '<test-account-id>';
  ```
- **H6b.** Expected `0`.
  ```sql
  select count(*) from auth.users where email = '<hook-test-address>';
  ```

**Success:** part 1 prints the staging host as `target:` and exits 0 with every check line `(ok)`; H5a returns `0` and H5b `0` and at least `1`; part 2 prints `200`; H6a and H6b each return `0`. A wrong password would get 400 instead of 403 (a known limitation, section 15), so H3 uses the account's real password.

**If any check fails:** stop; do not provision or invite anyone and do not continue the gate or the acceptance. **Keep the test account**: it is evidence until step 4 below.
1. **Record the evidence** (executor, in `m1-report.md`, no secrets): which checks failed and what they printed, the test account's id, the time, the H5 counts, and the test account's sessions and their methods:
   ```sql
   select s.id, s.created_at, s.aal, c.authentication_method
   from auth.sessions s left join auth.mfa_amr_claims c on c.session_id = s.id
   where s.user_id = '<test-account-id>' order by s.created_at;
   ```
   If part 1 stopped before printing an id, look for an account left behind: `select id, created_at from auth.users where email = '<hook-test-address>';` and record it.
2. **Assess the window** in which the hook may have been off or wrong: from the last passing run of this procedure (or the last recorded Auth configuration change, whichever is earlier) until now. The executor, with Einar for the dashboard logs (each query below run on its own):
   - the Auth logs (dashboard Logs, Auth; confirm the path at execution time) for successful password grants (`grant_type=password`) in the window, and which accounts they were for; refused password attempts appear only there (section 15);
   - every `password` row in `auth.mfa_amr_claims` with its session and user: `select s.user_id, s.created_at from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where c.authentication_method = 'password';`
   - which accounts have a password set: `select id, email, updated_at from auth.users where coalesce(encrypted_password, '') <> '';` (confirm at execution time how the hosted Auth version stores an account without a password);
   - every access token issued in the window is distrusted until `jwt_expiry` (3600 seconds) has passed after the revocation in step 3: nothing done with such a token is relied on, and the actions of any account found above during the window are listed for Einar to review.
3. **Fix** (executor): re-enable the hook with the right function (section 7.1 step 3), re-run H1 and H2, and revoke all sessions again (section 7.1 step 4: 4a `true` before 4b runs, then 4c–4e each `0`); record the time of the revocation.
4. **Delete the test account** only now: Einar runs part 2 with its id (or the id found in step 1), and the executor runs the H6 query.
5. **Re-run section 7.2 from H1** with a new test account; record the failure, the window assessment and the fix in `m1-report.md`; tell Einar through the controller. Accounts found with a password in step 2 are reported to Einar, who decides what happens to them (the hook keeps a password from signing in once this procedure passes).

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

### G4.3 A test invitation arrives
- **Owner:** Einar runs `cms provision editor … --email <Einar's test address>` (P-3; the CLI needs the secret key) and checks his mailbox.
- **Verify:** the invitation arrives within a few minutes, from the sender in section 8, with the link pointing to `https://<cms-staging-host>`; the message headers ("show original" or equivalent) report `spf=pass`, `dkim=pass` and `dmarc=pass`. Real LABAK editors are **not** invited in M1.

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

### G6.0 The existing project `landssamband-bakarameistara` must not be connected to the LABAK repository (G7 and G6)
- This step is the one statement of the check: section 1, section 3 and section 16 point here.
- **Owner:** Einar, in his own Vercel dashboard, **read only** (the existing project is off-limits: nothing in it is changed, by anyone, under this runbook). The controller raises this check with the G7 request at Task 27 and again at G6, and records the result (no secrets).
- **When:** **before the first push of `hub-integration`** to GitHub, whether that push is at Task 27 (if G7 includes it) or in G2.5; and again just before G6.1 connects the LABAK repository to `labak-hub-staging`. Nothing is pushed to `hub-integration` until this check has passed and been recorded.
- **Settings:** none; nothing is changed. Einar reads, in the existing project's Settings → Git (confirm the menu path at execution time): whether a Git repository is connected, and which. Any connection to the LABAK repository fails the check: an Ignored Build Step or disabled builds is not enough, because Vercel may still record a skipped deployment and post a commit status on the branch. By default Vercel builds a preview deployment for every branch pushed to a connected repository (confirm at execution time).
- **Verify:** passes only when the existing project has no Git connection or is connected to a different repository. If it has **any** Git connection to the LABAK repository (whatever its build settings), or if Einar cannot tell, **stop and report**: `hub-integration` is not pushed, and the existing project is not changed; Einar decides what happens. As a second line of defence, after the first push Einar checks the existing project's Deployments list: it shows no deployment of `hub-integration`. If one appears, stop and report; Einar decides about it (the executor never deletes or changes anything in the existing project).

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
  - **Connecting the LABAK repository** installs the Vercel GitHub integration on it. It is done only after the approvals section 1 requires (G6 and G7, each recorded by the controller) and after G6.0 has passed again. If the integration is installed for the first time, it is limited to the selected repositories, never all of Einar's repositories (confirm the option at execution time).
  - **Builds on `labak-hub-staging` are limited to `hub-integration`.** Production branch `hub-integration`, and a project setting that skips every other branch, including `main`, so no other LABAK branch is built or deployed. The intended setting is the project's Git settings, Ignored Build Step, with a command that skips the build unless the branch is `hub-integration` (for example `[ "$VERCEL_GIT_COMMIT_REF" != "hub-integration" ]`; Vercel skips the build when the command exits 0). **Confirm the exact setting at execution time** (an equivalent Git setting that disables builds for other branches is also acceptable); if neither exists, stop and report.
  - Plan: Vercel Hobby allows cron at most once a day (a more frequent schedule fails the deployment), and Hobby is for non-commercial use (§2.2). Per-minute cron (A8) needs Pro. **Einar: upgrade when needed** (before G6.4 is deployed).
- **Verify:** `vercel project ls` (in Einar's team scope) lists the three projects; each project's settings show the root directory, Node 22 and production branch above; `labak-hub-staging` shows the build restriction above, and after the next push to any LABAK branch other than `hub-integration` (if one happens) the project lists that deployment as skipped or shows none; the GitHub integration's repository access lists only the approved repositories; the team shows the Pro plan before the cron deploys.

### G6.2 Environment variables
- **Owner:** Executor sets non-secret values; **Einar enters secret values** (section 12) in the project's Environment Variables settings or from his own terminal, so no secret passes through an agent session. Production environment only (the staging hostnames are the projects' production domains); secret values marked sensitive if the option is offered (confirm at execution time).
- **Settings:** the variables in section 13 for each project, **except `CMS_WEBHOOK_SECRETS`** on the two site projects, plus the GitHub Packages read token on `labak-hub-staging`. `CMS_WEBHOOK_SECRETS` holds the site's webhook secret, which is created with the site in P-2 (section 11), after G6.5; P-2 sets and verifies it. A secret that Einar generates here (`CMS_INTERNAL_SECRET`, `CRON_SECRET`) is carried without a file, the clipboard or shell history, as in P-2: generated into a shell variable, piped to where it is stored, then unset. The GitHub Packages read token is entered as in G2.5 ("Entering a token"): at a hidden prompt in a subshell, piped to `vercel env add NODE_AUTH_TOKEN production --cwd ~/vercel-link/labak-hub-staging` (the name the `hub-integration` `.npmrc` reads; confirm at execution time), then unset.
- **Selecting the Vercel project.** `vercel env` acts on the project linked to its working directory, so a wrong directory would put a value, possibly a secret, on the wrong project (for example one site's webhook secret on the other site). Each project therefore gets its own empty directory outside the repository, `~/vercel-link/<project>` (`<project>` is a name from G6.1's table), linked once by Einar: `mkdir -p ~/vercel-link/<project>`, then `vercel link --cwd ~/vercel-link/<project> --project <project> --scope <team>` (`<team>` is his Vercel team). Every `vercel env` command in this runbook names that directory with `--cwd ~/vercel-link/<project>` and never relies on the current directory. Before the first value is added to a project, the executor compares the project ID in `~/vercel-link/<project>/.vercel/project.json` (not secret) with the one on that project's Settings page and records the match. Confirm the flags and the file at execution time (`vercel link --help`, `vercel env --help`); if the project cannot be selected and checked this way, stop and report.
- **Verify:** for each project, `vercel env ls production --cwd ~/vercel-link/<project>` lists exactly the names in section 13 for that project (values are not shown), except `CMS_WEBHOOK_SECRETS` on the two site projects (P-2 adds it), plus `NODE_AUTH_TOKEN` on `labak-hub-staging`; no other Supabase variable is present on a site project.

### G6.3 Deployment protection: Standard Protection on all three projects
- **Owner:** Executor (project Settings → Deployment Protection).
- **Settings:** for each of the three projects, Vercel Authentication **on, with Standard Protection** (it protects every deployment except production domains). Never disabled, and not "All Deployments". The staging hostnames are the projects' production domains, so they stay public and the live check (A15) reads the sites' pages without credentials, while preview and other deployment URLs stay behind Vercel Authentication (for `labak-hub-staging` this also covers anything built before the branch restriction of G6.1 applies). No Password Protection (paid per project and unnecessary). "Protection Bypass for Automation" is not needed, since the production domains are not protected.
- **Verify:** each project's Deployment Protection page shows Vercel Authentication with Standard Protection. From a machine with no Vercel session, after G6.5: `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` (not `401`, and not a redirect to a Vercel login) for all three hostnames; the same request to a preview or deployment-specific URL of one project, if one exists, returns `401` or a redirect to the Vercel login (confirm the exact response at execution time).

### G6.4 Cron for the worker sweep
- **Owner:** Executor; Einar enters `CRON_SECRET` (G6.2); the Pro plan is Einar's (G6.1).
- **Settings:** `apps/cms/vercel.json` (Task 17): `{ "crons": [{ "path": "/api/cron/sweep", "schedule": "* * * * *" }] }`. `CRON_SECRET` set on `litljomi-cms-staging` (random, at least 32 bytes; Vercel recommends at least 16 characters); Vercel sends it as `Authorization: Bearer <CRON_SECRET>` and the route compares it (`verifyCronSecret`). Cron delivery is best effort: a run can be missed or duplicated, there are no retries and redirects are not followed, so the sweep is idempotent and the route must not redirect.
- **Verify:** project Settings → Cron Jobs lists `/api/cron/sweep` with `* * * * *`; the project's logs show the sweep invoked about once a minute (A8 is measured over 10 minutes in Task 29). The protected routes refuse callers without the right secret (Task 17's routes answer `401`); the executor runs, after G6.5, with values that are deliberately wrong and not secrets:
  ```sh
  H='https://<cms-staging-host>'
  curl -s -o /dev/null -w 'cron, no header: %{http_code}\n' "$H/api/cron/sweep"
  curl -s -o /dev/null -w 'cron, wrong bearer: %{http_code}\n' -H 'Authorization: Bearer not-the-cron-secret' "$H/api/cron/sweep"
  curl -s -o /dev/null -w 'worker, no header: %{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
  curl -s -o /dev/null -w 'worker, wrong header: %{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -H 'x-cms-internal-secret: not-the-internal-secret' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
  ```
  All four print `401`. Anything else (including `202` or `200`): stop and report.

### G6.5 Deploy
- **Owner:** Executor.
- **Settings:** deploy each project's production branch (a push to the production branch, or a redeploy from the dashboard after G6.2). The two sites are deployed **without `CMS_WEBHOOK_SECRETS`, on purpose**: their webhook secrets do not exist until P-2, which sets the variable and redeploys each site. Nothing is published to a site before then (the test editor is invited in P-3).
- **Verify:** each project's latest production deployment is Ready; `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` for all three hostnames.

## 11. Tenants, sites and test editors (Task 28 Step 5)

The CLI (`tools/cli`) reads the staging URL and secret key from Einar's local environment (`.env.local`, never committed), so **Einar runs every `cms provision` command** in his own terminal (section 1); the executor prepares the exact commands (no secret in them) and runs the SQL checks. Run after G3.6, G3.7 and G6.5.

- **P-1 Tenants.** Owner: Einar runs `cms provision tenant labak`, `cms provision tenant demo`; the executor verifies. Verify: SQL editor `select slug from cms.tenants order by slug;` lists `demo` and `labak` (confirm the table and column names against the migrations at execution time).
- **P-2 Sites.** Owner: Einar (the CLI and the webhook secret); the executor verifies. `cms provision site …` once per staging site, with base URL `https://<demo-staging-host>` or `https://<labak-staging-host>` and the site's revalidate route (`/api/cms/revalidate` on the demo site; the LABAK branch's route, confirm at execution time). The secret is stored in Supabase Vault (`api.admin_create_site` keeps only its ID), and the same value becomes that site's `CMS_WEBHOOK_SECRETS` (set here, not in G6.2); the site is then redeployed. **Carrying the secret without a file, the clipboard or shell history**, in one terminal session per site:
  ```sh
  WEBHOOK_SECRET="$(openssl rand -base64 32)"          # never echoed; the command line holds only the variable's name
  printf '%s' "$WEBHOOK_SECRET" | cms provision site …  # the CLI reads it on stdin (confirm its input method at execution time)
  printf '%s' "$WEBHOOK_SECRET" \
    | vercel env add CMS_WEBHOOK_SECRETS production --cwd ~/vercel-link/'<site-project>'  # the project: G6.2
  unset WEBHOOK_SECRET
  ```
  `vercel env add` reads the value from stdin when piped (confirm at execution time); if it cannot, stop: Einar decides how the value is entered without a file, and the choice is recorded. To enter an existing value instead of generating one (for example during rotation), `read -rs WEBHOOK_SECRET` reads it without echo. `<site-project>` is `litljomi-demo-site` or `labak-hub-staging`, matching the base URL just provisioned. Verify: `select count(*) from vault.secrets;` increased by one per site (never select decrypted values); `vercel env ls production --cwd ~/vercel-link/<site-project>` now lists exactly section 13's names for that site (G6.2's list plus `CMS_WEBHOOK_SECRETS`); the site's redeployment is Ready.
- **P-3 Test editor.** Owner: Einar runs `cms provision editor … --email <Einar's test address>` for each tenant used in Task 29; the executor verifies. Real LABAK editors are not invited in M1. Verify: G4.3.
- **Record** every created resource (names, regions, domains, project references; no secrets) in `docs/verification/m1-report.md` (Task 28 Step 6). Owner: executor. Verify: `git grep -nE 'sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}' -- docs/verification/m1-report.md` finds nothing.

## 12. Secrets

No secret is ever committed, logged, printed in an agent session, pasted into chat or written into a report. `.env*` files other than `.env.example` are never committed, and `.env.local` is never sourced (section 7.2, "Reading `.env.local` without executing it"). The executor never reveals a secret value in the dashboard or the SQL editor and runs only the queries this runbook gives (section 1). Rotation: the SDK accepts two webhook secrets during rotation (§8.2).

| Secret | Created where | Stored where | Who may read it |
|---|---|---|---|
| Supabase secret key | Supabase project API keys (G3.1) | `litljomi-cms-staging` server environment (`SUPABASE_SECRET_KEY`); Einar's local `.env.local` for `tools/cli` | Code under `apps/cms/src/privileged/**` and `tools/cli` only (lint-enforced); in operation, only Einar's own terminal (the CLI and the section 7.2 scripts), never an agent session. Never in client bundles, sites or module code |
| Internal worker-trigger secret | Generated randomly by Einar (at least 32 bytes) | `litljomi-cms-staging` (`CMS_INTERNAL_SECRET`) | The CMS server: the trigger and `verifyInternalSecret` |
| Cron secret | Generated randomly by Einar (at least 32 bytes) | `litljomi-cms-staging` (`CRON_SECRET`) | Vercel Cron (sends it) and `verifyCronSecret` |
| Per-site webhook secret | Generated randomly by Einar, one per site (P-2) | Supabase Vault (by `cms provision site`) and the site's environment (`CMS_WEBHOOK_SECRETS`) | The worker through `service_role`-only functions (A9); the site's revalidation route |
| Per-site preview secret | Not created in M1 (preview is M3) | Vault and the site's environment, when M3 adds it | Privileged zone only (§8.2) |
| SMTP credentials (provider API key) | The email provider (G4.2) | Supabase Auth SMTP settings (G3.6) | Supabase Auth. §8.2 also lists the CMS environment; M1 code sends no email itself, so no variable is defined (section 16) |
| Supabase database password | Einar at project creation (G3.1) | Einar's password manager | Einar, typed at the `supabase link`/`db push` prompt only |
| Supabase CLI access token | `supabase login` by Einar | The Supabase CLI's local credential store | Einar's machine only |
| Supabase personal access token for the Management API (only if section 6's Management API route for secure password change is used) | Einar, in his Supabase account settings, for that step only | Not stored: entered at a hidden prompt in a subshell (section 6); **revoked by Einar once the setting is verified** | Einar's machine only |
| JWT signing secret or keys | Supabase (managed) | Supabase | Nobody exports it; holders could issue tokens without the hook (section 15) |
| GitHub Packages publish token | Einar (type, scope and expiry: G2.5, "Tokens") | Entered by Einar at a hidden prompt, in a subshell, for the publish commands only (G2.5, "Entering a token"); revoked by Einar once G2.5 is verified (G2.5) | Einar's machine only |
| GitHub Packages read token | Einar (type, scope and expiry: G2.5, "Tokens") | `labak-hub-staging` environment, under the variable name the `hub-integration` `.npmrc` reads (Task 28 Step 1; confirm at execution time), entered by Einar at a hidden prompt (G6.2); for the G2.5 check, a hidden prompt in a subshell only | Vercel's install step for that project, and also the site's server code at runtime (why its scope is limited: G2.5) |
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

Before Task 29, run the full local suite (Task 29 Step 1) and the hook verification (section 7.2). Task 29 then runs `apps/cms/e2e/m1-acceptance.spec.ts` against staging, one test per M1 criterion of spec §13.2 (Task 29 items 1–11; section 1 explains the numbering), and writes the results to **`docs/verification/m1-report.md`**: each criterion pass or fail with evidence (commands, request IDs, timestamps, screenshots at 375, 768 and 1440 px), each validation gate with its result, and every known limitation.

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
| Passwordless and email change: hook enabled; password sign-in 403; magic link works; no `password` row in `auth.mfa_amr_claims`; an email change needs both addresses | Sections 6 and 7 | Decisions 18, 19 (Task 29 item 11) |

Each run's secrets come from the local environment only; the report records results, never values. Because agents cannot read `.env.local` (section 1), anything in Task 29 that uses the staging secret key "from the local environment" (for example the admin `generateLink` path of the acceptance spec) is run by **Einar** in his own terminal, the same way as section 7.2; an agent never receives the key (open item, section 16).

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
- The live check cannot confirm a site behind deployment protection (§7.4); G6.3's Standard Protection keeps the staging domains (the production domains) public and every other deployment protected.
- Withdrawal from third-party caches is best-effort, and M1 has no fallback rule for failed entries (Task 29 reports both).

## 16. Open items

| Item | Owner | When |
|---|---|---|
| DECISION-SMTP: Resend (recommended) or SendGrid | Einar | G4 |
| Region (one of the four EU regions in G3.1) and project name for the Supabase staging project | Einar | G3 |
| The three staging hostnames under litljomi.is | Einar | G5 |
| Sending domain, sender address and, if no DMARC record exists, the DMARC policy | Einar | G4, G5 |
| Who enters secret values: this runbook proposes Einar, so no secret passes through an agent session | Einar confirms | G3, G6 |
| Steps that need the secret key or another secret value are Einar's (section 1), including the section 7.2 scripts, every `cms provision` command and section 6's Management API route | Einar confirms | G3 |
| Task 29's acceptance spec uses "the staging secret key from the local environment only"; agents cannot read `.env.local`, so that part must be run by Einar in his own terminal, the same way as section 7.2 (section 14) | Controller raises the Task 29 wording with Einar | Before Task 29 |
| The LABAK repository and Vercel: the approval to connect it to `labak-hub-staging` (section 1) and the G6.0 check on the existing project before the first push of `hub-integration` (section 10). The controller raises both with Einar when it requests G7 at Task 27 (the matching note is in the plan's Task 27) and again at G6 | Einar approves; controller raises | G7 request at Task 27; again at G6 |
| A `deny` rule for agent Edit and Write of `.env` and `.env.local`: the project settings deny only Read of them, and the repository root is writable for agents, so an agent could change `.env.local` (for example add a second `NEXT_PUBLIC_SUPABASE_URL`). The section 7.2 scripts refuse a duplicate name, a malformed value and another project's URL, but other tools that read the file may not; adding the rule is a `.claude/**` change for Einar to approve | Controller raises with Einar | Before G3 (before staging values go into `.env.local`) |
| `ask` rules for risky hosted Supabase commands (`supabase config push`, `supabase db reset --linked`, `supabase migration repair`): today the project settings have no `ask` rule for them, so G3.2's "do not use `supabase config push`" is behavioural only; adding the rules is a `.claude/**` change for Einar to approve | Controller raises with Einar | Before G3 |
| The email rate limit value (G3.6) | Einar confirms | G3 |
| SMTP credentials in the CMS environment (§8.2): no M1 code needs them, so no variable is defined; to be named when code that sends email is planned | Controller raises with Einar | When such code is planned |
| GitHub Packages scope for `@litljomi/*` under `einar6969` (G2.5) | Einar | G2 |
| Pin GitHub Actions to commit SHAs (deferred from Task 1) | Executor | G2.4 |
| Recurring automation of the hook verification (decision 20) | Einar, by a separate decision | Task 28 or later |
| Optional staging check of the 24-hour secure-password-change path (needs a session's `created_at` moved back in `auth.sessions`, as in the local verification) | Einar decides | G3 |
| Paid plans: Supabase Pro (§2.2), Vercel Pro (per-minute cron), email provider beyond its free tier. **Einar: upgrade when needed** | Einar | G3, G4, G6 |
| The production Supabase project and `cms.litljomi.is` (spec §2.2, §13) are outside this staging runbook | Controller raises with Einar | After M1 |
