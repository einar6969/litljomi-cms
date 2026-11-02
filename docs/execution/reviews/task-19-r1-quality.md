# Task 19, quality review, round 1 (Sonnet)

Verbatim report.

FAIL

Commands run: `git diff --stat 00d7830..53606bd`, source and test reads, `pnpm lint`, `pnpm typecheck` and `pnpm test` (unit). All three exited 0 (the repeated "failed to copy trust settings" lines are environment noise). I ran no database command. `git status --porcelain` is unchanged by me. Task 11's `pipeline.ts` is only a stub (`processAndDeliver` and `sweep`), so there is no duplication with Task 11 helpers.

**Major**

1. [Major] apps/cms/src/privileged/worker/process-request.ts:~104-107 (`processPendingRequests` catch) with `failUnexpected` (~120-135): an error is swallowed without being logged.
   - The empty `catch {}` relies on the comment "Logged by processClaimed". That is true only for the below-limit branch.
   - At the 5th attempt, if `worker_reject_request` fails with anything other than forbidden or not_found, `failUnexpected` rethrows `rejectError`. Nothing logs it, and the alert is never raised.
   - The sweep then drops it. The request stays `validating` and the same thing repeats on every re-claim, with no log line.
   - Suggested change: log `console.error` with the request id in the `processPendingRequests` catch (this covers both paths), or log in `failUnexpected` before rethrowing. Add a unit test for "5th attempt, reject fails with XX000": it should log, and the sweep should continue with the other requests.

2. [Major] apps/cms/src/privileged/worker/process-request.ts:~178-182 and its tests: the projection step has no test at all.
   - Neither `process-request.test.ts` nor the integration test exercises the `projection_failed` branch or the `RangeError` to `too_deep` branch around `projectEntry`.
   - Both branches run every time a request is published. The `too_deep` unit test covers only the separate `validate()` path.
   - A wrong shape in `issuesOf(error.issues)` for a `ProjectionError` would go unnoticed, or the code would throw instead of storing `failed_validation`.
   - A natural integration case is a draft that references an asset with no `public_path`. The commit's reference check allows it, but `resolveAsset` returns null.
   - Suggested change: add a unit test with a fake type or ref that makes `projectEntry` throw `ProjectionError`, and one for the `RangeError` from projection. Assert the stored `p_error` and that no commit is called.

**Security reviewer's points, rated in my scope**

3. (a) [Minor] process-request.ts:~159: `slug_required` is checked on the read and not re-checked at commit.
   - It affects integrity only. The window is small, and the revision stores no path, so nothing wrong is delivered.
   - The release build projects with the real slug anyway.
   - No code change is needed. Optionally add a comment next to the check saying it is read-time only, and why that is acceptable.

4. (b) [Minor, security-relevant, send back to the security review before any change] process-request.ts:~131: the 5th-attempt `failed` error stores `error.message`, the raw `WorkerRpcError` text `"<fn>: <code> <db message>"`.
   - Editors can read this through `publish_requests.error`.
   - The code path is clear and the tests pin the format.
   - If it is changed to a generic message (full text only in `console.error`), the existing 5th-attempt unit test asserts the stored message and would need updating.

**Minor**

5. [Minor] process-request.ts: `ClaimedRow & { id: string }` is repeated 4 times and cast once (`row as ClaimedRow & { id: string }`). Name it, for example `type ClaimedRequest`. `Result['status']` is also used as a stand-in for the commit's return type; `type CommitStatus` would be clearer.

6. [Minor] process-request.ts:~172-184: the draft is validated twice. `validate()` runs the publish validator, then `projectEntry` validates again internally and throws `ProjectionError`. The split gives distinct codes (`invalid_data` vs `projection_failed`) but is not obvious. A one-line comment would help. The `RangeError` to `too_deep` handling is duplicated in `validate()` and in the projection catch.

7. [Minor] process-request.ts:~86-100: the flow reads clearly overall, but `processClaimed` mixes three outcomes: thrown (retry), stored (reject or commit), and skipped (forbidden or not_found). The doc comments say so, which is good. A failure of the post-commit re-read (the `after = worker_read_request` call for `errors`) is treated as an unexpected error and retried, even though the request is already finished. The retry then just returns `skipped`. This is harmless but surprising. Consider catching it and returning the status without `errors`.

8. [Minor] process-request.integration.test.ts, `processPendingRequests` test: `update cms.publish_requests set status = 'failed' where status in ('pending','validating')` mutates global shared state to get isolation. It couples this test to the other suites' ordering. The expected order `[good, bad]` also silently depends on "oldest first". Both are acceptable, but a comment on the ordering would help. The deep relative imports (`../../../../../../tests/integration/src/...`) are fragile; a path alias would be better if one exists.

9. [Minor] tests/integration/src/service-role-timeout.test.ts: the 9.5–12 s window is reasoned carefully, the lock-hold trick is well documented, and the 2 s upper margin is adequate.
   - The final cleanup (`update ... set status='failed'`) sits after the assertions, so a failing assertion leaves a `validating` row behind. Move it into the `finally`.
   - `closeClient(holdRequest)` is called twice (once in the test body, once in the `finally`). Confirm it is idempotent, or add a comment saying so.
   - `sleep(6000 - (Date.now() - started))` cannot go negative in practice, because `waitForRestBackend` is capped at 3 s.

10. [Minor] apps/cms/src/privileged/worker/alerts.ts: the design is fine, since `alert` never rejects. The unit test for the 5th attempt exercises the real `alert()` through the fake client, which is good. No test covers "recording the alert fails, so it is logged and the caller still gets `failed`". It is cheap to add, as a handler for `worker_record_alert` that returns an error.

The remaining files read cleanly and their tests check behaviour: `rpc.ts`, `projection-context.ts` (with its test file), `worker-trigger.ts` and its test, the migration, and the concurrency test for the tenant FOR SHARE lock.

The verdict is FAIL because of findings 1 and 2. Once both are fixed (a log or test on the swallowed path, and tests for the projection branches), I expect PASS.
