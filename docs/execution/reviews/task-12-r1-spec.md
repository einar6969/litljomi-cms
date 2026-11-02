PASS

I read the diff and the files in the worktree. I ran no tests and did not touch the database. `git status --porcelain` was empty.

Commands: `git diff --stat f8bca05 5b336e0` (with and without the docs exclusion), `git diff` of `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` and `012_auth_hook.test.sql`, `sed` on plan Task 12 and `deferred-minors.md`, `cat` of every file under `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/tests/integration`.

**What matches the task text**
- **Files:** `package.json`, `vitest.config.ts`, `env.ts`, `fixtures.ts`, `clients.ts`, `sql.ts` and the five test files all exist. The extra `auth-api.ts`, `seed.ts`, `global-setup.ts` and `fixtures.test.ts` are the accepted ones.
- **Root script:** `test:integration` runs `pnpm --filter @litljomi/integration-tests test`.
- **Config changes:** `tests/*` is in `pnpm-workspace.yaml`. `tsconfig.json` includes `tests/integration`.
- **`env.ts`:** it reads `supabase status -o json` and refuses any host that is not loopback.
- **Client factories:** `anonClient()` and `secretClient()` have the specified signatures.
- **`editorClient(persona)`:** it calls `auth.admin.generateLink({type:'magiclink', email})`, then `verifyOtp({type:'magiclink', token_hash})`. It caches sessions and renews them near expiry; the cache is not in the plan (Minor 1).
- **`pgAs`:** it opens a dedicated `pg.Client` on `env.dbUrl`, runs `begin`, then `set_config('role', …, true)` and `set_config('request.jwt.claims', …, true)`. `'service'` gets `{role:'service_role'}`. Personas get `{sub, role:'authenticated', aal:'aal1'}`. It also accepts `'anon'` and `'owner'`, as accepted. The caller commits.
- **`expectBlocked(client)`:** it polls `pg_stat_activity.wait_event_type` for that backend's pid every 20 ms, for 2000 ms, and throws on timeout. The concurrency tests call it before the first transaction commits, so each interleaving is proven, not assumed.
- **`seedIntegration()`:**
  - It is idempotent.
  - It creates the personas through the Auth admin API with the fixed ids.
  - The tenants are inserted as owner with a comment explaining why. That is the accepted deviation.
  - Memberships and the demo site go through `api.admin_*`.
  - The revoked member's membership is added and then deleted once, guarded by the audit log.
  - The platform admin row is inserted as owner.
- **Fixed identities table:** `fixtures.ts` matches the plan, and `fixtures.test.ts` cross-checks it against `_helpers.sql` (UUIDs, emails, tenants). That closes the Task 5 quality r1 Minor 5.
- **`http-boundary.test.ts` (A1–A3):**
  - A1 tests: PGRST106 for `cms`, `private` and `public`, for anon, an editor and the secret key. The raw `Accept-Profile` and `Content-Profile` headers return 406. GraphQL is refused for an editor and for anon.
  - A2 tests: `create_entry` and `save_draft` give version 2 with one draft ref. The caller is recorded as author, and cross-tenant, outsider and revoked callers get `not_found`. A foreign-tenant asset reference fails the write.
  - A3 tests: editors get 42501 and the secret key succeeds on `worker_claim_requests`. All 11 `worker_*` functions and 3 `admin_*` functions are refused for anon and all five personas. Every `worker_*` function is covered, not only `worker_claim_requests`.
- **`storage-boundary.test.ts` (A4, A5):** all four plan-named cases exist, plus extra denial cases: foreign tenant prefix, overwrite, move, delete, MIME type, anon. Both A5 tests check that the object is public after the copy, that it was not public before, and that the original stays private.
- **`concurrency.test.ts`:** all five named cases exist with the specified assertions: revision data equals the validated data and the draft version is 4, `refs` equals B with reason `unpublished`, `superseded`, and one row plus one null from `worker_begin_release`. They run on real concurrent `pgAs` sessions and each can fail.
- **`auth-passwordless.test.ts`:** all six named cases exist and match decisions 18, 19, 21 and 22. This covers password refusal with 403 and no `password` entry in `auth.mfa_amr_claims`, and the email change variants including PKCE. It uses throwaway users and Mailpit.
- **`impersonation-parity.test.ts` (A14):** there are exactly 12 cases, with a test asserting the count. Each case runs once over REST and once through `pgAs`. It asserts the REST outcome equals the expected outcome and that the SQL outcome equals the REST outcome.
- **Task 10 deferred Minor (auth-user deletion):** the test pins the observed behaviour. Deleting a user who holds a membership fails closed with 500 and nothing is deleted. After the membership is removed, the deletion succeeds, with two audit rows. The implementer reports the trigger problem to the controller and does not change it.
- **Task 4 quality r1 Minors 1–5 in `012_auth_hook.test.sql`:**
  - The amr-missing row is selected by `a.amr is null`.
  - The plan count is 89 and its arithmetic is commented.
  - The three refused amr cases are added: `[null]`, `{"method": null}` and `{"method": 1}`.
  - The PG17 `MAINTAIN` comment is added.
  - Two tests pin `{"claims": null}` for missing and JSON-null claims.
  - I count 23 + 48 + 2 + 6 + 5 + 5 = 89, which matches.

**Findings**
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/tests/integration/src/clients.ts:43-52`: the plan says `editorClient` signs in, and the code does, but it caches the session per persona. The cache is not in the plan, though the file comment explains it (Auth's 30 verifications per 5 minutes). The sign-in path itself is the required one.
- [Minor] Plan Task 12 Step 4 says to record A1–A5 and A14 in `docs/verification/m1-gates.md`. That file is not in this diff (docs are excluded from the code diff and `m1-gates.md` is not among the docs changes). I assume this is the controller's step after the controller's own re-run.
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/tests/integration/src/http-boundary.test.ts` (Auth user deletion test): this is not a contradiction of the spec, but the test pins a behaviour that is arguably undesirable, namely deleting a user with memberships fails with 500. It records the open item in `deferred-minors.md` rows 76, 90 and 94, so the controller owns the decision.

No Critical or Major findings.
