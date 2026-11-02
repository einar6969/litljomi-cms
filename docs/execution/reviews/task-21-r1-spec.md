# Task 21, spec review, round 1 (Sonnet)

Verbatim report.

PASS

No Critical or Major findings. I could not run anything that touches the database: the pgTAP file 097_worker_sweep, `pipeline.integration.test.ts` and `pnpm test:e2e-local` are judged by reading only. I also did not run a demo-site e2e.

Commands run: `git diff` and `git log` over 5771348..49336e7, `pnpm lint` (clean), `pnpm typecheck` (clean), `pnpm check:slugs` (ok), `pnpm test` (42 files, 713 tests, all pass, including live-check, notify, deliver, the ESLint boundary tests and the SDK tests).

**Findings (all Minor)**
- [Minor] docs/architecture.md:§7.4 against apps/cms/src/privileged/worker/sweep.ts:3-6 and supabase/migrations/20261102001300_worker_sweep.sql:2-8. This is a documented contradiction for the controller to decide, not for me. The spec says "Retries use exponential backoff for up to 24 hours". The change retries with a fixed interval, one retry per sweep, up to 10 attempts. The plan's Task 21 text and decision 35 explicitly say "fixed interval … in M1", and the implementation follows them.
- [Minor] apps/cms/src/privileged/worker/live-check.ts:`evaluateCheck` (absent branch). The spec says `absent` means "no entry marker for the id" plus a 404 for the own path. The change also requires 200 on non-own `absent` pages. This is stricter than the text. It is conservative and tested, and it fails closed, but the spec does not require it. Keep it and note it in the spec.
- [Minor] Deferred row 112 ("server-only in privileged/"). `import 'server-only'` was added to `admin-client.ts`, `internal-auth.ts` and `pipeline.ts`, which is every entry point and the only files that reach the secret key. The other privileged worker files (`deliver.ts`, `sweep.ts`, `notify.ts`, `live-check.ts`, `build-release.ts`, `process-request.ts`, `rpc.ts`, `alerts.ts`, `projection-context.ts`, `storage-paths.ts`) do not have it. I count the row as cleared; if the row meant every file, it is partial.
- [Minor] apps/cms/src/privileged/worker/__tests__/pipeline.integration.test.ts. The plan names `pipeline.test.ts`; the file is `.integration.test.ts` because it needs the stack (decision 35 allows this). The stale-hash resend is proven only in `live-check.test.ts`. The integration test says so itself, and the stale site there shows no marker, so it sends a single webhook. Accepted, as you said.
- [Minor] eslint.config.mjs (`sitePaths` second regex, `(apps|modules|packages)/` anywhere). A site's own relative import through a folder named `modules`, `packages` or `apps` would be refused. This is over-strict and harmless today, and the comment states the limit.

**Checks against the task text**
- **Signatures and behaviour.**
  - `notifySite` signs with `webhook_secrets[0]` and returns `{ok, status}`. An empty secret list is refused without calling the site. It has a 10 s timeout, does not follow redirects, never throws, and the test shows the signature verifies with `verifyWebhook`.
  - `runLiveChecks` has `pollMs` 3000, `timeoutMs` 60000 and `ownPath`.
    - `present` needs 200 and a marker with id and hash, and the old hash with a newer layout release marker fails.
    - `absent` uses `parseEntryMarkerIds`, so it fails closed on id-only markers, and the own path must be 404.
    - Media must return 200.
    - `resend` fires once, only on a stale hash after round 1.
    - It stops at the timeout.
  - Fetches use no redirects, no cache, a 10 s limit and a 5 MiB cap.
- **Pipeline and routes.** `processAndDeliver(requestId, options?)` and `sweep(options?)` are in `pipeline.ts`. Both routes already call them: the worker route returns 202, the cron route returns 200 or 500.
- **live_status.** It is recorded as `'ok'` or `'not_confirmed'`, with `p_notify_status` null when only live is recorded. A failed notification is recorded as failed with live left pending, and the migration's `worker_record_delivery` handles null correctly. Every linked request is live-checked, and `'ok'` is recorded only when all pass. Failures go in `last_error` (capped at 50).
- **Implementer choices I judge acceptable.**
  - The extra `deliver.ts`, because it is shared by the fast path and the sweep.
  - The additive `requests?` on `buildRelease`. It is optional and set only on delivered builds.
  - Per-entry targets. An omitted publish gives `delivery_failed`, which matches §7.1 "never live". An unpublish uses the previous release's record for its checks.
  - One resend per site per delivery (`once`).
  - Fixed-port fake site 3198 on labak, with other sites deactivated and restored.
  - `CMS_MEDIA_HOST=media.example.test`, since demo events have no images.
  - `cms-next.sh` reads the keys from `supabase status` at run time, refuses a non-loopback stack, and keeps the secret out of the TS test and out of any file.
- **Sweep.** Order is pending requests, then releases for tenants with unreleased commits, then retries. Each step runs even if an earlier one fails, errors are collected into an `AggregateError`, and a release delivered in this sweep is skipped in step 3.
- **worker_deliveries_to_retry and pgTAP.**
  - It covers only the latest delivered release of an active tenant and active sites.
  - It uses a 5-minute grace both for "notified but live still pending" and for "no row yet", so a run still checking is not duplicated.
  - A live status of `ok` or `not_confirmed` is final, which is consistent with the task's "retry notification only".
  - Both functions are invoker, `search_path ''`, read-only and `service_role`-only.
  - The 097 pgTAP file has 29 assertions covering the grants, the 22023 parameter errors, the cap, grace, supersession, suspension and read-only behaviour. The counts in 010, 090 and 100 were updated (16 to 18 and 25 to 27).
- **Test cases in the task text.** Every one is present and able to fail by reading. That covers the old hash with a newer meta tag, the new hash, own path 200 without marker failing and 404 passing, a listing with the marker failing, media 404, one resend, the signed webhook, the pipeline committed to `ok`, and the sweep picking up a request. The pipeline tests also cover an unpublish, a non-revalidating site giving `not_confirmed`, and a failed notify retried by the sweep.
- **End to end.** The opt-in `pnpm test:e2e-local` builds and starts both apps and publishes `/events/x` as `editor_demo`. It triggers the worker route and asserts `notify_status` ok, `live_status` ok and `last_error` null. It checks the marker hash against the bundle, stops the CMS, then asserts `/events/x` still returns 200 with the same marker. It is excluded from `pnpm test:integration`.
- **Deferred rows owned by Task 21 (55, 105, 106, 107, 110, 111, 112, 113, 115, 119).**
  - Rows 55, 105, 106, 107, 110, 111, 113, 115 and 119 are cleared, each with a test.
  - Row 112 is cleared per the Minor above.

Relevant files, all under /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next:
- apps/cms/src/privileged/worker/notify.ts
- apps/cms/src/privileged/worker/live-check.ts
- apps/cms/src/privileged/worker/deliver.ts
- apps/cms/src/privileged/worker/sweep.ts
- apps/cms/src/privileged/worker/pipeline.ts
- supabase/migrations/20261102001300_worker_sweep.sql
- supabase/tests/database/097_worker_sweep.test.sql
- tests/integration/src/end-to-end-local.test.ts
- tests/integration/scripts/cms-next.sh
