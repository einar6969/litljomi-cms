# Task 20, spec review, round 1 (Sonnet)

Verbatim report.

PASS

Task 20 does what its text, as amended by decisions 34 and 35, says. I found no Critical or Major finding, only the Minors below. I could not run the integration tests or the pgTAP suite (no database commands, as instructed), so I judged those by reading them.

Commands run:
- `git diff --stat`, `git diff 91d3334..2803b63` (docs, migration, pgTAP, packages, fixtures) and reads of the worker sources and tests.
- `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs`: all clean. `pnpm test`: 38 files, 622 tests pass.
- `git status --porcelain` is empty.

**Interface and steps**
- `buildRelease(tenantId, options?)` returns `{ status, releaseId?, number?, omitted: [{ entryId, requestIds, error }], bundle?, previousBundle? }` (`apps/cms/src/privileged/worker/build-release.ts`).
  - `busy` is `{ status: 'busy', omitted: [] }` and is detected by `id == null` on the row of nulls.
  - `bundle` and `previousBundle` are returned on delivery; `previousBundle` is null for a first release.
- storage-paths exports `deliveryBundlePath` (`{slug}/releases/{n}.json`), `deliveryPointerPath` (`{slug}/current.json`) and `publicMediaPath` (`{slug}/{assetId}/{filename}`). It also exports `pointerBundlePath` and `privateMediaPath`, and the unit tests pin all the path forms.
- Steps 1–10 run in the specified order, with the previous release read straight after begin (decision 35).
- Any failure up to and including the pointer read-back calls `worker_finish_release('failed', …)` with `{ code, step, message, pointerWritten, omitted? }`.
- `omitted` is stored as `{ omitted }` in `releases.error` and alerted as `release.entry_omitted` after the finish call. The `{ omitted }` error is passed through `p_error` in the delivered finish call.
- Delivered builds link all snapshot requests, including those of omitted entries, as decision 35 says. `Pointer.bundle` is `releases/N.json` and `p_bundle_path` is `{slug}/releases/N.json`.

**Cache header (decision 34.4)**
- `docs/verification/m1-gates.md` records a probe table showing `immutable` can be set via storage-js's `headers` option, so no spec §7.2 amendment is needed.
- The task text's `cacheControl: '31536000'` is superseded accordingly.
- The integration test re-checks both headers through the public URLs.

**Migration `20261102001200_release_build.sql` and pgTAP `096`**
- The migration replaces `worker_finish_release`: `delivered` requires a bundle path, and `failed` links no requests and no assets, both refused with 22023 before anything changes.
- `096` has 17 cases covering this, including that a failed build's request reaches the next snapshot.
- The existing 090 cases still fit the new check order (the assets-array check comes before the bundle-path check).

**The eight test cases**
- All eight are in `build-release.integration.test.ts`: withdrawal wins, archived entry absent, n and n+1 with the pointer at n+1, busy, omitted entry (omitted, recorded, alerted, others delivered), asset not copied and never-published drafts' assets not public, contentHash recomputed, and pointer-upload failure.
- They all assert real outcomes and can fail.
- The unit test file covers the same behaviour with an in-memory storage plus the failure paths.

**Deferred rows cleared**
- Task 15 security (asset URLs): `canonicalHttpsUrl` rejects credentials and delivers `href`; `resolveAsset` and rich-text image projection use it, with tests. The inclusion-predicate comment is on `ProjectionContext.entry`, and projection goes only through `projectEntry`.
- Task 18 security (`canonicalJson` `toJSON` and accessors on arrays and objects): done, tested.
- Task 8 security Minor 2 (copy half): `validAsset` requires `original_path === privateMediaPath(...)`.
- Task 10 security Minor 3: `filename()` refuses backslashes and control characters.
- Task 11 security Minor 2: delivered needs a bundle path and failed links nothing.
- C1 cleanup row: `isHttpsUrl` refuses credentials.
- Task 26 fixture hash: `generate.ts` and the regenerated `1.json` use `entryContentHash`, and the fixture test checks it.

**Implementer choices**
- All are acceptable.
- Reading "all snapshot requests are linked" as delivered-only is the only workable reading, because linking requests to a failed release would drop them from the build queue. The migration enforces it.
- `entryContentHash` in `packages/schema` is the single hash helper shared by the worker and the fixtures. Bundle entry field order has contentHash after revisionId.
- A previous bundle that cannot be read, or a tenant with no module, fails the build rather than withdrawing content.
- Archived asset resolves to null. An invalid asset path omits the entry with `asset_path_invalid`, and the omission cascades until stable.
- ISO timestamps, `upsert: false` for bundles, and the `pointerWritten` tri-state (a false/true/null read-back after an upload error) are sound.

**Minor findings**
1. [Minor] `build-release.ts` (the `release.failed` alert in the catch block; the extra options argument): a `release.failed` alert on every failed build and the optional `BuildOptions` second argument are both beyond the task text. Both are harmless, and the second argument keeps `buildRelease(tenantId)` compatible for Task 21. The controller should ratify them.
2. [Minor] `build-release.ts`, step 9: if `worker_finish_release('delivered')` fails after the pointer moved, the release is marked `failed` while `current.json` already names it. The next build's `previousBundle` then comes from the earlier delivered release, not from the live pointer, and the requests re-link later. The text only specifies failure up to step 8, and `pointerWritten: true` is recorded and unit-tested. Task 21's live checks should not assume `previousBundle` equals the live bundle in that case.
3. [Minor] Misleading for Task 21: requests of omitted entries are linked to the delivered release (decision 35), so "every request linked to that release" includes them. A `present` live check on those would fail. Task 21 should exclude `result.omitted[].requestIds`, or treat them as `delivery failed`. Also, `bundle` is returned only when delivered, and `previousBundle` is also returned on failure.
4. [Minor] `096_release_build.test.sql` and the `090_api_worker` header: the Task 11 quality r2 row says finish_release behaviour stays with Task 20, and 090 does not say that failed now refuses links. 096 pins it, so this is documentation only.

Relevant files:
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/worker/build-release.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/worker/storage-paths.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/worker/__tests__/build-release.integration.test.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/apps/cms/src/privileged/worker/__tests__/build-release.test.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/migrations/20261102001200_release_build.sql`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/tests/database/096_release_build.test.sql`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/docs/verification/m1-gates.md`
