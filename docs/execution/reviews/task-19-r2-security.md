# Task 19, security review, round 2 (fix diff, Opus)

Verbatim report.

PASS

Task 19, security review, round 2. I reviewed only the fix diff `git diff 53606bd..91d3334` (code and tests; docs/execution excluded) in /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next at HEAD 91d3334. I found no Critical, Major or new Minor finding. My round-1 Minor about the stored message is resolved.

What I ran: `pnpm test` passed (36 files, 554 tests). `pnpm lint` and `pnpm typecheck` both exited 0. I ran no database command. `git status --porcelain` is empty afterwards. The diff touches only apps/cms/src/privileged/worker/{process-request.ts, __tests__/process-request.test.ts, __tests__/process-request.integration.test.ts, __tests__/alerts.test.ts (new)} and tests/integration/src/service-role-timeout.test.ts. Nothing changed under supabase/, packages/ or .claude/ (`git diff --stat` on those paths is empty).

**Round-1 Minor (stored raw database message): resolved.**
- process-request.ts:152 now stores `failure = { code: 'unexpected', attempts }` with no `message`.
- That object is the only thing passed as `p_error` to worker_reject_request (:158) and returned as `errors` (:167).
- The database message (`messageOf(error)`) is only in `details`, which go to console.error and `worker_record_alert` (:153, :163, :166). Editors cannot read that path; it was rated in round 1 as service_role or platform admins only.
- The unit test at process-request.test.ts:~203 pins `p_error` as exactly `{ code: 'unexpected', attempts: 5 }`, so it would fail if the message came back.
- The new projection paths store only `projection_failed` with issuesOf(...) (code, path, message from the schema's own issues) or `too_deep`. As before, no database text reaches publish_requests.error.

Checklist items the fix touches:

6. **pass:** no change to how the tenant is derived. outcomeOf and base still take tenant data from the database read or the claimed row (process-request.ts:155–157). The new `details` takes tenantId from `row.tenant_id`, which the claim returned. It only labels the alert.

7. **pass:** worker_* calls are unchanged and all go through createAdminClient (service_role). No function, grant or migration changed.

8. **pass:** the commit path is unchanged, and none of the new error paths can commit without validation or mark a request done wrongly:
   - The order is still: validate (:198), then the slug check (:203), then the projection (:209), then the commit (:213).
   - `project()` (:240–249) keeps the old semantics. ProjectionError becomes projection_failed, RangeError becomes too_deep through depthGuarded, and any other error is rethrown into failUnexpected. Only a null result reaches `commit`.
   - New unit tests check both projection branches with `called('worker_commit_publish')` equal to [], so they fail if the code commits.
   - addRecordedErrors (:131–138) runs only when the commit function returned a non-committed status. The database has already finished the request by then. A failed re-read is logged, and the function returns the status the database reported, without `errors`. It cannot turn a request into done, and it calls no reject (the test asserts worker_reject_request is []).
   - In the old code, the same failure went to failUnexpected. At attempt 5 that would have tried to reject an already finished request. The new handling is safer.
   - At the 5th attempt, when storing the failure fails (:159–164): forbidden or not_found is still treated as skipped. Any other error is logged, an alert is raised with `stored: false` and `storeError`, and the error is rethrown. The request stays validating for the re-claim and is not reported as failed.
   - processPendingRequests (:89–92) logs the error and leaves that request without an outcome.
   - The unit test "logs and alerts when the 5th attempt cannot store failed" asserts that the outcomes are only [['r2','committed']]. It would fail if the error were swallowed into an outcome again.

10. **pass:** no secrets in logs or alert details:
   - `message` and `storeError` are `WorkerRpcError.message` (`"<fn>: <sqlstate> <db message>"`, rpc.ts:9) or String(error).
   - console.error logs the Error object, which carries only fn, code and dbMessage (rpc.ts:4–15). It does not carry the client, headers or key.
   - Nothing new is sent to a client or site. processRequestById and processPendingRequests still have no callers outside the worker (grep).
   - alerts.ts is unchanged. The new alerts.test.ts confirms the alert still resolves when recording fails.

13. **pass:** no contradiction with the spec. A request whose 5th-attempt failure cannot be stored stays validating and gets an alert on each sweep, which is consistent with §6.3's retry and alert rule.

14. **pass:** no change under .claude/**.

Interface: no change. The exported signatures of processRequestById and processPendingRequests and the RequestOutcome and RequestStatus types are unchanged. ClaimedRequest, CommitStatus and Failure are internal type aliases.

Tests can fail:
- The re-read-failure test would fail against the old code, which threw.
- The unstored-failure test would fail if the error were swallowed or the alert were missing.
- The stable-code test would fail if `message` came back into `p_error`.
- The service-role-timeout change moves the "request still validating, no revision" assertion inside try, so it still runs. The cleanup moves to finally. This is test hygiene only; the timeout bounds are unchanged.
