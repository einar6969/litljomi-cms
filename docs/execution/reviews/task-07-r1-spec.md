# Task 7: spec-compliance review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02 (told not to run the database suite; the parallel security reviewer used it)
- Change: 0f7ca02
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major findings. I did not run `pnpm db:test` or `pnpm db:reset`, as instructed. I relied on your 406-test PASS and on reading the code.

Minors:
- [Minor] docs/verification/m1-gates.md (A13 block): the record says `Tests=405` and test numbers from the pre-merge run. Your post-merge run is 406 (040: 97). The numbering is a snapshot of the earlier run. This affects nothing.
- [Minor] supabase/migrations/20261102000300_content.sql (`drafts_check_version`, `check_actor`): the new AFTER checks raise `23514` with the messages `drafts.version must increase by exactly 1` and `<table>.<col> must equal auth.uid()`. The task and decision 3 name no code or message for these, so it is not a violation. The choice is consistent with the existing check-style errors and the tests pin it. Record it if you want decision 3's list to stay complete.
- [Minor] Commit `0f7ca02`: the trailer reads "Claude Opus 5.5", while the current attribution reminder says "Claude Sonnet 5.5". The subject matches the plan's Step 5 text exactly.

Points you asked me to judge:
- **Two-trigger split for drafts:** acceptable.
  - `drafts_sync_refs_on_insert` has no `WHEN`; `drafts_sync_refs_on_update` has `WHEN (old.data is distinct from new.data)`.
  - Both call `private.drafts_sync_refs()`, which re-checks the condition for UPDATE.
  - This meets decision 25's "AFTER INSERT OR UPDATE … WHEN … re-checked in the function". The one trigger the plan text shows cannot be written, because `OLD` is not allowed in an INSERT `WHEN` clause. The function comment explains this.
- **23514 for the new AFTER checks:** acceptable, see the Minor above.
- **In-place edits to migrations `0200` and `0300`:** acceptable.
  - `0200` changes comments only.
  - `0300` adds `drafts_check_version` and `check_actor`, plus the `pg_attribute` column lookup in `force_actor`. These are the deferred Task 7 rows, one of them explicitly "security-relevant".
  - The Task 7 plan text does not name the files. The migrations are local and unpushed, and `0400` carries the schema work, so no history is rewritten.
- **A13 tests:** they prove the claim and the cross-check.
  - **Plan document (tests 22–24):** the document has a top-level asset, an array element, a rich-text link mark (`attrs.entry`) and a rich-text image node.
    - Test 22 is the plan's `results_eq` on the refs.
    - Test 23 pins the jsonpath locations and kinds.
    - Test 24 is a `bag_eq` of the walk against `jsonb_path_query(…, 'strict $.**._ref')`.
  - **Edge-case document (tests 25–27):** the document has the root as a ref, a ref nested inside a ref, arrays of arrays, duplicate targets, quoted and non-ASCII keys, and a `_kind`-only object.
    - Each location is evaluated back as a jsonpath to the reference object it names.
    - The cross-check is repeated on this document.
  - **Plan's DB assertions:** `22P02` for `not-a-uuid`, `23503` for a cross-tenant ref and `23503` for a missing target are all present, plus rebuild-on-save.
  - **Mutation checks:** the record's claim that a walk skipping arrays fails tests 22–26 is plausible from the assertions.

Checks that passed:
- **Files:** `20261102000400_refs.sql` and `040_refs.test.sql` exist as the plan lists. Files outside the plan's list also changed, namely `0200`, `0300`, `001`, `010`, `020`, `030` and `_helpers.sql`. They belong to the deferred Task 6 Minors and decision 26's replacement assertions, and this is within scope.
- **Tables:**
  - `draft_refs` and `revision_refs` have the required columns, the `num_nonnulls = 1` check and primary keys that start with `tenant_id`.
  - `cms.revisions` gains `unique (tenant_id, id)`.
  - The composite FKs match the plan: cascade for `draft_refs`→`entries`, restrict on `revision_refs`.
  - The `assets` FKs are left to Task 8 as the plan says.
  - The `010` test pins that the `assets` FK is not yet present.
- **`private.extract_refs(p_data jsonb) returns table(path text, ref uuid, kind text)`:**
  - It is a recursive CTE walk. Locations are jsonpath text with keys quoted via `to_jsonb(key)::text`, for example `$."list"[0]."link"`.
  - `_ref` is validated first. It must be a string matching the canonical lowercase 8-4-4-4-12 pattern, else `22P02`; JSON null is malformed.
  - `_kind` must be exactly `entry` or `asset`, else `invalid_reference` (`P0001`).
  - The function is `security invoker` with an empty `search_path`, and every call is schema-qualified.
- **`private.revisions_write_refs()`:** AFTER INSERT on `cms.revisions`, as required.
- **Grants per decision 26:**
  - `authenticated` and `service_role` get `USAGE` on `private` and `EXECUTE` on `extract_refs(jsonb)` only. `anon` gets nothing.
  - `010` pins this: usage yes, create no, and the extract_refs ACL is exactly `postgres`, `authenticated` and `service_role` (not PUBLIC), and all other `private` functions stay unexecutable.
  - The old "no usage on private" assertions are replaced.
  - Table grants match the plan: `authenticated` has select, insert, delete on `draft_refs` and select on `revision_refs`; `service_role` has select on both and insert on `revision_refs`. `040` checks these at table and column level.
  - RLS policies are tenant-membership predicates matching the parent tables.
- **Step 1 assertions:** all are present with real fixture UUIDs. Beyond the plan:
  - Canonical-form cases: upper-case, braced, unhyphenated, newline, space, extra digit, and null, number, object and array `_ref`.
  - The nil UUID and a non-v4 UUID are accepted.
  - `_kind` cases, and the check that `_ref` is reported before `_kind`.
  - Trigger behaviour, including that an update leaving `data` unchanged does not rebuild `draft_refs`.
  - Revision refs equal the draft refs at that version.
  - Restrict and cascade behaviour, isolation, and the anon and platform-admin cases.
- **Task 6 deferred Minors (rows 45 and 49) cleared:**
  - AFTER `drafts_check_version`, and `private.check_actor` on `entries` and `drafts`, with probe tests that a later BEFORE trigger cannot undo the version bump or spoof the actor. Both ran for owner and editor. There is also a test that `check_actor` rejects a misspelt column.
  - `force_actor` now uses the `pg_attribute` lookup.
  - Test fixes: the `010` tenant-table list is derived and asserted complete, `column_privs` and the probes moved into `_helpers.sql`, `tests.entry` and `tests.revision` helpers, fixture and mutation-order headers, a 1 MB boundary case at exactly 1048576 bytes, and the plan named in the "review focus 5" comment.
  - A "keep identical" comment sits above the membership predicates in `0300` and `0400`. I did not diff-count the dedupe of the revisions UPDATE/DELETE assertions, and judged it plausible.
- **A13 record:** present in `docs/verification/m1-gates.md` with the assumption, the evidence and "Result: pass".

Commands run, all read-only:
- `git show 0f7ca02` (stat, the `0200`, `0300` and `docs/verification/m1-gates.md` diffs, and the test-file diffs for `001`, `010`, `020`, `030` and `_helpers.sql`)
- `grep` on the plan for the Task 7 text and decisions 25 and 26
- `grep` on `docs/execution/deferred-minors.md`
- `cat` of `supabase/migrations/20261102000400_refs.sql` and `supabase/tests/database/040_refs.test.sql`

I ran no tests and changed nothing.

---

## Controller ruling

PASS accepted.
- **Trailer:** correct. Task 7's implementer ran on Opus (high tier).
- **23514 for the two AFTER checks:** noted for decision 3's list at C1.
- **A13 record:** the controller adds the post-merge count, 406, when recording A13.
