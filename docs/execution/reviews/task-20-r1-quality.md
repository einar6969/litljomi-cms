# Task 20, quality review, round 1 (Sonnet)

Verbatim report.

PASS

Task 20 round 1 code-quality review. No Critical or Major findings.

Commands run: `git diff 91d3334..2803b63` (the whole diff), `pnpm lint` (exit 0), `pnpm typecheck` (exit 0), `pnpm test` (38 files, 622 tests passed). I ran no database command and no e2e. `git status --porcelain` is unchanged.

build-release.ts reads as §7.1's steps. The "Step N" comments follow the spec, and the `at(name, fn)` wrapper puts the failing step into the recorded error. Reuse of `buildProjectionContext` and `publicMediaUrl` from Task 19 is good, so there is no duplicated resolver logic. The omission loop terminates because every non-final pass adds at least one entry to `errors`. The unit tests cover the cascade, schema-version, unknown-type and asset-path cases, and each failure step. They assert the exact storage operation order, the `finish` payloads, and the failed-path `p_request_ids: null`, so they would catch regressions.

Minors:

1. [Minor] apps/cms/src/privileged/worker/build-release.ts:190-205 and `__tests__/build-release.test.ts`: two of the three `pointerWritten` states have no test.
   - Covered: `false` (upload failed, old pointer still there), `true` after a verify failure, and `true` after a `finish` failure.
   - Not covered: an upload that throws after the object was stored, so the read-back finds `release === number` and `pointerWritten` is `true`.
   - Not covered: `null`, where the read-back itself fails.
   - These are the branches that exist because the tri-state is a design point. Add two cases to the unit suite: the stub stores the pointer and then throws, and the stub throws on both upload and download.
   - I rated this Minor because I could not tell whether the task text requires these tests. If it does, make it Major.
   - Behaviour note: on a first release with no `current.json`, a failed upload reads back a 404, so `pointerWritten` becomes `null` ("unknown") although it is certainly `false`. This is acceptable but imprecise.

2. [Minor] build-release.ts:185-205: the pointer-upload step hand-rolls what `at()` does (`step = 'pointer_upload'`, its own try/catch, `new BuildFailure`). `step = 'project'` (line ~151) is a plain assignment too. Mixing both styles makes the step bookkeeping harder to audit. Suggestion: give `at` an optional `onError` hook, or put the pointer upload in a small `writePointer()` helper that returns the tri-state.

3. [Minor] build-release.ts:~255, `validAsset`: `publicMediaPath(...) !== ''` is used only to force the path validation to throw. It reads as a real check but is always true. Use a form that states its purpose, for example `void publicMediaPath(...)` followed by `return true`, or a `isValidPublicPath` helper next to `privateMediaPath` in storage-paths.ts. This touches path validation, which is security-relevant code, so a change there goes back through the security review.

4. [Minor] build-release.ts:~262-270: the `bad` expression looks the asset up three times (`assetsById.has`, `get(...)!.archived`, `validAsset(get(...)!)`). Pull the asset into a local first. `projectAll` (~100 lines) does four jobs: asset validity, pre-checks, the omission loop, and assembly with the copy list. Extracting `precheck()` and `assemble()` would make the loop easy to see.

5. [Minor] build-release.ts: the `sort_at === null ? null : iso(...)` expression appears three times (context entries, and twice in `bundleEntry`). The one in `projectAll`'s context map sits outside the per-entry try/catch, so a bad timestamp there fails the whole release at step `project`, while the same value in `bundleEntry` would only omit that entry. The database column is `timestamptz`, so this cannot happen in practice. Still, extract `isoOrNull` and keep the handling consistent.

6. [Minor] build-release.ts:~103: `releases.error.omitted` stores every omitted entry with up to 20 issues each, with no cap on the number of entries or total size. A mass-invalid tenant would bloat the row and the alert's audit details. Cap the entries stored (for example 50, plus a count).

7. [Minor] build-release.ts:114: `process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''` is the same fallback as process-request.ts:206. It is only reachable when the caller passes `options.db` without `mediaUrl`, because `createAdminClient()` throws when the variable is unset. In that case every image would silently resolve to null (non-https) in a delivered bundle. Throw when the variable is empty instead of defaulting.

8. [Minor] `__tests__/build-release.integration.test.ts:~28-45`, the `prepareLabak` setup in the `beforeAll`:
   - It finishes every `building` labak release as failed. If another integration file runs concurrently and holds a legitimate build, this kills it. The busy test also depends on there being no other build.
   - Vitest integration files should run serially for labak. Add a comment saying so, or restrict the cleanup to releases older than some age.
   - The placeholder originals uploaded for already-published labak entries rely on 409-as-ok, which is fine.
   - Within the same file, the `build` wrapper (`const result = ...; return result;`) is redundant.

9. [Minor] Integration test, first case (~line 150): `releases.error` is deliberately not asserted, and the comment explains why. That is acceptable. However, no test pins "delivered with no omitted entries has `error` null" against the real database. The unit test (`p_error: null`) covers the argument but not the stored value. A cheap option is to assert `row.error` is either null or has an `omitted` list that excludes the entries the test created.

10. [Minor] `096_release_build.test.sql`: the plan(17) count is correct, and the cases map to the refusals in the function. The `tests.pub` and `tests.asset` helper functions are re-declared per file (the same pattern as in 090). Moving them into `_helpers.sql` would remove the duplication, but that is not required.

Security-relevant code touched by suggestions: only item 3 (storage-paths validation). Everything else is outside the security checklist. Items 6 and 7 touch what is stored and logged, which is low risk.

Files reviewed (all under /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt):
- apps/cms/src/privileged/worker/build-release.ts
- apps/cms/src/privileged/worker/storage-paths.ts
- apps/cms/src/privileged/worker/__tests__/build-release.test.ts
- apps/cms/src/privileged/worker/__tests__/build-release.integration.test.ts
- supabase/migrations/20261102001200_release_build.sql
- supabase/tests/database/096_release_build.test.sql
- the packages/schema and packages/rich-text diffs
- the apps/demo-site fixture generator
