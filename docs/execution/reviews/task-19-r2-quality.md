# Task 19, quality review, round 2 (fix diff, Sonnet)

Verbatim report.

PASS

Commands run: `git diff 53606bd..91d3334` (excluding docs/execution), `pnpm lint && pnpm typecheck && pnpm test`. All passed; the test run showed 36 files and 554 tests passing. I ran no database command and changed nothing.

**Round-1 Majors**
1. The swallowed 5th-attempt error is resolved. In `apps/cms/src/privileged/worker/process-request.ts`, `failUnexpected` now logs the failed `worker_reject_request` and raises an alert with `stored: false` and `storeError` before it rethrows. The `processPendingRequests` catch also logs the request id and the error instead of staying empty. A new unit test in `__tests__/process-request.test.ts` checks the log line, the alert details and that the sweep continues with r2.
2. The untested projection branches are resolved. Two new unit tests cover a `ProjectionError`, which stores `projection_failed` with the issues, and a `RangeError` from the projection, which stores `too_deep`. Both assert the stored `p_error` and that no commit is called. The `RangeError` handling now lives in one helper, `depthGuarded`, used by both `validate()` and `project()`, which removes the duplication.

**Round-1 Minors**
- Minor 4, the stored error text: it now stores only `{code, attempts}`. The database message goes to the log and the alert only, and the test pins this. This touches security-relevant code, but the security re-review has already passed.
- Minor 5: `ClaimedRequest` and `CommitStatus` are named and used.
- Minor 6: there is a comment on why the draft is validated twice, and the `RangeError` duplication is gone.
- Minor 7: `addRecordedErrors` logs a failed re-read and returns the status without `errors`. A test covers it.
- Minor 8: comments were added on the shared-state reset and the claim ordering. The deep relative imports remain; I'm leaving that as not worth a change.
- Minor 9: the cleanup moved into the `finally`, and the post-assertions moved before it. `closeClient` is idempotent (`sql.ts`: `if (!open.delete(c)) return`), and a comment now says so.
- Minor 10: new `alerts.test.ts` covers a failed recording, and a `process-request.test.ts` case covers `failed` still being returned.
- Minor 3, the `slug_required` read-time comment: added.

**New findings**
- [Minor] `process-request.ts`, `failUnexpected` (reject-failure branch) plus the `processPendingRequests` catch: when storing `failed` keeps failing, each re-claim (attempts above 5) raises another alert and logs two or three lines. That is arguably desired noise, but it could flood the audit log. No change needed now; I'd note it for the alerting design.
- [Minor] `process-request.test.ts` (`unprojectableType`): `[projectionIssue] as never` is a type-escape cast in test setup. Harmless, but a typed issue would be tidier.

Nothing new is Major or Critical.
