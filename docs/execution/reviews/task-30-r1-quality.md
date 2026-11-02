# Task 30, quality review, round 1 (cms-quality-reviewer)

Diff `f55b64d..8aa9d69` in `.worktrees/lane-b`. Report as returned by the reviewer:

PASS

Commands run: `git diff f55b64d..8aa9d69` (source and unit tests), `git status --porcelain` (empty), `pnpm lint` (clean; only macOS certificate-trust noise), `pnpm typecheck` (clean). Unit tests not run by the reviewer; no database command. The sweep and process-request test diffs were read in part.

No Critical or Major findings. The `at()`/`BuildFailure` threading is correct (`at` re-throws an existing `BuildFailure`, so `pointer_refused` and `finish_refused` survive); the forward-only checks (c), (b), (a) are ordered closest to the write; the tests exercise real behaviour (deadline 270000 vs 269999, `latest_delivered` equal to and above N, unreadable pointer, another tenant's pointer, finish refused after the write with the pointer left at 3 and no second upload, omission cap); `confirmRelease` settles every site and throws `AggregateError`, replacing the duplicated retry logic, with tests.

Minor findings:
- `__tests__/build-release.test.ts`, "a finish refused before any pointer write (step failed earlier) is not retried either": the title does not match the path tested (catch-block `console.error`); rename; the `console.error` spy is never restored; nothing asserts the log.
- `process-request.ts:126` and `build-release.ts:56`: `MEDIA_PRIVATE` defined twice; in process-request after its use. Share from `storage-paths` or move above use.
- `20261102001400_worker_recovery.sql:699-701` and `sweep.ts:594`: 420 s as SQL literals and as `STALE_RELEASE_SECONDS`, kept equal only by comments; assert equality in a test.
- `process-request.ts:121-122`: `exists()` ignores `error`; relies on storage-js throwing except on 400/404; add a unit test or name the storage-js version.
- `build-release.ts` (~158): the `pointer_deadline` throw is the only check outside `at()`; comment or wrap it.
- `build-release.ts`: any `forbidden` from `worker_finish_release` is treated as `finish_refused`; the comment's "for example failed as stale" suffices; no change required.

Nothing here touches security-relevant code beyond what the security review covered.
