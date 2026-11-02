PASS

Security review, Task 11 round 1. Worktree `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt`, diff `cd747da..e6b66ab -- supabase/`. I found no Critical or Major findings. There are two Minors and two points for Einar under item 13. I ran rolled-back probes as `postgres`, `service_role`, `editor_labak` and `anon` through `_helpers.sql`. `git status --porcelain` in the worktree is empty. The main checkout shows only the controller's own changes under `docs/execution/`; I did not touch them.

1. pass: I ran a catalog query over `api`, `cms`, `private` and `public`: 0 functions have `prosecdef`. All 41 functions in `api`, `cms` and `private` have `proconfig = {search_path=""}`, and the bodies of `20261102000900_api_worker.sql` and `20261102001000_api_admin.sql` schema-qualify every name. The one exception is the multi-array `unnest(...)` FROM syntax at api_worker.sql:276 and 295, which cannot be qualified. The comment there explains this, and it resolves to `pg_catalog` under `search_path = ''`.
   - Vault (you asked me to judge this): `vault.create_secret` is SECURITY DEFINER, owned by `supabase_admin`, with `proconfig {search_path=""}`. It lives in `vault`, which is not exposed (config.toml:14 `schemas = ["api"]`). `api.admin_create_site` calls it (api_admin.sql:63). `vault.decrypted_secrets` is also a view owned by `supabase_admin` without `security_invoker`, and `api.worker_sites` reads it (api_worker.sql:661). My judgement is that this is not a contradiction of what §4.2 governs. That rule is about functions v1 creates: its reasoning and its "adding one later" conditions are about our own code. §8.2 chooses Vault explicitly, and §11/A9 test exactly "Vault access by `service_role`". Still, the sentence "v1 contains no SECURITY DEFINER functions" is absolute, and our invoker functions do call into Supabase-owned definer code. I am reporting it as a wording ambiguity for Einar (see item 13), not as a finding.

2. pass: config.toml:14 exposes `["api"]` only. Every `api` function is `prosecdef = f`. Neither migration adds a view. `vault` is not exposed, and `authenticated`/`anon` have no USAGE on it (probe as `editor_labak`: `select from vault.decrypted_secrets` and `vault.create_secret('x')` both give `42501 permission denied for schema vault`).

3. pass: the ACL of all 14 `worker_*`/`admin_*` functions is exactly `{postgres=X/postgres, service_role=X/postgres}`, with no PUBLIC entry. The 9 editor functions are `authenticated` only. The only new table privilege is decision 31's `grant update (updated_at) on cms.drafts to service_role` (api_worker.sql:73). `information_schema.column_privileges` confirms that `drafts`/`service_role` has UPDATE on `updated_at` only, and table-level SELECT only. The other `service_role` grants are unchanged from Tasks 5–10. `anon` has no `cms` grants. 010_catalog adds grantee assertions (service_role and postgres only, never both `authenticated` and `service_role`), and 030 pins decision 31's grant exactly. My probe confirmed that the grant also lets `service_role` run `update cms.drafts set updated_at = now()` directly. This is inherent to decision 31: there is no exposure, because `cms` is not exposed and no `api` function updates drafts. `grep` finds no `update cms.drafts` in the migration.

4. not applicable: no new table or policy. Task 11 adds only the `revisions_data_check` constraint and the `entries_lock_first_published_at` trigger. RLS and policies are unchanged.

5. not applicable: no new tenant table. The functions join on `(tenant_id, id)` throughout (for example api_worker.sql:139–145, 296–297, 489, 495).

6. pass: the tenant always comes from the row an id names. `commit_*` and `read_request` use the request; `finish_release` and `record_delivery` use the release; `release_snapshot` uses the release. A tenant id is a parameter only in `begin_release`, `previous_release` and `worker_sites`, where no other id determines it, and in `admin_*`. I probed each cross-tenant case with a labak release:
   - `finish_release` with a demo request id: `P0001 forbidden`.
   - Bundle path `demo/releases/1.json`: forbidden.
   - Asset with `public_path` `demo/x/y`: forbidden.
   - Non-object element `[1]`: forbidden.
   - `record_delivery` for a demo site: `P0001 forbidden`.
   - 090 also covers another tenant's asset, a request that is not committed, and one already in a release (all forbidden, with "the refused calls changed nothing").

7. pass: EXECUTE is `service_role` only (item 3). 100_escalation runs every `worker_*`/`admin_*` with typed nulls as `editor_labak`, as `platform_admin` at aal2, and as `anon`, and gets `42501` each time. It also shows that `service_role` gets `42501` on every editor function and view. My probe as `editor_labak` on `api.worker_sites` gave `42501`. Explicit checks: state checks (`validating` and `action` at :211 and :355, `building` at :577), tenant scoping (item 6), and the `admin_*` functions check that the tenant exists.

8. pass: `worker_commit_publish` (api_worker.sql:186–333) follows §6.2 steps 1–8:
   - It locks the request, the entry and the draft FOR UPDATE, in that order.
   - Version check: the draft version, the request version and the validated version must all be equal, else `superseded`. Then the schema-version check.
   - It re-reads the tenant status and the membership from the tables.
   - It extracts the references from the locked draft's data (not from `draft_refs`, which clears the Task 7 Minor). It locks the referenced entries and assets FOR SHARE in id order, scoped to the tenant, and then checks them in a new statement.
   - It inserts the revision with `INSERT … SELECT` from `cms.drafts`. There is no data parameter (090 asserts there is no jsonb parameter).
   - It moves the pointer with `first_published_at = coalesce(...)`, and the `first_published_at` write-once trigger is in place. My probe as owner trying to clear it gave `23514`.
   - My probe confirmed claim-then-commit returns `committed`.
   - `worker_commit_unpublish` applies the same request and entry locks and authorization checks.
   - Claim uses `for update skip locked` with stale reclaim after 5 minutes (:92–105).
   - Minor finding below on the tenant and membership rows.

9. pass: the snapshot has one statement with the predicate `e.published_rev_id is not null and e.archived_at is null` (api_worker.sql:490). The revision is joined on `e.published_rev_id` with tenant and entry. Assets are limited to the tenant and to the included revisions' `revision_refs`. 090 asserts that unpublished c907, archived c925, demo entries and never-published drafts are excluded.

10. pass (database scope): I created a site with the secret `TOPSECRETVALUE`.
   - `cms.sites.webhook_secret_ref` holds the Vault id only.
   - `vault.secrets` contains no plaintext in `secret`, `name` or `description`.
   - `cms.audit_log` has 0 hits for the secret.
   - `api.worker_sites` returns `{TOPSECRETVALUE}` to `service_role` only, and a site with no Vault secret gives `{}`.
   - Local settings are `log_statement = ddl` and `log_min_duration_statement = -1`. No raise message includes the secret.
   - The diff touches no app code.

11. not applicable: there are no markers or live checks in this task. `record_delivery` only stores what the worker reports.

12. not applicable: no editor text.

13. pass. Two points for Einar, which I report but do not resolve:
   (a) Item 1's Vault point: §4.2's absolute wording against the Supabase-owned SECURITY DEFINER code that §8.2 implies. In my judgement it is not a contradiction of intent, but the spec could say so explicitly.
   (b) §6.2 step 5 says the commit "checks every `draft_refs` target". The implementation checks the references extracted from the copied data instead, as the deferred Task 7 Minor asked. It is equivalent while the refs trigger holds and stronger otherwise, because editors hold INSERT/DELETE on `draft_refs`. It still departs from the spec's literal text, so it should be recorded, or the spec wording aligned.
   - Statement timeout (deferred, not implemented, options go to Einar). One fact for that decision: `service_role` has no `rolconfig` timeout, but `authenticator` has `statement_timeout=8s` and `lock_timeout=8s`. Calls through the Data API run in that session, so they already get the 8 s limit. Direct connections do not.

14. pass: `git diff --stat cd747da..e6b66ab` shows only 7 files under `supabase/` and nothing in `.claude/**`.

Further findings:

- [Minor] api_worker.sql:249–264 and 362–377: step 4 reads `cms.tenants.status` and `cms.memberships` without locking them. A suspension or membership revocation that commits between this check and the commit transaction's end does not stop the publish. The ordering is still consistent: the check sees the state just before the concurrent change. §6.2 asks only for a re-check, and this costs no security property today. As defence in depth, a `FOR SHARE`/`FOR KEY SHARE` on the tenant row and the membership row would serialise the commit with suspension and revocation (the membership delete would conflict with KEY SHARE).
- [Minor] api_worker.sql:581, 621–626: `worker_finish_release` accepts `p_status = 'delivered'` with `p_bundle_path` null, and accepts `p_request_ids` for a `failed` release. This does not affect tenant isolation, because the worker is trusted. But "Delivered" (§7.4) is meant to be proven by a written bundle, so requiring the bundle path when the status is `delivered` would keep the database consistent with that proof.

Relevant files:
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/migrations/20261102000900_api_worker.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/migrations/20261102001000_api_admin.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/tests/database/090_api_worker.test.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/tests/database/100_escalation.test.sql
- Probe script (scratch, not in the repo): /private/tmp/claude-501/-Users-einarzoega-litljomi-cms/f7085da3-8638-45ff-a6aa-b6fad42d8bf7/scratchpad/probe_body.sql
