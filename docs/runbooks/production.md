# Production runbook: the hosted environment, set up for M1 as staging

**Contents.** The execution order is section 3; sections 4–11 are the reference for each gate's steps. Day-to-day operations (a new tenant, secret rotation, suspend and revoke, platform admins, restore, advancing `production`) are in [`operations.md`](operations.md).

1. Purpose and status: scope, conventions, off-limits resources, the LABAK repository and Vercel
2. Prerequisites
3. Deployment sequence (the order Task 28 follows)
4. G2: GitHub repository, and the SDK files for the LABAK branch
5. G3: Hosted Supabase
6. Supabase Auth configuration (every hosted Auth setting, with the step that applies it)
7. Sign-in hook: enabling it (7.1), the verification procedure (7.2), the switch of this project (then staging) to password sign-in (7.3) and the rules for scripts that read the production env file (7.4)
8. Email delivery through SendGrid (G4)
9. DNS in the litljomi.is zone (G5)
10. Vercel projects, domains, deployment protection and cron (G6), and the G7 push
11. Tenants, sites and the first editor (Task 28 Step 5)
12. Secrets
13. Environment variables
14. Validation procedures (Task 29)
15. Known limitations
16. Open items

## 1. Purpose and status

This runbook set up the M1 staging environment (now production, see below): the GitHub repository, the hosted Supabase staging project, email through SendGrid, three CNAME records in litljomi.is and the three Vercel projects, and the push of the LABAK branch `hub-integration`. It is the procedure Task 28 follows and Task 29 checks.

**Status.** Written in Task 3 (2026-11-02) as a document only, and revised in Task 28 Step 0 (2026-11-03) to plan decisions 42.4 and 43; where decision 43 differs from decision 42 or an earlier version of this runbook, decision 43 applies. **Nothing in it has been executed**: no account, project, record, key or deployment exists because of it. It is executed only in Task 28 and Task 29, one gate at a time (G2, G3, G4, G5, G6, G7). Each gate is approved by Einar in his own words in chat and recorded by the controller in `docs/execution/gates.json` before any step under it runs. Approval of one gate does not cover another. The one paid step, the Vercel Pro upgrade, is Einar's (G6.1).

**Production on `vefstjorn.is` (decisions 74 and 76, 2026-11-12), and the renames.** The Supabase project this runbook set up as staging is now production, and there is no separate staging project. The staging-era names are renamed (2026-11-12):

| What | Now | Was |
|---|---|---|
| Supabase project `rwpgpfsmhhtimauvpoyt` | "vefstjorn" (production) | "staging" |
| Vercel project of the CMS (`apps/cms`) | `vefstjorn`, linked at `~/vercel-link/vefstjorn` | `vefumsjon-staging` |
| Vercel project of the demo site (`apps/demo-site`) | `vefstjorn-demo`, linked at `~/vercel-link/vefstjorn-demo` | `demo-staging` |
| CMS host | `https://vefstjorn.is` (`www.vefstjorn.is` and `vefumsjon-staging.litljomi.is` redirect to it) | `vefumsjon-staging.litljomi.is` |
| Demo site host | `https://demo.vefstjorn.is` (moving on 2026-11-12; the old host then redirects to it) | `demo-staging.litljomi.is` |
| Deploy branch (Vercel's Production Branch for both projects, G6.6) | `production` | `staging` |
| Einar's env file for `tools/cli` | `/Users/einarzoega/litljomi-cms/.env.production.local` | `.env.staging.local` |
| Next.js 15 fixture | deleted, with its two inactive `cms.sites` records | `demo-next15-staging` |

`labak-hub` and `labak-hub.litljomi.is` are unchanged. Auth's Site URL is `https://vefstjorn.is` and its only redirect URL is `https://vefstjorn.is/auth/confirm`. `CMS_PUBLIC_URL` on `vefstjorn` and `CMS_PREVIEW_BASE_URL` on `vefstjorn-demo` are `https://vefstjorn.is`. The secret key was rotated (`cms_prod_2026_11`) and the legacy JWT keys are disabled (operations runbook, section 4). The record is `docs/verification/production.md`.

**History sections.** The two paragraphs above ("This runbook set up" and "Status"), sections 2 to 5, 7.3, 8, 9 and 10 (apart from G6.6), the P-steps of section 11, Task 29 in section 14 and the per-gate rows of section 1's "Network" record what was done at M1 or in the password rollout. They keep the names of the time (the "Was" column), and each says so in one line. Everything else, and every command to run today, uses the current names.

**Password sign-in (PW-04, 2026-11-12).** Decision 72 replaced magic-link sign-in with password sign-in. Sections 6 and 7 describe the Auth configuration as it now is, and section 7.3 is the switch of this project (then staging) to it. Where sections 3, 5, 14 and 15 record what was done at M1 with the passwordless hook, they stay as history, with a note that decision 72 replaced it.

**Sources.** `docs/architecture.md` (§2.2, §4.2, §4.4, §7.3, §7.4, §8.2, §8.4, §9.1, §11) and the plan `docs/plans/2026-11-01-m0-m1.md` (gates G2–G7, decisions 16–21, 36.7, 42, 43, 72 to 72.5 and 73, Tasks 28 and 29) with `docs/plans/passwords.md`. If this runbook and the spec disagree, the spec wins: stop and report.

**Conventions.**
- Every step names its **Owner**, the **Settings** to apply and the **Verify** check that shows it worked. A step whose check fails stops the gate: record the result and report to the controller, who reports to Einar.
- **Einar** acts in his own accounts (sign-ups, payment, DNS, provider keys) and does **every login** (`gh`, `supabase login`, `vercel login`, every dashboard) and **enters every key and password**. No password, token or key goes into chat, ever. The **executor** is the agent the controller dispatches, acting only after the gate is recorded (written "Executor" only at the start of a sentence or table cell).
- **Who works in a dashboard.** The executor acts in the Supabase or Vercel dashboard (the SQL editor included) **only in a browser session Einar signed in to himself**. Otherwise Einar applies the step from this runbook's list and reads the result back to the controller. Every dashboard step below whose Owner is the executor is read this way.
- **A CLI whose saved login the sandbox cannot read.** `gh`, `supabase` and `vercel` keep their logins in local credential stores (some in the macOS keychain). A command whose saved login cannot be read from the sandbox is **handed to Einar to run** in his own terminal, as the exact command the executor wrote out, and he pastes back the output (no secrets in it). That is not a refusal to work around.
- **Who runs a step that needs a secret.** Every step that needs the Supabase secret key, the database password, the SendGrid API key, a GitHub token or any other secret value is **Einar's**, run in his own terminal or dashboard session. Agents cannot read `.env.local` or `.env.production.local` (the project's permission settings deny `.env.local` and every `.env.*.local`, see the ruling below) and never receive a secret value. The executor owns the steps that need no secret; the two public values it needs for checks (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, public by design) are given to it by Einar, never read from `.env.production.local`.
- **The dashboard and the SQL editor reach secret values.** The Supabase dashboard's API keys page can reveal the secret key, Vault (`vault.decrypted_secrets`) holds the per-site webhook secrets in clear, and the SQL editor runs as `postgres`, which can read both. The executor **never reveals a secret value** there: it does not reveal or copy a key on the API keys page or any other settings page (database password, SMTP password, JWT secret), never selects from `vault.decrypted_secrets`, and never selects token, password-hash or secret columns. In the SQL editor it runs **only the queries this runbook gives**, as written apart from the placeholders. A query that seems needed but is not here is reported to the controller first, never improvised.
- **SQL blocks.** Each SQL block or inline query holds exactly one statement; where a step has several, they are numbered (for example 2a, 2b). Run each statement on its own and record its result before running the next. The SQL editor may show only the last result when several statements run together (confirm its behaviour at execution time), so statements are never combined into one run.
- **Network.** The Bash sandbox stays limited to `registry.npmjs.org`. At each gate the controller shows Einar an exact `.claude/settings.json` diff adding **only that gate's hosts** to the sandbox's allowed domains, applies it only after his approval, and removes it when the gate is done. The hosts expected (confirm at execution time; a host found missing is a new diff for Einar, never an unsandboxed retry):

  | Gate | Hosts for the executor's commands |
  |---|---|
  | G2 | `github.com`, `api.github.com` |
  | G3 | `<project-ref>.supabase.co` (the executor's public checks, sections 5, 6 and 7; Einar's own `supabase` commands run in his terminal) |
  | G4, G5 | none (Einar works in SendGrid, Supabase and the DNS host himself, and runs the `dig` checks) |
  | G6 | `api.vercel.com`, `vefumsjon-staging.litljomi.is`, `demo-staging.litljomi.is`, `labak-hub.litljomi.is` |
  | G7 | `github.com` (G7.1's `git push` of `hub-integration` and its `git ls-remote` checks, in the LABAK checkout); `labak-hub.litljomi.is` (G7.1's live check and the `labak-hub` checks of G6.3 that wait for G7.1, since the G6 diff is removed by then). Shown to Einar as an exact diff with the G7 push request; removed when G7.1 is done |
  | Task 29 | `vefumsjon-staging.litljomi.is`, `demo-staging.litljomi.is`, `labak-hub.litljomi.is` and `<project-ref>.supabase.co`, for the controller's own read-only `curl` checks (status codes, headers, the public delivery files); no secret is used. Einar's browser tests and every acceptance run that needs the staging key (the admin link route, section 14) run in his own terminal, outside the sandbox, and need no entry here. Shown to Einar as an exact diff when Task 29 starts; removed when Task 29 is done |
- **Undo records.** Every hosted item created or changed under this runbook (repository, organisation, project, key, setting, record, deployment) is recorded the same day, with how to undo it, in `docs/verification/m1-gates.md`, table "Hosted items and how to undo them (Task 28)" (columns Item, Where, Created (date, gate), Monthly cost, How to undo), and in the session's handoff notes. No secret value goes into either.
- **Cost.** The only new cost is **Vercel Pro, $20 a month** (Einar upgrades the team at G6.1). SendGrid is Einar's existing paid plan; the Supabase organisation is on the Free plan (Pro comes with production, §2.2) and the GitHub repository is on GitHub Free. A step that would add any other cost stops: report it; Einar decides.
- "§" numbers refer to the spec (`docs/architecture.md`); "section N" refers to this runbook. **A1–A15** are the spec's validation gates (§11.1, the A-numbered table). "**Task 29 item N**" is item N of Task 29 Step 2 in the plan (one M1 acceptance test each). The two numberings are unrelated: Task 29 item 11 is the passwordless and email-change test, A11 is custom SMTP delivery.
- "**Confirm at execution time**" marks a value or screen this runbook could not verify when it was written (dashboard menu paths, provider record values, CLI details). The executor checks it against the live screen or the provider's current documentation and records what was found; it never guesses.
- **Names.** Today the CMS is at `vefstjorn.is` (Vercel project `vefstjorn`), the demo site at `demo.vefstjorn.is` (`vefstjorn-demo`) and the LABAK branch at `labak-hub.litljomi.is` (`labak-hub`); see the table above. At M1 the three staging hostnames were `vefumsjon-staging.litljomi.is`, `demo-staging.litljomi.is` and `labak-hub.litljomi.is`, and the Vercel projects `vefumsjon-staging`, `demo-staging` and `labak-hub` (G6.1). Placeholders are in angle brackets: `<project-ref>` (the hosted Supabase project's reference), `<team>` (Einar's Vercel team), `<hook-test-address>` and `<signup-test-address>` (throwaway addresses Einar controls, used only by the checks in sections 6 and 7), `<test-account-id>` (the test account's id, from section 7.2's S9a; not secret).
- **Where the hosted keys live (Einar's ruling, 2026-11-03, G3).** Einar ruled in chat (recorded in `docs/execution/gates.json`, G3): "Staging keys go in a separate file, /Users/einarzoega/litljomi-cms/.env.staging.local, which I create and fill myself. Don't swap `.env.local`. Point the runbook's scripts (their `ENV_FILE`) at the staging file, and keep the project-reference check. Record this change in the runbook." So the hosted URL, publishable key and secret key are read from that separate file, **`/Users/einarzoega/litljomi-cms/.env.production.local`** since 2026-11-12 (`.env.staging.local` until then): a file Einar creates and fills himself, git-ignored by `.env*`, never sourced and read-denied to agents like `.env.local` (`.env.*.local` in `.claude/settings.json`). `.env.local` keeps the local stack's values and is not swapped. `tools/cli` (section 11) reads it by default; the G3.2c script (its `ENV_FILE`) pointed at the staging file at M1, as section 7.2's scripts did until decision 72; the project-reference check (`EXPECT_REF`) is unchanged.
- **No secret, key or token value is ever written** to this repository, a commit, a chat message, a log or a report. Commands read hosted secrets from `.env.production.local` (never committed) without executing it, from a hidden prompt, or generate them and pipe them straight into the CLI that stores them; they never print them and never put them on a command line (sections 7.4, 11 and 12 show how). `.env.production.local` (like `.env.local`) is **never sourced** (`. ./.env.production.local`): that would run its lines as shell code in a shell that holds the secret key. See section 12.

**Off-limits.** `labak.is` and its DNS, FILMÍS, ISNIC, the hostnames `labak.litljomi.is` and `labak.is`, the LABAK repository's `main` branch, any production project, and the existing Vercel project `landssamband-bakarameistara`, **apart from the one build setting Einar changes himself** (G6.0). Nothing else in that project is changed, by anyone, under this runbook.

**The LABAK repository and Vercel (G6 and G7).** This paragraph is the one statement of this approval; other sections point here. The existing project `landssamband-bakarameistara` **is** connected to the LABAK repository and builds labak.litljomi.is from `main` (decision 43). So the Vercel GitHub app already has access to the LABAK repository through that project, and by default Vercel builds a preview deployment of every branch pushed there and posts deployment statuses on it. Connecting the new project `labak-hub` to the same repository (G6.1) lets a second project build and post statuses there; it still needs **Einar's explicit approval at G6 and at G7**, named as such, before the project is connected, and the controller records both. When approved, `labak-hub` builds `hub-integration` only (its Ignored Build Step, G6.1), and every deployment other than its production domain stays behind Vercel Authentication (G6.3).

**The existing project and `hub-integration`.** Without a safeguard, the first push of `hub-integration` would build a preview inside `landssamband-bakarameistara`, an off-limits project. So nothing is pushed to `hub-integration` until Einar has set, and confirmed to the controller, the Ignored Build Step of G6.0 on that project, which lets it build `main` only. That build setting is the one change anyone makes to `landssamband-bakarameistara`, and Einar makes it himself. G6.0 states the step, its check and its residual risk; G7.1 is the push.

## 2. Prerequisites

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

| # | Prerequisite | Owner | Verify |
|---|---|---|---|
| P1 | Tasks 0–27 complete and green locally (`pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test && pnpm db:reset && pnpm db:test && pnpm test:integration`) | Executor | Every command exits 0; the controller's `state.json` shows Tasks 0–27 done |
| P2 | Task 4's migration (creating `api`, `cms`, `private` and `private.passwordless_access_token`) and its `[api] schemas = ["api"]` are committed (since decision 72, `20261112100000_sign_in_auth_hook.sql` replaces that hook with `private.sign_in_access_token`, section 7) | Executor | `git log --oneline -- supabase/migrations` lists it; `grep -n 'schemas = \["api"\]' supabase/config.toml` matches |
| P3 | The LABAK branch `hub-integration` exists locally (Task 27, G7) and has **never been pushed**; it is pushed only at G7.1, after G6.0 | Controller | G7 recorded in `gates.json`; Task 27 done in `state.json`; the G6.0 confirmation recorded before G7.1 |
| P4 | Einar has accounts he controls at GitHub (`einar6969`, signed in to `gh` himself), Supabase, Vercel and SendGrid (his existing paid account, with litljomi.is already authenticated), and access to the litljomi.is DNS zone | Einar | Einar confirms in chat at each gate |
| P5 | The hosts each gate needs are allowed for the session, by the per-gate diff of section 1 ("Network"), approved by Einar and removed when the gate is done | Einar approves; controller applies | The approved diff is recorded; a sandbox refusal is reported, never worked around |
| P6 | Local tools: `git`, `gh`, `npm`, `supabase` (2.121.0, as in CI), `vercel`, `curl`, `jq`, `openssl`, `dig`, `shasum` | Einar (any install is G1) | `<tool> --version` for each |

## 3. Deployment sequence

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

Task 28 follows this order, in the three sittings of decision 43 (a stop and a short summary at the end of each). Each step lists what it depends on. Every hosted item is recorded with how to undo it as it is created (section 1, "Undo records").

G2.5 (sitting 1, order 5) is local work on the LABAK branch under the G7 extension of 2026-11-03 (no push); it is separate from the G7 push (G7.1, decision 43.8), which is approved on its own in sitting 3.

| Order | Step | Gate | Depends on |
|---|---|---|---|
| | **Sitting 1: local preparation, G2 and G3** | | |
| 1 | G2.4: pin GitHub Actions to commit SHAs (a reviewed commit), **before the first push** | G2 | P1 |
| 2 | G2.0: scan the full history of all refs for keys, tokens and `.env` contents; Einar sees the findings | G2 | G2.4 (the last commit before the push) |
| 3 | G2.1: private repository `einar6969/litljomi-cms` | G2 | G2.0 shown to Einar |
| 4 | G2.2–G2.3: push `main` and `m1/phase-1` only; Actions with no repository secrets; CI green | G2 | G2.1 |
| 5 | G2.5: the vendored SDK files on `hub-integration` (local work on the LABAK branch, not pushed); a fresh clone passes `npm ci` and `npm run build` | G7 (`branch=hub-integration`, no push) | P3 |
| 6 | G3.1: Free organisation "Litljómi", project "staging" in Frankfurt `eu-central-1` | G3 | P4 |
| 7 | G3.4: the Auth settings G3.4 lists (the section 6 rows whose Step is G3.4); **right after G3.1**, because sign-up is open on a new project until it is turned off | G3 | G3.1 |
| 8 | G3.2a: decision 36.7, the 10-second `service_role` timeout accepted; **before `db push`**; refused → stop | G3 | G3.4 |
| 9 | G3.2b: Einar runs `supabase login`, `supabase link`, `supabase db push` (includes the hook function) | G3 | G3.2a, P2 |
| 10 | G3.2c: decision 36.7, the timeout applied to `service_role` requests over REST | G3 | G3.2b |
| 11 | G3.3: Data API exposes `api` only | G3 | G3.2b (the `api` schema must exist) |
| 12 | G3.5: check that no account exists, enable the hook, revoke all sessions, run the hook verification (section 7). At M1 this was the passwordless hook; decision 72 replaced it with the sign-in hook (section 7.1 on a new project, section 7.3 on staging) | G3 | G3.2b, G3.4; **before any editor account exists** (`select count(*) from auth.users` → 0) |
| | **Sitting 2: G4, G5 and G6** | | |
| 13 | G4.1–G4.2: SendGrid restricted API key, Mail Send only | G4 | P4 |
| 14 | G5.1: read-only check of SendGrid's domain authentication for litljomi.is and its DMARC record; nothing added or changed | G5 | G4.1 |
| 15 | G3.6: custom SMTP (SendGrid) in Supabase Auth; the email rate limit | G3 (G4 credentials) | G4.2, G5.1 |
| 16 | G6.1: Vercel Pro (Einar), `vercel login` (Einar), Vercel's GitHub app given access to `litljomi-cms` (Einar); projects `vefumsjon-staging` and `demo-staging`; `labak-hub` created and configured but not built (connecting the LABAK repository needs the approvals in section 1) | G6 (and G7 for the LABAK repository) | G2.3, P3 |
| 17 | G5.2: the three CNAMEs in litljomi.is, added to the Vercel projects | G5 and G6 | G6.1 |
| 18 | G3.7: Auth Site URL and redirect URL for `vefumsjon-staging.litljomi.is`, the email templates (four at M1; the six of `supabase/templates/` since decision 72, G3.7) | G3 | G5.2 |
| 19 | G6.2–G6.4 settings: environment variables (section 13, except each site's `CMS_WEBHOOK_SECRETS`, which P-2 sets), deployment protection, cron. Their live checks (G6.3's and G6.4's `curl` requests) run after G6.5 | G6 | G3.1, G5.2 |
| 20 | G6.5: deploy `vefumsjon-staging` and `demo-staging` (the demo site without `CMS_WEBHOOK_SECRETS`, on purpose); then G6.3's and G6.4's live checks. `labak-hub` is first built by the G7.1 push | G6 | G6.2–G6.4 settings |
| | **Sitting 3: the G7 push, Task 29 and C4** | | |
| 21 | G6.0: Einar sets the Ignored Build Step on `landssamband-bakarameistara` and confirms it to the controller | G7 (raised with the G7 push request) | none |
| 22 | G7.1: push `hub-integration` only (with the vendored SDK files of G2.5); `labak-hub` builds it; Einar checks that `landssamband-bakarameistara` built nothing for it | G7 (`push=true`, `hub-integration` only) | G6.0 confirmed, G2.5, G6.1 |
| 23 | P-1–P-3: Einar provisions the tenants, the sites (webhook secrets stored in Vault) and the staging editor `einsi@litljomi.is` with `tools/cli`; sets each site's `CMS_WEBHOOK_SECRETS` and the site is redeployed (P-2 verifies it) | G3 (hosted Supabase) and G6 (site variables); the controller confirms coverage before running | G3.6, G3.7, G6.5, G7.1 |
| 24 | G4.3: the staging editor's invitation arrives with SPF, DKIM and DMARC passing | G4 | P-3 |
| 25 | Section 7.2 hook verification again, then Task 29 (section 14) | none beyond those recorded | everything above |

**Since M1.** The table is the order Task 28 followed. Staging moves to password sign-in by section 7.3, run once (decision 72). A new hosted project (production, by its own decision) follows the table with the sign-in hook of section 7.1 at order 12, the Auth settings of section 6 as they now are at order 7, and the six templates at order 18; its section 7.2 runs in full only after order 18, since the checks need SMTP and the templates.

## 4. G2: GitHub repository, and the SDK files for the LABAK branch

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

The order is section 3's: G2.4 (pins) and G2.0 (history scan) come **before** the repository exists, so nothing reaches GitHub unpinned or unscanned. Einar is signed in to `gh` as `einar6969` himself; a `gh` command whose saved login the sandbox cannot read is handed to him (section 1).

### G2.0 Scan the full history before the first push
- **Owner:** Executor (no secret needed); Einar sees the findings before G2.1.
- **When:** after G2.4's commit, as the last step before the repository is created, so the scan covers every commit that could be pushed.
- **Settings:** none; read only. From the repository root, over **every ref** (`git rev-list --all`: all branches, tags and stashes, more than the two branches pushed in G2.2). The commands print paths, counts and at most a recognisable prefix and four characters of a match, never a whole value.
  1. Files named like `.env` ever committed (expected: no output):
     ```sh
     git log --all --format= --name-only | grep -E '(^|/)\.env' | grep -vE '(^|/)\.env\.example$' | sort -u
     ```
  2. Key, token and secret-assignment shapes, each match cut to its prefix and four characters, with a count. `RE` covers Supabase keys (`sb_secret_`, `sb_publishable_`, legacy `eyJ…` JWTs) and personal access tokens (`sbp_`), GitHub tokens, SendGrid keys (`SG.`), Resend keys, `vercel_`-prefixed tokens, private keys, Postgres URLs with a password (`postgres://user:pw@`, `postgresql://…`), and any assignment of a non-empty value, quoted or not, to an upper-case name ending in `TOKEN`, `SECRET`, `SECRETS`, `PASSWORD`, `PASS` or `KEY` (`SUPABASE_DB_PASSWORD=`, `VERCEL_TOKEN=`, `NODE_AUTH_TOKEN=`, `SUPABASE_SECRET_KEY=` and the rest). A Vercel token without a recognisable prefix is caught only by such an assignment (confirm Vercel's current token format at execution time). `CUT` prints the prefix and four characters:
     ```sh
     RE='sb_(secret|publishable)_[A-Za-z0-9_-]{8,}|sbp_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|SG\.[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9]{8,}_[A-Za-z0-9]{8,}|vercel_[A-Za-z0-9_-]{16,}|postgres(ql)?://[^:/@[:space:]]+:[^@/[:space:]]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|[A-Z_]*(TOKEN|SECRET|SECRETS|PASSWORD|PASS|KEY)=["'"'"']?[^[:space:]$"'"'"'`]+'
     CUT='s/^(sb_secret_|sb_publishable_|sbp_|github_pat_|gh[pousr]_|SG\.|re_|vercel_|postgres(ql)?:\/\/|eyJ|-----BEGIN|[A-Z_]+=["'"'"']?)?(.{0,4}).*/\1\3…/'
     git rev-list --all | xargs git grep -ohIE "$RE" | sed -E "$CUT" | sort | uniq -c
     ```
  3. Where they are (path and the number of commits holding it):
     ```sh
     git rev-list --all | xargs git grep -lIE "$RE" | sed -E 's/^[0-9a-f]{40}://' | sort | uniq -c
     ```
  4. Commit messages, the same shapes (expected: no output from either command; the second prints only abbreviated commit hashes, never a subject):
     ```sh
     git log --all --format=%B | grep -ohE "$RE" | sed -E "$CUT" | sort | uniq -c
     git log --all -E --grep="$RE" --format=%h
     ```
  `git grep -I` skips binary files; this repository commits no archives, and the LABAK branch's tarballs are scanned unpacked before G7.1.
- **Verify:** the executor lists every finding for Einar (path, commits, shape, the four-character prefix) and classifies it. **Expected, and acceptable,** the local test values: `sb_publishable_test_value` and `sb_secret_test_value` (`sb_publishable_test…`, `sb_secret_test…`), the local database URL `postgres:postgres@127.0.0.1:54322` (`postgresql://post…`), `labak-local-secret` (`CMS_WEBHOOK_SECRETS=laba…`), `s3cr3t` (`CMS_WEBHOOK_SECRETS=s3cr…`), `local-cron` (`CRON_SECRET=loca…`), `local-internal` (`CMS_INTERNAL_SECRET=loca…`), `e2e-secret-old` and `e2e-secret-new` (the demo site's e2e harness, if a pattern catches them), the fake `supabase status` output in `tools/checks/__tests__/e2e-loopback.test.ts` (`PUBLISHABLE_KEY="pk…`, `SECRET_KEY="sk…`), and Supabase's public local development keys. Anything else, or anything the executor cannot classify: **stop**; nothing is pushed, and Einar decides (rewriting history is his decision, never automatic). The widened scan was tried on 2026-11-03 over every ref (about 25 s): it printed only the expected values above and nothing from commit messages; confirm at execution time that it still does.

### G2.1 Create the private repository
- **Owner:** Einar approves at G2; executor runs `gh` (or hands it to Einar, section 1).
- **Settings:** `gh repo create einar6969/litljomi-cms --private --source ~/litljomi-cms --remote origin`, **without `--push`** (confirm the flags at execution time against `gh repo create --help`).
- **Verify:** `gh repo view einar6969/litljomi-cms --json visibility -q .visibility` prints `PRIVATE`; `git -C ~/litljomi-cms remote -v` shows only `origin` → `einar6969/litljomi-cms`.

### G2.2 Push `main` and `m1/phase-1`; Actions with no repository secrets
- **Owner:** Executor, after G2.
- **Settings:** `git push -u origin main`, then `git push -u origin m1/phase-1`. **No other branch and no tag**; never `--all`, `--mirror`, `--tags` or a force-push. Actions enabled for the repository (repository Settings → Actions; confirm at execution time), running the existing `.github/workflows/ci.yml` (lint, typecheck, unit tests, and pgTAP and integration tests on a local Supabase stack inside CI). Workflow permissions (repository Settings → Actions → General; confirm at execution time): the default `GITHUB_TOKEN` permission is **read** repository contents only, and "Allow GitHub Actions to create and approve pull requests" is **off** (the workflow also declares `permissions: contents: read`). **No repository secrets**: CI uses only the local stack it starts.
- **Verify:** `git ls-remote --heads --tags origin` lists exactly `refs/heads/main` and `refs/heads/m1/phase-1`, matching `git rev-parse main` and `git rev-parse m1/phase-1`; `gh api repos/einar6969/litljomi-cms/actions/permissions -q .enabled` prints `true`; `gh api repos/einar6969/litljomi-cms/actions/permissions/workflow` shows `"default_workflow_permissions": "read"` and `"can_approve_pull_request_reviews": false`; `gh secret list --repo einar6969/litljomi-cms` lists nothing.

### G2.3 CI green on GitHub
- **Owner:** Executor.
- **Settings:** none.
- **Verify:** `gh run list --branch main --limit 1 --json conclusion -q '.[0].conclusion'` prints `success`, and the same for `m1/phase-1`. A failure stops G2. GitHub Free's Actions minutes for a private repository: confirm at execution time that a run fits; a cost stops the step (section 1, "Cost").

### G2.4 Pin GitHub Actions to commit SHAs (deferred from Task 1), before the first push
- **Owner:** Executor (a normal reviewed commit in the repository, on `m1/phase-1`, with `main` fast-forwarded to it locally, so both pushed branches carry the pins).
- **Settings:** in `.github/workflows/ci.yml`, replace each `uses: <action>@<tag>` (`actions/checkout`, `pnpm/action-setup`, `actions/setup-node`, `supabase/setup-cli`) with `<action>@<40-character commit SHA> # <tag>`, the SHA looked up from the action's own repository at execution time (for example `gh api repos/actions/checkout/git/ref/tags/<tag>`, which needs only `api.github.com`; for an annotated tag, dereference to the commit; confirm at execution time). The lookup is the one G2 step that reaches GitHub before the repository exists; it reads public repositories only.
- **Verify:** `grep -nE 'uses: [^@]+@[0-9a-f]{40}( |$)' .github/workflows/ci.yml` matches every `uses:` line and `grep -c 'uses:'` equals that count; after G2.2, the first CI run on each pushed branch is `success` (G2.3), and the G2.2 workflow-permission check shows `read` and `false`.

### G2.5 The SDK for the LABAK branch: vendored `npm pack` files (decisions 42.4 and 43.3)
- This step replaces the earlier GitHub Packages plan. Until a second site arrives, the two packages reach the LABAK site as vendored `npm pack` files committed on `hub-integration` (spec §9.1); a private registry (GitHub Packages, which needs a `litljomi` GitHub organisation) waits until then. No registry, no token and no `.npmrc` are involved.
- **Owner:** Executor, on the LABAK branch under G7 (`branch=hub-integration`); local work, nothing hosted. It is done before the G7.1 push, so the first pushed commit already builds without anything from Einar's Mac.
- **Settings:**
  - In this repository, at the commit recorded as the source: `npm pack` of `@litljomi/cms-sdk` and `@litljomi/rich-text`, version `0.1.0`, from `packages/sdk` and `packages/rich-text` (confirm at execution time that each tarball contains its built entry points and no workspace-only paths).
  - On `hub-integration`: the two tarballs under `vendor/`; in `package.json`, the dependencies `"@litljomi/cms-sdk": "file:vendor/<tarball>"` and `"@litljomi/rich-text": "file:vendor/<tarball>"` instead of the `link:` paths; `package-lock.json` regenerated by `npm install`.
  - `vendor/README.md` names, for each tarball: the source commit of this repository, the package version, and its SHA-256 (`shasum -a 256 vendor/*.tgz`), and says how to update them (repack, replace, record).
- **Verify:** a fresh clone of the branch, with nothing from Einar's Mac (no `node_modules`, no `.env*`, no link to this repository), passes `npm ci` and `npm run build`, for example `git clone --branch hub-integration --single-branch <LABAK checkout> "$TMPDIR/labak-fresh"`, then `npm ci` and `npm run build` there (npm reaches only `registry.npmjs.org`); `shasum -a 256 vendor/*.tgz` in the clone matches `vendor/README.md`; `git grep -nE 'link:|_authToken' hub-integration -- package.json .npmrc` finds nothing. Whether the build needs any environment variable to run in a clean clone: confirm at execution time and record (it must not need a secret).

## 5. G3: Hosted Supabase

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

### G3.1 Organisation and staging project
- **Owner:** Einar (account, organisation, project, database password); executor reads the result.
- **Settings:**
  - A **Free** organisation named "Litljómi" and a project named "staging" in **Central EU (Frankfurt) `eu-central-1`**. Pro comes with the production project (an approved deferral of §2.2, decision 42.4); the Custom Access Token hook is available on Free, so M1 staging does not depend on the plan.
  - The database password is set by Einar and kept in his password manager; it is typed only at the Supabase CLI's prompt (G3.2b) and never written anywhere else.
- **Region as built (C5, 2026-11-04):** the staging project is in `eu-west-1`, not `eu-central-1`. Einar ruled that it stays there. Vercel functions are set to `fra1`.
- **Verify:** the project's settings page shows region `eu-central-1` and the Free plan (Einar reads them out, or a screenshot without keys); the region and project reference are recorded in `docs/verification/m1-report.md` (no secrets), and the organisation and project in the undo table (section 1).

### G3.2 The role timeout, then link and apply migrations
Three parts, in this order. G3.4 has already turned sign-up off (section 3).

**G3.2a Decision 36.7, before `db push`: the 10-second `service_role` timeout is accepted.**
- **Owner:** Executor, in the SQL editor (section 1, "Who works in a dashboard").
- **Settings:** this statement on its own, the same statement as migration `20261102001100_worker_phase3.sql`:
  ```sql
  alter role service_role set statement_timeout = '10s';
  ```
- **Verify:** it succeeds, and then this statement, on its own, returns a `rolconfig` that contains `statement_timeout=10s`:
  ```sql
  select rolconfig from pg_roles where rolname = 'service_role';
  ```
  **If the `alter role` is refused, or `rolconfig` does not show the setting, stop and report**: nothing else is done on the project, `db push` does not run (the migration contains the same statement), and Einar decides. The migration repeats the statement during `db push` (harmless) and sends `notify pgrst, 'reload config'`, so PostgREST re-reads role settings then.

**G3.2b Link and apply migrations (Einar, in his own terminal).**
- **Owner:** Einar runs the commands below in his own terminal, from the repository root, so the database password never enters an agent session; he types it only at the CLI's prompt, never on a command line or in a file. The executor writes the commands out and reads the output he shares (no secrets in it).
- **Settings:**
  ```sh
  cd ~/litljomi-cms
  supabase login
  supabase link --project-ref <project-ref>
  supabase db push
  supabase migration list
  ```
  (`supabase login` opens the browser sign-in; `supabase link` asks for the database password; `supabase db push` lists the migrations it will apply and asks for confirmation. Confirm the prompts at execution time.) **Never `supabase config push`:** `supabase/config.toml` describes the local stack, so a push would send local-only values to staging (the localhost Site URL and redirect URLs, the local email rate limit, and no SMTP block), while the hosted Auth settings are set by hand (section 6); a push is also an Auth configuration change that makes section 7.2 due again.
- **Verify:** `supabase migration list` shows every local migration applied remotely (no row with a local version and an empty remote column). The executor, in the SQL editor: `select to_regprocedure('private.sign_in_access_token(jsonb)') is not null;` returns `true` (at M1 the check named `private.passwordless_access_token`, the hook decision 72 replaced).

**G3.2c Decision 36.7, after the push: the timeout applies to `service_role` requests over REST.**
Locally this is proven by `tests/integration/src/service-role-timeout.test.ts` (and the role setting by `supabase/tests/database/095_worker_phase3.test.sql`): a secret-key REST call made to wait on two locks in turn, each wait shorter than the login role `authenticator`'s 8-second `lock_timeout`, is cancelled at about 10 s with `57014`, which only `service_role`'s 10 s can do (the authenticator's own 8 s would cancel it at about 8 s, and with no timeout the second lock wait would end with `55P03`). That test refuses a hosted stack, so the hosted equivalent is the same measurement by hand, before any tenant, editor or deployment exists (nothing else uses the tables then):
- **Owner:** Einar, because the REST call needs the secret key (run under section 7.4's rules) and the two SQL editor runs must start within seconds of it; the executor writes out the steps and reads back the results.
- **Settings and verify,** each statement on its own:
  1. **c1** (SQL editor): the role settings. Expected: `service_role` shows `statement_timeout=10s` (G3.2a) and `authenticated` shows `statement_timeout=3s` (migration `20261105140000_editor_limits.sql`; if it doesn't, see operations section 8); record what `authenticator` shows (locally `statement_timeout=8s` and `lock_timeout=8s`; confirm at execution time).
     ```sql
     select rolname, rolconfig from pg_roles where rolname in ('service_role', 'authenticated', 'authenticator');
     ```
  2. **c2** (SQL editor, tab 1, started first): holds a lock on `cms.publish_requests` for 30 seconds.
     ```sql
     do $$ begin lock table cms.publish_requests in access exclusive mode; perform pg_sleep(30); end $$;
     ```
  3. **c3** (SQL editor, tab 2, started right after c2): holds a lock on `cms.tenants` for 7 seconds.
     ```sql
     do $$ begin lock table cms.tenants in access exclusive mode; perform pg_sleep(7); end $$;
     ```
  4. **c4** (Einar's terminal, started **within 4 seconds of c3**): the script below calls `api.worker_tenants_to_release()` (read only, no arguments, returns no secret) with the secret key. It waits on `cms.tenants` until c3 ends, then on `cms.publish_requests`, so the call as a whole passes 10 s while neither wait reaches 8 s. Einar copies it to `~/timeout-check.sh` and runs `EXPECT_REF='<project-ref>' bash ~/timeout-check.sh`. It reads `.env.staging.local` under section 7.4's rules (its `env_value` is the copy section 7.2's scripts shared until decision 72) and prints only the target, the HTTP code, the error code and the elapsed time.
     ```bash
     #!/usr/bin/env bash
     # G3.2c (decision 36.7): a secret-key REST call held on two locks. Run by Einar only. Never with
     # `bash -x` or `set -x`. Prints only the target host, the HTTP code, the error code and the time.
     set -eu
     ENV_FILE=~/litljomi-cms/.env.staging.local
     REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'

     # env_value NAME ERE: the rules of section 7.4 (reads ENV_FILE without executing it; never prints
     # a refused value).
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
         echo "FAILED: $1 must be on exactly one plain $1=value line in .env.staging.local (found $n); nothing was sent" >&2
         return 1
       fi
       if ! [[ $value =~ $allowed ]]; then
         echo "FAILED: $1 in .env.staging.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
       fi
       printf '%s' "$value"
     }

     REF="${EXPECT_REF:-}"
     if ! [[ $REF =~ $REF_RE ]]; then
       echo "FAILED: set EXPECT_REF to the staging project's reference (from your Supabase dashboard); nothing was sent" >&2
       exit 1
     fi
     URL="$(env_value NEXT_PUBLIC_SUPABASE_URL "$URL_RE")"
     SK="$(env_value SUPABASE_SECRET_KEY "$KEY_RE")"
     if [ "$URL" != "https://$REF.supabase.co" ]; then
       echo "FAILED: .env.staging.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent" >&2; exit 1
     fi
     printf 'target: %s\n' "${URL#https://}"
     # curl reads headers, URL and body as a config on stdin (--config -), so the key is on no command line.
     RESP="$(
       {
         printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$SK" "$SK"
         printf 'header = "Content-Type: application/json"\nheader = "Content-Profile: api"\n'
         printf 'request = "POST"\nurl = "%s/rest/v1/rpc/worker_tenants_to_release"\ndata = "{}"\n' "$URL"
         printf 'silent\nshow-error\nmax-time = 40\nwrite-out = "\\n%%{http_code} %%{time_total}"\n'
       } | curl -q --config -
     )" || { rc=$?; unset SK; echo "FAILED: curl error $rc"; exit 1; }
     unset SK
     META="${RESP##*$'\n'}"
     printf 'HTTP %s, seconds %s, code %s\n' "${META% *}" "${META#* }" \
       "$(printf '%s' "${RESP%$'\n'*}" | jq -r 'if type == "object" then (.code // "none") else "none" end' 2>/dev/null || echo unreadable)"
     ```
  Confirm at execution time that the SQL editor runs the two tabs at the same time and does not cancel a 30-second statement; if it cannot, stop and report (no other route is improvised).
- **Expected:** `HTTP 500` (or the status PostgREST gives a cancelled statement; confirm at execution time), code `57014`, about **10** seconds (between 9.5 and 12). Then:
  - code `57014` at about 8 s: the authenticator's timeout applied, not `service_role`'s: **stop and report**.
  - code `55P03` (lock timeout), or `HTTP 200`: the timing missed (c4 started too late or too early, or a lock was not held). Wait until c2 has ended, then repeat c2–c4 once; the same result again: **stop and report**.
  - anything else: stop and report. Einar decides in every stop case. Record the result (no secrets) in `docs/verification/m1-report.md`.

### G3.3 Data API: expose `api` only (decision 16)
- **Owner:** Executor (dashboard; checks with the public URL and publishable key from Einar).
- **Settings:** exposed schemas = `api` only, matching `[api] schemas = ["api"]` in `supabase/config.toml` (Data API settings page; confirm the menu path at execution time). Remove `public` and `graphql_public` if listed. **Never** run Supabase's custom-schema `GRANT ALL` recipe for any schema; grants come only from the migrations (§4.2, §4.5).
- **Verify:** in the same shell command as the URL check in section 6 (so a mismatch stops it), with the publishable key, `curl -s -o /dev/null -w '%{http_code}' "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H "Accept-Profile: <schema>"` returns `406` for `public`, `cms`, `private` and `graphql_public`; a call that Task 4's local verification makes against `api` succeeds the same way on staging (use Task 4's request; confirm at execution time).
- **`public` (decision 44.1).** `public` stays unexposed. If it ever must be exposed, turn off ‘Automatically expose new tables’ first. Task 29's A1 run confirms that `public` answers `406`.

### G3.4 Auth settings
- **Owner:** Executor (dashboard).
- **When:** right after G3.1, before G3.2. Sign-up is open on a new project until it is turned off, so nothing else happens on the project first.
- **Settings:** the section 6 rows whose Step is G3.4: self sign-up, email provider, password sign-in, other providers, confirm email, secure email change, minimum password length, password requirements, leaked password protection, secure password change, Email OTP Length, Email OTP Expiration, TOTP MFA and JWT expiry. (The four password rows and Email OTP Length came with decisions 72 and 72.3; at M1 they were not set. On staging they are applied by section 7.3.) The other rows belong to other steps: exposed schemas (G3.3) and the hook (G3.5) need the migrations of G3.2b first; custom SMTP and the email rate limit are G3.6; the Site URL, redirect URL and email templates are G3.7.
- **Verify:** as listed in section 6 for each of those rows.

### G3.5 Sign-in hook
- **History.** At M1 this step enabled the passwordless hook, and Einar ran section 7.2's scripts, which needed the secret key. Decision 72 replaced both: staging switches to the sign-in hook by section 7.3; the steps below are for a new hosted project.
- **Owner:** Executor (SQL editor and dashboard); Einar does section 7.2's sign-ins, mailbox checks and the test account's invitation and deletion. Einar is told the result before G3 continues.
- **Settings and verify:** Section 7.1 (check that no account exists, enable, revoke all sessions), then section 7.2's S1 and S2; the full section 7.2 after G3.6 and G3.7. Runs before any editor account exists on the project: `select count(*) from auth.users;` returns `0` (section 7.1 step 0).

### G3.6 Custom SMTP (SendGrid) and the email rate limit
- **Owner:** **Einar** enters the SMTP settings himself (section 8: host, port, user, the API key as password, sender); the executor sets the rate limit (dashboard).
- **Settings:** Section 8's SMTP fields; Auth **Rate Limits** page: emails sent per hour raised from **30** (imposed once custom SMTP is enabled) to **100**. Reason: M1 staging sends only invitations and magic links for one staging editor, and acceptance runs repeat sign-ins (since decision 72: invitations, reset emails and section 7.2's mails; a password sign-in sends no email); 30 per hour could block a test run, while 100 stays bounded. SendGrid's own plan limits still apply (Einar's existing plan; confirm at execution time). Einar may choose another value at G3; record the value used. This is the one statement of the value and its reason; sections 6 and 16 point here.
- **Verify:** the SMTP page shows custom SMTP enabled with the host, port, user, sender email and sender name of section 8 (password hidden; Einar reads them, or the executor in his signed-in session); the Rate Limits page shows 100 emails per hour; the end-to-end check is G4.3.

### G3.7 Site URL, redirect URL and email templates
- **Owner:** Executor (dashboard).
- **Settings:** Site URL `https://vefumsjon-staging.litljomi.is`; redirect URLs: exactly `https://vefumsjon-staging.litljomi.is/auth/confirm` (the reset form's `redirectTo`, the CMS's own origin plus `/auth/confirm`; at M1, the magic-link request's `emailRedirectTo`). No wildcard, no localhost (URL configuration page; confirm the menu path at execution time).
- **Email templates:** the **six** files in `supabase/templates/` are uploaded to the hosted project's Auth email templates page, each with its subject from the matching `[auth.email.template.*]` block of `supabase/config.toml`, the HTML pasted unchanged from the current file, never an earlier copy (confirm the menu path and the dashboard's template names at execution time). A hosted project does not read the local files, so without this step it sends Supabase's English defaults, whose links sign in on GET.

  | File | Template | Subject (`config.toml`) | What it carries |
  |---|---|---|---|
  | `magic_link.html` | Magic link (also sent for a sign-in code) | Innskráning í Litljómi vefumsjón | **No link, no token hash, no code**: only `{{ .SiteURL }}`, telling the editor to sign in with email and password there (decisions 72.1 and 72.2) |
  | `confirmation.html` | Confirm sign-up (Auth sends it to a pending invitee on request) | Innskráning í Litljómi vefumsjón | **No link, no token hash, no code**: the same text as `magic_link.html` (decision 72.3) |
  | `invite.html` | Invite | Þér er boðið í Litljómi vefumsjón | A link to `{{ .SiteURL }}/auth/confirm?token_hash=…&type=invite`; the editor then chooses a password (PW-03) |
  | `recovery.html` | Reset password | Nýtt lykilorð í Litljómi vefumsjón | A link to `{{ .SiteURL }}/auth/confirm?token_hash=…&type=recovery` (PW-03) |
  | `email_change.html` | Change email address | Staðfestu breytingu á netfangi | A link, to both addresses, to `{{ .SiteURL }}/auth/confirm?token_hash=…&type=email_change` (M5-03) |
  | `reauthentication.html` | Reauthentication | Staðfestingarkóði | The reauthentication code (`{{ .Token }}`), for a password change from a session over 24 hours old (section 6) |

  `{{ .SiteURL }}` is the Site URL above. The confirm page verifies nothing until the editor presses its "Halda áfram" button (a POST), so a link works in any browser and a mail scanner opening it does not use it up (decision 41.1); it accepts `invite`, `recovery` and `email_change` links and refuses `email` (a magic link, PW-03). **No hosted template may link to `{{ .ConfirmationURL }}`:** that link is used up on GET. The magic-link and confirmation templates are what stop magic-link and code sign-in (section 7): a copy that regains a link, a token hash or a code brings them back.
- **Verify:** the URL configuration page shows those two values only. The email templates page shows each of the six with the subject and body of its file (section 7.2, S3): the invite, reset and email-change links to `{{ .SiteURL }}/auth/confirm`, no template with `{{ .ConfirmationURL }}`, and `magic_link` and `confirmation` with no placeholder but `{{ .SiteURL }}`. The end-to-end checks are section 7.2 (S5, S7 and S8), G4.3 and A11. (At M1 this step uploaded four files, before `recovery.html` and `confirmation.html` existed, and section 7.2's part 1 script asserted the `generate_link` response's `redirect_to`; decision 72 replaced both.)

## 6. Supabase Auth configuration

Applied on the hosted project by hand, each row in the step its Step column names (G3.3–G3.7). Local equivalents are in `supabase/config.toml` and are regression-tested in `tools/checks/__tests__/supabase-config.test.ts`. Dashboard menu paths, other than the SMTP and Rate Limits pages, are confirmed at execution time.

`$NEXT_PUBLIC_SUPABASE_URL` and `$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` below (and in G3.3) are the two public values Einar gives the executor (section 1). `GET $NEXT_PUBLIC_SUPABASE_URL/auth/v1/settings -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"` returns public settings only.

**URL check.** Before any request in this section or in G3.3, the executor checks that `$NEXT_PUBLIC_SUPABASE_URL` is a hosted project URL and is the hosted project's, and prints the target host (a local-stack URL such as `http://127.0.0.1:54321` is refused; `<project-ref>` is the reference Einar reads from his Supabase dashboard or his own records; the value recorded at G3.1 in `docs/verification/m1-report.md` is for the record only, never the source of the check). It exits 1 on a mismatch, so it runs at the start of the same shell command as the requests it guards, and nothing after it runs:

```sh
if [ "$NEXT_PUBLIC_SUPABASE_URL" = 'https://<project-ref>.supabase.co' ] \
  && printf '%s\n' "$NEXT_PUBLIC_SUPABASE_URL" | grep -Eqx 'https://[a-z0-9]{20}\.supabase\.co'
then printf 'target: %s (ok)\n' "${NEXT_PUBLIC_SUPABASE_URL#https://}"
else echo 'NEXT_PUBLIC_SUPABASE_URL is not the hosted project: stop'; exit 1; fi
```

**Sign-up check, safely.** Owner: executor. In the same shell command as the URL check above, after it prints `(ok)`. It uses `<signup-test-address>`, a throwaway address Einar controls, never a real editor's, and a random password that is piped, never on a command line, and never used again:

```sh
openssl rand -hex 16 | jq -Rc '{email: "<signup-test-address>", password: .}' \
  | curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" \
      -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' --data @- \
  | jq -r '.error_code // "no error_code: sign-up may be on"'
```

Expected: `signup_disabled` (HTTP 422), and `select count(*) from auth.users where email = '<signup-test-address>';` returns `0`. If the call instead succeeds, sign-up is on: an account now exists and a confirmation email may have been sent. Stop, turn sign-up off, have Einar delete that account in the dashboard (Authentication, Users, as in section 7.2's S10, with its id from `select id from auth.users where email = '<signup-test-address>';`), record it, and tell Einar.

| Setting | Step | Hosted value | Local equivalent | Why | Verify |
|---|---|---|---|---|---|
| Self sign-up | G3.4 | **Off** ("allow new users to sign up" disabled) | `[auth] enable_signup = false` | §4.4: editors are invited by the CLI | `/auth/v1/settings` → `"disable_signup": true`; the sign-up check above → 422 `signup_disabled` and no account created |
| Email provider | G3.4 | **On**, for the invite, reset and email-change links and the reauthentication code, and for password sign-in; **not** for sign-in links: Auth still serves magic links and codes while the provider is on, so they are stopped by the templates (row "Email templates") and the code length (decisions 72 and 72.1) | `[auth.email] enable_signup = true` | Decision 17: turning the provider off disables email and password sign-in | `/auth/v1/settings` → `"external": {"email": true, …}` |
| Password sign-in | G3.4 | **The editors' sign-in** (decision 72): email and password, from the browser straight to Auth with the publishable key (decision 72.4). Part of the email provider, with no separate switch (confirm at execution time) | `[auth.email]`, as above | §4.4 | Section 7.2, S6 |
| Other providers | G3.4 | All off: phone, anonymous, OAuth, SAML, WebAuthn/passkeys | defaults in `config.toml` | Decisions 18 and 72: enabling any of them needs the hook's allowlist revisited | `/auth/v1/settings` → every other `external` entry `false`; section 7.2, S4 |
| Confirm email | G3.4 | **On** | `[auth.email] enable_confirmations = true` | Decision 19 | `/auth/v1/settings` → `"mailer_autoconfirm": false` |
| Secure email change (double confirmation) | G3.4 | **On** | `[auth.email] double_confirm_changes = true` | Decision 19: an email change needs both the old and the new address; with confirmations off it has no effect, so both stay on | The setting shows on; Task 29 item 11 checks the behaviour |
| Minimum password length | G3.4 (this project, then staging: section 7.3 step 2) | **6**, Auth's lowest setting (the email provider's or Auth's password settings; confirm the location at execution time) | `[auth] minimum_password_length = 6` | Decision 72: no password rules beyond Auth's minimum | The dashboard shows 6 |
| Password requirements | G3.4 (this project, then staging: section 7.3 step 2) | **None**: no required characters | `[auth] password_requirements = ""` | Decision 72 | The dashboard shows no requirement |
| Leaked password protection | G3.4 (this project, then staging: section 7.3 step 2) | **Off** (it may be offered only on paid plans; confirm at execution time and record what the dashboard shows) | No local setting: the local Auth leaves the check off (comment above `minimum_password_length` in `config.toml`) | Decision 72: the leaked-password check is off, accepted | The dashboard shows it off or not offered |
| Secure password change | G3.4 | **On**, set in the dashboard's Auth settings for the email provider ("Secure password change"; confirm the location at execution time). The dashboard is the executor's only route. If the dashboard does not offer the setting, stop and report: the other route, the Management API, needs a personal access token (a secret), so it is Einar's (below) | `[auth.email] secure_password_change = true` | Decision 21, kept by decision 72: changing a password needs a recent sign-in (§4.4); the verified 24-hour behaviour below is kept. The set-password page runs straight after an invite or reset link, so its session is new | The dashboard shows the setting on, or Einar's Management API check below prints `true` (behaviour below); record which route was used |
| Email OTP Length | G3.4 (this project, then staging: section 7.3 step 4) | **10** digits, the longest Auth allows (the email provider's settings; confirm the location at execution time) | `[auth.email] otp_length = 10` | Decision 72.3: Auth still makes a code for every magic-link or code request and accepts it, and every token-hash link is built from such a code; 10 digits can't be guessed within the hour, even across many addresses | Section 7.2, S3 |
| Email OTP Expiration | G3.4 | **3600** seconds (the email provider's settings; confirm the location at execution time) | `[auth.email] otp_expiry = 3600` | Decision 43 (for the magic-link mail's one hour), kept unchanged by decision 72.3: the invite, reset and email-change links last an hour | The dashboard shows 3600 (Einar reads it, or the executor in a browser session Einar signed in to himself); section 7.2, S3; recorded in `m1-report.md` |
| TOTP MFA | G3.4 | Enrolment and verification **on** | `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true` | §4.4: platform admins enrol TOTP; console needs `aal2` | The MFA settings show TOTP enabled |
| JWT expiry | G3.4 | **3600** seconds, recorded and kept | `[auth] jwt_expiry = 3600` | Decision 18: bounds how long a token issued before the hook, or before a revocation (section 7.1 step 4), stays valid | The setting shows 3600; value recorded in `m1-report.md` (at M1, section 7.2's magic-link response also showed `"expires_in": 3600`) |
| Exposed schemas | G3.3 | `api` only | `[api] schemas = ["api"]` | Decision 16, §4.2 | G3.3 |
| Custom Access Token hook | G3.5 (this project, then staging: section 7.3 step 1) | **Enabled**, Postgres function `private.sign_in_access_token` (at M1, `private.passwordless_access_token`, replaced by decision 72) | `[auth.hook.custom_access_token] enabled = true`, `uri = "pg-functions://postgres/private/sign_in_access_token"` | Decisions 18, 72 and 72.1 (section 7) | Section 7.2, S1 and S2 |
| Custom SMTP | G3.6 | SendGrid (section 8), entered by Einar | `[local_smtp]` (local mail catcher) | §4.4: the built-in sender delivers only to the team's addresses, about 2 an hour, not for production | G3.6, G4.3 |
| Email rate limit | G3.6 | The value G3.6 sets | `[auth.rate_limit] email_sent = 60` (decision 37.4) | Acceptance runs send invitations and resets, and the post-SMTP default could block one (G3.6) | G3.6 |
| Site URL, redirect URLs | G3.7 (since 2026-11-12, `vefstjorn.is`) | `https://vefstjorn.is`; `https://vefstjorn.is/auth/confirm` (at M1, `vefumsjon-staging.litljomi.is`) | `site_url`, `additional_redirect_urls` (`http://localhost:3100`, decisions 37.4 and 41.1) | Invite, reset and email-change links land on the CMS only | G3.7 |
| Email templates | G3.7 (this project, then staging: section 7.3 step 3) | The **six** files of `supabase/templates/` (`magic_link.html`, `confirmation.html`, `invite.html`, `recovery.html`, `email_change.html`, `reauthentication.html`), uploaded with their subjects from `config.toml` (G3.7's table). `magic_link.html` and `confirmation.html` carry **no link, no token hash and no code** (decisions 72.1 and 72.3); `{{ .SiteURL }}` is the CMS host, so invitations, resets and email changes go to `https://vefstjorn.is/auth/confirm` | `[auth.email.template.*]` (`magic_link`, `confirmation`, `invite`, `recovery`, `email_change`, `reauthentication`), files in `supabase/templates/` (Tasks 22 and 32, PW-01, PW-03); the `tools/checks` test allows no placeholder but `{{ .SiteURL }}` in the two link-free templates | §4.4; decision 41.1: a link works in any browser, and only the confirm page's button uses it; decisions 72.1 and 72.3: the two link-free templates are what stop magic-link and code sign-in | G3.7; section 7.2, S3, S5, S7 and S8; G4.3 and A11 |

**Secure password change through the Management API (Einar only).** Used only if the dashboard does not offer the setting (the row above). The Management API (`PATCH /v1/projects/<project-ref>/config/auth`) needs a Supabase personal access token, a secret, so Einar runs it in his own terminal, never an agent. He creates a token for this step (Supabase account settings, Access Tokens; confirm at execution time) with the shortest expiry or the narrowest scope Supabase offers (a personal access token is probably account-wide, so a wrong project reference would change another project; confirm the options at execution time), and **revokes it whatever the outcome**, success or failure. `<field-name>` is the Management API's name for the setting, taken from Supabase's current Management API reference at execution time, never guessed. The token is typed or pasted at a hidden prompt (`read -rs`, no echo, nothing in shell history), lives in a variable of a subshell only, is never exported and never on a command line (curl reads its headers from a configuration on standard input, written by the builtin `printf`, as in section 7.4), and is unset at the end; if he pasted it, he clears the clipboard afterwards. `REF` is the hosted project's reference, the same dashboard value Einar passes as `EXPECT_REF` to the G3.2c script and `tools/cli`; it is typed once, checked against `^[a-z0-9]{20}$`, used in both URLs and printed before anything is sent. The commands print only the target, an HTTP code and whether the setting is `true`:

```sh
(
  REF='<project-ref>'
  printf '%s\n' "$REF" | grep -Eqx '[a-z0-9]{20}' \
    || { echo 'REF is not a 20-character project reference: stop' >&2; exit 1; }
  printf 'target project: %s\n' "$REF"
  printf 'Supabase personal access token: '; read -rs SUPABASE_PAT; echo
  {
    printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "$SUPABASE_PAT"
    printf 'request = "PATCH"\nurl = "https://api.supabase.com/v1/projects/%s/config/auth"\n' "$REF"
    printf 'silent\nshow-error\noutput = "/dev/null"\nwrite-out = "PATCH: %%{http_code}\\n"\n'
    jq -nr '{"<field-name>": true} | tojson | "data = \(tojson)"'
  } | curl -q --config -
  {
    printf 'header = "Authorization: Bearer %s"\n' "$SUPABASE_PAT"
    printf 'url = "https://api.supabase.com/v1/projects/%s/config/auth"\nsilent\nshow-error\n' "$REF"
  } | curl -q --config - | jq '.["<field-name>"] == true' 2>/dev/null
  unset SUPABASE_PAT
)
```
  `REF`: the dashboard value used for EXPECT_REF.

Expected: the target line, `PATCH: 200`, then `true`. Anything else: stop and report, and **revoke the token anyway** (the response body is never printed, since the Auth configuration can hold secret settings). The check prints the comparison `== true`, never the field's raw value, on purpose: a wrong field name could otherwise print a secret setting, and the PATCH would have overwritten it with `true`; do not paste the output into chat. Einar revokes the token whatever the outcome and confirms it is gone from the Access Tokens list. It is an Auth configuration change: if it is made after section 7.1, section 7.2 is run again (section 7.2, "When to run it").

**Secure password change: verified behaviour** (Supabase Auth v2.197.0, `internal/api/user.go`, verified locally on 2026-11-02 in `docs/verification/decision-21-secure-password-change.md`):
- A session **less than 24 hours old** changes the password with no reauthentication (200).
- A session **missing or more than 24 hours old** is refused without a nonce: HTTP 400 `reauthentication_needed` ("Password update requires reauthentication"). `GET /auth/v1/reauthenticate` emails a code (`reauthentication.html`; 6 digits when this was verified, and `otp_length` digits, so 10 since decision 72.3: confirm at execution time); the update carrying it as `nonce` succeeds; a wrong nonce gets 422.
- A user with MFA enrolled needs an `aal2` session (HTTP 401 `insufficient_aal` on `aal1`).
- Every password change revokes the user's other sessions; the session that made the change stays valid.
- It is **additional protection only**: it does not stop a recent session from setting a password, and it is not fresh email verification for every change. Until decision 72 the passwordless hook (section 7) kept passwords from signing in; since then a password is the editors' sign-in, and the set-password page after an invite or reset link uses a session minutes old, so it needs no nonce. The Supabase CLI reference describes the setting as requiring "the user's current password"; that is not what the verified version does.
- Whether the hosted project runs the same Auth version: confirm at execution time (the version is shown in the project's settings or Auth logs); if it differs, record it and re-check the behaviour before relying on this description.

## 7. Sign-in hook (decisions 18, 20, 72 and 72.1)

The hook `private.sign_in_access_token(event jsonb) returns jsonb` (migration `20261112100000_sign_in_auth_hook.sql`, PW-01) issues a token only for these sign-in methods (`authentication_method`):

| Method | What it is | Allowed |
|---|---|---|
| `password` | Password sign-in, the editors' sign-in (decision 72) | Always |
| `otp` | Every link verified by token hash: the invite, password-reset and email-change links, verified by the confirm page's POST | Always |
| `totp` | A platform admin's TOTP step-up to `aal2` | Only if every method in the session's `amr` is `password`, `otp` or `totp` |
| `token_refresh` | A refresh of an existing session | Only if every method in the session's `amr` is `password`, `otp` or `totp` |

Anything else gets `{"error": {"http_code": 403, "message": "Sign-in not allowed"}}`, a message that names no method: sign-up, anonymous, phone, OAuth, SSO, web3, a PKCE exchange (`magiclink`, `recovery`, `invite`, which the CMS doesn't use) and a missing or malformed method or `amr` (fail closed). It reads no tables. It replaces decision 18's `private.passwordless_access_token`, which refused `password`; the same migration drops the old function.

**Why `otp` must be allowed (decision 72.1).** Supabase Auth reports every link verified by token hash as `otp`, whatever its type: invite, recovery, email change and magic link alike (observed on GoTrue v2.197.0; only a PKCE exchange reports `recovery` or `magiclink`). The hook therefore can't tell a magic link from an invitation, and refusing `otp` would break invites, resets and email changes. Magic-link and code sign-in are stopped in the email instead: `magic_link.html`, which Auth also sends for a sign-in code, and `confirmation.html` carry no link, no token hash and no code, and every code Auth still makes is 10 digits (decision 72.3), so it can't be guessed within its hour. On a hosted project the control is therefore three things together: the hook, the six email templates and the code length (section 6). All three live in the Auth configuration, not in a migration, so each is set and verified on every hosted project (spec §11.2).

### 7.1 Enabling it on a new hosted project

**History.** At M1 (G3.5, 2026-11-03) these steps enabled `private.passwordless_access_token` on this project, then called staging; decision 72 replaced that hook, and section 7.3 moved the project to the sign-in hook on 2026-11-12. On a new hosted project the steps below apply as written.

0. **No account exists yet.** Owner: executor. Verify in the SQL editor: `select count(*) from auth.users;` returns `0`. If not, stop and report: an account was created before the hook (for example while sign-up was open), and Einar decides what happens to it before anything continues.
1. **Function present.** Owner: executor. Applied by G3.2b (`supabase db push`). Verify: G3.2b's `to_regprocedure` check returns `true`.
2. **Function and grants (§4.5, "Auth hook grant").** Owner: executor. Verify in the SQL editor with the six statements below, each run on its own with its result recorded (section 1, "SQL blocks"). Any result other than the expected one: stop and report; do not change grants on the hosted project by hand.
   - **2a.** The function: owner, ACL, not `SECURITY DEFINER`, `search_path` pinned to `''`.
     ```sql
     select p.proowner::regrole as owner, p.proacl, p.prosecdef,
            'search_path=""' = any(p.proconfig) as search_path_empty
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'private' and p.proname = 'sign_in_access_token';
     ```
     Expected: `proacl` grants `EXECUTE` only to the owner and `supabase_auth_admin`; `prosecdef` is `false`; `search_path_empty` is `true`.
   - **2b.** Who may execute it.
     ```sql
     select r as role, has_function_privilege(r, 'private.sign_in_access_token(jsonb)', 'execute') as can_execute
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
     Expected: exactly one row, `private.sign_in_access_token(jsonb)`.
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
   - **2f.** The hook it replaces is gone.
     ```sql
     select to_regprocedure('private.passwordless_access_token(jsonb)') is null as old_hook_gone;
     ```
     Expected: `true`.
3. **Enable the hook.** Owner: executor. Settings: Authentication hooks page (confirm the menu path at execution time): Custom Access Token hook → enabled, type Postgres, schema `private`, function `sign_in_access_token`. If the page cannot select a function in `private`, **stop and report**; do not move the function or change its grants. Verify: the page shows the hook enabled with that schema and function.
4. **Revoke all sessions** (immediately after step 3, still before any editor exists; at the switch, section 7.3 step 5; and in step 3 of section 7.2's failure handling). Owner: executor, in the SQL editor, the statements below in order, each run on its own with its result recorded (section 1, "SQL blocks"):
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

   Success: 4a is `true` and 4c, 4d and 4e are each `0`. If 4a is `false` or a count is not `0`, stop and report. Every session is gone, so nothing issued before the revocation can be refreshed. Access tokens already issued stay valid until they expire, at most `jwt_expiry` (3600 seconds, section 6). Record the time of the revocation; nothing issued before it is relied on for one hour.
5. **Verify** with section 7.2: S1 and S2 straight away, and the whole procedure once custom SMTP (G3.6) and the templates (G3.7) are in place, since S3 and S5 to S8 need them.

### 7.2 Verification procedure (decision 20, inverted by decision 72)

Since decision 72 this procedure proves the opposite of M1's: a password signs in, invite and reset links sign in through the confirm page's POST, and a magic-link or code request sends a mail that can't sign anyone in. **Until decision 72 it held two scripts (parts 1 and 2, checks H1 to H6)** that proved a password was refused with 403 and a magic link signed in. They test the replaced hook and were removed; never run a copy of them. The last version is in git history (`git show 6e5f0d2:docs/runbooks/staging.md`, the file's name then).

**When to run it:** after the switch to passwords (section 7.3) and after enabling the hook on a new project (section 7.1); after any change to hosted Auth settings, templates or hooks (dashboard or Management API) or any configuration push; and before each acceptance run.

**Owners:** the executor runs the dashboard and SQL editor checks (in a browser session Einar signed in to himself, section 1) and the public `curl` requests; **Einar** invites and deletes the test account, reads its mailbox, does every sign-in and types every password. No password goes into chat. Einar is told the result. **Record** each run (date, who, trigger, each check's result, the test account's id; no secrets) in the record the controller names (`docs/verification/m1-report.md` during M1).

**The test account** is `<hook-test-address>`, a throwaway address Einar controls (section 1, "Names"). It is invited fresh in each run (S5) and deleted at the end (S10). Its password is a throwaway Einar keeps in his password manager until S10. It has no membership, so once signed in the CMS shows its page for an account with no site (confirm the page at execution time).

**What a script could do later (decision 73, suggestion 12).** Scripting the hosted checks is a task for the hosted rollout, not decided here, and no such script exists. The last column of the table says which checks a script could take over and what it would need. Until a script is written, reviewed and approved, every check is run by hand as written.

**Checks, in this order, and expected results:**

| # | Check | Owner | Expected | A script could do it? |
|---|---|---|---|---|
| S1 | Authentication hooks page | Executor | Custom Access Token hook **enabled**, Postgres, `private.sign_in_access_token` | Yes, from the Management API's Auth configuration (needs a personal access token: Einar's, as in section 6) |
| S2 | Function and grants: section 7.1 step 2, statements 2a–2f, each on its own | Executor | As in section 7.1 step 2: execute only for the owner and `supabase_auth_admin`, which has nothing else in `api`, `cms` or `private`; not `SECURITY DEFINER`; `search_path` empty; the old `private.passwordless_access_token` gone | Yes, over a database connection (needs the database password: Einar's) |
| S3 | Hosted templates and code length: the Auth email templates page and the email provider's settings | Executor | Each of the six hosted templates has the subject and the body of its repository file (G3.7's table), so `magic_link` and `confirmation` hold no `{{ .ConfirmationURL }}`, `{{ .TokenHash }}` or `{{ .Token }}` and no placeholder but `{{ .SiteURL }}`; Email OTP Length **10**; Email OTP Expiration **3600** | Yes: the Management API returns the templates, subjects and code length (personal access token), to compare with the files under the same rule as the `tools/checks` template test |
| S4 | Sign-up and anonymous sign-in, with the publishable key (commands below), then S4c in the SQL editor | Executor | Both refused with HTTP **422**, no token: sign-up `signup_disabled`; anonymous `signup_disabled` or `anonymous_provider_disabled` (record which); S4c `0` | Yes (public values only) |
| S5 | Invite: Einar invites the test account from the dashboard (Authentication, Users, "Invite user"; confirm the path at execution time), opens the mail in a private browser window and presses "Halda áfram" | Einar | The mail ("Þér er boðið í Litljómi vefumsjón") links to `https://vefstjorn.is/auth/confirm?token_hash=…&type=invite`; opening it shows only the confirm page and its button; the button's POST signs in and opens the set-password page; Einar sets a throwaway password and reaches the CMS | Partly: a browser test against the hosted project could, given a way to read the test mailbox |
| S6 | Password sign-in: Einar signs out, then signs in at `/login` with a wrong password, then with the right one | Einar | Wrong password: "Innskráning tókst ekki. Athugaðu netfang og lykilorð og reyndu aftur." (decision 72.5); right password: signed in | Yes, against the password endpoint with the publishable key, for a test account the script creates (needs the secret key: Einar's) |
| S7 | Reset: Einar signs out, uses "Gleymt lykilorð?" for the test account, opens the mail and presses "Halda áfram", sets a new password; signs out; signs in with the old password, then with the new one, and stays signed in | Einar | The mail ("Nýtt lykilorð í Litljómi vefumsjón") links to the confirm page with `type=recovery`; the button's POST opens the set-password page; the old password gets S6's message; the new one signs in | Partly, as S5 |
| S8 | Magic-link and code request, with the publishable key (command below), for the test account; Einar reads the mail that arrives | Executor (request), Einar (mailbox) | HTTP **200**; the mail ("Innskráning í Litljómi vefumsjón") says that sign-in is with email and password at `https://vefstjorn.is`, and holds **no link to `/auth/confirm`, no token hash and no code**: no run of digits, and no `token_hash` anywhere in the message source ("show original" or equivalent) | Partly: the request, yes; the mail, only with a way to read the test mailbox |
| S9 | SQL editor (S9a–S9c), while the test account still exists and Einar is still signed in from S7 | Executor | S9a: one id (`<test-account-id>`); S9b: every method on the project is `password`, `otp` or `totp`; S9c: `password_rows` at least `1` | Yes, over a database connection |
| S10 | Einar deletes the test account in the dashboard (Authentication, Users; confirm at execution time); then S10a and S10b | Einar (deletion), executor (SQL) | The account is gone: S10a and S10b each **0** | Yes (the secret key or a database connection: Einar's) |

**S4 and S8 requests (executor).** Each in one shell command that starts with section 6's URL check, so a wrong URL stops it before anything is sent. They print only error codes and HTTP codes.

- **S4a, sign-up:** section 6's "Sign-up check, safely", as written. Expected `signup_disabled`.
- **S4b, anonymous sign-in** (a sign-up with no address and no password):
  ```sh
  printf '{}' | curl -s -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/signup" \
      -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' --data @- \
    | jq -r '.error_code // "no error_code: anonymous sign-in may be on"'
  ```
  Expected `signup_disabled` or `anonymous_provider_disabled`.
- **S4c** (SQL editor). Expected `0` (confirm at execution time that the hosted Auth version has the column):
  ```sql
  select count(*) from auth.users where is_anonymous;
  ```
- **S8, magic-link and code request,** for the test account only (`create_user: false`, so no account is made):
  ```sh
  jq -nc '{email: "<hook-test-address>", create_user: false}' \
    | curl -s -o /dev/null -w 'otp request: HTTP %{http_code}\n' -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/otp" \
        -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' --data @-
  ```
  Auth spaces the emails it sends to one address (confirm the interval at execution time), so S8 runs at least a minute after S7's reset mail. A `429` there means: wait a minute and repeat once.

**S9 (executor, SQL editor).** Three statements, each run on its own with its result recorded (section 1, "SQL blocks").

- **S9a.** The test account's id. Expected one row; record it as `<test-account-id>` (not secret).
  ```sql
  select id from auth.users where email = '<hook-test-address>';
  ```
- **S9b.** Every sign-in method on the project. Expected only `password`, `otp` and `totp` rows; any other method is a token the hook should have refused.
  ```sql
  select authentication_method, count(*) from auth.mfa_amr_claims group by authentication_method order by authentication_method;
  ```
- **S9c.** The test account's password sign-in from S7. Expected `password_rows` at least `1`.
  ```sql
  select count(*) filter (where c.authentication_method = 'password') as password_rows,
         count(*) as all_rows
  from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id
  where s.user_id = '<test-account-id>';
  ```

**S10 (executor, SQL editor), after Einar's deletion.** Two statements, each run on its own.

- **S10a.** Expected `0`.
  ```sql
  select count(*) from auth.users where id = '<test-account-id>';
  ```
- **S10b.** Expected `0`.
  ```sql
  select count(*) from auth.users where email = '<hook-test-address>';
  ```

**Success:** S1 to S10 each as expected. The S6 and S7 messages are the CMS's own; a sign-in that fails with "Of margar tilraunir í bili." is the rate limit (section 7.3 step 9), not a pass or a fail: wait five minutes and repeat the step.

**If any check fails:** stop; do not provision or invite anyone and do not continue the gate or the acceptance. **Keep the test account**: it is evidence until step 4 below.
1. **Record the evidence** (executor, no secrets): which checks failed and what was seen, the time, the test account's id, and S9's results. If the run stopped before S9, run S9 now.
2. **Assess the window** in which the configuration may have been wrong: from the last passing run of this procedure (or the last recorded Auth configuration change, whichever is earlier) until now. Owner: executor, with Einar for the dashboard's Auth logs (confirm the path at execution time). Each query is run on its own; `<window-start>` is the start of the window.
   - **S1 or S2 failed** (the hook off or wrong): tokens may have been issued for any method. The sessions started in the window, by method:
     ```sql
     select c.authentication_method, count(*) from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.created_at >= '<window-start>' group by c.authentication_method;
     ```
   - **S3 or S8 failed** (a template with a link or code, or a shorter code): a magic-link or code sign-in looks like an `otp` session. The `otp` sessions started in the window, with their accounts, are compared with the invites, resets and email changes the Auth logs show as sent; any other is listed for Einar:
     ```sql
     select s.user_id, s.created_at from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where c.authentication_method = 'otp' and s.created_at >= '<window-start>' order by s.created_at;
     ```
   - **S4 failed** (sign-up or anonymous sign-in on): the accounts created in the window:
     ```sql
     select id, email, created_at from auth.users where created_at >= '<window-start>' order by created_at;
     ```
   - **S5, S6 or S7 failed** (a link or a password doesn't sign in): editors can't sign in, but nothing was let in. There is no window to assess; go to step 3.
   - Every access token issued in the window is distrusted until `jwt_expiry` (3600 seconds) has passed after the revocation in step 3, and the actions of any account found above are listed for Einar to review.
3. **Fix** (executor): restore what failed from section 6 (the hook: section 7.1 step 3; the templates: G3.7; the code length and the other settings: their section 6 rows), and re-run S1 to S3. After a failed S1, S2, S3, S4 or S8, revoke all sessions (section 7.1 step 4: 4a `true` before 4b runs, then 4c–4e each `0`) and record the time.
4. **Delete the test account** only now (S10).
5. **Re-run section 7.2 from S1** with a fresh invite; record the failure, the window assessment and the fix; tell Einar through the controller. Accounts found in step 2 are reported to Einar, who decides what happens to them.

### 7.3 Switching staging to password sign-in (decisions 72 and 72.4)

**History (2026-11-12).** Run once on this project, then called staging, with the names of the time (the `staging` branch, `vefumsjon-staging.litljomi.is`); the record is `docs/verification/pw-production.md`. Today's names are in section 1.

Run once, to move the staging project from M1's passwordless hook to password sign-in (`docs/plans/passwords.md`, "Hosted"). **Approval:** under decision 73 rule 2, these staging steps are pre-approved within the approved plan (decision 72), so no new approval is asked for; the controller records each one in `docs/execution/gates.json` when it is done (G3 for the Supabase steps, G6 for advancing `staging`). **Production is not covered:** it waits for its own decision. A change to `.claude/**` (the network diff of section 1) still needs Einar's approval of the exact diff.

**Before you start:**
- PW-01 to PW-03 are merged to `main`, and the local acceptance of `docs/plans/passwords.md` has passed. PW-03 must land before any hosted rollout (decision 72.3: Auth's default reset email would hand over a session on GET).
- Read what's going out, with the commands of [`operations.md`](operations.md), section 8 ("Before you start, read what's going out"). Expected among the migrations: `20261112100000_sign_in_auth_hook.sql`, whose one drop, `private.passwordless_access_token`, only Auth calls (step 1). If another migration drops something the deployed CMS calls, stop and report before step 1: steps 2 to 5 run between `db push` and the new deployment (step 6).
- Staging has no editors who need to sign in during the switch: sign-ins fail between steps 1a and 1b, and after step 5 everyone signs in again (step 7). Einar is told when the switch starts.
- The Auth hooks page is open in Einar's browser session before step 1, so step 1b takes seconds.
- The executor's public checks need `<project-ref>.supabase.co` (section 1, "Network").

**Steps, in this order:**
1. **The migration and the hook, in the same minute.**
   - **1a.** Owner: Einar, in his own terminal. Confirm the link and push the migrations, as in [`operations.md`](operations.md), section 8 ("Confirm the link", then `supabase db push` and `supabase migration list`; not yet the push to `staging`). Never `supabase config push` (G3.2b).
   - **1b.** Owner: executor (Einar's session) or Einar, straight after 1a's `db push` ends. Authentication hooks page: Custom Access Token hook, Postgres, schema `private`, function **`sign_in_access_token`**, saved (as section 7.1 step 3). **Seen on 2026-11-12:** the dashboard's "Update hook" shows and runs its own grant statements, including a revoke and a grant on the old function, which the migration has already dropped; it saved anyway. Always confirm the end state with section 7.1 step 2 (2a–2f), not the dashboard's list.
   - Between 1a and 1b, Auth calls a function that no longer exists, so every sign-in and refresh fails (fail closed). If 1b can't select the new function, stop and report: sign-ins keep failing until it is fixed, which on staging locks out no editor.
   - **Verify:** `supabase migration list` shows no local version with an empty remote column; the hooks page shows `private.sign_in_access_token`; G3.2b's `to_regprocedure` check returns `true`; section 7.1 step 2 (2a–2f) as expected.
2. **Password settings.** Owner: executor (Einar's session). The section 6 rows "Minimum password length" (6), "Password requirements" (none), "Leaked password protection" (off) and "Secure password change" (on, unchanged). Verify: as in section 6.
3. **The six templates and their subjects.** Owner: executor (Einar's session). G3.7's "Email templates", from the files on `main` as merged, pasted unchanged. Verify: S3's template part.
4. **The code length.** Owner: executor (Einar's session). Email OTP Length **10**; Email OTP Expiration stays **3600** (section 6). If the dashboard won't accept 10, stop and report: decision 72.3 rests on it. Verify: S3's code part. **Seen on 2026-11-12:** the hosted value was 8, not the local default.
5. **Sign out every hosted session.** Owner: executor. Section 7.1 step 4 (4a–4e), as written. Sessions started by M1's magic links have `amr` `[otp]`, which the new hook would go on refreshing, so they must end here. This signs out Einar and the platform admins too; they sign in again in step 7. Record the time.
6. **Advance `staging`.** Owner: Einar. [`operations.md`](operations.md), section 8: `supabase migration list` again (nothing new since step 1a), then `git push origin origin/main:refs/heads/staging`, and that section's **Verify**. Nothing else is redeployed or restarted; `labak-hub` stays at its commit. Steps 2 to 5 come between `db push` and this push, unlike that section's usual rule, because the deployed CMS's magic-link page can't sign anyone in once step 3 is done and staging has no editors: keep them to minutes.
7. **Reset the passwords of the test and admin accounts.** Owner: Einar, for the staging editor `einsi@litljomi.is` and each platform admin account ([`operations.md`](operations.md), section 6): at `https://vefumsjon-staging.litljomi.is/login`, "Gleymt lykilorð?", the reset mail, "Halda áfram", a new password from his password manager, then on to the CMS. A platform admin then opens `/console`, which asks for the TOTP code (`aal2`). The `boundary-check` test editors (`einsi+a-labak@litljomi.is`, `einsi+a-demo@litljomi.is`) have no password and need none (section 14). **Confirm at execution time** that the set-password page completes for an account with TOTP enrolled: Auth asks such an account for an `aal2` session before it changes a password (section 6, "verified behaviour"), and the reset link's session is `aal1`. If the page refuses, stop and report; don't work around it. Verify: each account signs in with its new password.
8. **Run section 7.2** in full. A failed check follows its failure handling.
9. **The limit counts the editor's own address (decision 72.4).** Auth limits password attempts per IP address, about 150 per 5 minutes, shared with session refresh (`token_refresh`); local Auth limits nothing, so this is proved here only.
   - **9a.** Owner: executor, on Einar's Mac (one address). In one shell command that starts with section 6's URL check: wrong-password attempts for `<hook-test-address>`, which has no account after S10, until Auth answers `429`. The password is a fixed wrong value, not a secret.
     ```sh
     n=0; code=''
     while [ "$n" -lt 200 ] && [ "$code" != 429 ]; do
       n=$((n + 1))
       code="$(jq -nc '{email: "<hook-test-address>", password: "not-the-password"}' \
         | curl -s -o /dev/null -w '%{http_code}' -X POST "$NEXT_PUBLIC_SUPABASE_URL/auth/v1/token?grant_type=password" \
             -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" -H 'Content-Type: application/json' --data @-)"
     done
     printf 'attempts: %s, last HTTP %s\n' "$n" "$code"
     ```
     Expected: last HTTP `429` after about 150 attempts (record the count).
   - **9b.** Owner: Einar, at once, in a browser on the same Mac and network (no VPN; confirm that both leave from the same public address): a sign-in at `/login` with his real password shows "Of margar tilraunir í bili. Reyndu aftur eftir nokkrar mínútur." (decision 72.5). The browser signs in straight to Auth, so this is the Mac's address being counted. **Seen on 2026-11-12:** the limit refills continuously (about one attempt every 2 seconds after a burst of about 30), so one sign-in a few seconds after 9a can succeed. Keep the allowance empty while 9b and 9c run: repeat 9a's request in a loop for 90 seconds (in the background) and make both sign-ins during it.
   - **9c.** Owner: Einar, within the same 5 minutes, from another address (his phone on mobile data, Wi-Fi off): a sign-in at `https://vefumsjon-staging.litljomi.is/login` with his password succeeds.
   - **Verify:** 9a `429`, 9b the rate-limit message, 9c signed in. If 9c gets the rate-limit message, the limit isn't keyed on the editor's address: stop and report (M5 finding 7). For up to 5 minutes the Mac's sessions can't refresh either, since the limit is shared: wait 5 minutes before step 10.
10. **The staging browser suite.** Owner: Einar runs it in his own terminal, from the one exact command the controller gives him, and pastes the output back (section 14, "Who runs what"). **As of 2026-11-12 the repository has no staging browser suite** (`apps/cms/e2e-staging` no longer exists), so this step is recorded as not run until one is added.
11. **Record.** The controller records each step in `gates.json` (decision 73 rule 2) and the results, without secrets, in the verification record it names; each hosted change goes in the undo table (section 1, "Undo records"). There is no undo back to magic-link sign-in: the migration dropped the old hook, so going back would need a new decision and a new migration.

### 7.4 Scripts that read the production env file

The G3.2c script and `tools/cli` (`provision`, `boundary-check`, `migrate-drafts`, section 11) need the hosted project's secret key, so they are Einar's to run, and they follow these rules. (Until decision 72, section 7.2's two scripts did too.)

**Keeping secrets off command lines.** A command line is visible to every user of the machine (`ps`) and to process auditing; a pipe is not. So in a script curl reads its headers, URL and body as a configuration on standard input (`curl -q --config -`; `-q` first, so `~/.curlrc` is not read), written by `printf`, a shell builtin, so its arguments never become a program's command line; request bodies are built by `jq` from values it reads on standard input; responses stay in shell variables. The values read from `.env.production.local` stay in the script's own shell variables and are never exported, so no process's environment holds them either. The secret key therefore never appears on any command line, and nothing is written to a file (pipes only: no temporary files and no here-documents). Never run a script with `bash -x` or `set -x`. It prints only the target host, HTTP codes (or a curl error number), error codes and results that hold no secret.

**Reading `.env.production.local` without executing it.** A script never sources `.env.production.local` (`. ./.env.production.local` runs every line as shell code in a shell that holds the secret key, and a later duplicate line silently wins, which could send the key to another host). It reads only the names it needs, line by line (G3.2c's `env_value`), and refuses to send anything when:
- a name is assigned zero times or more than once, or not on a plain `NAME=value` line (an `export NAME=…` line or spaces around `=` count as assignments and are refused; comment lines are ignored);
- a value contains characters that cannot occur in it: `NEXT_PUBLIC_SUPABASE_URL` must be exactly `https://`, 20 lowercase letters or digits (the project reference) and `.supabase.co`, with nothing before or after; the keys may contain only letters, digits, `.`, `_` and `-` (this also keeps quotes, spaces, `$`, `%`, `\` and a stray carriage return out of the curl configuration);
- the URL is not the hosted project's: Einar passes the project reference as `EXPECT_REF`, taken from his Supabase dashboard (or his own records), never from a repository file (the value recorded at G3.1 in `docs/verification/m1-report.md` is for the record only), and the URL must be `https://$EXPECT_REF.supabase.co`.

A refusal prints a `FAILED:` line naming the variable, never its value. Before its first request, a script prints the target host (`target: <project-ref>.supabase.co`). A local-stack URL (for example `http://127.0.0.1:54321`, as `.env.local` holds for local work) is refused, so a script can never run against the local stack by mistake; the scripts read the separate file `.env.production.local`, which holds the hosted project's values, and `.env.local` is not swapped (Einar's ruling, section 1). **Confirm at execution time** that the hosted project's reference has 20 characters and that the publishable and secret keys contain only the characters above. If the hosted URL or a key has another shape, stop and report; do not loosen the check.

## 8. Email delivery through SendGrid (G4)

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

DECISION-SMTP is settled (decision 43.5): Einar's existing paid SendGrid account, in which litljomi.is is already authenticated, so G5 adds no email records. (Resend was the earlier plan, decision 42.4; decision 43 replaced it.) Supabase needs SPF, DKIM and DMARC on the sending domain and a dedicated From address.

### G4.1 Restricted API key, Mail Send only
- **Owner:** Einar, in his SendGrid account; the key is never pasted into chat, a file or a command line.
- **Settings:** a new **restricted** API key (Settings → API Keys → Create API Key → Restricted Access; confirm the menu path at execution time) with **Mail Send** access only and every other permission at No Access, named for this use (for example `supabase-staging-smtp`). SendGrid shows the key once: Einar enters it straight into Supabase in G4.2 and keeps it nowhere else (or only in his password manager).
- **Verify:** SendGrid's API Keys list shows the key's name with restricted access (Einar reads it; names only, never the key); the key is recorded in the undo table (section 1) as "SendGrid API key `<name>`; undo: delete it in SendGrid".

### G4.2 SMTP settings in Supabase Auth (applied in G3.6)
- **Owner:** Einar enters every field himself in the Supabase dashboard (Authentication → SMTP Settings; confirm the menu path at execution time).
- **Settings:**

  | Field | Value |
  |---|---|
  | Host | `smtp.sendgrid.net` |
  | Port | `587` |
  | Username | `apikey` (the literal string) |
  | Password | the G4.1 API key (Einar enters it) |
  | Sender email | `innskraning@litljomi.is` |
  | Sender name | `Litljómi vefumsjón` |

  The sender address must be on SendGrid's authenticated domain litljomi.is (G5.1); whether SendGrid also needs it as a verified sender: confirm at execution time. SendGrid's current Supabase instructions are confirmed at execution time.
- **Verify:** as G3.6.

### G4.3 A test invitation arrives
- **Owner:** Einar runs the P-3 command (`provision editor --email einsi@litljomi.is …`, section 11; the CLI needs the secret key) and checks his mailbox.
- **Verify:** the invitation arrives within a few minutes, from `Litljómi vefumsjón <innskraning@litljomi.is>`, with the link pointing to `https://vefumsjon-staging.litljomi.is/auth/confirm`; the message headers ("show original" or equivalent) report `spf=pass`, `dkim=pass` and `dmarc=pass`. Nobody else is invited in M1 (decision 43.9).

## 9. DNS in the litljomi.is zone (G5)

**History (M1).** This section records what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1. A command for today uses the current names.

G5 is **three CNAME records** in the **litljomi.is** zone, added by Einar, and nothing else (decision 43.6). **No email records** are added or changed. **`labak.is` and its DNS are untouched**, and no record is created or changed for `labak.litljomi.is`. Before adding anything, Einar lists the zone's existing records so nothing in use (the litljomi.is website, existing mail, SendGrid's authentication) is changed.

### G5.1 SendGrid's domain authentication and DMARC: a read-only check
- **Owner:** Einar (he runs `dig`, or reads SendGrid's domain page); nothing is added or changed.
- **Settings:** none.
- **Verify:** SendGrid's Sender Authentication page shows litljomi.is **verified** (the records it lists, typically CNAMEs for the return path and for DKIM at `s1._domainkey.litljomi.is` and `s2._domainkey.litljomi.is`; confirm at execution time), and `dig +short CNAME <each record SendGrid lists>` returns the value SendGrid shows; `dig +short TXT _dmarc.litljomi.is` shows exactly one `v=DMARC1` record. If any of this is missing, **stop and report**: adding or changing an email record is not part of G5, and Einar decides.

### G5.2 The three staging hostnames
- **Owner:** Einar creates the records; the executor adds the domains to the Vercel projects (G6.1) and reads the targets Vercel shows.
- **Settings:** three CNAMEs, each with the target Vercel's Domains screen shows for that project (confirm at execution time; never guessed):

  | Name in litljomi.is | Vercel project |
  |---|---|
  | `vefumsjon-staging` | `vefumsjon-staging` |
  | `demo-staging` | `demo-staging` |
  | `labak-hub` | `labak-hub` |
- **Verify:** `dig +short CNAME <name>.litljomi.is` returns the target Vercel showed; each project's Domains page shows its domain valid with a certificate issued; `curl -sI https://<name>.litljomi.is/` completes a TLS handshake. Each record is in the undo table (section 1).

## 10. Vercel projects, domains, deployment protection and cron (G6), and the G7 push

**History (M1).** G6.0 to G6.5 and G7.1 record what was done at M1, with the names of the time (the project "staging", `vefumsjon-staging`, `demo-staging`, their `*.litljomi.is` hosts, the `staging` branch, `.env.staging.local`); today's names are in section 1, and G6.6 is the deploy switch as it is now. A command for today uses the current names.

Never touched under this runbook: the existing project `landssamband-bakarameistara` (apart from the one build setting of G6.0, which Einar sets himself), labak.litljomi.is and labak.is.

### G6.0 The safeguard on `landssamband-bakarameistara` before `hub-integration` is pushed (G7)
- This step is the one statement of the safeguard: section 1, section 3, G7.1 and section 16 point here.
- **The facts** (decision 43): `landssamband-bakarameistara` **is** connected to the LABAK repository and builds labak.litljomi.is from `main`. The earlier check that it has "no Git connection" cannot pass and is replaced by this safeguard. By default Vercel builds a preview of every branch pushed to a connected repository (confirm at execution time), so without the safeguard a push of `hub-integration` would build inside that project.
- **Owner:** **Einar**, in his own Vercel dashboard. It is the one change anyone makes to that project, and it is his; the executor never opens or changes that project. The controller raises it with the G7 push request and records Einar's confirmation (no secrets).
- **When:** before the first push of `hub-integration` (G7.1). Nothing is pushed to `hub-integration` until Einar has confirmed it to the controller.
- **Settings:** on `landssamband-bakarameistara`, Settings → Git → Ignored Build Step (confirm the menu path at execution time), the custom command:
  ```sh
  if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi
  ```
  Vercel builds when the command exits 1 and skips the build when it exits 0, so the project keeps building `main` (labak.litljomi.is) and skips every other branch. Nothing else in the project is changed.
- **Verify:** Einar confirms to the controller that the setting is saved with exactly that command. After the G7.1 push, Einar checks the project's Deployments list: it shows **no built deployment** of `hub-integration` (a skipped or cancelled entry is the known limitation below). If one was built, **stop and report**; Einar decides about it (the executor never deletes or changes anything in that project).
- **Residual risk, stated plainly (a known limitation, section 15):** the existing project may still list a skipped or cancelled deployment for `hub-integration` and post a commit status on that branch in the LABAK repository. Nothing is built or served by it, and labak.litljomi.is is unaffected.
- **Undo:** Einar clears the Ignored Build Step (back to the default, automatic) when `hub-integration` is no longer pushed; recorded in the undo table.

### G6.1 Plan, login, GitHub access and the three projects
- **Owner:** **Einar** upgrades the Vercel team to **Pro ($20 a month)**, runs `vercel login` himself, and gives Vercel's GitHub app access to `einar6969/litljomi-cms` (the selected repositories only, never all of his repositories; confirm the option at execution time). The executor creates and configures the projects after G6 (dashboard, or `vercel` commands; a command whose saved login the sandbox cannot read is handed to Einar, section 1).
- **Settings:**

  | Project | Source | Root directory | Production branch | Hostname |
  |---|---|---|---|---|
  | `vefumsjon-staging` | `einar6969/litljomi-cms` | `apps/cms` | `main` | `vefumsjon-staging.litljomi.is` |
  | `demo-staging` | `einar6969/litljomi-cms` | `apps/demo-site` | `main` | `demo-staging.litljomi.is` |
  | `labak-hub` | LABAK repository, branch `hub-integration` only | as the LABAK repository needs (confirm at execution time) | `hub-integration` | `labak-hub.litljomi.is` |

  - **On all three:** Node.js 22 (pnpm is detected from the lockfile in this repository; confirm both at execution time in project Settings); functions in Frankfurt **`fra1`**; `noindex` through an `X-Robots-Tag: noindex` header; the custom domain public and every `*.vercel.app` URL behind Vercel Authentication, Standard Protection (G6.3); environment variables per `.env.example` (G6.2, section 13).
  - **`vefumsjon-staging` and `demo-staging`:** the region and the header come from each app's `vercel.json` (`apps/cms/vercel.json`, `apps/demo-site/vercel.json`: `"regions": ["fra1"]` and a `headers` entry sending `X-Robots-Tag: noindex` on every path; the CMS's also holds the cron, G6.4). An import from GitHub may deploy `main` straight away, before G6.2's variables exist; that first deployment may fail, and G6.5 redeploys (confirm at execution time).
  - **`labak-hub`** is a **new** project: never `landssamband-bakarameistara`, never `main` of the LABAK repository, never labak.litljomi.is or labak.is. Its region is set in the project's **Functions settings** (`fra1`; confirm the menu path at execution time), not in a LABAK file, so LABAK's `main` never inherits it. Its `noindex` header is sent by the LABAK branch when `SITE_NOINDEX=1` (set on `labak-hub` only, G6.2; the code is on `hub-integration`). Its Ignored Build Step is the mirror image of G6.0's:
    ```sh
    if [ "$VERCEL_GIT_COMMIT_REF" = "hub-integration" ]; then exit 1; else exit 0; fi
    ```
    so it builds `hub-integration` and skips every other branch, `main` included. **Order:** an import from a Git repository deploys the default branch (`main`) at once (confirm at execution time), so `labak-hub` is created **without** a Git connection first (for example `vercel project add labak-hub --scope <team>`; confirm the command at execution time), given its Ignored Build Step, region, `SITE_NOINDEX` and other settings, and only then connected to the LABAK repository, after the approvals of section 1 (G6 and G7, each recorded by the controller). If the Ignored Build Step or the production branch cannot be set before the connection, or connecting would build `main`, **stop and report**. Its first build is the G7.1 push.
  - Plan: Vercel Hobby allows cron at most once a day (a more frequent schedule fails the deployment), and Hobby is for non-commercial use (§2.2). Per-minute cron (A8) needs Pro, which Einar sets up before any project is created.
  - **As built:** `vefumsjon-staging` and `demo-staging` (now `vefstjorn` and `vefstjorn-demo`) use the deploy branch (`staging`, now `production`) as their production branch, not `main` (G6.6).
- **Verify:** `vercel project ls` (in Einar's team scope) lists the three projects; each project's settings show the root directory, Node 22, production branch and `fra1` above; `labak-hub` shows the Ignored Build Step above and its Git connection to the LABAK repository only after the approvals; the GitHub app's repository access lists only `litljomi-cms` and the LABAK repository (which it already had through the existing project); the team shows the Pro plan. Each project is in the undo table (section 1).

### G6.2 Environment variables
- **Owner:** Executor sets non-secret values; **Einar enters every secret value** (section 12) from his own terminal, or in the project's Environment Variables settings, so no secret passes through an agent session. Production environment only (the staging hostnames are the projects' production domains); secret values marked sensitive if the CLI or dashboard offers it (confirm at execution time).
- **Settings:** the variables in section 13 for each project, **except `CMS_WEBHOOK_SECRETS`** on the two site projects: it holds the site's webhook secret, which is created with the site in P-2 (section 11), after G6.5; P-2 sets and verifies it. `CRON_SECRET` and `CMS_INTERNAL_SECRET` are generated fresh and piped straight into the CLI, never printed, never in a file, the clipboard or shell history (section 12).
- **Selecting the Vercel project.** `vercel env` acts on the project linked to its working directory, so a wrong directory would put a value, possibly a secret, on the wrong project (for example one site's webhook secret on the other site). Each project therefore gets its own empty directory outside the repository, `~/vercel-link/<project>` (`<project>` is a name from G6.1's table), linked once by Einar: `mkdir -p ~/vercel-link/<project>`, then `vercel link --cwd ~/vercel-link/<project> --project <project> --scope <team>`. If `vercel link` offers to pull environment variables (for example into `.env.local`), Einar declines; the executor reads only `.vercel/project.json` there (confirm the prompts at execution time). Every `vercel env` command in this runbook names that directory with `--cwd ~/vercel-link/<project>` and never relies on the current directory. Before the first value is added to a project, the executor compares the project ID in `~/vercel-link/<project>/.vercel/project.json` (not secret) with the one on that project's Settings page and records the match. Confirm the flags and the file at execution time (`vercel link --help`, `vercel env --help`); if the project cannot be selected and checked this way, stop and report.
- **Verify:** for each project, `vercel env ls production --cwd ~/vercel-link/<project>` lists exactly the names in section 13 for that project (values are not shown), except `CMS_WEBHOOK_SECRETS` on the two site projects (P-2 adds it); no Supabase variable other than those section 13 lists is present on a site project; `SITE_NOINDEX` is on `labak-hub` only, and set there with the value `1` (Einar or the executor reads the value on the project's Environment Variables page; it is not secret). The header itself is checked live in G6.5 and, for `labak-hub`, after G7.1.

### G6.3 Deployment protection: Standard Protection on all three projects
- **Owner:** Executor (project Settings → Deployment Protection).
- **Settings:** for each of the three projects, Vercel Authentication **on, with Standard Protection** (it protects every deployment except production domains, so every `*.vercel.app` URL). Never disabled, and not "All Deployments". The staging hostnames are the projects' production domains, so they stay public and the live check (A15) reads the sites' pages without credentials (§7.4), while preview and other deployment URLs stay behind Vercel Authentication (for `labak-hub` this also covers anything built before its Ignored Build Step applies). No Password Protection (paid per project and unnecessary). "Protection Bypass for Automation" is not needed, since the production domains are not protected.
- **Verify:** each project's Deployment Protection page shows Vercel Authentication with Standard Protection. From a machine with no Vercel session, after G6.5 (and, for `labak-hub`, after G7.1): `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` (not `401`, and not a redirect to a Vercel login) for all three hostnames, and `curl -sI https://<host>/ | grep -i '^x-robots-tag'` shows `noindex`; the same request to a deployment-specific `*.vercel.app` URL of one project returns `401` or a redirect to the Vercel login (confirm the exact response at execution time).

### G6.4 Cron for the worker sweep
- **Owner:** Executor; Einar enters `CRON_SECRET` (G6.2); the Pro plan is Einar's (G6.1).
- **Settings:** `apps/cms/vercel.json` (Task 17, decision 43): `"crons": [{ "path": "/api/cron/sweep", "schedule": "* * * * *" }]`, next to its `regions` and `headers`. `CRON_SECRET` set on `vefumsjon-staging` (random, 32 bytes, section 12); Vercel sends it as `Authorization: Bearer <CRON_SECRET>` and the route compares it (`verifyCronSecret`). Cron delivery is best effort: a run can be missed or duplicated, there are no retries and redirects are not followed, so the sweep is idempotent and the route must not redirect.
- **Verify:** project Settings → Cron Jobs lists `/api/cron/sweep` with `* * * * *`; the project's logs show the sweep invoked about once a minute (A8 is measured over 10 minutes in Task 29). The protected routes refuse callers without the right secret (Task 17's routes answer `401`); the executor runs, after G6.5, with values that are deliberately wrong and not secrets:
  ```sh
  H='https://vefumsjon-staging.litljomi.is'
  curl -s -o /dev/null -w 'cron, no header: %{http_code}\n' "$H/api/cron/sweep"
  curl -s -o /dev/null -w 'cron, wrong bearer: %{http_code}\n' -H 'Authorization: Bearer not-the-cron-secret' "$H/api/cron/sweep"
  curl -s -o /dev/null -w 'worker, no header: %{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
  curl -s -o /dev/null -w 'worker, wrong header: %{http_code}\n' -X POST -H 'Content-Type: application/json' \
    -H 'x-cms-internal-secret: not-the-internal-secret' -d '{"requestId":"00000000-0000-0000-0000-000000000000"}' "$H/api/internal/worker"
  ```
  All four print `401`. Anything else (including `202` or `200`): stop and report.

### G6.5 Deploy the CMS and the demo site
- **Owner:** Executor.
- **Settings:** deploy `vefumsjon-staging` and `demo-staging` from `main` (a redeploy from the dashboard after G6.2, or the next push to `main`). The demo site is deployed **without `CMS_WEBHOOK_SECRETS`, on purpose**: its webhook secret does not exist until P-2, which sets the variable and redeploys the site. `labak-hub` is first built by the G7.1 push. Nothing is published to a site before P-3.
- **Verify:** each project's latest production deployment is Ready; `curl -s -o /dev/null -w '%{http_code}' https://<host>/` returns `200` for `vefumsjon-staging.litljomi.is` and `demo-staging.litljomi.is`, and `curl -sI https://<host>/ | grep -i '^x-robots-tag'` shows `X-Robots-Tag: noindex` for both. For `labak-hub` (first built by G7.1): `SITE_NOINDEX=1` is set on the project (G6.2), and after G7.1 `curl -sI https://labak-hub.litljomi.is/ | grep -i '^x-robots-tag'` shows `X-Robots-Tag: noindex` (G7.1's Verify). A missing header on any of the three hosts: stop and report.

### G6.6 The `production` deploy switch (as built on 2026-11-04 as `staging`; renamed on 2026-11-12)

G6.1 and G6.5 describe the first setup, which deployed from `main`. Since the freeze of 2026-11-04, a deploy branch is the deploy switch: `staging` until 2026-11-12, **`production`** since. This section is the one statement of it.

- **Settings,** on `vefstjorn` and `vefstjorn-demo`:
  - Production Branch: `production`.
  - Ignored Build Step, the one of decision 49.3 (confirm at execution time that it's still this):
    ```sh
    if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi
    ```
- **What it does.** A push to `production` deploys both projects to production. Every other branch is a preview, and its build is cancelled, so **merging to `main` deploys nothing**. A redeploy of a production deployment still builds (decision 51's CMS redeploy did), which is how a changed variable reaches a project.
- **Who moves it.** Einar pushes `production`, under a recorded approval. It always moves with the migrations, migrations first: the commands are in [`operations.md`](operations.md), section 8. That's a rule, not a technical control: `git` runs outside the sandbox, and the permission patterns don't catch every form of the command (decision 60).
- **Other projects.** `labak-hub` builds `hub-integration` and stays at its commit until M6. The Next.js 15 fixture `demo-next15-staging`, which wasn't updating (C5), was deleted on 2026-11-12, with its two inactive `cms.sites` records.
- **Verify:** each project's Git settings show the branch and the Ignored Build Step above (confirm the menu path at execution time). After a merge to `main`, the Deployments list shows that commit cancelled. After a push to `production`, it shows a new Ready production deployment.

### G7.1 Push `hub-integration` (G7, `push=true` for that branch only)
- **Owner:** Executor, in the LABAK checkout, only after G7 with `push=true` is recorded **and** Einar has confirmed G6.0's Ignored Build Step to the controller.
- **Before the push** (read only, in the LABAK checkout; both checks pass, or nothing is pushed):
  1. **No `vercel.json` that overrides G6.0.** A `vercel.json` with `ignoreCommand` or a `git` key (for example `git.deploymentEnabled`) on `hub-integration` would take precedence over the Ignored Build Step Einar set on `landssamband-bakarameistara`. Expected: no output (the branch had no `vercel.json` on 2026-11-03):
     ```sh
     git ls-tree -r --name-only hub-integration | grep -E '(^|/)vercel\.json$' | while read -r f; do
       printf '%s: ' "$f"; git show "hub-integration:$f" | jq 'has("ignoreCommand") or has("git")'
     done
     ```
     A file listed with `false` is reported and recorded; one with `true`, or one `jq` cannot parse: **stop and report**, nothing is pushed.
  2. **G2.0's history scan over what the push adds.** With `RE` and `CUT` set exactly as in G2.0 step 2, over the commits on `hub-integration` that are not on `main`, their commit messages, and the vendored tarballs unpacked (`git grep -I` skips them as binary):
     ```sh
     git rev-list main..hub-integration | xargs git grep -ohIE "$RE" | sed -E "$CUT" | sort | uniq -c
     git rev-list main..hub-integration | xargs git grep -lIE "$RE" | sed -E 's/^[0-9a-f]{40}://' | sort | uniq -c
     git log main..hub-integration --format=%B | grep -ohE "$RE" | sed -E "$CUT" | sort | uniq -c
     git ls-tree --name-only hub-integration vendor/ | grep '\.tgz$' | while read -r f; do
       git show "hub-integration:$f" | tar -xzOf - | grep -ohaE "$RE"
     done | sed -E "$CUT" | sort | uniq -c
     ```
     The executor shows Einar the findings, classified as in G2.0, before the push. Expected: only the local fixture value `labak-local-secret` (`CMS_WEBHOOK_SECRETS=laba…`, tried on 2026-11-03); nothing from the commit messages or the tarballs. Anything else: **stop**; nothing is pushed, and Einar decides.
- **Settings:** `git push -u origin hub-integration` in the LABAK repository. **Only `hub-integration`**: never `main`, never another branch or a tag, never `--all`, `--mirror` or a force-push. The branch carries G2.5's vendored SDK files and the `SITE_NOINDEX` code.
- **Verify:** `git ls-remote --heads origin hub-integration` matches the local branch head and `git ls-remote --heads origin main` is unchanged from before the push (recorded before); `labak-hub` shows a Ready production deployment of `hub-integration`, and `curl -s -o /dev/null -w '%{http_code}' https://labak-hub.litljomi.is/` returns `200`, and `curl -sI https://labak-hub.litljomi.is/ | grep -i '^x-robots-tag'` shows `X-Robots-Tag: noindex` (otherwise stop and report: `SITE_NOINDEX=1` is missing or not read); Einar checks G6.0's Deployments list on `landssamband-bakarameistara` (no built deployment of `hub-integration`; otherwise stop and report). The pushed branch is in the undo table (undo: Einar deletes the remote branch; labak-hub's deployments go with the project).

## 11. Tenants, sites and the first editor (Task 28 Step 5)

The tool is `provision` in `tools/cli` (decision 44.2; written `provision` throughout this runbook). It reads the hosted URL and secret key from Einar's env file (`~/litljomi-cms/.env.production.local` by default, never committed; section 1), so **Einar runs every `provision` command** in his own terminal, from the repository root (`~/litljomi-cms`); the executor prepares the exact commands (no secret in them) and runs the SQL checks. Run after G3.6, G3.7, G6.5 and G7.1.

This section records how the first two tenants were set up: P-1 to P-3 are history, with the names of the time (`demo-staging`, `demo-staging.litljomi.is`; section 1). **For a new tenant, follow [`operations.md`](operations.md), section 2.**

**Standard order for any new tenant (§9.2, decision 45.1):** the tenant's module reaches `production` first, then provision (P-1 to P-3), publish once in the CMS, then deploy the site. The SDK fails a site's build while its tenant has no release (`current.json` 400), and it keeps doing so on purpose: a missing release is never treated as empty content.

**What the tool does and refuses.** It reads `.env.production.local` as text, never executing it, with section 7.4's `env_value` rules (`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` each exactly once on a plain `NAME=value` line, `export` lines and spaces around `=` refused, the same value patterns; a refusal names the variable, never its value). `--expect-ref '<project-ref>'` is required, and the URL must be `https://<project-ref>.supabase.co`; any other host, the local stack included, is refused. It prints the target host (`target: <project-ref>.supabase.co`) before its first request, sends requests only to that origin with the key in headers only, follows no redirect, and prints only ids and statuses; a server error is shown as its HTTP status and the error's code and message only. `--env-file=<absolute path>` (equals form; a separate `--env-file <path>` is swallowed by vite-node when run through `pnpm … cli`) reads another file (not needed here). `--silent` stops pnpm adding its own `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` block after a failure; the tool's own output and exit code are unchanged. Exit codes: `0` done, `1` refused or failed, `2` wrong arguments. **Never trust the exit code alone:** a run succeeded only if it printed its result line (`tenant <slug>: <tenant-id>`, `site: <site-id>`, `membership <tenant-id>: ok`). Under vite-node an early exit once ended `provision site` after `target: …` with exit code `0` and nothing created, which let a chained `&& vercel env add …` run (fixed: stdin is read synchronously, and the exit code is `1` until the tool returns). **Reruns finish the job (spec §9.2, plan M4-02).** A rerun of `provision site` exits `0` and keeps the stored secret, so **never chain `provision site` to `vercel env add`**: run it, read its output, and run the Vercel step only if it printed `site: <site-id>`. Every command below is one line; `<project-ref>` is the hosted project's reference, from Einar's Supabase dashboard, as for G3.2c.

- **P-1 Tenants.** Owner: Einar; the executor verifies.
  ```sh
  pnpm --silent --filter @litljomi/cli cli provision tenant labak --name 'Landssamband bakarameistara' --expect-ref '<project-ref>'
  pnpm --silent --filter @litljomi/cli cli provision tenant demo --name 'Demo' --expect-ref '<project-ref>'
  ```
  Each prints `tenant <slug>: <tenant-id>`; Einar keeps the two ids for P-2 and P-3 (`<labak-tenant-id>`, `<demo-tenant-id>`; not secret). A rerun with the same name prints the same line and creates nothing. Another name for an existing slug refuses (`FAILED: tenant <slug> already exists with a different name (slug_taken); nothing was created`). Verify: SQL editor `select slug from cms.tenants order by slug;` lists `demo` and `labak` (confirm the table and column names against the migrations at execution time).
- **P-2 Sites.** Owner: Einar (the CLI and the webhook secret); the executor verifies. `provision site` once per staging site: base URL `https://demo-staging.litljomi.is` (tenant `demo`) or `https://labak-hub.litljomi.is` (tenant `labak`), and the site's revalidate route (`/api/cms/revalidate` on the demo site; the LABAK branch's route, confirm at execution time). The tool reads the webhook secret from **standard input only** (it refuses a terminal or empty input, and never takes the secret as an argument or environment variable; one trailing newline is removed; the secret must be 32–256 printable characters with no spaces or commas, since `CMS_WEBHOOK_SECRETS` is comma-separated), sets the revalidate URL to base URL plus route and the preview URL to the optional `--preview-url` (https, or http only to a loopback host; none when left out, and `provision preview-url --site-id <id> --preview-url (<url> | none)` sets, replaces or clears it later), and prints `site: <site-id>`. The secret is stored in Supabase Vault (`api.admin_create_site` keeps only its ID), and the same value becomes that site's `CMS_WEBHOOK_SECRETS` (set here, not in G6.2); the site is then redeployed. Before creating, the tool reads the tenant's active sites (`api.worker_sites`, id and base URL only). For a base URL the tenant already has, it exits `0` and prints `site <site-id>: already exists at <base-url>; nothing was created and the webhook secret was not changed (to change it, use provision webhook-secret)`, so a rerun creates no duplicate and never changes the stored secret. That line isn't the `site: <site-id>` result line. **Carrying the secret without a file, the clipboard or shell history**, in one terminal session per site, from the repository root:
  ```sh
  SITE_PROJECT='<site-project>'
  WEBHOOK_SECRET="$(openssl rand -base64 32)"
  printf '%s' "$WEBHOOK_SECRET" \
    | pnpm --silent --filter @litljomi/cli cli provision site --tenant-id '<tenant-id>' --base-url 'https://'"$SITE_PROJECT"'.litljomi.is' --revalidate-path '<revalidate-route>' --expect-ref '<project-ref>'
  ```
  `SITE_PROJECT`: set once per site, next to its base URL: demo-staging for https://demo-staging.litljomi.is, labak-hub for https://labak-hub.litljomi.is. The secret is never echoed; the command lines hold only the variable's name.
  Read that output. Only if it printed `site: <site-id>`, run:
  ```sh
  printf '%s' "$WEBHOOK_SECRET" \
    | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --cwd ~/vercel-link/"$SITE_PROJECT"
  unset WEBHOOK_SECRET SITE_PROJECT
  ```
  `<tenant-id>` is `<demo-tenant-id>` with `demo-staging`, and `<labak-tenant-id>` with `labak-hub` (P-1). Both pipes carry the same generated secret, entered by Einar; the base URL is built from `SITE_PROJECT`, so the site, its tenant and its Vercel project are set together (the two staging hostnames equal their project names). Run the `vercel env add` line only if `provision site` printed `site: <site-id>`. If it printed the `already exists` line, the generated value was thrown away and Vault keeps the stored secret: run `unset WEBHOOK_SECRET SITE_PROJECT` and don't touch Vercel. If it refused or failed, run the same `unset` and start again. `vercel env add` reads the value from stdin when piped (confirm at execution time); if it cannot, stop: Einar decides how the value is entered without a file, and the choice is recorded. **If the site exists but its `CMS_WEBHOOK_SECRETS` is missing or wrong on Vercel** (for example after a first run that created the site, followed by a failed Vercel step), never generate a new value here: read the stored secret into a variable and pipe it, with `--force`, because without it `vercel env add` refuses a variable that exists, and run the `unset`. The exact commands are in [`operations.md`](operations.md), section 2, step 11c. Then redeploy the site. To change a site's secret, follow that section's rotation. Verify: `select count(*) from vault.secrets;` increased by one per site (never select decrypted values); `vercel env ls production --cwd ~/vercel-link/<site-project>` now lists section 13's names for that site (G6.2's list plus `CMS_WEBHOOK_SECRETS`); the site's redeployment is Ready.
- **P-3 The staging editor.** Owner: Einar; the executor verifies. **`einsi@litljomi.is`**, an editor of `labak` and of `demo` (decision 44.2), in one command:
  ```sh
  pnpm --silent --filter @litljomi/cli cli provision editor --email einsi@litljomi.is --tenant-id '<labak-tenant-id>' --tenant-id '<demo-tenant-id>' --expect-ref '<project-ref>'
  ```
  It sends one Auth admin invitation (Supabase's invitation email, the Icelandic template of G3.7, whose link is `{{ .SiteURL }}/auth/confirm?…&type=invite`, so no redirect is passed), prints `invited einsi@litljomi.is: user <user-id>`, then adds one membership per tenant (`api.admin_add_membership`, idempotent) and prints `membership <tenant-id>: ok` for each. If a membership fails after the invitation, it prints the user id, exactly which tenant ids are still missing and the command that finishes them (`provision editor --user-id <user-id> --tenant-id <missing-id> … --expect-ref '<project-ref>'`, run the same way as above), and exits `1`; Einar runs that command. If a user with that email already exists and has not confirmed the invitation, Auth re-sends the invitation (HTTP 200) and the memberships are added; no second user is created (confirm at execution time). If the existing user has confirmed, Auth refuses the invitation, so the tool finds the user's id in the Auth users list, prints `existing user einsi@litljomi.is: user <user-id>` and adds the memberships. A rerun therefore finishes the job after any partial failure and creates no second user. To revoke, use `provision remove-editor` ([`operations.md`](operations.md), section 5). Nobody else is invited or given access in M1 (decision 43.9). Verify: `select t.slug from cms.memberships m join cms.tenants t on t.id = m.tenant_id join auth.users u on u.id = m.user_id where u.email = 'einsi@litljomi.is' order by t.slug;` lists `demo` and `labak` (confirm the table names against the migrations at execution time), and `select count(*) from auth.users;` returns `1`; then G4.3.
- **Record** every created resource (names, regions, domains, project references; no secrets) in `docs/verification/m1-report.md` (Task 28 Step 6) and in the undo table (section 1). Owner: executor. Verify: `git grep -nE 'sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}' -- docs/verification/m1-report.md docs/verification/m1-gates.md` finds nothing.

## 12. Secrets

No secret is ever committed, logged, printed in an agent session, pasted into chat or written into a report. `.env*` files other than `.env.example` are never committed, and `.env.local` and `.env.production.local` are never sourced (section 7.4, "Reading `.env.production.local` without executing it"). The executor never reveals a secret value in the dashboard or the SQL editor and runs only the queries this runbook gives (section 1). Every hosted secret is **fresh**, created for this project only. Rotation: the SDK accepts two webhook secrets during rotation (§8.2); the procedures are in [`operations.md`](operations.md), sections 3 and 4.

**Generating and storing the CMS secrets (G6.2).** Einar, in his own terminal, once per secret, generates the value and pipes it straight into the CLI, so it is never printed, never in a file, the clipboard or shell history, and never on a command line:

```sh
openssl rand -base64 32 | vercel env add CRON_SECRET production --cwd ~/vercel-link/vefstjorn
openssl rand -base64 32 | vercel env add CMS_INTERNAL_SECRET production --cwd ~/vercel-link/vefstjorn
```

Mark each sensitive if the CLI offers it (for example a `--sensitive` flag; confirm the flags at execution time with `vercel env add --help`). If `vercel env add` cannot read a piped value, stop: Einar decides, as in P-2. Nobody needs to know these values: Vercel sends `CRON_SECRET` to the cron route itself, and the CMS sends `CMS_INTERNAL_SECRET` to itself. `SUPABASE_SECRET_KEY` is entered by Einar the same way, from the Supabase API keys page, at `vercel env add`'s own prompt (or in the dashboard), never on a command line.

| Secret | Created where | Stored where | Who may read it |
|---|---|---|---|
| Supabase secret key | Supabase project API keys (G3.1) | `vefstjorn` server environment (`SUPABASE_SECRET_KEY`, entered by Einar); Einar's `.env.production.local` for `tools/cli` (and, at M1, `.env.staging.local` for the G3.2c script and Task 29's automated sign-in ; until decision 72, also section 7.2's scripts) | Code under `apps/cms/src/privileged/**` and `tools/cli` only (lint-enforced); in operation, only Einar's own terminal, never an agent session. Never in client bundles, sites or module code |
| Internal worker-trigger secret | Generated fresh, 32 random bytes, piped into `vercel env add` by Einar (above) | `vefstjorn` (`CMS_INTERNAL_SECRET`) | The CMS server: the trigger and `verifyInternalSecret` |
| Cron secret | Generated fresh, 32 random bytes, piped into `vercel env add` by Einar (above) | `vefstjorn` (`CRON_SECRET`) | Vercel Cron (sends it) and `verifyCronSecret` |
| Per-site webhook secret | Generated fresh by Einar, one per site (P-2: `provision site` needs the secret key) | Supabase Vault (by `provision site`) and the site's environment (`CMS_WEBHOOK_SECRETS`) | The worker through `service_role`-only functions (A9); the site's revalidation route |
| Per-site preview secret | Generated fresh by Einar, one per site, and set with `provision preview-secret` (it reads the secret from standard input only) | Supabase Vault (by `provision preview-secret`) and the site's environment (`CMS_PREVIEW_SECRETS`) | The privileged zone: the preview-token route and the preview endpoint (§8.2); the site's preview route |
| SMTP credentials (SendGrid restricted API key, Mail Send only) | Einar, in SendGrid (G4.1) | Supabase Auth SMTP settings (G4.2), entered by Einar | Supabase Auth. §8.2 also lists the CMS environment; M1 code sends no email itself, so no variable is defined (section 16) |
| Supabase database password | Einar at project creation (G3.1) | Einar's password manager | Einar, typed at the `supabase link`/`db push` prompt only (G3.2b) |
| Supabase CLI access token | `supabase login` by Einar | The Supabase CLI's local credential store | Einar's machine only |
| Supabase personal access token for the Management API (only if section 6's Management API route for secure password change is used) | Einar, in his Supabase account settings, for that step only | Not stored: entered at a hidden prompt in a subshell (section 6); **revoked by Einar whatever the outcome (success or failure)** | Einar's machine only |
| JWT signing secret or keys | Supabase (managed) | Supabase | Nobody exports it; holders could issue tokens without the hook (section 15) |
| Vercel and GitHub sessions | `vercel login`, `gh auth login` by Einar | The CLIs' local credential stores | Einar's machine only; a command that needs them and cannot read them from the sandbox is handed to Einar (section 1) |

No registry token exists: the LABAK branch gets the SDK as vendored files (G2.5), and GitHub Packages waits until a second site arrives (§9.1).

## 13. Environment variables

The same set as `.env.example` (`tools/checks/__tests__/env-example.test.ts` checks that the first column of this table and the `NAME=` lines of `.env.example` match both ways). Values are set per Vercel project (G6.2) and, for local work, in `.env.local` (the local stack's values); the hosted values that `tools/cli` reads are in Einar's `.env.production.local` (section 1).

| Variable | Used by | Secret | Value and where it comes from | Set on |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | CMS app; `tools/cli` locally | No (public) | `https://<project-ref>.supabase.co`, the project URL on the API settings page (confirm at execution time) | `vefstjorn`; `.env.production.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | CMS app (browser and server) | No (public by design; RLS and grants protect data) | The project's publishable key (API keys page) | `vefstjorn`; `.env.production.local` |
| `SUPABASE_SECRET_KEY` | `apps/cms/src/privileged/**`, `tools/cli` | **Yes** | The project's secret key (API keys page); entered by Einar (section 12) | `vefstjorn`; Einar's `.env.production.local` |
| `CMS_INTERNAL_SECRET` | CMS app (worker trigger, header `x-cms-internal-secret`) | **Yes** | 32 random bytes, generated and piped into the CLI by Einar (section 12) | `vefstjorn` |
| `CRON_SECRET` | CMS app (`/api/cron/sweep`), Vercel Cron | **Yes** | 32 random bytes, generated and piped into the CLI by Einar (section 12) | `vefstjorn` |
| `CMS_PUBLIC_URL` | CMS app (worker trigger URL; secure session cookies when the URL is not local. Until decision 72, also the magic-link redirect) | No | `https://vefstjorn.is` | `vefstjorn` |
| `CMS_ALERT_SMTP_HOST` | CMS app (`privileged/worker/alert-email.ts`, alert emails, plan M3-04) | No | `smtp.sendgrid.net` (SendGrid, decision 50.5). Unset: no alert email (alerts stay in the server log and the audit log) | `vefstjorn` (M3 local acceptance step 8) |
| `CMS_ALERT_SMTP_PORT` | CMS app (alert emails) | No | `587` (STARTTLS, required for any non-loopback host); `465` for implicit TLS. Default `587` | `vefstjorn` |
| `CMS_ALERT_SMTP_USER` | CMS app (alert emails) | No | `apikey` (SendGrid's SMTP user name) | `vefstjorn` |
| `CMS_ALERT_SMTP_PASSWORD` | CMS app (alert emails) | **Yes** | A SendGrid API key with Mail Send only; entered by Einar (section 12) | `vefstjorn` |
| `CMS_ALERT_EMAIL_FROM` | CMS app (alert emails) | No | A sender verified in SendGrid for litljomi.is (confirm at execution time) | `vefstjorn` |
| `CMS_ALERT_EMAIL_TO` | CMS app (alert emails) | No | The platform admin's address(es), comma-separated | `vefstjorn` |
| `CMS_DELIVERY_BASE_URL` | Sites (SDK release reading) | No | Public URL of the `delivery` bucket, as Storage shows it (expected `https://<project-ref>.supabase.co/storage/v1/object/public/delivery`; confirm at execution time) | `vefstjorn-demo`, `labak-hub` |
| `CMS_TENANT` | Sites | No | The site's tenant slug: `demo` or `labak` | `vefstjorn-demo` (`demo`), `labak-hub` (`labak`) |
| `CMS_WEBHOOK_SECRETS` | Sites (revalidation route) | **Yes** | The site's webhook secret from P-2; two, comma-separated, during rotation; entered by Einar | Each site project, its own secret only |
| `CMS_PREVIEW_SECRETS` | Demo site (preview route) | **Yes** | The site's preview secrets, comma-separated; the same value is stored in Vault with `provision preview-secret` (section 12); entered by Einar | `vefstjorn-demo`, its own secret only |
| `CMS_PREVIEW_BASE_URL` | Demo site (preview endpoint; read only in draft mode) | No | The CMS origin: `https://vefstjorn.is` | `vefstjorn-demo` |
| `CMS_MEDIA_HOST` | Sites (`next/image` `remotePatterns`) | No | The host of `media-public` public URLs (expected `<project-ref>.supabase.co`; confirm at execution time) | `vefstjorn-demo`, `labak-hub` |
| `SITE_NOINDEX` | The LABAK branch (`hub-integration`): sends `X-Robots-Tag: noindex` when `1` | No | `1` | `labak-hub` only (the CMS and the demo site send the header from their `vercel.json`; LABAK's `main` and `landssamband-bakarameistara` never get it) |

Sites hold no Supabase credentials and no API URL (§8.1): they read only public Storage files (`delivery`, `media-public`) and receive signed webhooks.

## 14. Validation procedures (Task 29)

**History.** This section records Task 29 as run at M1, with magic-link sign-in. Decision 72 replaced that sign-in: the rows and the manual check marked below are M1 history. A later acceptance signs in with a password and runs section 7.2 as it now stands (S1 to S10).

Before Task 29, run the full local suite (Task 29 Step 1) and the hook verification (section 7.2). Task 29 then runs `apps/cms/e2e/m1-acceptance.spec.ts` against staging, one test per M1 criterion of spec §13.2 (Task 29 items 1–11; section 1 explains the numbering), and writes the results to **`docs/verification/m1-report.md`**: each criterion pass or fail with evidence (commands, request IDs, timestamps, screenshots at 375, 768 and 1440 px), each validation gate with its result, and every known limitation.

**Who runs what (decision 43.1 and 43.9).**
- **Einar runs every browser test** (`pnpm --filter cms e2e …` and the staging acceptance spec) in his own terminal, from **one exact command** the controller gives him, and pastes the output back; the controller reads it. Agents do not run browser tests.
- **Automated sign-in** (at M1) uses the Auth admin `generateLink` route with the staging secret key from Einar's environment only (his `.env.staging.local` or his shell; never printed, never committed, never in an agent session), which is one more reason the spec runs in his terminal.
- **The staging account** is `einsi@litljomi.is`, an editor of both `labak` and `demo` (P-3). No other editor, and no access for anyone else in M1.
- **On staging, prove A6, A7, A8, A11 and A15**, and **re-run A1–A4 against hosted Supabase** with `boundary-check` (below, decision 46). It replaces re-running the integration suite's `http-boundary.test.ts` and `storage-boundary.test.ts`, which need the local seed and owner SQL; the local suite keeps refusing a hosted URL.
- **Einar's manual check** (at M1): request a magic link on his laptop, open it on his phone, press "Halda áfram", publish a test article from the phone, and see it on `https://labak-hub.litljomi.is`. Replaced by decision 72: he signs in on the phone with his password, then publishes and checks the same way.

| What Task 29 checks | Depends on (this runbook) | Gate |
|---|---|---|
| Magic-link sign-in delivered by custom SMTP (SendGrid) with Icelandic templates (M1; since decision 72, the invite and reset mails of section 7.2, S5 and S7) | Section 8, G3.6, G5.1 | A11 |
| Publish reaches "Birt á vef ✓" on `labak-hub.litljomi.is` within 60 s | G6.3, G7.1, P-2 | A7, A15 |
| Image public only after publish; republish moves Live; unpublish passes every `absent` check | Section 11 | — |
| Isolation both ways through the API and storage, and A2–A3 with them (`boundary-check`, below; decision 46) | G3.2, G3.3, P-1, a delivered release per tenant | A1–A4 |
| Malformed RPC never committed; stale save rejected; changed draft `superseded` | G3.2 | — |
| With the CMS deployment paused, both sites keep serving (Einar pauses it or approves pausing, G6) | G6.5, G7.1 | — |
| `current.json` overwritten and polled: new release within about a minute | `CMS_DELIVERY_BASE_URL` | A6 |
| Cron log shows the sweep every minute for 10 minutes | G6.4 | A8 |
| Passwordless and email change: hook enabled; password sign-in 403; magic link works; no `password` row in `auth.mfa_amr_claims`; an email change needs both addresses (M1; replaced by decision 72: section 7.2, where a password signs in and a magic-link request can't; the email-change check is unchanged) | Sections 6 and 7 | Decisions 18, 19 (Task 29 item 11) |
| The phone check: link requested on the laptop, opened on the phone, "Halda áfram", article published from the phone and seen on `labak-hub.litljomi.is` (M1; since decision 72, a password sign-in on the phone) | Sections 8 and 11 | Einar's manual check |

Each run's secrets come from Einar's local environment only; the report records results, never values.

### A1–A4 on the hosted project: `boundary-check` (decision 46)

**Owner:** Einar, in his own terminal, from the repository root (it reads the secret key); the controller reads the output he pastes back. One line:

```sh
pnpm --silent --filter @litljomi/cli cli boundary-check --labak-tenant-id '<labak-tenant-id>' --demo-tenant-id '<demo-tenant-id>' --expect-ref '<project-ref>'
```

It is `provision`'s sibling and has the same safety rules (section 11, "What the tool does and refuses"): `.env.production.local` read as text, never executed, with the `env_value` rules, now also for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (used for the anon and editor requests); `--expect-ref` required; HTTP only, to `https://<project-ref>.supabase.co` only, keys and tokens in headers only, no redirect followed; no database connection and no SQL. It prints no key, token, link or response body, only statuses, error codes and messages, and ids.

**Setup, before any check.** If a setup step fails, the tool prints `FAILED: setup: …`, runs no checks and prints no `RESULT` line.
1. It confirms, read-only (`api.worker_previous_release` with the secret key), that each tenant id is the tenant its flag names, from the slug in its latest release's bundle path. Swapped ids, or a tenant with no delivered release, are refused before anything is created or changed.
2. It finds or creates the two test editors, `einsi+a-labak@litljomi.is` and `einsi+a-demo@litljomi.is`, through the Auth admin API: created confirmed (`email_confirm`), with no password and no invitation, so no email is sent. An existing user is reused.
3. It gives each a session through `generate_link` and the hashed token's verification, with no email: since decision 72 a recovery link, which Auth reports as `otp` and the sign-in hook allows (decision 72.1); at M1 a magic link, as in the old section 7.2's H4. The test editors have no password and get none.
4. It adds the one membership (`api.admin_add_membership`, idempotent). It refuses to go on if a test editor is a member of any other tenant (`api.my_tenants`).

**Checks, one line each:**
- **A1:** schemas `cms`, `private`, `public` and `graphql_public` refused (406 `PGRST106`) for anon, each editor and the secret key, both as a table read (`Accept-Profile`) and as an RPC (`Content-Profile`). GraphQL is refused for anon and each editor.
- **A2:** each editor creates, or reuses (found by the title "A1–A4 grensupróf (prófun)"), one draft in its own tenant (`news` in `labak`, `event` in `demo`) and saves it. Creating an entry in, or saving the draft of, the other tenant is refused (`P0001 not_found`). Its `api.entry_list` shows no row of another tenant.
- **A3:** `api.worker_previous_release` succeeds with the secret key and is refused (`42501`) for anon and each editor. It is read-only, and unlike `worker_sites` it returns no secret.
- **A4:** each editor uploads, or finds and downloads, its own 14-byte JPEG at `media-private/<tenant-id>/<fixed id>/a.jpg` and reads it back. "Already existed" counts only after a download with the same bytes, and the line says so. Refused: an upload into the other tenant's prefix; reading the other tenant's test object; an upsert or update of its own object (it is then downloaded again, unchanged); a delete of its own object (still there afterwards); any upload to `media-public` or `delivery`. The refused writes use fresh paths each run, so an earlier object can never make a refusal look like a pass. The secret key is never used for a storage write or delete.

**What it leaves on the hosted project:** two users with one membership each, two drafts titled "A1–A4 grensupróf (prófun)", and two 14-byte objects in `media-private`. These drafts show in the CMS lists ("Fréttir" for `labak`, "Events" for `demo`): never publish them. Each run saves the drafts once more, so their version goes up. Nothing is ever deleted; these leftovers cannot be removed without SQL and are removed only with the production cut-over.

**Reading the output:** `target: <project-ref>.supabase.co` first, then one line per check: `PASS <gate> <description> (<observed status and code>)` or `FAIL <gate> <description> (observed …, expected …)`. A transport error fails only its own check. After the checks come the test user ids and the entry and object ids, marked created or reused, and last `RESULT: <n> passed, <m> failed`. **A run passed only if it printed `RESULT: <n> passed, 0 failed`** (71 checks today). As for `provision`, never trust the exit code alone (`0` all passed, `1` refused or any check failed, `2` wrong arguments). Record the run (date, the RESULT line, any FAIL lines, the ids) in `docs/verification/m1-report.md`.

## 15. Known limitations

The full list is decision 18's (plan, "Implementation-level decisions"), decision 21's and, since password sign-in, decisions 72 to 72.4's; the ones that matter when operating the hosted project:
- **Replaced by decision 72** (M1 history): "a password can be set on an account but never signs in" and "a correct password gets 403 and a wrong one 400". A password is now the editors' sign-in. A wrong password and an unknown address get the same Auth error (PW-02); Supabase's own `user_banned` and `email_not_confirmed` answers are unchanged (confirm at execution time).
- Guessing is limited only per IP address: about 150 password attempts per 5 minutes per address, shared with session refresh (decision 72.4, section 7.3 step 9). Guesses spread over many addresses are not limited, and there is no CAPTCHA and no password rule beyond length 6: accepted by Einar (decisions 72 and 72.4).
- Auth still makes a 10-digit code for every magic-link or code request and accepts it for an hour, though no email carries it (decision 72.3). An outsider can still spoil a pending invitation by requesting a sign-up confirmation; the invitation is then sent again (accepted, decision 72.3).
- Refused sign-in attempts leave no row in `auth.audit_log_entries`; they appear only in the Auth logs (confirm at execution time for wrong passwords).
- The hook, the six templates and the code length live in the Auth configuration: a dashboard change or a configuration push can switch the hook off, or bring back a template with a link or code, silently. So section 7.2 is re-run after every Auth configuration change or configuration push, and on every hosted project.
- Sign-in fails closed if the hook cannot run (it must answer within 2 seconds): a slow or unavailable database blocks sign-in rather than allowing anything.
- Holders of the JWT secret or the Supabase secret key can issue tokens without the hook (by design, §8.1).
- Access tokens issued before the hook was enabled stay valid until they expire (at most `jwt_expiry`, 3600 seconds); hence the revocation in section 7.1.
- Secure password change is additional protection only (section 6): a session under 24 hours old can set a password without a nonce, and any password change revokes the user's other sessions, so a session holder can sign the editor out elsewhere (the editor signs in again with the password).
- Enabling sign-up, MFA recovery codes, WebAuthn, phone MFA or passkeys needs the hook's allowlist revisited.
- The hook and secure password change were verified on local Supabase Auth v2.197.0 only until Task 29; the sign-in hook, the link-free templates and the 10-digit codes, locally only (PW-01 to PW-03) until section 7.3 runs.
- Vercel Cron is best effort (missed or duplicate runs possible, no retries); the sweep is idempotent.
- The live check cannot confirm a site behind deployment protection (§7.4); G6.3's Standard Protection keeps the projects' production domains public and every other deployment protected.
- `landssamband-bakarameistara` stays connected to the LABAK repository: with G6.0's Ignored Build Step it builds nothing for `hub-integration`, but it may still list a skipped or cancelled deployment and post a commit status on that branch (G6.0).
- `noindex` is a header only (`X-Robots-Tag`); it asks search engines not to index the CMS and the demo and LABAK-branch hosts, it does not keep anyone out.
- Withdrawal from third-party caches is best-effort, and M1 has no fallback rule for failed entries (Task 29 reports both).

## 16. Open items

| Item | Owner | When |
|---|---|---|
| Per-site preview secret: **resolved by M3**. Decision 43.1 asks for one; it is created with `provision preview-secret` and stored in Vault and in the site's `CMS_PREVIEW_SECRETS` (sections 12 and 13) | Controller | Done |
| Who enters secret values: Einar, so no secret passes through an agent session (sections 1 and 12) | Einar confirms | G3, G6 |
| Steps that need the secret key or another secret value are Einar's (section 1), including the G3.2c script (and, until decision 72, section 7.2's scripts), every `provision` command, the secrets of section 12 and section 6's Management API route | Einar confirms | G3 |
| Task 29's re-run of A1–A4 against hosted Supabase: the integration suite (`tests/integration/src/env.ts`) refuses any non-loopback stack. **Decided** (decision 46): `boundary-check` in `tools/cli` (section 14), run by Einar in his own terminal | Einar approved ("Approve adapter") | Done; run before Task 29's report |
| The LABAK repository and Vercel: the approvals to connect it to `labak-hub` (section 1), and Einar's confirmation of G6.0's Ignored Build Step before G7.1 | Einar approves and confirms; controller raises | G6; the G7 push request |
| `deny` rules for agents on `.env`, `.env.local` and `.env.staging.local`: **done**. Edit and Write denies for `.env` and `.env.local` (diff B, Einar 2026-11-03, `0bfb23f`); Read, Edit and Write denies for `.env.staging.local` (diff D, Einar 2026-11-03, `6504caf`), applied before Einar created the file; the `.env.*.local` patterns also cover `.env.production.local` | Einar approved | Done |
| `ask` rules for risky hosted Supabase commands (`supabase config push`, `supabase db reset --linked`, `supabase migration repair`): today the project settings have no `ask` rule for them, so G3.2b's "never `supabase config push`" is behavioural only; adding the rules is a `.claude/**` change for Einar to approve | Controller raises with Einar | Before G3 |
| The email rate limit value (G3.6) | Einar confirms | G3 |
| SMTP credentials in the CMS environment (§8.2): no M1 code needs them, so no variable is defined; to be named when code that sends email is planned | Controller raises with Einar | When such code is planned |
| GitHub Packages for `@litljomi/*` (a `litljomi` GitHub organisation) replaces the vendored files of G2.5 | Einar | When a second site arrives (§9.1) |
| Recurring automation of the hook verification (decision 20): decision 73 left scripting the hosted checks (suggestion 12) to the hosted rollout; section 7.2's last column marks what a script could do. No script exists | Einar, by a separate decision | The hosted rollout or later |
| Optional hosted check of the 24-hour secure-password-change path (needs a session's `created_at` moved back in `auth.sessions`, as in the local verification) | Einar decides | G3 |
| The production Supabase project (and the organisation's move to Pro, §2.2): decided by decision 74 (this project, on the Free plan; Pro and backups deferred) and live at `vefstjorn.is` (decision 76), not `cms.litljomi.is` | Einar | Done on 2026-11-12; Pro deferred |
