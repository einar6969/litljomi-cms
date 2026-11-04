# M1 validation gates: evidence

Status lives in `docs/execution/state.json` (`node tools/harness/state.mjs show`). This file holds the evidence, newest section last.

## V-SANDBOX re-check for Docker and localhost (Task 2, 2026-11-01)

Original result (Task 0): pass, evidence in `docs/execution/environment.md`.

**Before the change** (sandboxed, OrbStack installed and running, Docker 29.8.2, context `orbstack`):
- `docker version` → `permission denied while trying to connect to the docker API at unix:///Users/einarzoega/.orbstack/run/docker.sock`
- Node `net.connect(…, '127.0.0.1')` → `EPERM`; `net.createServer().listen(0, '127.0.0.1')` → `EPERM`
- `supabase --version` → `EPERM … open '/Users/einarzoega/.supabase/telemetry.json.tmp…'`; with `SUPABASE_TELEMETRY_DISABLED=1` → `2.121.0` (no settings change needed for this)

**Change** (`.claude/settings.json`, approved by Einar in chat on 2026-11-01: "I approve the exact proposed `.claude/settings.json` change for Task 2 … This approval is specifically for running the local Supabase stack and its tests, not for unrelated container operations or access to other projects."):

```diff
     "network": {
-      "allowedDomains": ["registry.npmjs.org"]
+      "allowedDomains": ["registry.npmjs.org"],
+      "allowUnixSockets": [
+        "/Users/einarzoega/.orbstack/run/docker.sock",
+        "/var/run/docker.sock"
+      ],
+      "allowLocalBinding": true
     }
```

**After the change** (sandboxed):
- `docker info` → `server=29.8.2 os=OrbStack arch=aarch64`, exit 0
- loopback listen and connect on `127.0.0.1` → ok
- outside host still blocked: `net.connect(443, '1.1.1.1')` → `EPERM`
- throwaway project in the scratchpad: `supabase init` exit 0; `supabase start` exit 0 (images pulled by the OrbStack daemon, about 2 min 40 s first run); `supabase db reset` exit 0 (CLI → Postgres on 127.0.0.1:54322); `supabase stop --no-backup` exit 0, no containers left
- no further sandbox refusals

**Result: pass**, with these known limitations:
- Docker socket access lets a sandboxed command start containers that mount host folders shared by OrbStack (the home directory by default), so the sandbox's filesystem boundary does not hold for Docker-mediated actions. Einar accepted this for running the local Supabase stack and its tests only; agents use Docker only through the `pnpm db:*` scripts and the Supabase CLI.
- `allowLocalBinding` allows connections to any service on this Mac's loopback, not only Supabase.
- The Supabase CLI must run with `SUPABASE_TELEMETRY_DISABLED=1` (it otherwise writes to `~/.supabase`, outside the sandbox).

## Plan defect found in pre-flight (Task 2, 2026-11-01)

With the plan's `[api] schemas = ["api"]`, `supabase start` fails before Task 4 creates `api`: PostgREST logs `schema "api" does not exist` (3F000) and the health check ends `HealthCheckTimeoutError … supabase_rest_… unexpected status 503`. With `schemas = []`, `supabase start` and `supabase db reset` succeed. Task 4's Step 2 expects the stack to run before `api` exists. Reported to Einar for a decision.

Decision (Einar, 2026-11-01: "I approve Option A: temporarily expose no application schemas until Task 4 creates `api`."): Task 2 sets `[api] schemas = []` as a temporary bootstrap value; Task 4 creates `api`, `cms` and `private`, sets `["api"]` in the same commit, and verifies that the API works and that `cms` and `private` stay unexposed. Recorded as implementation-level decision 16 in the plan (sequencing, not architecture).

## V-HELPERS (Task 2, 2026-11-01)

Assumption: `supabase test db` runs files that include a shared helper file with `\ir`. Task 2 Step 4: "V-HELPERS passes if `\ir` resolved. If `supabase test db` also tries to run `_helpers.sql` as a test file and fails, apply the V-HELPERS fallback and record it."

Evidence (controller's own runs on commit 7933579, Supabase CLI 2.121.0, local stack on OrbStack):
- `\ir _helpers.sql` resolves: `000_harness.test.sql .. ok`, 3 tests (act_as sets `auth.uid()`, switches role to `authenticated`, `act_as_owner` resets role).
- Plain `supabase test db` (no arguments) also runs `_helpers.sql` as a test file: `_helpers.sql .. No subtests run … Parse errors: No plan found in TAP output … Result: FAIL`. Because the helper file then runs outside a test transaction, schema `tests` is committed and the next plain run fails with `ERROR: schema "tests" already exists` until `pnpm db:reset`.

**Result: pass** (`\ir` resolves), **with the fallback applied**: `pnpm db:test` is `node tools/db/test.mjs`, a tooling-only wrapper that passes only the `*.test.sql` files to `supabase test db` (with `SUPABASE_TELEMETRY_DISABLED=1`). The plan's fallback text describes concatenating the helpers into each test file; that is unnecessary because `\ir` resolves, so the wrapper only filters which files run (controller ruling, Task 2 notes). `pnpm db:reset && pnpm db:test` → `Files=1, Tests=3 … Result: PASS`; a repeated `pnpm db:test` without reset also passes. Limitation: run the database tests through `pnpm db:test`, never as a plain `supabase test db`; CI's `database` job already calls `pnpm db:test`.

## Correction to the bootstrap exposure (Task 2 security review, 2026-11-01)

The security review found that `[api] schemas = []` makes PostgREST fall back to exposing `public` (empty at the time; `Accept-Profile: public` returned the OpenAPI document). Controller pre-check: `["graphql_public"]` keeps the stack healthy and rejects `public` (406). Einar approved the correction on 2026-11-01 ("I approve F1–F3 as recommended, including the three minor corrections."); recorded as plan decision 17, with decision 16 corrected in place.

## A13 (Task 7, 2026-11-02)

Assumption (spec §11.1): the reference extraction finds `_ref` at any depth, including inside arrays and rich text. Under decision 25 (spec §4.3 revised), `private.extract_refs` walks the document recursively and returns each reference's location as jsonpath text, and the tests cross-check the walk against the recursive JSON path `strict $.**._ref`.

Evidence: `supabase/tests/database/040_refs.test.sql`. Local stack: PostgreSQL 17.11, Supabase CLI. `pnpm db:reset && pnpm db:test` gave `Files=7, Tests=405 … Result: PASS`. The A13 assertions, as reported:

```
ok 22 - refs found at any depth
ok 23 - each reference's location is a jsonpath to the reference object, with its kind
ok 24 - the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (rich-text document)
ok 25 - edge cases: root, nested inside a reference, arrays of arrays, duplicates, quoted keys
ok 26 - the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (edge cases)
ok 27 - every path evaluates, as a jsonpath, to the reference object it names
ok 51 - draft_refs rebuilt on save
ok 56 - draft_refs replaced by the new document's references (stray and old rows gone)
ok 78 - revision_refs equal the draft's draft_refs at that version
```

- Test 22 uses the plan's document: a top-level field, an array element, a rich-text link mark (`attrs.entry`) and a rich-text image node (`attrs.asset`), the shapes of `packages/rich-text/src/doc-schema.ts`.
- Test 23 pins the locations, for example `$."body"."content"[0]."content"[0]."marks"[0]."attrs"."entry"`.
- Tests 24 and 26 compare the walk with `jsonb_path_query(p_data, 'strict $.**._ref')` as multisets (`bag_eq`), so duplicates count.
- Tests 51 and 56 show the same documents saved through the draft trigger as an editor.

Malformed and canonical cases (decision 25), tests 30–48:
- Rejected with 22P02: upper-case, braced, unhyphenated, extra digit, leading space, leading or trailing newline, JSON null, number, object and array `_ref`.
- Accepted: the nil UUID and a canonical non-v4 UUID.
- Rejected with `invalid_reference`: an unknown, missing, wrong-case or non-string `_kind`.

Mutation check: each mutation was applied inside the test's transaction and rolled back.
- A walk that skips arrays fails tests 22–26.
- A cast-only `_ref` check (no pattern) fails the upper-case, braced and unhyphenated cases.

**Re-run at Task 7 completion (2026-11-02, commit `f3eab7a`).** After the fixes for decisions 27–29 (128-level depth limit, lean walk that builds paths only for references, object keys `^[A-Za-z0-9_-]{1,64}$`, at most 1,000 references, all checked in linear time before the walk with 54000), the A13 assertions above are unchanged and still pass, now alongside regression tests bounding temp files and run time (about 10 MB of temp space per statement in the worst case inside the limits). The controller ran `pnpm db:reset && pnpm db:test` on PostgreSQL 17.11: `Files=7, Tests=496 … Result: PASS` (`040_refs.test.sql`: 187 tests). Reviews: spec r1–r4 pass; security r1–r3 fail, r4 and r5 pass; quality r1 fail, r2 pass (`docs/execution/reviews/task-07-*`).
- A newline-sensitive pattern (`(?n)`) still rejects a trailing newline, because the `uuid` cast also rejects it. Checked directly: the plain anchored `~` gives `false` for a trailing newline, `(?n)` gives `true`, and the cast raises 22P02.

**Result: pass.**

## A9 (Task 11, 2026-11-02)

Assumption (spec §11.1, plan "Validation gates"): Vault secrets are created and read through `service_role`-only functions. Fallback if it fails: §8.2 app-level encryption (not needed).

Evidence: `supabase/tests/database/090_api_worker.test.sql` (commit `e6b66ab`, branch `m1/lane-a-alt`), local stack PostgreSQL 17.11 with `supabase_vault` 0.3.1. The controller ran `pnpm db:reset && pnpm db:test` from the worktree: `Files=13, Tests=1233 … Result: PASS`. Passing A9 assertions:

```
A9: admin_create_site stores a webhook secret in Vault (as service_role)
A9: worker_sites reads the secret back from Vault (as service_role)
A9: the site's webhook_secret_ref is a Vault secret named after the site
A9: Vault stores the secret encrypted
the secret is in no cms.sites column
```

- `api.admin_create_site` (invoker, `search_path = ''`, EXECUTE `service_role` only) calls `vault.create_secret` and stores only the returned id in `cms.sites.webhook_secret_ref`; `api.worker_sites` (same attributes) reads `vault.decrypted_secrets` by that id. Implementer's rolled-back probe as `service_role`: `worker_sites(demo)` returned `{s3cr3t}`; `vault.secrets` row `name=cms.sites/<id>/webhook`, `secret_is_plaintext=false`.
- Grants relied on are Supabase's defaults; none were added: `service_role` USAGE on `vault`; `vault.create_secret(text,text,text,uuid)` owned by `supabase_admin`, SECURITY DEFINER, EXECUTE for `service_role`; `vault.decrypted_secrets` and `vault.secrets` SELECT for `service_role`. Editors and `anon` get `42501 permission denied for schema vault` (security review r1 probe).
- Security review r1 (`docs/execution/reviews/task-11-r1-security.md`): the secret appears in no `cms` column, audit row or raise message; `worker_sites` returns it to `service_role` only. The reviewer notes that `vault.create_secret` is Supabase-owned SECURITY DEFINER code; whether §4.2's wording should say so is open for Einar (deferred-minors, Task 11).

Result: **A9 pass.**

## A1, A2, A3, A4, A5 and A14 (Task 12, 2026-11-02)

Assumptions (spec §11.1, plan "Validation gates"): A1 `cms` unreachable for `anon` and `authenticated` through REST and GraphQL; A2 invoker `api` functions write `cms` under RLS and column grants, including trigger writes; A3 `worker_*` callable with the secret key, refused for `authenticated`; A4 Storage RLS on `media-private` by tenant prefix, editors refused on `media-public` and `delivery`; A5 server-side copy `media-private` → `media-public`; A14 pgTAP impersonation matches PostgREST.

Scope: proven against the **local** stack (Supabase CLI, PostgreSQL 17.11, GoTrue v2.197.0, Storage API v1.82.1). Spec §11.1 and Task 29 re-run A1–A4 against staging; `tests/integration/src/env.ts` refuses non-loopback hosts until Task 29 changes it under its gate.

Evidence: `tests/integration/src/*.test.ts` (commit `5b336e0`, merged into `m1/phase-1` as `46398ef`). The controller ran, in the main checkout after the merge: `pnpm db:reset && pnpm db:test` → `Files=13, Tests=1246 … Result: PASS`; `pnpm test:integration` → `Test Files 6 passed (6)`, `Tests 67 passed (67)`:

```
✓ src/auth-passwordless.test.ts (6 tests)
✓ src/http-boundary.test.ts (31 tests)
✓ src/concurrency.test.ts (5 tests)
✓ src/impersonation-parity.test.ts (13 tests)
✓ src/storage-boundary.test.ts (8 tests)
✓ src/fixtures.test.ts (4 tests)
```

Per gate (test names from the implementer's verbose run, confirmed by the security review r1, which re-ran the suite: `docs/execution/reviews/task-12-r1-security.md`):
- **A1 pass** (`http-boundary.test.ts`): `cms`, `private` and `public` refused (PGRST106) for anon, an editor and the secret key, tables and rpc; raw `Accept-Profile`/`Content-Profile: cms` → 406 PGRST106; GraphQL not ok for an editor or anon (406 PGRST106, `pg_graphql` dropped, decision 1).
- **A2 pass** (`http-boundary.test.ts`): `create_entry` and `save_draft` over REST give version 2 and one `draft_refs` row written by trigger; actor triggers record the caller; views show the caller's tenant only; another tenant's editor, an outsider and a revoked member get `not_found` and nothing changes; a reference to another tenant's asset fails the write; anon gets 42501.
- **A3 pass** (`http-boundary.test.ts`): all 11 `worker_*` and 3 `admin_*` functions give 42501 for anon and all five personas; the secret key reaches the worker functions (and `worker_sites` reads Vault); the secret key gets 42501 on editor functions.
- **A4 pass** (`storage-boundary.test.ts`): editors upload only under their own tenant prefix in `media-private`; other personas and anon cannot read, list, sign or upload; no overwrite, move or delete of an original; non-image types refused; editors and anon cannot write `media-public` or `delivery`. The security reviewer confirmed each refusal is the RLS 403 "new row violates row-level security policy".
- **A5 pass** (`storage-boundary.test.ts`): the secret client copies `media-private` → `media-public`; the public URL returns 200 with identical bytes; the original stays non-public; a secret-key write to `delivery` is publicly readable.
- **A14 pass** (`impersonation-parity.test.ts`): 12 cases (plus a count check), each run over REST and through `pgAs` (dedicated connection, `begin`, `set_config('role')` and `set_config('request.jwt.claims')` as PostgREST does), REST equal to the expected outcome and SQL equal to REST: own-tenant create (ok); other-tenant create, outsider create, revoked save, cross-tenant publish request (`not_found`); asset outside its path (`forbidden`); editor calls a worker function, anon calls an editor function, anon reads an editor view (42501); secret key reads sites through Vault; editor lists own entries; platform admin without membership sees no tenants. No difference between the paths. Known limit (deferred Minor): no `aal2` case, and impersonated claims are `{sub, role, aal}` only.
- **Concurrency** (`concurrency.test.ts`, exactness consideration 1): save_draft waits for an in-flight commit and the revision holds the validated data; a commit holding a referenced entry makes a concurrent unpublish wait; unpublish first makes the commit end `failed_validation`; a save between `worker_read_request` and the commit gives `superseded`; two `worker_begin_release` calls give one row and one null. Each wait is proven by `expectBlocked` (`pg_stat_activity.wait_event_type = 'Lock'`).
- **Decisions 18, 19, 21 and 22 over HTTP** (`auth-passwordless.test.ts`): passwords never sign in (403 from the hook, which Auth runs as `supabase_auth_admin`); email changes need both addresses, also over PKCE; TOTP step-up and refresh; no token for sign-up, anonymous, phone, id_token, web3, forged PKCE, SSO or OAuth.

Result: **A1, A2, A3, A4, A5 and A14 pass** (local stack).

## Bundle and pointer cache headers (Task 20, 2026-11-02; decision 34.4)

Question: can Storage serve a release bundle with spec §7.2's `cache-control: public, max-age=31536000, immutable`? storage-js turns its `cacheControl` option into `max-age=${cacheControl}`, so that option alone cannot add `public` or `immutable`.

Probe on the local stack (Storage API 1.82.1, `@supabase/storage-js` 2.118.0), uploading to the `delivery` bucket with the secret key and reading each object back through its public URL (`/storage/v1/object/public/delivery/...`). The response headers served:

| Upload | Served `cache-control` | Served `content-type` |
|---|---|---|
| `upload(path, bytes, { cacheControl: '31536000', contentType: 'application/json' })` | `max-age=31536000` | `application/json` |
| `upload(path, bytes, { contentType: 'application/json', headers: { 'cache-control': 'public, max-age=31536000, immutable' } })` | `public, max-age=31536000, immutable` | `application/json` |
| pointer: `upload(path, bytes, { contentType: 'application/json', upsert: true, headers: { 'cache-control': 'public, max-age=30' } })`, twice (the second replaces the object) | `public, max-age=30` | `application/json` |
| pointer: `upload(path, bytes, { cacheControl: '30', contentType: 'application/json', upsert: true })` | `max-age=30` | `application/json` |

Result: **`immutable` can be set.** storage-js's `headers` option replaces the `cache-control` header it builds from `cacheControl`, and Storage stores the value as given and serves it back unchanged. The worker (`apps/cms/src/privileged/worker/build-release.ts`, `supabaseReleaseStorage`) uploads the bundle with `public, max-age=31536000, immutable` and the pointer with `public, max-age=30`, exactly as §7.2 says, so spec §7.2 needs no amendment. `build-release.integration.test.ts` re-checks both headers on every run, through the public URLs.

The same probe recorded what the worker relies on for copies and uploads that collide: a second server-side copy to an existing destination, and an upload with `upsert: false` to an existing path, both fail with `{ message: 'The resource already exists', status: 400, statusCode: '409' }`. The worker counts the copy case as success (decision 35) and treats the upload case as a failure (bundle paths are never reused).

Limits: this is the local Storage API. Whether a CDN in front of hosted Storage keeps these headers is part of A6, checked on staging (Task 29). The probe's objects were removed afterwards.

## Hosted items and how to undo them (Task 28)

Items added by the M2 and M3 acceptance are in `docs/execution/checkpoints/C5.md`, "What was created, and how to undo it".

Every hosted item created or changed in Task 28 and Task 29 is added here the day it is created (staging runbook, section 1, "Undo records"), and repeated in the session's handoff notes. No secret value is ever written here: a key or token is named, never shown.

| Item | Where | Created (date, gate) | Monthly cost | How to undo |
|---|---|---|---|---|
| Private repository `einar6969/litljomi-cms`, remote `origin`; branches `main` and `m1/phase-1` pushed at `ddb67c8`; Actions on, default token read-only, cannot approve PRs, no secrets | GitHub (Einar's account) | 2026-11-03, G2 (created and pushed by Einar) | 0 (GitHub Free; Actions minutes within the free allowance) | Einar: `gh repo delete einar6969/litljomi-cms` (needs the `delete_repo` scope: `gh auth refresh -h github.com -s delete_repo`), then locally `git remote remove origin`. Deleting removes the Actions history too |
| Supabase organisation "Litljómi" (Free) and project "staging" (`rwpgpfsmhhtimauvpoyt`, `eu-west-1`; corrected in C5, recorded earlier as Central EU Frankfurt), with 17 migrations, Auth settings (sign-up off, secure email and password change, OTP 3600, JWT 3600, TOTP), exposed schema `api` only, the Custom Access Token hook, Site URL and one redirect URL | Supabase (Einar's account) | 2026-11-03, G3 (created by Einar; configured by the controller in Einar's signed-in browser pane, link and push by Einar) | 0 (Free; pauses after a week without activity) | Einar: project Settings → General → Delete project, then organisation settings → Delete organisation. Everything configured lives inside the project and goes with it. `supabase unlink` locally removes the CLI link |
| Vercel project `vefumsjon-staging` (`prj_uF0weGsGBnJBdj2m14zZgTnCvslb`): `einar6969/litljomi-cms`, root `apps/cms`, Next.js, Node 22, functions `fra1`, Vercel Authentication `all_except_custom_domains` (Standard Protection), plain env `NEXT_PUBLIC_SUPABASE_URL`, `CMS_PUBLIC_URL`; domain `vefumsjon-staging.litljomi.is` | Vercel team `team_QumUyzagQwAqXmpItxceUQ5C` | 2026-11-03, G6 (controller through the Vercel connector) | Included in Vercel Pro ($20/month, the team) | Einar: project Settings → Advanced → Delete Project (removes its deployments, domain assignment and env vars) |
| Vercel project `demo-staging` (`prj_vxOdDKBJ45VL5JY2506JionufkRU`): same repository, root `apps/demo-site`, same settings; plain env `CMS_DELIVERY_BASE_URL`, `CMS_TENANT=demo`, `CMS_MEDIA_HOST`; domain `demo-staging.litljomi.is` | same | 2026-11-03, G6 | Included | Einar: delete the project |
| Vercel project `labak-hub` (`prj_16thnknxFJ4qOC6TSQR9MJDlqEmn`): Git connection to `einar6969/landssamband-bakarameistara` with Production Branch `hub-integration` (both set by Einar, 2026-11-03, G7), Ignored Build Step `if [ "$VERCEL_GIT_COMMIT_REF" = "hub-integration" ]; then exit 1; else exit 0; fi`, same settings; plain env `CMS_DELIVERY_BASE_URL`, `CMS_TENANT=labak`, `CMS_MEDIA_HOST`, `SITE_NOINDEX=1`; domain `labak-hub.litljomi.is` | same | 2026-11-03, G6 | Included | Einar: delete the project (also removes its Git connection to the LABAK repository; nothing in the repository itself changes) |
| DNS: three CNAMEs in litljomi.is: `vefumsjon-staging` → `69cdbc6710f9f9df.vercel-dns-017.com.`, `demo-staging` → `529d21ae137f44ca.vercel-dns-017.com.`, `labak-hub` → `e05d898bd734d208.vercel-dns-017.com.` | litljomi.is zone (ISNIC forwarding nameservers), added by Einar | 2026-11-03, G5 | 0 | Einar: delete the three CNAME records in the litljomi.is zone |
| Ignored Build Step on the existing project `landssamband-bakarameistara`: `if [ "$VERCEL_GIT_COMMIT_REF" = "main" ]; then exit 1; else exit 0; fi` (builds `main` only; every other branch skipped) | Vercel team `team_QumUyzagQwAqXmpItxceUQ5C`, project settings → Git | 2026-11-03, G7 (decision 43.8; set by Einar) | 0 | Einar: clear the Ignored Build Step (back to automatic) once `hub-integration` is no longer pushed (runbook G6.0) |
| Remote branch `hub-integration` at `56bb9dd` in `einar6969/landssamband-bakarameistara` (LABAK `main` unchanged at `aec9f95`) | GitHub (Einar's account) | 2026-11-03, G7 push (pushed by Einar from his terminal) | 0 | Einar: `git push origin --delete hub-integration` in the LABAK checkout (`labak-hub` then has nothing to build; its deployments go with the project) |
| A1–A4 test fixtures (decision 46): never-invited, pre-confirmed users `einsi+a-labak@litljomi.is` (`b730e8e4-…`, labak only) and `einsi+a-demo@litljomi.is` (`4cf97f88-…`, demo only); draft entries `4b48543c-…` (labak) and `ce02f26c-…` (demo), titled "A1–A4 grensupróf (prófun)", never published; one 14-byte test JPEG per tenant in `media-private` | Supabase staging | 2026-11-03, G3 extension (decision 46; created by Einar's `boundary-check` run) | 0 | Go with the staging project when it is deleted; removing them earlier needs SQL (memberships first, then the users; Einar) |
| Task 29 test content in `demo` (sitting 4, decision 47): entry `7cd90ebb-b0c1-4fde-a6c4-0d4e5e3f0673` (`event`, slug `m1-prufa-a6a7`, unpublished, draft v7 deliberately malformed), its 6 publish and unpublish requests, revisions, releases 2–5 with `demo/releases/2–5.json` and the rewritten `demo/current.json` in the `delivery` bucket, and their `site_deliveries`; nothing in `labak` | Supabase project `rwpgpfsmhhtimauvpoyt` (database and Storage), written through `api.*` as `einsi+a-demo@litljomi.is` | 2026-11-03, decision 47 (Supabase connector) | 0 | Cannot be removed through `api` (no hard delete). Einar, as owner in the SQL editor, or by deleting the project when staging is retired. |

## G7 push of `hub-integration` (2026-11-03, sitting 3)

- **Approval:** Einar in chat, 2026-11-03: "G7 push: I approve G7 with `push=true` for `hub-integration` only. Never `main`, never a force-push. Record it in `gates.json` and `m1-gates.md`." Recorded in `gates.json` (G7, third extension; `params.push = true`, `pushBranches = ["hub-integration"]`).
- **Safeguard (G6.0):** Einar in chat: "Ignored Build Step: I set it on `landssamband-bakarameistara`, exactly as in decision 43.8." (the command in the undo table above).
- **Push:** Einar in chat: "I pushed `hub-integration` from my own terminal (`56bb9dd`); `main` is unchanged at `aec9f95`." Controller, read only: local and `origin/hub-integration` at `56bb9dd`, LABAK `main` at `aec9f95`.
- **G7.1 pre-push checks, run by the controller after the push** (the push was Einar's; read only, on `56bb9dd`): check 1, no `vercel.json` on the branch (no output); check 2, the G2.0 scan over `main..hub-integration`: content `5 CMS_WEBHOOK_SECRETS=laba…` (the local fixture value, all in `README.md`), commit messages none, the two vendored tarballs none. As expected; nothing else.
- **`landssamband-bakarameistara` after the push** (advisor's read-only check, reported by Einar; confirmed by the controller through the Vercel connector, read only): the `hub-integration` build `dpl_A5Xo29xxp7tfKyQRGiU6WEzfxxyU` is `CANCELED` (Ignored Build Step), target none; the latest production deployment is still `aec9f95` (`dpl_9CsuT29iuWJdN2FYwqjLc6adFLt3`, labak.litljomi.is). This is the known limitation of runbook section 15 (a cancelled entry, nothing built or served).
- **`labak-hub`:** Einar in chat: "I connected it to `einar6969/landssamband-bakarameistara` and set its Production Branch to `hub-integration`." Checked before its first deployment in sitting 3, step 1.
