PASS

No Critical or Major findings. I read the migrations and tests and did not run anything against the database. I relied on the controller's `pnpm db:test` result (Files=13, Tests=1233, PASS) and did not re-run it.

**Findings**
- [Minor] `docs/verification/m1-gates.md`: Task 11 Step 4 says to record A9 here. The file has no A9 entry and the diff contains none. This is probably the controller's step after the review. It needs to be written before Task 11 is closed, with the Vault round-trip evidence from `090_api_worker.test.sql` (lines 627–660).

**Checked and consistent**
- **Signatures:** all 14 function names, parameters and return types match the plan exactly. All are `security invoker` with `search_path = ''`. `EXECUTE` is granted to `service_role` only. `010_catalog` pins the count (14) and the grantees.
- **Commit behaviour:** `worker_commit_publish` implements §6.2 steps 1–8 as the plan and your accepted choices describe. The request, entry and draft are locked `FOR UPDATE` in that order. The data comes from the locked `cms.drafts` row, not from a parameter or `draft_refs`. Referenced entries and assets are locked `FOR SHARE` in id order and checked in a new statement. Failures are recorded as `{code, refs}`. `first_published_at` is set with `coalesce`.
- **Unpublish:** `worker_commit_unpublish` takes the same request and entry locks and does the same tenant and membership checks. It clears both pointer columns and has no reference check.
- **`worker_finish_release`:**
  - Bundle path: `{slug}/releases/{number}.json`.
  - `p_public_assets` shape: `[{id, public_path}]`, with `public_path` exactly `{slug}/{asset_id}/{filename}`.
  - Scoping: request ids and asset ids must belong to the release's tenant, otherwise `forbidden`.
- **Other worker functions:** the claim, snapshot, begin-release, previous-release, `worker_sites` and record-delivery functions match their text. The snapshot has the extra keys `release` and `tenant`, and `worker_sites` returns active sites only.
- **Admin functions:** the Vault secret is named `cms.sites/<id>/webhook` and `cms.sites` keeps only its id. `admin_add_membership` is idempotent.
- **Decision 31 and the deferred Minors:** the `grant update (updated_at) on cms.drafts` is present and `030_content.test.sql` is updated to match. The write-once `first_published_at` trigger is an AFTER UPDATE trigger, and `070_audit.test.sql` adds it to the `entries` trigger list. `revisions_data_check` adds the 1 MB limit. The statement timeout is not implemented, which matches "investigated only".
- **Step 1 cases in `090_api_worker.test.sql`:**
  - Exactness: revision data equals draft data; `revision_refs` equal `draft_refs`; `xmax` shows the row locks.
  - Commit outcomes: superseded (both a stale request and a mismatched validated version); `rejected` for a revoked requester and for a suspended tenant; `failed_validation` for a schema-version mismatch and for unpublished, archived and forged-`draft_refs` references.
  - Release and Vault: unpublish of a referenced entry returns `committed`; a second `worker_begin_release` returns null; the Vault round-trip (`worker_sites` returns `array['s3cr3t']`, and no secret appears in `cms.sites`).
  - Each case asserts a specific value, so each can fail.
- **`100_escalation.test.sql`:** all four required cases are present (editor 42501 on each `worker_*` and `admin_*`; anon 42501 on every `api` function and view; the `entries.tenant_id` update gives 42501; `request_publish` on a demo entry gives `not_found`). It also covers the platform admin and the reverse check for `service_role`. The function lists are guarded by count assertions, so they cannot pass vacuously.
- **Scope:** the files changed are the two migrations, the two new test files, and the 010, 030 and 070 edits (consequences of the new `api` functions, decision 31 and the new trigger). Nothing off-task.

**Commands run (read-only):** `git diff --stat cd747da..e6b66ab -- supabase/`, `git diff` on the 010, 030 and 070 test files, `cat` and `grep` of the migrations, the tests and `docs/verification/m1-gates.md`, and `git status --porcelain` (clean).

Files reviewed under `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt`:
- `supabase/migrations/20261102000900_api_worker.sql`
- `supabase/migrations/20261102001000_api_admin.sql`
- `supabase/tests/database/090_api_worker.test.sql`
- `supabase/tests/database/100_escalation.test.sql`
- `supabase/tests/database/010_catalog.test.sql`
- `supabase/tests/database/030_content.test.sql`
- `supabase/tests/database/070_audit.test.sql`
