# Task 19, security review, round 1 (Opus)

Verbatim report.

PASS

Task 19 security review, round 1 (commit 53606bd, `git diff 00d7830..53606bd`). I found no Critical or Major findings. There are four Minors.

What I ran: `pnpm db:reset` and `pnpm db:test` passed (14 files, 1296 tests). `pnpm test:integration` passed (70 tests, plus 13 in the cms app). I ran catalog queries with `docker exec supabase_db_litljomi-cms psql`; host psql is not installed. I also wrote my own REST probe at /private/tmp/claude-501/-Users-einarzoega-litljomi-cms/7a6f2c82-cf64-4cb8-b189-37672d4c376f/scratchpad/probe/probe.mjs. At the end I ran `pnpm db:reset` again. `git status --porcelain` is empty.

Focus results:
- **Commit functions re-created.** I diffed both bodies against 20261102000900_api_worker.sql with `diff -w`. The only code changes are the two tenant `select ... for share` lines (/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/migrations/20261102001100_worker_phase3.sql:265 and :373). Everything else in §6.2 steps 1–8 is unchanged: step 5 still reads from the copied data, decision 31's draft lock is intact, and only comments moved.
- **Lock order.** Order is request FOR UPDATE, then entry FOR UPDATE, then draft FOR UPDATE, then tenant FOR SHARE, then targets FOR SHARE in id order. I see no deadlock cycle:
  - `worker_begin_release` takes only the tenant row FOR UPDATE in its own transaction and locks no request, entry or draft.
  - `worker_finish_release` does not lock the tenant.
  - Editor paths take only foreign-key FOR KEY SHARE on the tenant, which does not conflict with FOR SHARE.
  - No suspension function exists yet; a direct status UPDATE waits, as intended.
- **Timeout over REST (decision 34.1), verified myself.** I held the request row for 5 s and the tenant row (FOR UPDATE) the whole time, then called `worker_commit_publish` with the secret key. The call was cancelled at 10013 ms with 57014 "canceling statement due to statement timeout". This also proves the tenant FOR SHARE: without it the call would have committed at about 5 s. The request stayed `validating`.
  - `pg_db_role_setting` shows `service_role {statement_timeout=10s}` (all databases) and `authenticator {statement_timeout=8s, lock_timeout=8s}`.
  - `service_role` has `rolcanlogin=f` and nothing connects as it directly (Storage `supabase_storage_admin`, Auth `supabase_auth_admin`, migrations `postgres`). The setting therefore reaches only PostgREST 16.4's impersonation; a SET ROLE does not apply role settings.
  - The 8 s lock_timeout from authenticator still applies to service_role requests.
- **Decision 34.2 functions.**
  - Read targets are joined only with `te.tenant_id = r.tenant_id` and `ta.tenant_id = r.tenant_id`. The title comes from `tr.id = te.published_rev_id` only. 090 pins that cross-tenant targets read as all nulls (the trigger was disabled to set that case up).
  - Over REST, anon gets 42501 on all three functions. The alert function rejects `abc\n`, a mixed-case event and array details with 22023. The actor is null and the action always starts with `system.alert.`.
  - service_role already held INSERT on `cms.audit_log` (all columns) before this task, so the function adds no capability; `cms` is not exposed.
  - Catalog: 0 definer functions and 0 without a pinned search_path in `api`, `cms` and `private`. The ACLs on the five functions are `{postgres, service_role}` only. Counts 16 and 25 are updated in 010 and 100, and 100 adds the editor 42501 cases.
- **Tests that can fail.**
  - Tenant lock: 095 asserts pgrowlocks 'For Share' on both tenants. This would fail if the lock were removed, because the fixtures leave only 'For Key Share'. The concurrency test also uses `expectBlocked`.
  - Strict validation: the missing-image test asserts no revision row exists.
  - Version check: the superseded tests.
  - Timeout: an integration test with timing bounds of 9.5–12 s, plus the role-setting assertion in 095.

Checklist:
1. **pass:** `prosecdef=f` and `proconfig={search_path=""}` for all five functions (catalog query). A system-wide count of definer functions returns 0. All names are schema-qualified; the one bare `unnest(...)` with several arrays carries over unchanged from Task 11.
2. **pass:** the new objects are all invoker functions in `api`. A REST probe of `cms` is not needed: no exposure changed.
3. **pass:** service_role on `cms.tenants` is SELECT, INSERT and UPDATE(name, status) only (column_privileges query). No grant was added on memberships (still SELECT, INSERT, DELETE). anon has nothing. The new functions' ACLs have no PUBLIC entry (`{postgres=X, service_role=X}`).
4. **not applicable:** no table, policy or RLS change. Existing RLS is untouched.
5. **not applicable:** no new tables.
6. **pass:** claim, read and commit derive the tenant from the request row. The worker takes the tenant slug and type from the database read (process-request.ts:150–151). For alerts, `p_tenant_id` only labels the audit row and is checked to exist; it authorizes nothing.
7. **pass:** EXECUTE is held by service_role only. The commit re-checks the tenant (now under lock) and the membership. The unlocked membership read is the race accepted in decision 33 and is documented at migration lines 205–211.
8. **pass:** data is copied from `cms.drafts` (unchanged). Version and schema version are checked. Membership and tenant status are re-checked, with the tenant locked FOR SHARE. Referenced rows are locked FOR SHARE. Verified by the diff and by the REST probe.
9. **pass:** unpublish is unchanged apart from the lock. The pre-commit context resolves unpublished or archived targets to null (projection-context.ts:93–96).
10. **pass:** secret-key references appear only in `apps/cms/src/privileged/**` and their tests, plus the boundary test (grep). The diff contains no keys. Logs and alerts carry no secret. `worker-trigger.ts` is `server-only`, imports nothing, and sends only `{requestId}` with the internal-secret header (eslint boundary test added).
11. **not applicable:** no live confirmation in this task.
12. **not applicable:** no editor text.
13. **pass:** I found no contradiction with the spec. The Task 19 Files list names `src/privileged/worker/trigger.ts`, but decision 35 moved the trigger to `lib/worker-trigger.ts`, and the decisions govern.
14. **pass:** the diff touches nothing under `.claude/**` (`git diff --stat -- .claude` is empty).

Findings:
- **[Minor]** /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/process-request.ts:131. At the 5th attempt the `failed` error object stores `message: error.message` in `publish_requests.error`, and editors can read that column in their tenant. A `WorkerRpcError` message is `"<fn>: <sqlstate> <db message>"`, so raw database messages (constraint names, key values from the editor's own tenant) reach editors. I found no cross-tenant data and no secret on this path. A stable code is enough for editors; the full message already goes to the alert, which only service_role or platform admins can read.
- **[Minor]** /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/lib/worker-trigger.ts:15. `fetch` follows redirects by default and keeps the custom `x-cms-internal-secret` header across origins. If `CMS_PUBLIC_URL` ever redirects (for example apex to www, or http to https), the secret goes to the redirect target. This is defence in depth only: there is no exposure with a correct configuration. `redirect: 'manual'` (or `'error'`) would close it.
- **[Minor]** /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/process-request.ts:148. The superseded shortcut passes `request.draft_version` as the validated version without validating anything. It is safe only because draft versions only increase and `request_publish` requires the current version. Passing the read `draft.version` would make `superseded` unconditional in the database (its step 2 `p_validated <> request.draft_version` branch). The task text prescribes this behaviour, so this is defence in depth, not a contradiction.
- **[Minor, not a security property]** process-request.ts:159. `slug_required` checks `entry.slug` from the read, but the commit does not re-check it. A `set_slug(null)` that lands between the read and the commit (milliseconds, own tenant) would publish an entry without a slug. This is integrity only; flagging it for the spec and quality reviews.

Note, not a finding: `alter role service_role set ...` applied locally as `postgres` through supautils. Whether the hosted project allows it on the reserved `service_role` is unproven until G2/Task 28.
