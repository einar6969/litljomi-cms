# Task 17, spec review, round 1 (Sonnet)

Verbatim report.

PASS

I found no Critical or Major findings. The merged result (00d7830 plus 8577cfb) runs every Vitest project. That includes the new `cms` project and Task 26's `demo-site`, 32 files and 518 tests in all. I changed nothing in the working tree; `git status --porcelain` was clean before and after. I did not run `next build` or any database command.

**Interfaces and files.** All match the task text and decision 35.
- `createEditorClient(): Promise<SupabaseClient>`, `createAdminClient(): SupabaseClient`, `verifyInternalSecret` and `verifyCronSecret` have the required names and signatures.
- Both secret checks go through `timingSafeEqual`. A different-length secret returns false without throwing, and an unset or empty secret returns false.
- The worker route has `maxDuration` 300. POST answers 202 and runs `processAndDeliver(requestId)` inside `after()`. The cron route has `maxDuration` 300 and GET calls `sweep()`.
- `pipeline.ts` has stubs that throw `not implemented`.
- `vercel.json`, `t: typeof is`, and the registry's `modules`, `getModule` and `getType` are as specified.
- Decision 35 items are all present: package `cms`, `transpilePackages`, `db: { schema: 'api' }` on every client, `apps/cms/tsconfig.json` with bundler resolution, typecheck wiring, the integration config reusing the `tests/integration` global setup, the `cms` Vitest project that excludes `*.integration.test.ts`, and the `check:slugs` roots.
- `check:slugs` now fails on a missing root. The ESLint exemption covers exactly the two route files, and the lint test covers neighbouring paths that stay banned.

**Tests.** Each required test can fail.
- The routes tests check 401 for a missing, wrong, other-length, other-route and unset secret, and 202/200 with the right one. They also check that `after()` schedules the job rather than running it inline.
- The cron request class throws if the URL or body is read, and the URL carries a `requestId` query. That is a real "never reads a request ID" check.
- The registry test checks that `getType('labak','news')` has `secondaryImage` and `getType('demo','news')` is undefined.
- `eslint-boundaries.test.ts` (around lines 469–489) checks that importing `admin-client` from `app/(editor)` is rejected.
- `pnpm lint` and `pnpm typecheck` exit 0, and `pnpm check:slugs` is ok (roots `apps/cms/src` and `packages`).

**Deferred Minor rows claimed cleared.** I verified each in the diff.
- **Row 35 (bundler resolution):** done in `apps/cms/tsconfig.json`.
- **Row 41 (Tiptap/ProseMirror ESLint rule):** a `tiptap` boundary is added, with exceptions for `tiptap.ts` and the rich-text tests.
- **Row 52:** the limits comment is in `eslint.config.mjs`, the demo null-slug test is in `demo.test.ts`, and the `FIELD_KEY` pointer comment is in `codegen.ts`.
- **Row 53:** rich-text is forbidden from modules, relative sibling-module imports are caught, and `./` segments are handled in the editor rule.
- **Row 91 (secret-key scope):** an `integrationTests` boundary lets only test files import `tests/integration` helpers.
- **N1 (backslash separators):** the path regexes accept `\`.
- **C-F1:** the `check:slugs` roots are now required.
- **C-S2b/S6/S11 (Supabase imports, app names, route exception):** a Supabase boundary and an app-name boundary are added, plus the route exemption.
- **Q3-1/Q3-2 (comment wording, temp-dir cleanup):** I did not verify these.
- The Row 41 entry itself still reads "moved to Task 17". The controller will need to update `docs/execution/deferred-minors.md`, since only it writes `docs/execution/`.

**Your two questions.**
- **`SupabaseClient` redefined as `BaseSupabaseClient<any, 'api'>` (`apps/cms/src/lib/supabase/types.ts`):** acceptable. The task interface only names `SupabaseClient`, and the wrapper makes the signatures compile with the schema decision 35 requires. The `any` database type is a Minor, and later tasks can replace it with generated types.
- **Routes also importing `privileged/internal-auth`:** acceptable. The routes need `verifyInternalSecret` and `verifyCronSecret` from somewhere. The ESLint regex allows only `worker/pipeline` and `internal-auth` as the last path segments. `admin-client` and path-continuation tricks still fail, and the lint tests cover this (lines 410–432). It is narrower than decision 35's literal "exempt from the privileged/ ban".

**Minor findings.**
- [Minor] `apps/cms/src/app/api/internal/worker/route.ts:11-23`: the task specifies the body `{requestId}`, a 202 and an unauthenticated 401. The route also does strict zod validation with `canonicalUuid` (a new `rich-text` and `zod` import in the route) and returns 400 for a bad body. This is small, tested, and reasonable, but the plan does not mention 400.
- [Minor] `apps/cms/src/app/api/cron/sweep/route.ts:12-17`: the route returns 500 with a `[cms-alert]` log when `sweep()` throws. The task text does not require it. It is tested and harmless.
- [Minor] `apps/cms/src/lib/supabase/browser.ts` and `env.ts`: both are extra relative to the file list. `browser.ts` is listed in the task, `env.ts` is a small helper, and `layout.tsx` and `.gitignore` (`next-env.d.ts`) are trivial and justified.
- [Minor] `apps/cms/src/privileged/admin-client.ts:14`: `createClient<any, 'api'>`. This is the same `any` typing as in `types.ts`.

**Commands run:** `git diff --stat`, `git show` and `git log` reads, `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs`, `pnpm test`.
