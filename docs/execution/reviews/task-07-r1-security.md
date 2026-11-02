# Task 7: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent; the only reviewer using the database this round
- Change: 0f7ca02
- The reviewer's report, verbatim:

---

FAIL

Security review, Task 7 (reference extraction), round 1. Commit 0f7ca02 on m1/phase-1.

**Result:** one Major finding (an editor can cause unbounded temp-file use) and two Minors. Everything else holds: grants, RLS, composite keys, the actor and version checks, and trigger-order independence.

**Evidence base:** `pnpm db:test` gives Files=7, Tests=406, Result: PASS. I also ran catalog queries and rolled-back probes as `postgres` (not a superuser), using `_helpers.sql` impersonation, through `docker exec supabase_db_litljomi-cms psql`. I did not use `supabase_admin` or `db:reset`. I wrote nothing in the repository (probe scripts are in $TMPDIR only). While I worked, `git status --porcelain` gained controller-owned changes: `docs/execution/{deferred-minors.md,state.json}` modified and `reviews/task-07-r1-spec.md` untracked. None of these came from this review.

## Checklist

1. **pass:** No `prosecdef` function in api, cms, private or public (query returned 0 rows). Every function in api, cms and private has `proconfig = {search_path=""}`. In the new functions every name is schema-qualified: `pg_catalog.*`, `cms.*`, `private.extract_refs`.
   - The dynamic SQL in `check_actor` (`pg_catalog.format('select ($1).%I', tg_argv[0])`) is safe:
     - The argument is DDL-fixed, checked against `pg_attribute` and quoted with `%I`.
     - The statement contains no unqualified name.
     - No API role can attach the function to a table. As editor, `create trigger … execute function private.check_actor('who')` gives "permission denied for function private.check_actor".

2. **pass:** `config.toml` has `[api] schemas = ["api"]`. Nothing was added to `api`. Decision 26 makes `private` reachable inside the database only:
   - `nspacl` of private is `{postgres=UC, supabase_auth_admin=U, authenticated=U, service_role=U}`. There is no CREATE for any API role.
   - private contains no relations and no types.
   - anon: `select private.extract_refs('{}')` gives "permission denied for schema private".

3. **pass:**
   - `relacl` `draft_refs`: `authenticated=ard, service_role=r`.
   - `relacl` `revision_refs`: `authenticated=r, service_role=ar`.
   - Neither table has column ACLs.
   - anon has nothing.

   This matches §4.5 and the Task 7 grant line.

   Function ACLs in private:
   - `extract_refs`: `{postgres=X, authenticated=X, service_role=X}`, with no PUBLIC entry.
   - Every other function in private: `{postgres=X}` only.
   - The Auth hook: `{postgres=X, supabase_auth_admin=X}`, unchanged.
   - Default ACL `postgres/-/f = {postgres=X}`, so future private functions are not executable either.

   Probes as editor all give "permission denied for function": `drafts_sync_refs()`, `check_actor()`, `force_actor()`, `drafts_check_version()`, `revisions_write_refs()` and `passwordless_access_token()`. As service_role, `revisions_write_refs()` is also denied.

4. **pass:** `relrowsecurity = t` on both tables. Policies apply to `authenticated` only and use the standard membership `EXISTS … (select auth.uid())` predicate (pg_policies output). There is no platform-admin clause; the aal2 platform admin sees nothing (tests 040). Probes:
   - A labak editor's `insert … on conflict do nothing` into a demo row gives "new row violates row-level security policy". The WITH CHECK runs before the conflict check, and the key leads with `tenant_id`, so there is no oracle.
   - `on conflict do update` gives 42501, because there is no UPDATE grant.
   - `truncate` gives 42501.
   - `set session_replication_role` is refused.
   - `alter table … disable trigger` gives "must be owner".

5. **pass:** The catalog test pins `tenant_id NOT NULL` on all existing tenant tables and composite FKs between tenant tables. Constraints:
   - `draft_refs (tenant_id, entry_id)` → entries, ON DELETE CASCADE.
   - `draft_refs (tenant_id, target_entry_id)` → entries.
   - `revision_refs (tenant_id, revision_id)` → `revisions(tenant_id, id)`, RESTRICT.
   - `revision_refs (tenant_id, target_entry_id)` → entries, RESTRICT.
   - All have `condeferrable = f`, so `set constraints all deferred` does not help: the cross-tenant ref still gives 23503.
   - Cross-tenant and missing targets both give the same 23503 message, so there is no oracle.
   - Rejection also holds for UPDATE, INSERT, `INSERT … ON CONFLICT DO UPDATE`, `MERGE … WHEN MATCHED UPDATE` and `MERGE … WHEN NOT MATCHED INSERT` (all probed: 23503).

   The asset FKs are deferred to Task 8 as the plan says. Until then `target_asset_id` is unconstrained (a probe stored an arbitrary asset UUID). Task 8 must add the composite asset FK on both `draft_refs` and `revision_refs`.

6. **pass:** No `api` functions in this task. The triggers take `tenant_id` from `NEW` (the draft or revision row, which is itself tied to the entry by a composite FK), never from a parameter.

7. **not applicable:** no `worker_*` or `admin_*` functions.

8. **not applicable:** no commit function. See Minor M1 for what Task 11 must not rely on.

9. **not applicable.**

10. **pass:** The diff contains no keys or secrets. It touches only SQL, tests and `docs/verification/m1-gates.md`.

11. **not applicable.**

12. **not applicable.**

13. **pass:** no contradiction with the spec found. The Major below may need a decision: a nesting-depth cap is not in the spec, which says "at any depth".

14. **pass:** `git show 0f7ca02 --stat` touches no `.claude/**` file.

## Findings

[Major] supabase/migrations/20261102000400_refs.sql:53-97 (`private.extract_refs`, called by `drafts_sync_refs`). Any editor can make one draft write use gigabytes of temp disk, with cost quadratic in nesting depth.
- **Cause:** the recursive CTE carries the full subtree (`node`) and the growing path text (`loc`) on every row. A document nested D levels deep therefore materialises about D × document-size bytes into a tuplestore that spills to `pgsql_tmp`.
- **Probes:**
  - As `editor_labak` under the role's `statement_timeout=8s`: `update cms.drafts set data = (repeat('{"<90×a>":', 10000) || '1' || repeat('}', 10000))::jsonb …`. The document is about 930 KB, under the 1 MB check, and contains no `_ref`. It ran the full 8,050 ms before "canceling statement due to statement timeout". `pg_stat_database.temp_bytes` grew by 3.08 GB for that one statement.
  - Without a timeout (owner context; service_role also has none), the same walk ran 24.5 s and failed with `could not write to file "base/pgsql_tmp/…": No space left on device`, after filling the 7.6 GB free on the local volume. The space was freed on abort; `pgsql_tmp` is back to 0.
  - Locally `temp_file_limit = -1`.
- **Exposure:**
  - `api` is exposed and the save path's validation is lenient, so a few parallel saves from one editor account (or a stolen session) can exhaust the database disk.
  - On a disk shared with WAL, that risks a database-wide outage across all tenants.
  - The worker's revision insert runs the same walk as service_role, with no timeout.
- **Comparison:** documents of normal shape are fast. Depth 10000 with 1-character keys took 400 ms, and 15,000 references in about 1 MB took 100 ms. The JSON parser caps depth at roughly 12,000–15,000 (`max_stack_depth` 2MB), so there is no stack overflow inside the walk itself.
- **Rating:** an availability weakness reachable by any authenticated editor, short of a confidentiality or integrity break, so Major.
- **Possible fixes (for the controller to decide; a depth cap may need a decision because §4.3 says "at any depth"):**
  - Avoid carrying the subtree and full path per level.
  - Prune subtrees that contain no `_ref`.
  - Reject documents above a nesting depth.
  - Set `temp_file_limit` for `authenticated` and `service_role`.
- **Test gap:** a regression test should bound run time or temp use for a deep document near 1 MB.

[Minor] supabase/migrations/20261102000400_refs.sql:24-25 and 213-218. Editors hold INSERT and DELETE on `draft_refs`, as §4.5 says, so `draft_refs` can diverge from `drafts.data`. In probes, an editor deleted all its refs and inserted a `$."bogus"` row; a data-unchanged update keeps such rows (test 040 shows this too). There is no current exposure, because `cms` is not exposed and no `api` function writes `draft_refs`. Task 11's commit must still validate references from the copied data or from the trigger-written `revision_refs`, never from `draft_refs` (Exactness item 2). Similarly, service_role's INSERT on `revision_refs` (which the trigger needs) allows arbitrary rows from trusted code.

[Minor] supabase/migrations/20261102000400_refs.sql:24. `path` is part of the btree primary key. A reference whose path is longer than the index tuple limit makes the save fail with 54000. Probe: depth 4000 with 90-character keys gives "index row requires 9424 bytes, maximum size is 8191". Incompressible paths over about 2.7 KB hit the btree limit sooner. The write fails closed, so no security property is affected. It is a functional limit worth documenting.

## Checks that found no issue

**Malformed-`_ref` and `_kind` rules:**
- The regex is `^[0-9a-f]{8}-…-[0-9a-f]{12}$` (spelled as explicit character lists), the same as `packages/rich-text/src/doc-schema.ts:61`.
- A trailing newline is rejected, because PostgreSQL's `$` is not newline-sensitive.
- JSON null, number, object and array `_ref` values give 22P02.
- `_kind` must be exactly "entry" or "asset". A missing, null, wrong-case or array `_kind` gives `invalid_reference`. `_ref` is checked first.
- Keys are JSON-quoted in paths, so paths are unique.
- References nested inside references are extracted.

**Version and actor checks:**
- The AFTER checks `drafts_check_version` and `check_actor` hold against later BEFORE triggers.
- `drafts_sync_refs_on_update`'s WHEN clause sees the final row. In my probe, a later BEFORE trigger injecting a cross-tenant ref into a title-only update gave 23503, and injecting a same-tenant ref rebuilt `draft_refs`.

**Exactness item 2:** revision_refs equal draft_refs for the same data (test 78).

Files reviewed:
- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000400_refs.sql
- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000300_content.sql
- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000200_tenancy.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/010_catalog.test.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/_helpers.sql

---

## Controller ruling

**FAIL accepted, on the Major.** The likely fix includes a document nesting-depth limit, which goes beyond spec §4.3's "at any depth". The controller therefore asks Einar before the fix round.

**Minor 1** (`draft_refs` writable by editors, so it can diverge from `data`) is deferred to Task 11: the commit must validate references from the copied draft data or from the trigger-written `revision_refs`, never from `draft_refs`.

**Minor 2** (long paths exceed the btree index limit, failing closed) is folded into the depth-limit decision. A depth cap also bounds path length.
