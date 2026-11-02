# Task 30, spec review, round 1 (cms-spec-reviewer)

Diff `f55b64d..8aa9d69` in `.worktrees/lane-b`. Report as returned by the reviewer:

PASS

No Critical or Major findings. Ran the full suites and read the diff against Task 30 and decisions 36.2, 36.4 and 37.1–37.2.

Commands run in `.worktrees/lane-b`: `git status --porcelain` before and after (empty); `git diff f55b64d..8aa9d69`; `pnpm test` (43 files, 841 passed); `pnpm db:reset && pnpm db:test` (17 files, 1374 tests, PASS, including 098, 010, 090, 100); `pnpm db:stop`. The `*.integration.test.ts` files were read, not run.

Requirements and tests, all present and able to fail:
- Stale releases: `api.worker_fail_stale_releases()` (invoker, `search_path = ''`, service_role-only, > 420 s); pgTAP covers 419 s / exactly 420 s, the audit event, late `finish(delivered)` and `finish(failed)` refused with `forbidden` and changing nothing, next `worker_begin_release` gives number 4; `sweep.ts` runs it as step 0 with one alert per release; unit and integration tests show the tenant built in the same sweep.
- Pointer only moves forward (decision 37.1): `api.worker_pointer_check(uuid)` same grants; `build-release.ts` (c) current pointer ≥ N refused, (b) DB check, (a) 270 s deadline, write after them; a refused or failed finish after the write leaves the pointer, no repair, alert `release.finish_refused`, requests unlinked; tests for (a), (b), (c) and finish refused after and before the write.
- Missing private files: `process-request.ts` checks the private original of every non-archived referenced asset with `public_path = null` before commit; `failed_validation {code:'asset_missing', assetIds}`, alert, no commit; unit tests and `build-release.integration.test.ts:493` check the live revision stays and other entries are unaffected; a failing lookup is an unexpected error (retried).
- Counts in 010, 100 (20 worker/admin, 29 total) and 090 (two new return types).
- Deferred rows: pointer row handled; `finish('delivered')`-after-pointer row handled with the 090 header note; Task 20 quality row items each tested (`projectAll` size and per-file pgTAP helpers left as the row says); Task 21 quality row items handled.
- Earlier interfaces: additive only (`processRequestById`/`processPendingRequests` options, `BuildOptions.clock`, `confirmRelease` `retry`). Nothing beyond the task.

Rulings: (a) keeping every omitted entry and trimming only the detail beyond 50 is acceptable and the safer reading (every omission stays visible; size bounded); Minor at most. (b) the note in `090_api_worker.test.sql` is correct (applied migrations are not edited). (c) `098_worker_recovery.test.sql` is fine.

Findings:
- [Minor] `apps/cms/src/privileged/worker/build-release.ts` (`storedOmissions`, `MAX_STORED_OMISSION_DETAILS`): caps the detail rather than the number of entries; see (a). No correctness impact.
