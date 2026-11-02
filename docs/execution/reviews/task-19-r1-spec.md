# Task 19, spec review, round 1 (Sonnet)

Verbatim report.

PASS

Commands run: `git diff --stat 00d7830..53606bd`; `pnpm lint`, `pnpm typecheck` and `pnpm check:slugs` (all clean); `pnpm test` (unit only: 35 files, 548 tests passed); `git status --porcelain` (empty). I ran no database command. I judged the integration and pgTAP tests by reading them and could not run them.

Findings:
- [Minor] apps/cms/src/privileged/worker/alerts.ts:17: the plan says `alert(event, details): void`. The change returns `Promise<void>`, and the promise never rejects. This is justified, because the audit insert is async. Task 20 and Task 21 must `await` it. The change also does not write `alerts.ts`'s companion `privileged/worker/trigger.ts` from the task's file list. Decision 35 moves `triggerWorker` to `apps/cms/src/lib/worker-trigger.ts`, which exists, has `import 'server-only'` and the right signature, and needs only `CMS_INTERNAL_SECRET` and `CMS_PUBLIC_URL`. No finding there.
- [Minor] apps/cms/src/privileged/worker/process-request.ts:~137: a draft-moved (superseded) commit is called with `p_validated_schema_version = draft.schema_version` and `p_validated_draft_version = request.draft_version`. The DB records `superseded` before it checks the schema version, so this is harmless and matches flow step 2.
- [Minor] apps/cms/src/privileged/worker/projection-context.ts:~84: the pre-commit projection context sets `sortAt: null` for referenced entries, because the read does not return it. Entry `path()` calls that need `sortAt` would yield a null path (path is null when `path()` throws). No M1 path needs it, and the comment says so. If a later module path uses `sortAt`, the pre-commit projection and the release build (Task 20) could differ. Task 20 should share the builder, but its `ContextEntry` input differs.

Verified against the task text and decisions 33–35:
- **Interfaces:** `processRequestById`, `processPendingRequests(limit = 10)` and `RequestOutcome` exist. `RequestOutcome` has `entryId`, `action`, `type` and `tenantSlug` (nullable only for a request that failed before it could be read) and the `'skipped'` status.
- **Migration** `20261102001100_worker_phase3.sql`:
  - `worker_claim_request` returns a null row when the request is not claimable, uses `skip locked`, and claims a pending request or a stale `validating` one older than 5 minutes.
  - `worker_read_request` is extended with `tenant` and, per ref, the type, slug and title (entries) or the asset fields including `public_path`.
  - `worker_record_alert` writes `system.alert.<event>` with a null actor and validates its inputs (22023 for a bad event name or details, `not_found` for an unknown tenant). All are invoker, `search_path = ''`, and granted to `service_role` only.
  - Decision 33 is met: UPDATE on `cms.tenants` is narrowed to `(name, status)`, and both commit functions lock the tenant row `FOR SHARE` before the status check. No membership lock or grant was added, and the race is documented.
  - Decision 34.1 is met: `alter role service_role set statement_timeout = '10s'` and `notify pgrst, 'reload config'`. `tests/integration/src/service-role-timeout.test.ts` checks the role setting and a 57014 cancellation over REST.
- **Flow steps 1–7:** all present, with the check order superseded → unknown_type → schema_outdated → validation → slug_required → projection → commit. The `slug_required` check only fires when `module.site[type.name]` exists. The ProjectionError and RangeError handling is as specified.
- **Choices that go beyond the text, judged:**
  - Stored error codes `unknown_type`, `schema_outdated`, `invalid_data`, `slug_required`, `projection_failed`, `too_deep` and `unexpected`: consistent with the task and decisions. Tasks 20, 21 and 25 should treat `errors` as opaque JSON.
  - Unexpected errors below 5 attempts are rethrown, and `processPendingRequests` swallows them, so that request has no outcome in that run. At 5 attempts the worker calls `worker_reject_request(... 'failed')` and alerts. This matches decision 35.
  - `forbidden` and `not_found` from a commit become `skipped`, and a claim that returns nulls becomes `skipped`. This matches decision 35.
  - The pre-commit media URL is `{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/media-public/{path}`. It is https only when the Supabase URL is https, so locally `resolveAsset` drops non-https URLs. Task 20 must reuse the same builder. This is acceptable under decision 34.3.
- **Tests (read, not run).** All seven required cases are present, plus `schema_outdated`, `slug_required`, `skipped`, and `processPendingRequests`. Each can fail:
  - The `failed_validation` case asserts `issues` contains the path `['image']`, that the stored error equals the outcome error, and that `revisionCount` is 0.
  - The `revoked` request is inserted as owner and asserts `{code:'forbidden'}`.
  - The committed case asserts `revision_refs` equal `draft_refs` and the exact revision data, `draft_version` and `schema_version`.
  - The superseded case asserts the stored error contents.
  - The unit test covers `too_deep`.
- **pgTAP:** `095_worker_phase3.test.sql` is new, and the existing pgTAP files were updated for the changed grant and extended read.
- **Deferred Minors owned by Task 19:**
  - Row 5 (tenants UPDATE) is cleared by the column-level grant.
  - Row 14 (the catch part) is cleared: a `RangeError` becomes `failed_validation` with `too_deep` in both `validate` and projection.
  - Row 83 (statement timeout) is cleared by the role setting plus the REST proof.
  - Row 88 (tenant lock) is cleared by `FOR SHARE` in both commit functions.
  - The controller should flip the status in `docs/execution/deferred-minors.md`.
- **Security boundary:** I found nothing in this task's spec scope that contradicts `docs/architecture.md`.

Relevant files:
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/process-request.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/projection-context.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/alerts.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/lib/worker-trigger.ts
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/migrations/20261102001100_worker_phase3.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/__tests__/process-request.integration.test.ts
