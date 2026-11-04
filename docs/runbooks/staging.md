# Staging runbook: hosted environments for M1

**Contents.** The execution order is section 3; sections 4–11 are the reference for each gate's steps.

1. Purpose and status: scope, conventions, off-limits resources, the LABAK repository and Vercel
2. Prerequisites
3. Deployment sequence (the order Task 28 follows)
4. G2: GitHub repository, and the SDK files for the LABAK branch
5. G3: Hosted Supabase
6. Supabase Auth configuration (every hosted Auth setting, with the step that applies it)
7. Passwordless Auth hook: enabling it (7.1) and the verification procedure (7.2)
8. Email delivery through SendGrid (G4)
9. DNS in the litljomi.is zone (G5)
10. Vercel projects, domains, deployment protection and cron (G6), and the G7 push
11. Tenants, sites and the staging editor (Task 28 Step 5)
12. Secrets
13. Environment variables
14. Validation procedures (Task 29)
15. Known limitations
16. Open items

## 1. Purpose and status

This runbook sets up the M1 staging environment: the GitHub repository, the hosted Supabase staging project, email through SendGrid, three CNAME records in litljomi.is and the three Vercel projects, and the push of the LABAK branch `hub-integration`. It is the procedure Task 28 follows and Task 29 checks.

**Status.** Written in Task 3 (2026-11-02) as a document only, and revised in Task 28 Step 0 (2026-11-03) to plan decisions 42.4 and 43; where decision 43 differs from decision 42 or an earlier version of this runbook, decision 43 applies. **Nothing in it has been executed**: no account, project, record, key or deployment exists because of it. It is executed only in Task 28 and Task 29, one gate at a time (G2, G3, G4, G5, G6, G7). Each gate is approved by Einar in his own words in chat and recorded by the controller in `docs/execution/gates.json` before any step under it runs. Approval of one gate does not cover another. The one paid step, the Vercel Pro upgrade, is Einar's (G6.1).

**Sources.** `docs/architecture.md` (§2.2, §4.2, §4.4, §7.3, §7.4, §8.2, §8.4, §9.1, §11) and the plan `docs/plans/2026-11-01-m0-m1.md` (gates G2–G7, decisions 16–21, 36.7, 42 and 43, Tasks 28 and 29). If this runbook and the spec disagree, the spec wins: stop and report.

**Conventions.**
- Every step names its **Owner**, the **Settings** to apply and the **Verify** check that shows it worked. A step whose check fails stops the gate: record the result and report to the controller, who reports to Einar.
- **Einar** acts in his own accounts (sign-ups, payment, DNS, provider keys) and does **every login** (`gh`, `supabase login`, `vercel login`, every dashboard) and **enters every key and password**. No password, token or key goes into chat, ever. The **executor** is the agent the controller dispatches, acting only after the gate is recorded (written "Executor" only at the start of a sentence or table cell).
- **Who works in a dashboard.** The executor acts in the Supabase or Vercel dashboard (the SQL editor included) **only in a browser session Einar signed in to himself**. Otherwise Einar applies the step from this runbook's list and reads the result back to the controller. Every dashboard step below whose Owner is the executor is read this way.
- **A CLI whose saved login the sandbox cannot read.** `gh`, `supabase` and `vercel` keep their logins in local credential stores (some in the macOS keychain). A command whose saved login cannot be read from the sandbox is **handed to Einar to run** in his own terminal, as the exact command the executor wrote out, and he pastes back the output (no secrets in it). That is not a refusal to work around.
- **Who runs a step that needs a secret.** Every step that needs the Supabase secret key, the database password, the SendGrid API key, a GitHub token or any other secret value is **Einar's**, run in his own terminal or dashboard session. Agents cannot read `.env.local` or `.env.staging.local` (the project's permission settings and the sandbox deny `.env.local`; `.env.staging.local` is likewise kept from agents, see the ruling below) and never receive a secret value. The executor owns the steps that need no secret; the two public values it needs for checks (`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, public by design) are given to it by Einar, never read from `.env.staging.local`.
- **The dashboard and the SQL editor reach secret values.** The Supabase dashboard's API keys page can reveal the secret key, Vault (`vault.decrypted_secrets`) holds the per-site webhook secrets in clear, and the SQL editor runs as `postgres`, which can read both. The executor **never reveals a secret value** there: it does not reveal or copy a key on the API keys page or any other settings page (database password, SMTP password, JWT secret), never selects from `vault.decrypted_secrets`, and never selects token, password-hash or secret columns. In the SQL editor it runs **only the queries this runbook gives**, as written apart from the placeholders. A query that seems needed but is not here is reported to the controller first, never improvised.
- **SQL blocks.** Each SQL block or inline query holds exactly one statement; where a step has several, they are numbered (for example 2a, 2b). Run each statement on its own and record its result before running the next. The SQL editor may show only the last result when several statements run together (confirm its behaviour at execution time), so statements are never combined into one run.
- **Network.** The Bash sandbox stays limited to `registry.npmjs.org`. At each gate the controller shows Einar an exact `.claude/settings.json` diff adding **only that gate's hosts** to the sandbox's allowed domains, applies it only after his approval, and removes it when the gate is done. The hosts expected (confirm at execution time; a host found missing is a new diff for Einar, never an unsandboxed retry):

  | Gate | Hosts for the executor's commands |
  |---|---|
  | G2 | `github.com`, `api.github.com` |
  | G3 | `<project-ref>.supabase.co` (the executor's public checks, sections 5 and 6; Einar's own `supabase` commands run in his terminal) |
  | G4, G5 | none (Einar works in SendGrid, Supabase and the DNS host himself, and runs the `dig` checks) |
  | G6 | `api.vercel.com`, `vefumsjon-staging.litljomi.is`, `demo-staging.litljomi.is`, `labak-hub.litljomi.is` |
  | G7 | `github.com` (G7.1's `git push` of `hub-integration` and its `git ls-remote` checks, in the LABAK checkout); `labak-hub.litljomi.is` (G7.1's live check and the `labak-hub` checks of G6.3 that wait for G7.1, since the G6 diff is removed by then). Shown to Einar as an exact diff with the G7 push request; removed when G7.1 is done |
  | Task 29 | `vefumsjon-staging.litljomi.is`, `demo-staging.litljomi.is`, `labak-hub.litljomi.is` and `<project-ref>.supabase.co`, for the controller's own read-only `curl` checks (status codes, headers, the public delivery files); no secret is used. Einar's browser tests and every acceptance run that needs the staging key (the admin link route, section 14) run in his own terminal, outside the sandbox, and need no entry here. Shown to Einar as an exact diff when Task 29 starts; removed when Task 29 is done |
- **Undo records.** Every hosted item created or changed under this runbook (repository, organisation, project, key, setting, record, deployment) is recorded the same day, with how to undo it, in `docs/verification/m1-gates.md`, table "Hosted items and how to undo them (Task 28)" (columns Item, Where, Created (date, gate), Monthly cost, How to undo), and in the session's handoff notes. No secret value goes into either.
- **Cost.** The only new cost is **Vercel Pro, $20 a month** (Einar upgrades the team at G6.1). SendGrid is Einar's existing paid plan; the Supabase organisation is on the Free plan (Pro comes with production, §2.2) and the GitHub repository is on GitHub Free. A step that would add any other cost stops: report it; Einar decides.
- "§" numbers refer to the spec (`docs/architecture.md`); "section N" refers to this runbook. **A1–A15** are the spec's validation gates (§11.1, the A-numbered table). "**Task 29 item N**" is item N of Task 29 Step 2 in the plan (one M1 acceptance test each). The two numberings are unrelated: Task 29 item 11 is the passwordless and email-change test, A11 is custom SMTP delivery.
- "**Confirm at execution time**" marks a value or screen this runbook could not verify when it was written (dashboard menu paths, provider record values, CLI details). The executor checks it against the live screen or the provider's current documentation and records what was found; it never guesses.
- **Names.** The three staging hostnames are `vefumsjon-staging.litljomi.is` (the CMS), `demo-staging.litljomi.is` (the demo site) and `labak-hub.litljomi.is` (the LABAK branch); the Vercel projects are `vefumsjon-staging`, `demo-staging` and `labak-hub` (G6.1). Placeholders are in angle brackets: `<project-ref>` (the Supabase staging project's reference), `<team>` (Einar's Vercel team), `<hook-test-address>` and `<signup-test-address>` (throwaway addresses Einar controls, used only by the checks in sections 6 and 7), `<test-account-id>` (the id that section 7.2 part 1 prints; not secret).
- **Where the staging keys live (Einar's ruling, 2026-11-03, G3).** Einar ruled in chat (recorded in `docs/execution/gates.json`, G3): "Staging keys go in a separate file, /Users/einarzoega/litljomi-cms/.env.staging.local, which I create and fill myself. Don't swap `.env.local`. Point the runbook's scripts (their `ENV_FILE`) at the staging file, and keep the project-reference check. Record this change in the runbook." So the staging URL, publishable key and secret key are read from `.env.staging.local`: a separate file Einar creates and fills himself, git-ignored by `.env*`, never sourced and read-denied to agents like `.env.local`. `.env.local` keeps the local stack's values and is not swapped. The section 7.2 and G3.2c scripts (their `ENV_FILE`) and `tools/cli` (section 11) point at the staging file; the project-reference check (`EXPECT_REF`) is unchanged.
- **No secret, key or token value is ever written** to this repository, a commit, a chat message, a log or a report. Commands read staging secrets from `.env.staging.local` (never committed) without executing it, from a hidden prompt, or generate them and pipe them straight into the CLI that stores them; they never print them and never put them on a command line (sections 7.2, 11 and 12 show how). `.env.staging.local` (like `.env.local`) is **never sourced** (`. ./.env.staging.local`): that would run its lines as shell code in a shell that holds the secret key. See section 12.

**Off-limits.** `labak.is` and its DNS, FILMÍS, ISNIC, the hostnames `labak.litljomi.is` and `labak.is`, the LABAK repository's `main` branch, any production project, and the existing Vercel project `landssamband-bakarameistara`, **apart from the one build setting Einar changes himself** (G6.0). Nothing else in that project is changed, by anyone, under this runbook.

**The LABAK repository and Vercel (G6 and G7).** This paragraph is the one statement of this approval; other sections point here. The existing project `landssamband-bakarameistara` **is** connected to the LABAK repository and builds labak.litljomi.is from `main` (decision 43). So the Vercel GitHub app already has access to the LABAK repository through that project, and by default Vercel builds a preview deployment of every branch pushed there and posts deployment statuses on it. Connecting the new project `labak-hub` to the same repository (G6.1) lets a second project build and post statuses there; it still needs **Einar's explicit approval at G6 and at G7**, named as such, before the project is connected, and the controller records both. When approved, `labak-hub` builds `hub-integration` only (its Ignored Build Step, G6.1), and every deployment other than its production domain stays behind Vercel Authentication (G6.3).

**The existing project and `hub-integration`.** Without a safeguard, the first push of `hub-integration` would build a preview inside `landssamband-bakarameistara`, an off-limits project. So nothing is pushed to `hub-integration` until Einar has set, and confirmed to the controller, the Ignored Build Step of G6.0 on that project, which lets it build `main` only. That build setting is the one change anyone makes to `landssamband-bakarameistara`, and Einar makes it himself. G6.0 states the step, its check and its residual risk; G7.1 is the push.

## 2. Prerequisites

| # | Prerequisite | Owner | Verify |
|---|---|---|---|
| P1 | Tasks 0–27 complete and green locally (`pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test && pnpm db:reset && pnpm db:test && pnpm test:integration`) | Executor | Every command exits 0; the controller's `state.json` shows Tasks 0–27 done |
| P2 | Task 4's migration (creating `api`, `cms`, `private` and `private.passwordless_access_token`) and its `[api] schemas = ["api"]` are committed | Executor | `git log --oneline -- supabase/migrations` lists it; `grep -n 'schemas = \["api"\]' supabase/config.toml` matches |
| P3 | The LABAK branch `hub-integration` exists locally (Task 27, G7) and has **never been pushed**; it is pushed only at G7.1, after G6.0 | Controller | G7 recorded in `gates.json`; Task 27 done in `state.json`; the G6.0 confirmation recorded before G7.1 |
| P4 | Einar has accounts he controls at GitHub (`einar6969`, signed in to `gh` himself), Supabase, Vercel and SendGrid (his existing paid account, with litljomi.is already authenticated), and access to the litljomi.is DNS zone | Einar | Einar confirms in chat at each gate |
| P5 | The hosts each gate needs are allowed for the session, by the per-gate diff of section 1 ("Network"), approved by Einar and removed when the gate is done | Einar approves; controller applies | The approved diff is recorded; a sandbox refusal is reported, never worked around |
| P6 | Local tools: `git`, `gh`, `npm`, `supabase` (2.121.0, as in CI), `vercel`, `curl`, `jq`, `openssl`, `dig`, `shasum` | Einar (any install is G1) | `<tool> --version` for each |

## 3. Deployment sequence

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
| 12 | G3.5: check that no account exists, enable the passwordless hook, revoke all sessions, run the hook verification (section 7) | G3 | G3.2b, G3.4; **before any editor account exists** (`select count(*) from auth.users` → 0) |
| | **Sitting 2: G4, G5 and G6** | | |
| 13 | G4.1–G4.2: SendGrid restricted API key, Mail Send only | G4 | P4 |
| 14 | G5.1: read-only check of SendGrid's domain authentication for litljomi.is and its DMARC record; nothing added or changed | G5 | G4.1 |
| 15 | G3.6: custom SMTP (SendGrid) in Supabase Auth; the email rate limit | G3 (G4 credentials) | G4.2, G5.1 |
| 16 | G6.1: Vercel Pro (Einar), `vercel login` (Einar), Vercel's GitHub app given access to `litljomi-cms` (Einar); projects `vefumsjon-staging` and `demo-staging`; `labak-hub` created and configured but not built (connecting the LABAK repository needs the approvals in section 1) | G6 (and G7 for the LABAK repository) | G2.3, P3 |
| 17 | G5.2: the three CNAMEs in litljomi.is, added to the Vercel projects | G5 and G6 | G6.1 |
| 18 | G3.7: Auth Site URL and redirect URL for `vefumsjon-staging.litljomi.is`, the email templates | G3 | G5.2 |
| 19 | G6.2–G6.4 settings: environment variables (section 13, except each site's `CMS_WEBHOOK_SECRETS`, which P-2 sets), deployment protection, cron. Their live checks (G6.3's and G6.4's `curl` requests) run after G6.5 | G6 | G3.1, G5.2 |
| 20 | G6.5: deploy `vefumsjon-staging` and `demo-staging` (the demo site without `CMS_WEBHOOK_SECRETS`, on purpose); then G6.3's and G6.4's live checks. `labak-hub` is first built by the G7.1 push | G6 | G6.2–G6.4 settings |
| | **Sitting 3: the G7 push, Task 29 and C4** | | |
| 21 | G6.0: Einar sets the Ignored Build Step on `landssamband-bakarameistara` and confirms it to the controller | G7 (raised with the G7 push request) | none |
| 22 | G7.1: push `hub-integration` only (with the vendored SDK files of G2.5); `labak-hub` builds it; Einar checks that `landssamband-bakarameistara` built nothing for it | G7 (`push=true`, `hub-integration` only) | G6.0 confirmed, G2.5, G6.1 |
| 23 | P-1–P-3: Einar provisions the tenants, the sites (webhook secrets stored in Vault) and the staging editor `einsi@litljomi.is` with `tools/cli`; sets each site's `CMS_WEBHOOK_SECRETS` and the site is redeployed (P-2 verifies it) | G3 (hosted Supabase) and G6 (site variables); the controller confirms coverage before running | G3.6, G3.7, G6.5, G7.1 |
| 24 | G4.3: the staging editor's invitation arrives with SPF, DKIM and DMARC passing | G4 | P-3 |
| 25 | Section 7.2 hook verification again, then Task 29 (section 14) | none beyond those recorded | everything above |

## 4. G2: GitHub repository, and the SDK files for the LABAK branch

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
- **Settings:** `gh repo create einar6969/litljomi-cms --private --source /Users/einarzoega/litljomi-cms --remote origin`, **without `--push`** (confirm the flags at execution time against `gh repo create --help`).
- **Verify:** `gh repo view einar6969/litljomi-cms --json visibility -q .visibility` prints `PRIVATE`; `git -C /Users/einarzoega/litljomi-cms remote -v` shows only `origin` → `einar6969/litljomi-cms`.

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

### G3.1 Organisation and staging project
- **Owner:** Einar (account, organisation, project, database password); executor reads the result.
- **Settings:**
  - A **Free** organisation named "Litljómi" and a project named "staging" in **Central EU (Frankfurt) `eu-central-1`**. Pro comes with the production project (an approved deferral of §2.2, decision 42.4); the Custom Access Token hook is available on Free, so M1 staging does not depend on the plan.
  - The database password is set by Einar and kept in his password manager; it is typed only at the Supabase CLI's prompt (G3.2b) and never written anywhere else.
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
  cd /Users/einarzoega/litljomi-cms
  supabase login
  supabase link --project-ref <project-ref>
  supabase db push
  supabase migration list
  ```
  (`supabase login` opens the browser sign-in; `supabase link` asks for the database password; `supabase db push` lists the migrations it will apply and asks for confirmation. Confirm the prompts at execution time.) **Never `supabase config push`:** `supabase/config.toml` describes the local stack, so a push would send local-only values to staging (the localhost Site URL and redirect URLs, the local email rate limit, and no SMTP block), while the hosted Auth settings are set by hand (section 6); a push is also an Auth configuration change that makes section 7.2 due again.
- **Verify:** `supabase migration list` shows every local migration applied remotely (no row with a local version and an empty remote column). The executor, in the SQL editor: `select to_regprocedure('private.passwordless_access_token(jsonb)') is not null;` returns `true`.

**G3.2c Decision 36.7, after the push: the timeout applies to `service_role` requests over REST.**
Locally this is proven by `tests/integration/src/service-role-timeout.test.ts` (and the role setting by `supabase/tests/database/095_worker_phase3.test.sql`): a secret-key REST call made to wait on two locks in turn, each wait shorter than the login role `authenticator`'s 8-second `lock_timeout`, is cancelled at about 10 s with `57014`, which only `service_role`'s 10 s can do (the authenticator's own 8 s would cancel it at about 8 s, and with no timeout the second lock wait would end with `55P03`). That test refuses a hosted stack, so the hosted equivalent is the same measurement by hand, before any tenant, editor or deployment exists (nothing else uses the tables then):
- **Owner:** Einar, because the REST call needs the secret key (run like section 7.2) and the two SQL editor runs must start within seconds of it; the executor writes out the steps and reads back the results.
- **Settings and verify,** each statement on its own:
  1. **c1** (SQL editor): the role settings. Expected: `service_role` shows `statement_timeout=10s` (G3.2a); record what `authenticator` shows (locally `statement_timeout=8s` and `lock_timeout=8s`; confirm at execution time).
     ```sql
     select rolname, rolconfig from pg_roles where rolname in ('service_role', 'authenticator');
     ```
  2. **c2** (SQL editor, tab 1, started first): holds a lock on `cms.publish_requests` for 30 seconds.
     ```sql
     do $$ begin lock table cms.publish_requests in access exclusive mode; perform pg_sleep(30); end $$;
     ```
  3. **c3** (SQL editor, tab 2, started right after c2): holds a lock on `cms.tenants` for 7 seconds.
     ```sql
     do $$ begin lock table cms.tenants in access exclusive mode; perform pg_sleep(7); end $$;
     ```
  4. **c4** (Einar's terminal, started **within 4 seconds of c3**): the script below calls `api.worker_tenants_to_release()` (read only, no arguments, returns no secret) with the secret key. It waits on `cms.tenants` until c3 ends, then on `cms.publish_requests`, so the call as a whole passes 10 s while neither wait reaches 8 s. Einar copies it to `~/timeout-check.sh` and runs `EXPECT_REF='<project-ref>' bash ~/timeout-check.sh`. It reads `.env.staging.local` exactly as section 7.2 does (its `env_value` is an identical copy) and prints only the target, the HTTP code, the error code and the elapsed time.
     ```bash
     #!/usr/bin/env bash
     # G3.2c (decision 36.7): a secret-key REST call held on two locks. Run by Einar only. Never with
     # `bash -x` or `set -x`. Prints only the target host, the HTTP code, the error code and the time.
     set -eu
     ENV_FILE='/Users/einarzoega/litljomi-cms/.env.staging.local'
     REF_RE='^[a-z0-9]{20}$'; URL_RE='^https://[a-z0-9]{20}\.supabase\.co$'; KEY_RE='^[A-Za-z0-9._-]+$'

     # env_value NAME ERE: identical to section 7.2's copy; keep them identical (reads ENV_FILE without
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
- **Settings:** the section 6 rows whose Step is G3.4: self sign-up, email provider, other providers, confirm email, secure email change, secure password change, Email OTP Expiration, TOTP MFA and JWT expiry. The other rows belong to other steps: exposed schemas (G3.3) and the hook (G3.5) need the migrations of G3.2b first; custom SMTP and the email rate limit are G3.6; the Site URL, redirect URL and email templates are G3.7.
- **Verify:** as listed in section 6 for each of those rows.

### G3.5 Passwordless hook
- **Owner:** Executor (SQL editor and dashboard); Einar runs the section 7.2 scripts, which need the secret key. Einar is told the result before G3 continues.
- **Settings and verify:** Section 7.1 (check that no account exists, enable, revoke all sessions), then section 7.2 (verification). Runs before any editor account exists on the project: `select count(*) from auth.users;` returns `0` (section 7.1 step 0).

### G3.6 Custom SMTP (SendGrid) and the email rate limit
- **Owner:** **Einar** enters the SMTP settings himself (section 8: host, port, user, the API key as password, sender); the executor sets the rate limit (dashboard).
- **Settings:** Section 8's SMTP fields; Auth **Rate Limits** page: emails sent per hour raised from **30** (imposed once custom SMTP is enabled) to **100**. Reason: M1 staging sends only invitations and magic links for one staging editor, and acceptance runs repeat sign-ins; 30 per hour could block a test run, while 100 stays bounded. SendGrid's own plan limits still apply (Einar's existing plan; confirm at execution time). Einar may choose another value at G3; record the value used. This is the one statement of the value and its reason; sections 6 and 16 point here.
- **Verify:** the SMTP page shows custom SMTP enabled with the host, port, user, sender email and sender name of section 8 (password hidden; Einar reads them, or the executor in his signed-in session); the Rate Limits page shows 100 emails per hour; the end-to-end check is G4.3.

### G3.7 Site URL, redirect URL and email templates
- **Owner:** Executor (dashboard).
- **Settings:** Site URL `https://vefumsjon-staging.litljomi.is`; redirect URLs: exactly `https://vefumsjon-staging.litljomi.is/auth/confirm` (the CMS's `emailRedirectTo`, `${CMS_PUBLIC_URL}/auth/confirm`). No wildcard, no localhost (URL configuration page; confirm the menu path at execution time).
- **Email templates:** the four files in `supabase/templates/` (`magic_link.html`, `invite.html`, `email_change.html`, `reauthentication.html`) are uploaded to the hosted project's Auth email templates page, each with its subject from the matching `[auth.email.template.*]` block of `supabase/config.toml`, the HTML pasted unchanged (confirm the menu path at execution time). A hosted project does not read the local files, so without this step it sends Supabase's English defaults. In the templates, `{{ .SiteURL }}` is the Site URL above: magic links go to `https://vefumsjon-staging.litljomi.is/auth/confirm?token_hash=…&type=email` and invitations to the same page with `type=invite` (decision 41.1). That page verifies nothing until the editor presses its "Halda áfram" button, so the link works in any browser and a mail scanner opening it does not use it up. The magic-link mail carries the link only, no 6-digit code (`{{ .Token }}` is not in `magic_link.html`; decision 42.2), and says the link is valid for one hour, which the Email OTP Expiration of section 6 makes true: paste the current file, not an earlier copy.
- **Verify:** the URL configuration page shows those two values only; Einar's next section 7.2 part 1 run, with `EXPECT_REDIRECT='https://vefumsjon-staging.litljomi.is'`, asserts that the `generate_link` response's `redirect_to` field (the only field of it printed, never the action link) equals it. The email templates page shows the Icelandic subjects, and each template's link is as above (the magic link and invitation to `{{ .SiteURL }}/auth/confirm`), and the magic-link template shows no code; the end-to-end check is G4.3 and A11.

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
| Email provider | G3.4 | **On** (sign-in by email magic link, §4.4) | `[auth.email] enable_signup = true` | Decision 17: turning the provider off disables email sign-in | `/auth/v1/settings` → `"external": {"email": true, …}` |
| Other providers | G3.4 | All off: phone, anonymous, OAuth, SAML, WebAuthn/passkeys | defaults in `config.toml` | Decision 18: enabling any of them needs the hook's allowlist revisited | `/auth/v1/settings` → every other `external` entry `false` |
| Confirm email | G3.4 | **On** | `[auth.email] enable_confirmations = true` | Decision 19 | `/auth/v1/settings` → `"mailer_autoconfirm": false` |
| Secure email change (double confirmation) | G3.4 | **On** | `[auth.email] double_confirm_changes = true` | Decision 19: an email change needs both the old and the new address; with confirmations off it has no effect, so both stay on | The setting shows on; Task 29 item 11 checks the behaviour |
| Secure password change | G3.4 | **On**, set in the dashboard's Auth settings for the email provider ("Secure password change"; confirm the location at execution time). The dashboard is the executor's only route. If the dashboard does not offer the setting, stop and report: the other route, the Management API, needs a personal access token (a secret), so it is Einar's (below) | `[auth.email] secure_password_change = true` | Decision 21: additional protection, not a substitute for the hook | The dashboard shows the setting on, or Einar's Management API check below prints `true` (behaviour below); record which route was used |
| Email OTP Expiration | G3.4 | **3600** seconds (the email provider's settings; confirm the location at execution time) | `[auth.email] otp_expiry = 3600` | Decision 43: the magic-link mail says the link is valid for one hour | The dashboard shows 3600 (Einar reads it, or the executor in a browser session Einar signed in to himself); recorded in `m1-report.md` |
| TOTP MFA | G3.4 | Enrolment and verification **on** | `[auth.mfa.totp] enroll_enabled = true`, `verify_enabled = true` | §4.4: platform admins enrol TOTP; console needs `aal2` | The MFA settings show TOTP enabled |
| JWT expiry | G3.4 | **3600** seconds, recorded and kept | `[auth] jwt_expiry = 3600` | Decision 18: bounds how long a token issued before the hook stays valid | The setting shows 3600; in section 7.2 the magic-link response has `"expires_in": 3600`; value recorded in `m1-report.md` |
| Exposed schemas | G3.3 | `api` only | `[api] schemas = ["api"]` | Decision 16, §4.2 | G3.3 |
| Custom Access Token hook | G3.5 | **Enabled**, Postgres function `private.passwordless_access_token` | `[auth.hook.custom_access_token] enabled = true`, `uri = "pg-functions://postgres/private/passwordless_access_token"` | Decision 18 | Section 7 |
| Custom SMTP | G3.6 | SendGrid (section 8), entered by Einar | `[local_smtp]` (local mail catcher) | §4.4: the built-in sender delivers only to the team's addresses, about 2 an hour, not for production | G3.6, G4.3 |
| Email rate limit | G3.6 | The value G3.6 sets | `[auth.rate_limit] email_sent = 60` (decision 37.4) | Acceptance runs repeat sign-ins, and the post-SMTP default could block one (G3.6) | G3.6 |
| Site URL, redirect URLs | G3.7 | `https://vefumsjon-staging.litljomi.is`; `https://vefumsjon-staging.litljomi.is/auth/confirm` | `site_url`, `additional_redirect_urls` (`http://localhost:3100`, decisions 37.4 and 41.1) | Magic links land on the staging CMS only | G3.7 |
| Email templates | G3.7 | The four files of `supabase/templates/`, uploaded with their subjects; `{{ .SiteURL }}` is the staging CMS host, so magic links and invitations go to `https://vefumsjon-staging.litljomi.is/auth/confirm` | `[auth.email.template.*]` (`magic_link`, `invite`, `email_change`, `reauthentication`), files in `supabase/templates/` (Tasks 22 and 32) | §4.4; decision 41.1: the link works in any browser, and only the confirm page's button uses it | G3.7, G4.3 and A11 |

**Secure password change through the Management API (Einar only).** Used only if the dashboard does not offer the setting (the row above). The Management API (`PATCH /v1/projects/<project-ref>/config/auth`) needs a Supabase personal access token, a secret, so Einar runs it in his own terminal, never an agent. He creates a token for this step (Supabase account settings, Access Tokens; confirm at execution time) with the shortest expiry or the narrowest scope Supabase offers (a personal access token is probably account-wide, so a wrong project reference would change another project; confirm the options at execution time), and **revokes it whatever the outcome**, success or failure. `<field-name>` is the Management API's name for the setting, taken from Supabase's current Management API reference at execution time, never guessed. The token is typed or pasted at a hidden prompt (`read -rs`, no echo, nothing in shell history), lives in a variable of a subshell only, is never exported and never on a command line (curl reads its headers from a configuration on standard input, written by the builtin `printf`, as in section 7.2), and is unset at the end; if he pasted it, he clears the clipboard afterwards. `REF` is the staging project's reference, the same dashboard value Einar passes as `EXPECT_REF` in section 7.2; it is typed once, checked against `^[a-z0-9]{20}$`, used in both URLs and printed before anything is sent. The commands print only the target, an HTTP code and whether the setting is `true`:

```sh
(
  REF='<project-ref>'   # the dashboard value used for EXPECT_REF
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

Expected: the target line, `PATCH: 200`, then `true`. Anything else: stop and report, and **revoke the token anyway** (the response body is never printed, since the Auth configuration can hold secret settings). The check prints the comparison `== true`, never the field's raw value, on purpose: a wrong field name could otherwise print a secret setting, and the PATCH would have overwritten it with `true`; do not paste the output into chat. Einar revokes the token whatever the outcome and confirms it is gone from the Access Tokens list. It is an Auth configuration change: if it is made after section 7.1, section 7.2 is run again (section 7.2, "When to run it").

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
1. **Function present.** Owner: executor. Applied by G3.2b (`supabase db push`). Verify: G3.2b's `to_regprocedure` check returns `true`.
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

**Keeping secrets off command lines.** A command line is visible to every user of the machine (`ps`) and to process auditing; a pipe is not. So in both scripts curl reads its headers, URL and body as a configuration on standard input (`curl -q --config -`; `-q` first, so `~/.curlrc` is not read), written by `printf`, a shell builtin, so its arguments never become a program's command line; request bodies are built by `jq` from values it reads on standard input; responses stay in shell variables. The values read from `.env.staging.local` stay in the script's own shell variables and are never exported, so no process's environment holds them either. The secret key, the generated password, the token hash and the refresh token therefore never appear on any command line, and nothing is written to a file (pipes only: no temporary files and no here-documents). Never run the scripts with `bash -x` or `set -x`. They print only the target host, HTTP codes (or a curl error number), `true`/`false` results, `redirect_to` and the test account's id (not a secret).

**Reading `.env.staging.local` without executing it.** The scripts never source `.env.staging.local` (`. ./.env.staging.local` runs every line as shell code in a shell that holds the secret key, and a later duplicate line silently wins, which could send the key to another host). Each script reads only the names it needs, line by line, and refuses to send anything when:
- a name is assigned zero times or more than once, or not on a plain `NAME=value` line (an `export NAME=…` line or spaces around `=` count as assignments and are refused; comment lines are ignored);
- a value contains characters that cannot occur in it: `NEXT_PUBLIC_SUPABASE_URL` must be exactly `https://`, 20 lowercase letters or digits (the project reference) and `.supabase.co`, with nothing before or after; the keys may contain only letters, digits, `.`, `_` and `-` (this also keeps quotes, spaces, `$`, `%`, `\` and a stray carriage return out of the curl configuration);
- the URL is not the staging project's: Einar passes the project reference as `EXPECT_REF`, taken from his Supabase dashboard (or his own records), never from a repository file (the value recorded at G3.1 in `docs/verification/m1-report.md` is for the record only), and the URL must be `https://$EXPECT_REF.supabase.co`.

A refusal prints a `FAILED:` line naming the variable, never its value. Before its first request, each script prints the target host (`target: <project-ref>.supabase.co`). A local-stack URL (for example `http://127.0.0.1:54321`, as `.env.local` holds for local work) is refused, so the checks can never run against, or delete an account on, the local stack by mistake; the scripts read the separate file `.env.staging.local`, which holds the staging values, and `.env.local` is not swapped (Einar's ruling, section 1). **Confirm at execution time** that the staging project's reference has 20 characters and that the publishable and secret keys contain only the characters above. If the hosted URL or a key has another shape, stop and report; do not loosen the check.

**How Einar runs them.** He copies each script, as shown, into a file outside the repository (the scripts hold no secret; for example `~/hook-check-1.sh` and `~/hook-check-2.sh`) and runs it with `bash`. The scripts read `/Users/einarzoega/litljomi-cms/.env.staging.local` by its full path, so the directory he runs them from does not matter; nothing is loaded into his interactive shell:

```sh
EXPECT_REF='<project-ref>' EXPECT_REDIRECT='https://vefumsjon-staging.litljomi.is' bash ~/hook-check-1.sh
EXPECT_REF='<project-ref>' bash ~/hook-check-2.sh '<test-account-id>'
```

Before G3.7 is done, leave out `EXPECT_REDIRECT=…`; part 1 then prints `redirect_to` without asserting it. Confirm at execution time that the hosted Auth admin endpoints accept the secret key in the `apikey` and `Authorization` headers as below.

**Part 1 (H3, H4).** It creates the test account and **does not delete it**. It checks every expected result and exits non-zero on any mismatch; a curl transport error or a failed sign-in is a mismatch too, so every failure ends with the `FAILED:` line and its hint.

```bash
#!/usr/bin/env bash
# Section 7.2, part 1 (H3, H4). Run by Einar only. Never with `bash -x` or `set -x`.
# Prints only the target host, HTTP codes, true/false results, redirect_to and the test account's id.
set -eu
ENV_FILE='/Users/einarzoega/litljomi-cms/.env.staging.local'
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
PK="$(env_value NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$KEY_RE")"
SK="$(env_value SUPABASE_SECRET_KEY "$KEY_RE")"
if [ "$URL" != "https://$REF.supabase.co" ]; then
  echo "FAILED: .env.staging.local points at ${URL#https://}, not $REF.supabase.co; nothing was sent" >&2; exit 1
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
ENV_FILE='/Users/einarzoega/litljomi-cms/.env.staging.local'
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
    echo "FAILED: $1 must be on exactly one plain $1=value line in .env.staging.local (found $n); nothing was sent" >&2
    return 1
  fi
  if ! [[ $value =~ $allowed ]]; then
    echo "FAILED: $1 in .env.staging.local has an unexpected form (value not shown); nothing was sent" >&2; return 1
  fi
  printf '%s' "$value"
}

USER_ID="${1:-}"
case "$USER_ID" in
  '' | *[!0-9a-f-]*) echo 'FAILED: usage: bash hook-check-2.sh <test-account-id>; nothing was sent' >&2; exit 1 ;;
esac
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

## 8. Email delivery through SendGrid (G4)

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

## 11. Tenants, sites and the staging editor (Task 28 Step 5)

The tool is `provision` in `tools/cli` (decision 44.2; written `provision` throughout this runbook). It reads the staging URL and secret key from Einar's staging file (`/Users/einarzoega/litljomi-cms/.env.staging.local`, never committed; section 1), so **Einar runs every `provision` command** in his own terminal, from the repository root (`/Users/einarzoega/litljomi-cms`); the executor prepares the exact commands (no secret in them) and runs the SQL checks. Run after G3.6, G3.7, G6.5 and G7.1.

**Standard order for any new tenant (decision 45.1):** provision (P-1 to P-3), publish once in the CMS, then deploy the site. The SDK fails a site's build while its tenant has no release (`current.json` 400), and it keeps doing so on purpose: a missing release is never treated as empty content.

**What the tool does and refuses.** It reads `.env.staging.local` as text, never executing it, with section 7.2's `env_value` rules (`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` each exactly once on a plain `NAME=value` line, `export` lines and spaces around `=` refused, the same value patterns; a refusal names the variable, never its value). `--expect-ref '<project-ref>'` is required, and the URL must be `https://<project-ref>.supabase.co`; any other host, the local stack included, is refused. It prints the target host (`target: <project-ref>.supabase.co`) before its first request, sends requests only to that origin with the key in headers only, follows no redirect, and prints only ids and statuses; a server error is shown as its HTTP status and the error's code and message only. `--env-file=<absolute path>` (equals form; a separate `--env-file <path>` is swallowed by vite-node when run through `pnpm … cli`) reads another file (not needed here). `--silent` stops pnpm adding its own `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` block after a failure; the tool's own output and exit code are unchanged. Exit codes: `0` done, `1` refused or failed, `2` wrong arguments. **Never trust the exit code alone:** a run succeeded only if it printed its result line (`tenant <slug>: <tenant-id>`, `site: <site-id>`, `membership <tenant-id>: ok`). Under vite-node an early exit once ended `provision site` after `target: …` with exit code `0` and nothing created, which let a chained `&& vercel env add …` run (fixed: stdin is read synchronously, and the exit code is `1` until the tool returns). Chaining the Vercel step with `&&` stays allowed, but `site: <site-id>` must be printed before the Vercel step is trusted; without it, treat the run as failed whatever the exit code. Every command below is one line; `<project-ref>` is the staging project's reference, from Einar's Supabase dashboard, as for section 7.2.

- **P-1 Tenants.** Owner: Einar; the executor verifies.
  ```sh
  pnpm --silent --filter @litljomi/cli cli provision tenant labak --name 'Landssamband bakarameistara' --expect-ref '<project-ref>'
  pnpm --silent --filter @litljomi/cli cli provision tenant demo --name 'Demo' --expect-ref '<project-ref>'
  ```
  Each prints `tenant <slug>: <tenant-id>`; Einar keeps the two ids for P-2 and P-3 (`<labak-tenant-id>`, `<demo-tenant-id>`; not secret). A re-run for an existing slug refuses (`FAILED: tenant <slug> already exists (slug_taken); nothing was created`) and creates nothing. Verify: SQL editor `select slug from cms.tenants order by slug;` lists `demo` and `labak` (confirm the table and column names against the migrations at execution time).
- **P-2 Sites.** Owner: Einar (the CLI and the webhook secret); the executor verifies. `provision site` once per staging site: base URL `https://demo-staging.litljomi.is` (tenant `demo`) or `https://labak-hub.litljomi.is` (tenant `labak`), and the site's revalidate route (`/api/cms/revalidate` on the demo site; the LABAK branch's route, confirm at execution time). The tool reads the webhook secret from **standard input only** (it refuses a terminal or empty input, and never takes the secret as an argument or environment variable; one trailing newline is removed; the secret must be 32–256 printable characters with no spaces or commas, since `CMS_WEBHOOK_SECRETS` is comma-separated), sets the revalidate URL to base URL plus route and the preview URL to the optional `--preview-url` (https, or http only to a loopback host; none when left out, and `provision preview-url --site-id <id> --preview-url (<url> | none)` sets, replaces or clears it later), and prints `site: <site-id>`. The secret is stored in Supabase Vault (`api.admin_create_site` keeps only its ID), and the same value becomes that site's `CMS_WEBHOOK_SECRETS` (set here, not in G6.2); the site is then redeployed. Before creating, the tool reads the tenant's active sites (`api.worker_sites`, id and base URL only) and refuses a base URL the tenant already has (`FAILED: tenant <id> already has a site at <base-url> (site <id>); nothing was created`), so a re-run creates no duplicate. **Carrying the secret without a file, the clipboard or shell history**, in one terminal session per site, from the repository root:
  ```sh
  SITE_PROJECT='<site-project>'   # set once per site, next to its base URL: demo-staging for https://demo-staging.litljomi.is, labak-hub for https://labak-hub.litljomi.is
  WEBHOOK_SECRET="$(openssl rand -base64 32)"          # never echoed; the command lines hold only the variable's name
  printf '%s' "$WEBHOOK_SECRET" \
    | pnpm --silent --filter @litljomi/cli cli provision site --tenant-id '<tenant-id>' --base-url 'https://'"$SITE_PROJECT"'.litljomi.is' --revalidate-path '<revalidate-route>' --expect-ref '<project-ref>'
  printf '%s' "$WEBHOOK_SECRET" \
    | vercel env add CMS_WEBHOOK_SECRETS production --cwd ~/vercel-link/"$SITE_PROJECT"
  unset WEBHOOK_SECRET SITE_PROJECT
  ```
  `<tenant-id>` is `<demo-tenant-id>` with `demo-staging`, and `<labak-tenant-id>` with `labak-hub` (P-1). Both pipes carry the same generated secret, entered by Einar; the base URL is built from `SITE_PROJECT`, so the site, its tenant and its Vercel project are set together (the two staging hostnames equal their project names). Run the `vercel env add` line only if `provision site` printed `site: <site-id>`; if it refused or failed, run `unset WEBHOOK_SECRET SITE_PROJECT` and start again. `vercel env add` reads the value from stdin when piped (confirm at execution time, and mark it sensitive if the CLI offers it); if it cannot, stop: Einar decides how the value is entered without a file, and the choice is recorded. To enter an existing value instead of generating one (for example during rotation), `read -rs WEBHOOK_SECRET` reads it without echo. **Re-running P-2 when the site's `CMS_WEBHOOK_SECRETS` already exists on Vercel** (for example after a run that printed no `site: <site-id>` but whose Vercel step ran): the new `provision site` run generates a new secret, so Vercel's value must be replaced with it, in the same session and still only through the pipe, never printed: once `site: <site-id>` is printed, run `printf '%s' "$WEBHOOK_SECRET" | vercel env add CMS_WEBHOOK_SECRETS production --sensitive --force --cwd ~/vercel-link/"$SITE_PROJECT"` in place of the plain `vercel env add` line (confirm the overwrite flag with `vercel env add --help` at execution time; Einar runs it), then redeploy the site. Verify: `select count(*) from vault.secrets;` increased by one per site (never select decrypted values); `vercel env ls production --cwd ~/vercel-link/<site-project>` now lists section 13's names for that site (G6.2's list plus `CMS_WEBHOOK_SECRETS`); the site's redeployment is Ready.
- **P-3 The staging editor.** Owner: Einar; the executor verifies. **`einsi@litljomi.is`**, an editor of `labak` and of `demo` (decision 44.2), in one command:
  ```sh
  pnpm --silent --filter @litljomi/cli cli provision editor --email einsi@litljomi.is --tenant-id '<labak-tenant-id>' --tenant-id '<demo-tenant-id>' --expect-ref '<project-ref>'
  ```
  It sends one Auth admin invitation (Supabase's invitation email, the Icelandic template of G3.7, whose link is `{{ .SiteURL }}/auth/confirm?…&type=invite`, so no redirect is passed), prints `invited einsi@litljomi.is: user <user-id>`, then adds one membership per tenant (`api.admin_add_membership`, idempotent) and prints `membership <tenant-id>: ok` for each. If a membership fails after the invitation, it prints the user id, exactly which tenant ids are still missing and the command that finishes them (`provision editor --user-id <user-id> --tenant-id <missing-id> … --expect-ref '<project-ref>'`, run the same way as above), and exits `1`; Einar runs that command. If a user with that email already exists and has not confirmed the invitation, Auth re-sends the invitation (HTTP 200) and the memberships are added; no second user is created (confirm at execution time). If the existing user has confirmed, the tool refuses the invitation, changes nothing and says so, pointing to `--user-id <user-id>` in place of `--email` to add the memberships. Nobody else is invited or given access in M1 (decision 43.9). Verify: `select t.slug from cms.memberships m join cms.tenants t on t.id = m.tenant_id join auth.users u on u.id = m.user_id where u.email = 'einsi@litljomi.is' order by t.slug;` lists `demo` and `labak` (confirm the table names against the migrations at execution time), and `select count(*) from auth.users;` returns `1`; then G4.3.
- **Record** every created resource (names, regions, domains, project references; no secrets) in `docs/verification/m1-report.md` (Task 28 Step 6) and in the undo table (section 1). Owner: executor. Verify: `git grep -nE 'sb_(secret|publishable)_[A-Za-z0-9]|eyJ[A-Za-z0-9_-]{10,}' -- docs/verification/m1-report.md docs/verification/m1-gates.md` finds nothing.

## 12. Secrets

No secret is ever committed, logged, printed in an agent session, pasted into chat or written into a report. `.env*` files other than `.env.example` are never committed, and `.env.local` and `.env.staging.local` are never sourced (section 7.2, "Reading `.env.staging.local` without executing it"). The executor never reveals a secret value in the dashboard or the SQL editor and runs only the queries this runbook gives (section 1). Every staging secret is **fresh**, created for staging only. Rotation: the SDK accepts two webhook secrets during rotation (§8.2).

**Generating and storing the CMS secrets (G6.2).** Einar, in his own terminal, once per secret, generates the value and pipes it straight into the CLI, so it is never printed, never in a file, the clipboard or shell history, and never on a command line:

```sh
openssl rand -base64 32 | vercel env add CRON_SECRET production --cwd ~/vercel-link/vefumsjon-staging
openssl rand -base64 32 | vercel env add CMS_INTERNAL_SECRET production --cwd ~/vercel-link/vefumsjon-staging
```

Mark each sensitive if the CLI offers it (for example a `--sensitive` flag; confirm the flags at execution time with `vercel env add --help`). If `vercel env add` cannot read a piped value, stop: Einar decides, as in P-2. Nobody needs to know these values: Vercel sends `CRON_SECRET` to the cron route itself, and the CMS sends `CMS_INTERNAL_SECRET` to itself. `SUPABASE_SECRET_KEY` is entered by Einar the same way, from the Supabase API keys page, at `vercel env add`'s own prompt (or in the dashboard), never on a command line.

| Secret | Created where | Stored where | Who may read it |
|---|---|---|---|
| Supabase secret key | Supabase project API keys (G3.1) | `vefumsjon-staging` server environment (`SUPABASE_SECRET_KEY`, entered by Einar); Einar's `.env.staging.local` for `tools/cli`, the section 7.2 and G3.2c scripts, and Task 29's automated sign-in | Code under `apps/cms/src/privileged/**` and `tools/cli` only (lint-enforced); in operation, only Einar's own terminal, never an agent session. Never in client bundles, sites or module code |
| Internal worker-trigger secret | Generated fresh, 32 random bytes, piped into `vercel env add` by Einar (above) | `vefumsjon-staging` (`CMS_INTERNAL_SECRET`) | The CMS server: the trigger and `verifyInternalSecret` |
| Cron secret | Generated fresh, 32 random bytes, piped into `vercel env add` by Einar (above) | `vefumsjon-staging` (`CRON_SECRET`) | Vercel Cron (sends it) and `verifyCronSecret` |
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

The same set as `.env.example` (`tools/checks/__tests__/env-example.test.ts` checks that the first column of this table and the `NAME=` lines of `.env.example` match both ways). Values are set per Vercel project (G6.2) and, for local work, in `.env.local` (the local stack's values); the staging values that `tools/cli` and the section 7.2 scripts read are in `.env.staging.local` (section 1).

| Variable | Used by | Secret | Value and where it comes from | Set on |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | CMS app; `tools/cli` locally | No (public) | `https://<project-ref>.supabase.co`, the project URL on the API settings page (confirm at execution time) | `vefumsjon-staging`; `.env.staging.local` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | CMS app (browser and server) | No (public by design; RLS and grants protect data) | The project's publishable key (API keys page) | `vefumsjon-staging`; `.env.staging.local` |
| `SUPABASE_SECRET_KEY` | `apps/cms/src/privileged/**`, `tools/cli` | **Yes** | The project's secret key (API keys page); entered by Einar (section 12) | `vefumsjon-staging`; Einar's `.env.staging.local` |
| `CMS_INTERNAL_SECRET` | CMS app (worker trigger, header `x-cms-internal-secret`) | **Yes** | 32 random bytes, generated and piped into the CLI by Einar (section 12) | `vefumsjon-staging` |
| `CRON_SECRET` | CMS app (`/api/cron/sweep`), Vercel Cron | **Yes** | 32 random bytes, generated and piped into the CLI by Einar (section 12) | `vefumsjon-staging` |
| `CMS_PUBLIC_URL` | CMS app (worker trigger URL, magic-link redirect) | No | `https://vefumsjon-staging.litljomi.is` | `vefumsjon-staging` |
| `CMS_ALERT_SMTP_HOST` | CMS app (`privileged/worker/alert-email.ts`, alert emails, plan M3-04) | No | `smtp.sendgrid.net` (SendGrid, decision 50.5). Unset: no alert email (alerts stay in the server log and the audit log) | `vefumsjon-staging` (M3 local acceptance step 8) |
| `CMS_ALERT_SMTP_PORT` | CMS app (alert emails) | No | `587` (STARTTLS, required for any non-loopback host); `465` for implicit TLS. Default `587` | `vefumsjon-staging` |
| `CMS_ALERT_SMTP_USER` | CMS app (alert emails) | No | `apikey` (SendGrid's SMTP user name) | `vefumsjon-staging` |
| `CMS_ALERT_SMTP_PASSWORD` | CMS app (alert emails) | **Yes** | A SendGrid API key with Mail Send only; entered by Einar (section 12) | `vefumsjon-staging` |
| `CMS_ALERT_EMAIL_FROM` | CMS app (alert emails) | No | A sender verified in SendGrid for litljomi.is (confirm at execution time) | `vefumsjon-staging` |
| `CMS_ALERT_EMAIL_TO` | CMS app (alert emails) | No | The platform admin's address(es), comma-separated | `vefumsjon-staging` |
| `CMS_DELIVERY_BASE_URL` | Sites (SDK release reading) | No | Public URL of the `delivery` bucket, as Storage shows it (expected `https://<project-ref>.supabase.co/storage/v1/object/public/delivery`; confirm at execution time) | `demo-staging`, `labak-hub` |
| `CMS_TENANT` | Sites | No | The site's tenant slug: `demo` or `labak` | `demo-staging` (`demo`), `labak-hub` (`labak`) |
| `CMS_WEBHOOK_SECRETS` | Sites (revalidation route) | **Yes** | The site's webhook secret from P-2; two, comma-separated, during rotation; entered by Einar | Each site project, its own secret only |
| `CMS_PREVIEW_SECRETS` | Demo site (preview route) | **Yes** | The site's preview secrets, comma-separated; the same value is stored in Vault with `provision preview-secret` (section 12); entered by Einar | `demo-staging`, its own secret only |
| `CMS_PREVIEW_BASE_URL` | Demo site (preview endpoint; read only in draft mode) | No | The CMS origin: `https://vefumsjon-staging.litljomi.is` | `demo-staging` |
| `CMS_MEDIA_HOST` | Sites (`next/image` `remotePatterns`) | No | The host of `media-public` public URLs (expected `<project-ref>.supabase.co`; confirm at execution time) | `demo-staging`, `labak-hub` |
| `SITE_NOINDEX` | The LABAK branch (`hub-integration`): sends `X-Robots-Tag: noindex` when `1` | No | `1` | `labak-hub` only (the CMS and the demo site send the header from their `vercel.json`; LABAK's `main` and `landssamband-bakarameistara` never get it) |

Sites hold no Supabase credentials and no API URL (§8.1): they read only public Storage files (`delivery`, `media-public`) and receive signed webhooks.

## 14. Validation procedures (Task 29)

Before Task 29, run the full local suite (Task 29 Step 1) and the hook verification (section 7.2). Task 29 then runs `apps/cms/e2e/m1-acceptance.spec.ts` against staging, one test per M1 criterion of spec §13.2 (Task 29 items 1–11; section 1 explains the numbering), and writes the results to **`docs/verification/m1-report.md`**: each criterion pass or fail with evidence (commands, request IDs, timestamps, screenshots at 375, 768 and 1440 px), each validation gate with its result, and every known limitation.

**Who runs what (decision 43.1 and 43.9).**
- **Einar runs every browser test** (`pnpm --filter cms e2e …` and the staging acceptance spec) in his own terminal, from **one exact command** the controller gives him, and pastes the output back; the controller reads it. Agents do not run browser tests.
- **Automated sign-in** uses the Auth admin `generateLink` route with the staging secret key from Einar's environment only (his `.env.staging.local` or his shell; never printed, never committed, never in an agent session), which is one more reason the spec runs in his terminal.
- **The staging account** is `einsi@litljomi.is`, an editor of both `labak` and `demo` (P-3). No other editor, and no access for anyone else in M1.
- **On staging, prove A6, A7, A8, A11 and A15**, and **re-run A1–A4 against hosted Supabase** with `boundary-check` (below, decision 46). It replaces re-running the integration suite's `http-boundary.test.ts` and `storage-boundary.test.ts`, which need the local seed and owner SQL; the local suite keeps refusing a hosted URL.
- **Einar's manual check:** request a magic link on his laptop, open it on his phone, press "Halda áfram", publish a test article from the phone, and see it on `https://labak-hub.litljomi.is`.

| What Task 29 checks | Depends on (this runbook) | Gate |
|---|---|---|
| Magic-link sign-in delivered by custom SMTP (SendGrid) with Icelandic templates | Section 8, G3.6, G5.1 | A11 |
| Publish reaches "Birt á vef ✓" on `labak-hub.litljomi.is` within 60 s | G6.3, G7.1, P-2 | A7, A15 |
| Image public only after publish; republish moves Live; unpublish passes every `absent` check | Section 11 | — |
| Isolation both ways through the API and storage, and A2–A3 with them (`boundary-check`, below; decision 46) | G3.2, G3.3, P-1, a delivered release per tenant | A1–A4 |
| Malformed RPC never committed; stale save rejected; changed draft `superseded` | G3.2 | — |
| With the CMS deployment paused, both sites keep serving (Einar pauses it or approves pausing, G6) | G6.5, G7.1 | — |
| `current.json` overwritten and polled: new release within about a minute | `CMS_DELIVERY_BASE_URL` | A6 |
| Cron log shows the sweep every minute for 10 minutes | G6.4 | A8 |
| Passwordless and email change: hook enabled; password sign-in 403; magic link works; no `password` row in `auth.mfa_amr_claims`; an email change needs both addresses | Sections 6 and 7 | Decisions 18, 19 (Task 29 item 11) |
| The phone check: link requested on the laptop, opened on the phone, "Halda áfram", article published from the phone and seen on `labak-hub.litljomi.is` | Sections 8 and 11 | Einar's manual check |

Each run's secrets come from Einar's local environment only; the report records results, never values.

### A1–A4 on staging: `boundary-check` (decision 46)

**Owner:** Einar, in his own terminal, from the repository root (it reads the secret key); the controller reads the output he pastes back. One line:

```sh
pnpm --silent --filter @litljomi/cli cli boundary-check --labak-tenant-id e9e5badd-375f-485a-a249-c47469d49e15 --demo-tenant-id 02ed0155-2bfc-44ce-99d3-e904e0a0d491 --expect-ref rwpgpfsmhhtimauvpoyt
```

It is `provision`'s sibling and has the same safety rules (section 11, "What the tool does and refuses"): `.env.staging.local` read as text, never executed, with the `env_value` rules, now also for `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (used for the anon and editor requests); `--expect-ref` required; HTTP only, to `https://<project-ref>.supabase.co` only, keys and tokens in headers only, no redirect followed; no database connection and no SQL. It prints no key, token, link or response body, only statuses, error codes and messages, and ids.

**Setup, before any check.** If a setup step fails, the tool prints `FAILED: setup: …`, runs no checks and prints no `RESULT` line.
1. It confirms, read-only (`api.worker_previous_release` with the secret key), that each tenant id is the tenant its flag names, from the slug in its latest release's bundle path. Swapped ids, or a tenant with no delivered release, are refused before anything is created or changed.
2. It finds or creates the two test editors, `einsi+a-labak@litljomi.is` and `einsi+a-demo@litljomi.is`, through the Auth admin API: created confirmed (`email_confirm`), with no password and no invitation, so no email is sent. An existing user is reused.
3. It gives each a session through `generate_link` and the hashed token's verification (as in section 7.2, H4; no email).
4. It adds the one membership (`api.admin_add_membership`, idempotent). It refuses to go on if a test editor is a member of any other tenant (`api.my_tenants`).

**Checks, one line each:**
- **A1:** schemas `cms`, `private`, `public` and `graphql_public` refused (406 `PGRST106`) for anon, each editor and the secret key, both as a table read (`Accept-Profile`) and as an RPC (`Content-Profile`). GraphQL is refused for anon and each editor.
- **A2:** each editor creates, or reuses (found by the title "A1–A4 grensupróf (prófun)"), one draft in its own tenant (`news` in `labak`, `event` in `demo`) and saves it. Creating an entry in, or saving the draft of, the other tenant is refused (`P0001 not_found`). Its `api.entry_list` shows no row of another tenant.
- **A3:** `api.worker_previous_release` succeeds with the secret key and is refused (`42501`) for anon and each editor. It is read-only, and unlike `worker_sites` it returns no secret.
- **A4:** each editor uploads, or finds and downloads, its own 14-byte JPEG at `media-private/<tenant-id>/<fixed id>/a.jpg` and reads it back. "Already existed" counts only after a download with the same bytes, and the line says so. Refused: an upload into the other tenant's prefix; reading the other tenant's test object; an upsert or update of its own object (it is then downloaded again, unchanged); a delete of its own object (still there afterwards); any upload to `media-public` or `delivery`. The refused writes use fresh paths each run, so an earlier object can never make a refusal look like a pass. The secret key is never used for a storage write or delete.

**What it leaves on staging:** two users with one membership each, two drafts titled "A1–A4 grensupróf (prófun)", and two 14-byte objects in `media-private`. These drafts show in the CMS lists ("Fréttir" for `labak`, "Events" for `demo`): never publish them. Each run saves the drafts once more, so their version goes up. Nothing is ever deleted; these leftovers cannot be removed without SQL and are removed only with the production cut-over.

**Reading the output:** `target: <project-ref>.supabase.co` first, then one line per check: `PASS <gate> <description> (<observed status and code>)` or `FAIL <gate> <description> (observed …, expected …)`. A transport error fails only its own check. After the checks come the test user ids and the entry and object ids, marked created or reused, and last `RESULT: <n> passed, <m> failed`. **A run passed only if it printed `RESULT: <n> passed, 0 failed`** (71 checks today). As for `provision`, never trust the exit code alone (`0` all passed, `1` refused or any check failed, `2` wrong arguments). Record the run (date, the RESULT line, any FAIL lines, the ids) in `docs/verification/m1-report.md`.

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
- `landssamband-bakarameistara` stays connected to the LABAK repository: with G6.0's Ignored Build Step it builds nothing for `hub-integration`, but it may still list a skipped or cancelled deployment and post a commit status on that branch (G6.0).
- `noindex` is a header only (`X-Robots-Tag`); it asks search engines not to index the staging hosts, it does not keep anyone out.
- Withdrawal from third-party caches is best-effort, and M1 has no fallback rule for failed entries (Task 29 reports both).

## 16. Open items

| Item | Owner | When |
|---|---|---|
| Per-site preview secret: **resolved by M3**. Decision 43.1 asks for one; it is created with `provision preview-secret` and stored in Vault and in the site's `CMS_PREVIEW_SECRETS` (sections 12 and 13) | Controller | Done |
| Who enters secret values: Einar, so no secret passes through an agent session (sections 1 and 12) | Einar confirms | G3, G6 |
| Steps that need the secret key or another secret value are Einar's (section 1), including the section 7.2 and G3.2c scripts, every `provision` command, the secrets of section 12 and section 6's Management API route | Einar confirms | G3 |
| Task 29's re-run of A1–A4 against hosted Supabase: the integration suite (`tests/integration/src/env.ts`) refuses any non-loopback stack. **Decided** (decision 46): `boundary-check` in `tools/cli` (section 14), run by Einar in his own terminal | Einar approved ("Approve adapter") | Done; run before Task 29's report |
| The LABAK repository and Vercel: the approvals to connect it to `labak-hub` (section 1), and Einar's confirmation of G6.0's Ignored Build Step before G7.1 | Einar approves and confirms; controller raises | G6; the G7 push request |
| `deny` rules for agents on `.env`, `.env.local` and `.env.staging.local`: **done**. Edit and Write denies for `.env` and `.env.local` (diff B, Einar 2026-11-03, `0bfb23f`); Read, Edit and Write denies for `.env.staging.local` (diff D, Einar 2026-11-03, `6504caf`), applied before Einar created the file | Einar approved | Done |
| `ask` rules for risky hosted Supabase commands (`supabase config push`, `supabase db reset --linked`, `supabase migration repair`): today the project settings have no `ask` rule for them, so G3.2b's "never `supabase config push`" is behavioural only; adding the rules is a `.claude/**` change for Einar to approve | Controller raises with Einar | Before G3 |
| The email rate limit value (G3.6) | Einar confirms | G3 |
| SMTP credentials in the CMS environment (§8.2): no M1 code needs them, so no variable is defined; to be named when code that sends email is planned | Controller raises with Einar | When such code is planned |
| GitHub Packages for `@litljomi/*` (a `litljomi` GitHub organisation) replaces the vendored files of G2.5 | Einar | When a second site arrives (§9.1) |
| Recurring automation of the hook verification (decision 20) | Einar, by a separate decision | Task 28 or later |
| Optional staging check of the 24-hour secure-password-change path (needs a session's `created_at` moved back in `auth.sessions`, as in the local verification) | Einar decides | G3 |
| The production Supabase project (and the organisation's move to Pro, §2.2) and `cms.litljomi.is` (spec §13) are outside this staging runbook | Controller raises with Einar | After M1 |
