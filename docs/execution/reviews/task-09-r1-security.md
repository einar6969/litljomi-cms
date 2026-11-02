PASS

Task 9 security review, round 1 (`318da7d..354d0d3`, worktree `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt`). No Critical, Major or Minor findings.

I checked the database catalog and probed the local stack as the personas, using `_helpers.sql` inside one rolled-back transaction (`ON_ERROR_ROLLBACK on`). I did not run `pnpm db:reset` and changed nothing in any checkout.

1. pass: no `SECURITY DEFINER` function anywhere outside the Supabase-owned schemas (count = 0). The migration creates no function. It reuses the Task 6 triggers `private.force_actor` and `private.check_actor`, and every `private` function has `prosecdef = f` and `proconfig = {search_path=""}`.

2. pass: the migration creates no objects in `api`. The four tables are in `cms`, which is not exposed. `anon` has no usage on schema `cms` (probe: "permission denied for schema cms").

3. pass: the table and column grants (`relacl`, `attacl`, `information_schema.column_privileges`) match §4.5 exactly:
   - **`authenticated`:**
     - `publish_requests`: `r` on the table, plus `INSERT (action, draft_version, entry_id, requested_by, tenant_id)`. No `UPDATE` or `DELETE`.
     - `releases` and `site_deliveries`: `r` only.
     - `sites`: no table-level privilege, only column `SELECT (id, tenant_id, base_url, preview_url, active)`. `revalidate_url`, `webhook_secret_ref` and `preview_secret_ref` are not readable.
   - **`service_role`:** exactly the controller-accepted set. `publish_requests`: `r` + `UPDATE (status, claimed_at, attempts, error, revision_id, release_id)`. `releases`: `ar` + `UPDATE (status, bundle_path, delivered_at, error)`. `sites`: `ar`. `site_deliveries`: `ar` + `UPDATE` on the six notify/live columns. No `DELETE` or `TRUNCATE` anywhere.
   - **`revisions`:** `service_role` still holds only `SELECT, INSERT`. Probes `update cms.revisions` and `delete from cms.revisions` both give 42501.
   - **`anon` and `PUBLIC`:** absent from every ACL on the four tables.
   - **Fit with Task 11:**
     - `worker_claim_requests` (`for update skip locked`) is covered: `SELECT ... FOR UPDATE` needs `UPDATE` on at least one column, and `service_role` has it.
     - `admin_create_site` and `worker_begin_release` are covered by `INSERT`.
     - `worker_sites` is covered by `SELECT` on the secret-reference column.
   - **Judgement on the accepted choices:** I agree with them. They are least-privilege for Task 11's function list. They leave out `requested_by`, `draft_version`, `tenant_id` and `entry_id` on requests, and `number` and `tenant_id` on releases.

4. pass: RLS is on for all 13 `cms` tables (`relrowsecurity = t`).
   - **Member policies:** the four tables use the standard membership `EXISTS` with `(select auth.uid())`. `publish_requests` has SELECT and INSERT, the other three SELECT only.
   - **Console policies:** one per table, SELECT only, to `authenticated`, requiring `auth.jwt()->>'aal' = 'aal2'` and a `platform_admins` row. There is none on content tables.
   - **Probes:**
     - platform_admin at aal2: `count(*) from cms.sites` = 1, while `select * from cms.sites` gives 42501. `entries`, `drafts`, `revisions` and `assets` each return 0 rows.
     - Revoked or outsider cannot insert: membership is checked per request.
     - `authenticated` with no `sub` in the claims: insert gives an RLS 42501, so a null `auth.uid()` cannot be used to spoof `requested_by`.

5. pass: all four tables have `tenant_id NOT NULL` and tenant foreign keys that are composite with `tenant_id` (catalog):
   - `publish_requests`: `(tenant_id, entry_id)` to `entries`, `(tenant_id, entry_id, revision_id)` to `revisions`, `(tenant_id, release_id)` to `releases`.
   - `site_deliveries`: `(tenant_id, release_id)` and `(tenant_id, site_id)`.
   - `releases` and `sites` reference `tenants(id)`.
   - `010_catalog` now lists all eleven tenant tables in its generic FK check.
   - **No leak through foreign-key checks:** as editor_labak, labak tenant + demo's entry ID gives 23503 "Key is not present in table entries", the same as a random UUID, so the demo entry's existence is not revealed. demo tenant + demo entry gives the RLS 42501.

6. not applicable: no functions in this task. The tables' foreign keys tie each row to its tenant, so Task 11 can derive the tenant from the data.

7. not applicable: no `worker_*` or `admin_*` functions yet. The `service_role` grants hold nothing those functions do not need.

8. not applicable: there is no commit function yet (Task 11). The schema supports it: `revision_id` must be a revision of the same entry and tenant (composite FK), and `requested_by` is forced and cannot be changed by `service_role` (probe: `update ... set requested_by` gives 42501).

9. not applicable: no release build here. The `releases_one_building_per_tenant` partial unique index exists, and `number` and `tenant_id` cannot be updated by `service_role`.

10. pass:
   - No secrets are committed. `sites` holds only `uuid` references to Vault.
   - Editors cannot read the references, including via `select *`, `to_jsonb(s)` or a whole-row reference (`where s is not null`). All of these give 42501, and platform admins at aal2 get the same result.
   - Later `api.tenant_sites` must keep using explicit columns. Its `security_invoker` setting inherits the column grant either way.

11. not applicable: no live confirmation in this task. No value checks on `notify_status`/`live_status` is the accepted choice. Only `service_role` writes those columns, and §7.4's proof logic belongs to the worker (Task 21).

12. not applicable: no editor text.

13. pass: no contradiction with the spec. The `revalidate_url` exclusion for editors is §4.5's column list exactly.

14. pass: `git diff --name-only 318da7d..354d0d3` lists only the three `supabase/` files. Nothing under `.claude/**` changed.

Other probe results (editor_labak, all rolled back):
- A spoofed `requested_by` of editor_demo on insert is stored as editor_labak's ID (b001), with status `pending`.
- `insert ... on conflict (id) do update set status=...`, `select ... for update` on `publish_requests`, and `truncate` by `service_role` all give 42501.
- `service_role` has `rolbypassrls = t`, as expected. Its limits come from the column grants above.

Unchanged-checkout check:
- The lane-a-alt worktree is clean (`git status --porcelain` is empty).
- The main checkout `/Users/einarzoega/litljomi-cms` shows changes I did not make: `M docs/execution/progress.md`, `M docs/execution/state.json`, `?? docs/execution/reviews/task-09-r1-spec.md`. These look like the controller's own writes.

Files:
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/migrations/20261102000600_publishing.sql`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/tests/database/060_publishing.test.sql`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/tests/database/010_catalog.test.sql`
