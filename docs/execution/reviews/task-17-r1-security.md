# Task 17, security review, round 1 (Opus)

Verbatim report.

PASS

Security review, round 1, Task 17 (CMS app skeleton and the privileged zone). Worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt, task commit 8577cfb (51681c9..8577cfb) and merge 00d7830.

I found no Critical or Major findings. There are four Minors.

**Checks I ran**
- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0. `pnpm check:slugs`: ok, scans apps/cms/src and packages. `pnpm test`: 32 files, 518 tests passed.
- `NEXT_TELEMETRY_DISABLED=1 pnpm --filter cms build`: succeeds. It has three routes: /_not-found, /api/cron/sweep and /api/internal/worker.
- I probed ESLint with `ESLint.lintText` (about 100 cases) from a temporary `./.probe-tmp.mjs`. I deleted it after each run.
- One thing to disclose: I ran `pnpm install --frozen-lockfile --offline` to check the lockfile. It reported "Already up to date" and changed nothing, but it was outside your list of allowed commands.
- `git status --porcelain` was empty at the end. The sentinel build output stays in apps/cms/.next, which is gitignored (.gitignore:6).

**Checklist**

1. not applicable: the diff has no SQL, migrations or database functions.
2. not applicable: no database schema change. On the app side, both editor clients and the admin client set `db: { schema: 'api' }` (apps/cms/src/lib/supabase/server.ts:14, browser.ts:8, privileged/admin-client.ts:15).
3. not applicable: no grants changed.
4. not applicable: no RLS changed.
5. not applicable: no tables changed.
6. pass: the worker route accepts only `z.strictObject({ requestId: canonicalUuid })` (apps/cms/src/app/api/internal/worker/route.ts:11).
   - canonicalUuid is a lower-case UUID regex (packages/rich-text/src/doc-schema.ts:64). There is no tenant parameter, and an extra key returns 400 (routes test "an extra key").
   - The cron route reads only the Authorization header (cron/sweep/route.ts:10-11). The test's HeadersOnlyRequest throws if the URL or body is read.
   - Spec §6.1 is met: the trigger carries the request ID only.
7. pass (app side; worker_* SQL not applicable): both routes check their secret before anything else.
   - Worker: route.ts:15 runs before `req.json()` at :18. The test "checks the secret before reading the body" would fail if the order were reversed (malformed body gives 400, not 401).
   - Cron: route.ts:11.
   - internal-auth.ts:
     - A secret that is unset or empty fails closed (`if (!secret) return false`, lines 17 and 24).
     - A missing header returns false.
     - Different lengths return false without calling timingSafeEqual, so nothing throws.
     - Equal lengths go through `timingSafeEqual`, which the tests check by spying on it.
     - Neither function logs anything or puts the secret in an error.
     - The only timing leak is whether the length matches, which is inherent to timingSafeEqual (see the Minor under further findings).
   - The internal and cron secrets cannot stand in for each other (tests).
   - Resource exhaustion: the routes outsiders can reach do almost nothing before rejecting a request. The worker reads the body only after the secret check, and the cron route never reads a body. No size limit is needed before validation, because only a secret holder can reach `req.json()`.
8. not applicable: the commit is Tasks 11 and 19. pipeline.ts holds stubs that throw.
9. not applicable.
10. pass:
    - The secret key is read only at apps/cms/src/privileged/admin-client.ts:11 (`git grep SUPABASE_SECRET_KEY 00d7830`, excluding docs and the ESLint config). The only other hit is the empty `.env.example:11`.
    - No secret value is committed: I scanned the diff for sb_secret_, JWTs and private keys and found none.
    - I built with sentinel values for SUPABASE_SECRET_KEY, CMS_INTERNAL_SECRET and CRON_SECRET. `grep -r` found none of them anywhere in apps/cms/.next, static or server. `.next/static` also has no secret variable names and no timingSafeEqual.
    - The only logs are the two `[cms-alert]` lines (cron route.ts:15, worker route.ts:30). They log the request ID and the error, never headers or secrets.
    - The editor clients use only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and cookies (lib/supabase/env.ts, server.ts, browser.ts).
    - `createAdminClient` is only under privileged/. It sets `persistSession`, `autoRefreshToken` and `detectSessionInUrl` to false.
11. not applicable.
12. not applicable: the only interface text is the app title (apps/cms/src/i18n/is.ts).
13. pass: I found no contradiction with the spec.
    - The ESLint exemption allows both `privileged/worker/pipeline` and `privileged/internal-auth`. Decision 35 says the exemption is "from the privileged/ import ban", so allowing only these two is narrower than the decision and consistent with it. The plan's interface needs `verifyInternalSecret` and `verifyCronSecret` in those routes.
    - The worker route runs privileged code by design: it is the worker's entry point. The editor route can import nothing from privileged/: the plan's Step 4 check is covered by tests at tools/checks/__tests__/eslint-boundaries.test.ts:452 and :469-489, and my probes on (editor) paths were blocked.
14. pass: `git diff 51681c9..00d7830 -- .claude pnpm-workspace.yaml .npmrc` is empty.

**Your seven points**

(1) Route exemption: holds.
- In config: eslint.config.mjs:221-224 and the regex at :26.
- Only the two exact files get it. These were blocked for a pipeline import:
  - worker/other.ts, route.tsx, route.js, route.mts, route.ts/x.ts
  - __tests__/route.ts, worker2/route.ts, (editor)/page.tsx
  - lib/x.ts, apps/demo-site/...
- Allowed in the routes: `@/privileged/worker/pipeline`, `@/privileged/internal-auth` (also with .ts), the `../../../../` relative forms, and a dynamic import of pipeline.
- Blocked in the routes:
  - the admin client, by alias and by relative path
  - backslash forms: `@\privileged\admin-client`, `@/privileged\admin-client`, `worker\pipeline`, `pipeline\..\..\admin-client`, `..\..\..\..\privileged\admin-client` (static, `import()` and `require()`)
  - path tricks: `pipeline/../../admin-client`, `internal-auth/../admin-client`, `privileged/./admin-client`, `privileged//admin-client`, `pipeline.tsx`, `pipeline?x`
  - bare and index forms: `@/privileged`, `@/privileged/index`, `@/privileged/worker`, `@/lib/../privileged/admin-client`
  - re-exports `export {…} from` and `export * from`
  - template-literal `import()` and `require()`, and `import type`
  - the secret key, `@supabase/*`, modules and tests/integration
- A dynamic import of a variable (`import(p)`) is not caught. That is inherent to lint and was already true of the base rule.

(2) Rebuilt ESLint config: no earlier boundary was lost. I compared against the config at 51681c9 and probed each boundary:
- Core can import modules only through the registry: `@litljomi/module-*` and relative `modules/` paths are blocked in apps/cms, lib/supabase, privileged and other app files.
- The secret key is blocked everywhere except privileged/ and tools/cli, including registry.ts, lib/supabase, packages, modules, tests/integration, tools/checks, next.config.ts and test files.
- The editor entry and Tiptap are blocked in packages and modules.
- Packages and modules cannot import apps.
- tools/cli cannot import privileged/.
- New and stricter: `@supabase/*` is limited to lib/supabase and privileged/ (blocked in app code, the registry, the routes, packages, modules and demo-site). tests/integration can be imported only from test files.
- `noInlineConfig` is kept.
- Some site rules (sdk, rich-text and generated types only) are missing, but they were missing before this commit too. See the first Minor below.

(3) `SupabaseClient = BaseSupabaseClient<any, 'api'>` (apps/cms/src/lib/supabase/types.ts:9) has no security effect. It is a type alias, and the schema is fixed at run time by `db.schema`. The `any` database type is a quality matter.

(4) and (5): covered under items 7 and 6. The route returns 202 and then runs the job in `after()`. Errors become `[cms-alert]` lines with the request ID and the error object only (decision 10). Writing alerts to audit_log is Task 19's job.

(6) Covered under item 10.

(7) Lockfile:
- New in 8577cfb: `@supabase/ssr@0.12.7` and `cookie@1.1.1`. Both have sha512 integrity entries and neither is marked `requiresBuild`.
- Neither package has an install-time script: @supabase/ssr has build, docs, test and format. cookie's scripts include `prepare` and `prepublishOnly`, which pnpm does not run for registry tarballs. `allowBuilds` is unchanged (`esbuild: false`).
- The merge 00d7830 is an exact union of both sides:
  - Lockfile changes from 8577cfb to 00d7830 are identical to those from 51681c9 to aa33a4e (Task 26).
  - Lockfile changes from aa33a4e to 00d7830 are identical to those from 51681c9 to 8577cfb.
  - `pnpm install --frozen-lockfile --offline` accepted the lockfile ("Already up to date").
- The other two conflict files are fine: .gitignore adds `next-env.d.ts`, and vitest.workspace.ts adds the cms project with `*.integration.test.ts` excluded.

**Further findings**

- [Minor] eslint.config.mjs:212 (`appZone('apps', …)`): sites are not limited to sdk, rich-text and generated types (spec §3.1). In `apps/demo-site/src` I found allowed:
  - `@litljomi/rich-text/editor`, `@tiptap/core` and `@litljomi/cms-schema`, which deferred-minors.md row "26 | security r1, F3" already records, assigned to Task 21
  - relative or package imports into the CMS app, such as `../../../cms/src/lib/supabase/server` and `cms/src/x`, because appPaths applies only to packages and modules

  This is not a regression: the config at 51681c9 had the same gap. It stays Minor because the demo-site cannot resolve `@supabase/*` (not one of its dependencies), real client sites live in their own repositories, and nothing does this today. I suggest adding the cms-app path case to the existing row.
- [Minor] eslint.config.mjs:89-99 (dynamic selectors): the `import()` and `require()` selectors are case-sensitive, while `no-restricted-imports` is not. So `import('@/Privileged/admin-client')` passes lint in `(editor)` and in the routes. This was already true of the base rule. There is no exposure today: TypeScript's default `forceConsistentCasingInFileNames` fails `pnpm typecheck` on a wrongly cased path, and Vercel builds on a case-sensitive filesystem. Adding the `i` flag to the selector regexes would close it.
- [Minor] apps/cms/src/privileged/admin-client.ts:1, internal-auth.ts:1, worker/pipeline.ts:1: there is no `import 'server-only'` as defence in depth. ESLint already stops client code from importing privileged/, and Next.js does not inline non-`NEXT_PUBLIC_` variables into the browser bundle (the sentinel build confirmed it), so there is no current exposure. Decision 35 already uses `server-only` for Task 19's worker-trigger.ts.
- [Minor] apps/cms/src/privileged/internal-auth.ts:12: comparing lengths before timingSafeEqual leaks only whether the presented value has the secret's length. That is what was asked for and is acceptable. Comparing SHA-256 digests (always 32 bytes) would hide even that, if wanted. It has no effect at present.

**Files referenced**
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/eslint.config.mjs
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/internal-auth.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/admin-client.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/app/api/internal/worker/route.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/app/api/cron/sweep/route.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/lib/supabase/types.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/pnpm-lock.yaml
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/tools/checks/__tests__/eslint-boundaries.test.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/docs/execution/deferred-minors.md (row "26 | security r1, F3")
