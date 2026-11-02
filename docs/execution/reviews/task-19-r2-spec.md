# Task 19, spec review, round 2 (fix diff, Sonnet)

Verbatim report.

PASS

No Critical or Major findings, and no Minors.

Quality Major 1 (swallowed error when worker_reject_request fails at the 5th attempt): resolved.
- failUnexpected in /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/process-request.ts (around lines 158-165) now logs the reject error and calls alert('publish_request.failed', {...details, stored: false, storeError}). It then rethrows.
- processPendingRequests logs the sweep skip in its catch (error), so the failure is no longer silent.
- The forbidden/not_found case still returns skipped.
- The new test "logs and alerts when the 5th attempt cannot store failed, and continues with the other requests" can fail. It asserts the alert payload (stored: false, storeError), the error log, and that r2 still commits. Removing the alert call or the log would break it.

Quality Major 2 (no tests for the projection branches): resolved.
- The new fixture types have fields whose publishSchema is z.unknown(), so validation passes, and whose project throws.
- The ProjectionError test asserts the stored error is projection_failed with {code, path, message} issues, the failed_validation status, and no worker_commit_publish call.
- The RangeError test asserts too_deep in both the outcome and the reject payload, and no commit.
- Both tests can fail. Removing the ProjectionError branch or the depth guard would fail them.
- project() is wrapped in depthGuarded, which also covers the validator's RangeError handling.

Task text and decisions:
- No interface changed. processRequestById, processPendingRequests, RequestOutcome, alert, triggerWorker, the stored error codes and the SQL functions are untouched. The edits to the exported functions' bodies, the new named types, ClaimedRequest and CommitStatus, and the helper functions are internal.
- The 5th-attempt stored error is now { code: 'unexpected', attempts }, which still matches decision 35: at 5 attempts the worker calls worker_reject_request(id, 'failed', ...) and alerts. The database message now goes only to the log and the alert, not to the editor-readable stored error. The unit test was updated to match.
- A failed re-read of the recorded error after a commit now logs and returns the status without errors. A new unit test covers this.
- The new alerts.test.ts checks that a failing worker_record_alert is logged and alert still resolves.
- The timeout-test cleanup in /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/tests/integration/src/service-role-timeout.test.ts moved into finally, and the assertion moved inside the try. The rest of the diff is comments.
- Nothing extra beyond the listed findings.

Commands run (all in /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next):
- git diff 53606bd..91d3334, excluding docs/execution: read.
- pnpm lint: exit 0.
- pnpm typecheck: exit 0.
- pnpm test: exit 0, 36 files and 554 tests passed.
- git status --porcelain: only the pre-existing docs/execution changes; the review left no changes of its own.

I ran no database commands. I did not run the integration tests, including the edited service-role-timeout.test.ts and process-request.integration.test.ts, so I judged those from the diff alone.
