FAIL

Security review, Task 7 round 2 (fix commits a730140 and b8d2849, diff `0f7ca02..b8d2849 -- supabase/`). This is not a full re-review. The fix is limited to `private.extract_refs` and tests, and I could judge it on its own.

**Result:** the round 1 Major is only partly resolved. The new pre-walk checks are linear and I could not bypass them. But the walk can still write about 1.1 GB of temp files for a single editor draft save of 513 KB that is inside all three limits, and the save succeeds. That is about 40 times the 27 MB the migration comment and tests claim, and far from the "few MB" in Einar's decision 28 ruling. So the Major stands, in a new form.

**How I checked:** probes ran as `postgres` (not a superuser), with `_helpers.sql` impersonation (`act_as editor_labak`, role `statement_timeout=8s`), inside transactions that were rolled back. Probe scripts are only in $TMPDIR/probe. I did not run `db:reset`. `git status --porcelain` shows only `docs/execution/progress.md`, `state.json` (both already modified at session start) and `?? docs/execution/reviews/task-07-r2-spec.md` from the parallel spec reviewer. None of them came from me.

## Checklist items the fix touches

1. **pass:**
   - `prosecdef` count is 0 across api, cms, private and public.
   - Every function in private has `proconfig={search_path=""}`.
   - The new calls are all `pg_catalog`-qualified: `jsonb_path_exists`, `regexp_matches`, `char_length`, `count`, `jsonb_path_query`. Operators and casts resolve to pg_catalog.

2. **pass:**
   - `nspacl` of private is unchanged: `{postgres=UC, supabase_auth_admin=U, authenticated=U, service_role=U}`.
   - The test helpers (`tests.cost`, `tests.try_sql`, `tests.costs`, `tests.at_limits`, etc.) are created inside the pgTAP transaction and rolled back. `select nspname from pg_namespace where nspname='tests'` returns nothing.

3. **pass:**
   - `extract_refs` proacl is `{postgres=X, authenticated=X, service_role=X}`. All other private functions are `postgres=X` only, and the Auth hook is unchanged.
   - `draft_refs` grants are `authenticated=ard, service_role=r`. `revision_refs` grants are `authenticated=r, service_role=ar`.
   - `anon` has nothing.

4.–9. Not touched by the fix. The round 1 results stand, with no change to RLS, foreign keys, actor or version checks, worker/admin functions, commit or withdrawal.

10. **pass:** the diff contains no secrets.

11.–12. **not applicable.**

13. **pass, with one point for the controller.** Spec §4.3 says only that "extraction cost and the stored paths stay bounded". At about 1.1 GB per statement that is technically true. Einar's decision 28 ruling ("the worst case is bounded at a few MB") is not met. The Major below gets the higher rating for that reason. Whether it needs another ruling is the controller's call.

14. **pass:** no `.claude/**` file is in the diff.

## Round 1 Major: partly resolved, still Major

What is now fixed:
- The 10,000-level probe is rejected in milliseconds.
- The long-key probe (100 levels of 900-character keys) is rejected with 54000 and no temp files.
- The walk no longer carries subtrees.

**The pre-walk checks are linear, run before the walk and before `_ref`/`_kind` validation, and I found no bypass:**

- **Order:** depth check at `20261102000400_refs.sql:93`, then key check at `:110-117`, then reference count at `:124-128`. All three come before the walk at `:138` and the 22P02/P0001 checks in the loop.
- **Depth:** `strict $.**{128}` with `jsonb_path_exists` visits at most levels 0 to 128 and stops at the first match.
- **Keys, escapes:**
  - A key of 30 `k` plus 35 backslashes (65 characters) is rejected.
  - 65 `\u0001` characters (escaped `\u0001` in the text) are rejected; 64 of them (384 characters of text) are allowed.
- **Keys, multi-byte:** 65 emoji are rejected.
- **Keys, regex cost:** a 500,000-backslash value ran in 22 ms, a 500,000-quote value in 16 ms, 250k short strings in 287 ms and 100k keys in 232 ms. There is no backtracking blow-up.
- **Keys, string values:** a string value can never be followed by `:` in jsonb text output, so values are not mistaken for keys.
- **Reference count:** `strict $.**._ref` counts every object that has a `_ref` key, at any position. That includes a root `_ref`, `_ref` objects nested in references, and `_ref` keys whose value is not a string. It is the same set the walk emits, because the walk's `-> '_ref'` is not null for JSON null.
- **Revisions:** revision inserts as service_role go through the same function, and the tests show it.

**[Major] `supabase/migrations/20261102000400_refs.sql:138-162` and the claim at `:66-70`. The walk still costs about 1 GB of temp files for one editor save inside all three limits.**

- **Cause:** the claim "the walk carries at most 1,000 of [the paths]" is wrong. The recursive CTE stores one row per reference and one per container on the way to a reference. Each row carries its full `loc` text and `steps` text[]. The number of rows is bounded by 1,000 times the depth, not by 1,000.
- **Document shape:**
  - A shared trunk of 63 objects with 64-character keys.
  - An array of 1,000 elements.
  - Each element is its own 63-level chain of `{"a": ...}` ending in a reference.
  - Depth is 128, there are 1,000 references, no key is longer than 64 characters, and the text is 513,410 bytes.
  - The walk produces about 64,000 rows, each carrying about 9 KB of path.
- **Probe as `editor_labak`** (`update cms.drafts set data = <that document>`, measured with the suite's own `tests.cost`): state `00000`, temp_bytes **1,139,466,240**, elapsed **1.13 s**. The save succeeds, with 1,000 `draft_refs` rows and a maximum path length of 4,479 characters.
- **Second probe:** trunk 118, chains 8, a 132 KB document. It wrote 281 MB in 0.27 s.
- **Exposure:**
  - The run is well under the editor's 8 s timeout, so it repeats freely.
  - A handful of parallel saves from one editor or a stolen session needs several GB of `pgsql_tmp`. Locally `temp_file_limit=-1` and 12 GB are free.
  - The worker's revision insert as service_role (no timeout) pays the same cost when such a draft is published.
- **Test gap:** `040_refs.test.sql:630-` (`tests.at_limits`) measures only a shared trunk with the references directly under it, so the stated worst case is not the real one. The cost test cannot catch this shape.
- **Possible fixes (the controller decides; some may need a ruling):**
  - Do not carry `loc`/`steps` per row. For example, carry a parent link and one step, and build the path only for reference rows.
  - Bound the total number of containers entered, or the total path bytes.
  - Set `temp_file_limit` for `authenticated` and `service_role`.
  - Add a cost test with branching chains.

## The two points you asked about

- **"About 27 MB" against "a few MB":** the real worst case is about 1.1 GB, not 27 MB (see the Major). Even 27 MB would have been above "a few MB", so this needs controller or Einar attention either way.
- **Btree row limit:** confirmed. As editor, a draft insert with 126 levels of incompressible 64-character keys (md5 pairs) fails with `ERROR: index row size 5160 exceeds btree version 4 maximum 2704 for index "draft_refs_pkey"` (SQLSTATE 54000). The write fails closed and leaks only the index name.

## Further findings

- **[Minor] `20261102000400_refs.sql:24` and `:38` (primary keys including `path`):** documents inside all limits can be refused by the btree limit, as above. This affects no security property. It is a functional limit that §4.3 and decision 28 do not mention, and the test comment at `040_refs.test.sql:630` notes it only in passing.
- **[Minor] `20261102000400_refs.sql:147` and `:153-158` (CPU cost):** the CPU cost has a factor equal to the depth. Each entered row copies its subtree with `v_doc #> w.steps`, and each child is scanned again by `jsonb_path_exists`. In a probe, 125 levels over a ~900 KB blob plus one reference took 1.0 s of CPU, in memory, with no temp files. It is bounded and under the timeout, so there is no current exposure on its own.
- **[Minor] round 1 Minor 1:** `draft_refs` is still writable by editors. This is unchanged and already deferred to Task 11.

## Files

- /Users/einarzoega/litljomi-cms/supabase/migrations/20261102000400_refs.sql
- /Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql
- /Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md (decisions 27 and 28, lines 261-262)
- /Users/einarzoega/litljomi-cms/docs/architecture.md (§4.3 "References inside JSON")
- Probe scripts, outside the repository: p3.sql (the 1.1 GB editor save probe), p1.sql, p4.sql, p5.sql and p6.sql in "$TMPDIR/probe/". $TMPDIR is this sandbox session's temp directory.
