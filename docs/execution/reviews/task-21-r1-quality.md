# Task 21, quality review, round 1 (Sonnet)

Verbatim report.

PASS

Commands run: `git diff 5771348..c337b48 --stat`, plus reads of the files in scope. `pnpm lint` and `pnpm typecheck` are clean. `pnpm test` passes (42 files, 805 tests). I did not read the SQL migration, `097_worker_sweep.test.sql`, the SDK `parse-markers`/`revalidate-handler`/`client` changes or tests, or the eslint test file. I only skimmed `live-check.ts`.

No Critical or Major findings. The Minors below are mostly test gaps and small duplication.

**Minor**

1. apps/cms/src/privileged/worker/deliver.ts:166-190, and `__tests__/deliver.test.ts`: the `confirmSite` error branches have no test. The branches are `retries_exhausted` at attempt 10, the `no_webhook_secret` code when every secret is empty, and the `not_confirmed` result with the `more` count when failures exceed `MAX_STORED_FAILURES`. A grep of the tests finds none of these tokens, so a regression in the alert threshold (`attemptsBefore + 1 >= MAX_NOTIFY_ATTEMPTS`) would not be caught. Suggestion: add unit cases to `deliver.test.ts` using its fake db and `startFakeSite`, with `alert` mocked. They need no database. This touches the live-check and webhook result paths, so the security reviewer should see it. It adds tests only, not production code.

2. apps/cms/src/privileged/worker/sweep.ts:47-79: the `AggregateError` and "a failing step does not stop the next one" behaviour is untested. Only success paths are covered in `pipeline.integration.test.ts`. A mocked unit test is enough: make `processPendingRequests` reject and check that steps 2 and 3 still run, then that the sweep throws an `AggregateError` with one error per failed step.

3. apps/cms/src/privileged/worker/sweep.ts:97-128 against deliver.ts:237-243 (duplication between the sweep and the fast path): `retryRelease` repeats the sequence in `confirmRelease`. Both look up the module with the same "no module for tenant" throw, call `liveTargets(..., mediaPrefix())`, call `worker_sites`, and call `confirmSite`. The only differences are that the retry reads bundles from storage and passes `notify_attempts`. A small helper in `deliver.ts` that takes the release and returns targets and sites would remove it. This is not security-relevant; `confirmSite` stays as is.

4. apps/cms/src/privileged/worker/deliver.ts:253-267 (`deliverTenant`): the `result.releaseId`, `result.number` and `result.bundle` checks only narrow optional fields of `BuildResult`, and nothing says so. A short comment would help, or a discriminated `BuildResult` for the delivered case. The `BuildResult` change is a different design, so the comment is the in-scope option.

5. apps/cms/src/privileged/worker/deliver.ts:241-242: if one site's `confirmSite` throws, `Promise.all` rejects on the first error. The other sites' work keeps running unobserved, so the sweep's `Promise.allSettled` log sees only the first failure. Use `allSettled` here and rethrow an `AggregateError` for symmetry with `sweep.ts`. The same applies at sweep.ts:122. This is not a correctness bug, because `confirmSite` records its own outcomes.

6. apps/cms/src/privileged/worker/deliver.ts:201-203: the `failures.push` calls from concurrent targets make the order of the stored failures non-deterministic. Sorting by `entryId` before slicing gives a stable `last_error`. This is only a diagnostic.

7. apps/cms/src/privileged/worker/__tests__/pipeline.integration.test.ts:20, 99-124:
   - Fixed port 3198 has no collision guard. A stale process would fail with a bare EADDRINUSE from `startFakeSite` after the labak setup has already run. The e2e test guards its port with `reachable()`, and the same early check here would give a clearer message.
   - `afterAll` reactivates the deactivated sites, but a kill during the run leaves labak sites inactive. Resetting `active` for all labak sites in `prepareLabak` would make the next run self-healing.
   - The assertion `expect(webhooks().length - before).toBe(1)` assumes no stray sweep traffic. This is acceptable because the file runs serially.

8. tests/integration/src/end-to-end-local.test.ts:127-148, and the `afterAll` there:
   - Cleanup relies on `afterAll`. A SIGINT of vitest, or a build that spawned worker grandchildren, can leave `next` processes running. Port 3101 would then remain in use, and the "already in use" guard would trip on the next run. A `process.once('exit', ...)` kill of `started` is cheap insurance.
   - The 90 s `waitUntilServing` is fine.
   - `rmSync(.next)` runs only after the CMS is up, and only on the demo site, so it cannot hit anything else. It would be clearer to move it next to `siteBuild`, but it is already adjacent.
   - The `waitFor` predicate at lines 188-194 treats `notify_status === 'failed'` as terminal. That fails fast, which is good, but the nested ternary is hard to read. Name it `settled`.

9. apps/cms/src/privileged/worker/deliver.ts:134-141 (`once`): its comment says "One resend", but `done = true` is set before `await fn()`. If the resend throws, it is never retried. That matches "at most once per run", but `notifySite` never throws, so the point is only theoretical. Say in the comment that a failed resend is not repeated.

10. tests/integration/scripts/cms-next.sh:11-14: `tr -d '"'` and `sed` parse `supabase status -o env`. Because of `set -eu`, a failure of `supabase status` is hidden by `2>/dev/null` and shows up only as "no keys". The message already hints at `pnpm db:start`, which is enough. This is shell and secrets handling, so flag it as security-adjacent: leave it unchanged unless the security reviewer agrees.
