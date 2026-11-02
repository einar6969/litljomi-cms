# Task 6: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent; the only reviewer using the database this round
- Change: bcbc955
- The reviewer's report, verbatim:

---

PASS

Security review of Task 6 (commit `bcbc955`), round 1. There is no Critical or Major finding. There are three Minors, plus one note for the spec reviewer.

**Evidence collected:**
- `pnpm db:test` passed: 6 files, 282 tests, `Result: PASS`.
- Catalog queries run as `postgres`, which is not a superuser.
- Two rolled-back probe scripts, run through `docker exec … psql` as `postgres` with the `_helpers.sql` impersonation. Their full text is in `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/probe1.sql` and `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/probe2.sql`.
- I wrote nothing in the repository. During my run, `git status --porcelain` also showed `docs/execution/deferred-minors.md` modified and `docs/execution/reviews/task-06-r1-spec.md` untracked. Those are controller or spec-review files and did not come from this review.

1. pass: `pg_proc` in `api`/`cms`/`private` has 5 functions (`drafts_bump_version`, `entries_lock_slug`, `force_actor`, `passwordless_access_token`, `tenants_lock_slug`). All are `prosecdef = f` with `proconfig = {search_path=""}`. Every function call in the new bodies is schema-qualified (`pg_catalog.now`, `pg_catalog.to_jsonb`, `pg_catalog.jsonb_populate_record`, `pg_catalog.jsonb_build_object`, `auth.uid`). The only unqualified items are operators (`?`, `=`), and these resolve through the implicit `pg_catalog`. The `010_catalog` checks "no security definer functions" and "search_path pinned" pass.

2. pass: `supabase/config.toml:14` has `schemas = ["api"]`. The `private` ACL is `{postgres=UC, supabase_auth_admin=U}`. As editor, `has_function_privilege('private.force_actor()', …)` returns `permission denied for schema private`. This task adds nothing to `api`.

3. pass: Checked with `\dp` and probes.
   - `entries`: `authenticated` has table `r`, plus column `a` on `tenant_id`, `type`, `slug`, `created_by` and column `w` on `slug`, `archived_at`. `service_role` has `r` plus `w` on `published_rev_id`, `published_draft_version`, `first_published_at`, `last_published_at`.
   - `drafts`: `authenticated` has `r`, plus `a` on `entry_id`, `tenant_id`, `schema_version`, `data`, `title`, `sort_at`, `updated_by` and `w` on `data`, `schema_version`, `title`, `sort_at`, `updated_at`, `updated_by`. `service_role` has `r` only.
   - `revisions`: `authenticated=r`, `service_role=ar`.
   - `anon` has nothing on any of the three. The `pg_default_acl` rows for `postgres` give no grants on `cms`, and the global function default is `{postgres=X}`, so `PUBLIC` has no `EXECUTE`.
   - Probes, editor: UPDATE `tenant_id`/`entry_id`, INSERT `id`/`version`/`first_published_at`, ON CONFLICT `set version`, and TRUNCATE all return 42501.
   - Probes, `service_role`: INSERT/DELETE/UPDATE of `archived_at` on `entries`, UPDATE on `drafts`, and UPDATE/DELETE on `revisions` all return 42501.
   - This matches §4.5 exactly, and it is pinned by `030_content.test.sql:25-73` (`table_privs_are` plus a `column_privs` `set_eq` that covers INSERT, UPDATE and REFERENCES).

4. pass: `relrowsecurity = t` on all 6 `cms` tables. The 7 policies, all to `authenticated`, are select/insert/update on `entries` and `drafts` and select on `revisions`, one for each granted command. Each uses the §4.5 `EXISTS` against `cms.memberships` with `(select auth.uid())`. The UPDATE policies have both USING and WITH CHECK. There is no platform-admin clause, and the platform admin at aal2 sees nothing (`030:145-148`).
   - Probes, demo editor: an ON CONFLICT upsert onto labak's draft fails with "violates row-level security policy (USING expression)". A MERGE `when matched update` on a labak draft matches nothing. An unfiltered UPDATE leaves labak rows unchanged (`030:125-131`).
   - Revoked and outsider users see nothing.
   - **[Minor] Cross-tenant existence oracle through `drafts_pkey`.** `drafts_pkey` is `entry_id` alone (per spec). A demo editor who inserts or MERGE-inserts a draft with `tenant_id = demo` and the UUID of a labak entry gets "duplicate key … drafts_pkey" when that entry has a draft, and a 23503 foreign-key error when it does not. This reveals whether a known entry UUID exists in another tenant. It cannot be reached today: `cms` is not exposed, and `create_entry` generates the ID. It needs a known UUID and does not expose data. Owners: Task 10 must never let a caller choose `drafts.entry_id` or `entries.id`. Task 8 has the same pattern on the client-chosen `assets.id`. This is a spec-level design, not a contradiction.

5. pass: `tenant_id` is NOT NULL on all three tables (`col_not_null` in `010`). The foreign keys are composite:
   - `drafts (tenant_id, entry_id) → entries (tenant_id, id)`
   - `revisions (tenant_id, entry_id) → entries (tenant_id, id)`
   - `entries (tenant_id, id, published_rev_id) → revisions (tenant_id, entry_id, id)`

   The `010` check that every foreign key between tenant tables pairs `tenant_id` with `tenant_id` passes. Tests show a pointer to another entry's or tenant's revision fails with 23503 (`030:266-269`), and a revision against another tenant's entry fails too (`030:261-263`).

6. not applicable: this task adds no `api` functions and no functions that take a tenant parameter.

7. not applicable: there are no `worker_*` or `admin_*` functions yet.

8. not applicable.

9. not applicable.

10. pass: the diff is SQL only. `git show bcbc955 | grep -iE 'secret|sb_secret|service_role_key|eyJ'` finds nothing.

11. not applicable.

12. not applicable.

13. pass: no contradiction with the spec.
   - **Note for the spec reviewer, not a security finding.** The plan's Task 6 says `entries_lock_slug` is "BEFORE UPDATE OF slug". The implementation is AFTER UPDATE on every update, with the function re-checking the condition. The commit also changes Task 5's `tenants_lock_slug` the same way. This is stronger: it is not bypassed by a BEFORE trigger that rewrites `slug`, and it also catches ON CONFLICT and MERGE. Probes:
     - editor ON CONFLICT setting a published slug: `slug_locked`
     - editor MERGE setting a published slug: `slug_locked`
     - a `zz_` BEFORE trigger changing the slug: `slug_locked` (`020`/`030` tests)

     It is a deviation from the plan text, and Task 5's migration was edited after the fact (nothing has been deployed). Both are in the spec reviewer's scope.

14. pass: `git show --stat bcbc955` lists only `supabase/migrations/**` and `supabase/tests/database/**`. Nothing under `.claude/**` changed.

**Other findings (all Minor):**

- **[Minor] `supabase/migrations/20261102000300_content.sql:79-92,124-153`: the version bump and actor forcing depend on BEFORE trigger name order. They were not hardened the way the slug lock was.**
  - Probe: as owner, I added `zz_keep_version` (BEFORE UPDATE on `cms.drafts`, setting `new.version := old.version` and `new.updated_by := <outsider>`). An editor's `update cms.drafts set data = '{"changed":true}'` then left `version = 1` with the data changed and `updated_by = outsider`.
  - Only the table owner (a migration) can add such a trigger, and none exists, so there is no current exposure.
  - Still, §4.3 promises that data cannot change without a version bump, and §4.5 says this holds "regardless of writer … including migrations". An AFTER UPDATE check that `new.version = old.version + 1` (and, for `force_actor`, an AFTER check of the actor column) would remove the dependency, as was done for the slug.
  - Owner: Task 7, which adds the next trigger on `drafts`.

- **[Minor] `supabase/migrations/20261102000300_content.sql:98-117`: the slug lock depends on `first_published_at` alone, and `service_role` can set it back to null.**
  - Probe: as `service_role`, `update cms.entries set first_published_at = null where id = c002` succeeded. Then, as editor, `update … set slug = 'changed-after-publish'` succeeded, while `published_rev_id` was still `d001`.
  - In a single statement it is blocked, because the lock checks `old.first_published_at`. `service_role` cannot change slugs itself (42501).
  - Exploiting this needs a worker bug or someone holding the secret key, who is trusted per §8.1. The implementation matches the literal spec and plan wording, and spec §6.2 step 7 sets the column only "if null", so write-once is the intent.
  - Defence-in-depth options: make `first_published_at` write-once once it is non-null (trigger), and/or `check (published_rev_id is null or first_published_at is not null)`.
  - Owner: Task 11 (`worker_commit_publish`, and unpublish must never clear `first_published_at`).

**Probes that passed (no finding):**
- ON CONFLICT DO UPDATE and MERGE on a draft both bump `version` by exactly 1 and force `updated_by` (v2 then v3).
- A multi-row UPDATE adds +1 to each row.
- An owner `update set version = 99` gives `old + 1` (`030:181-183`).
- Non-object `data` (`"str"`, JSON `null`, `[]`) and data over 1 MB fail with 23514; SQL NULL fails with 23502.
- Forged `created_by` and `updated_by` are overwritten with `auth.uid()` on INSERT and UPDATE.
- Every role gets 42501 for UPDATE, DELETE or TRUNCATE on `revisions`, and the catalog test covers anon, authenticated and service_role.
- `force_actor` raises an error when its argument is missing or misspelt.
- `service_role` is BYPASSRLS, as expected for the worker.

---

## Controller ruling

PASS accepted. The three Minors are deferred to the owners the reviewer names:
- the `drafts_pkey` existence oracle to Task 10, where IDs are never caller-chosen, and Task 8, where `assets.id` is client-chosen by spec, so that task should note it;
- the BEFORE-trigger order dependency of the version bump and `force_actor` to Task 7;
- making `first_published_at` write-once to Task 11.
