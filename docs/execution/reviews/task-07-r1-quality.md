FAIL

Commands run (read-only): `git diff 0f7ca02~1..72860c1 --stat` and the diffs of `_helpers.sql`, `010_catalog`, `020_tenancy` and `001_helpers`; `cat -n` of `20261102000400_refs.sql` and `040_refs.test.sql`. I did not run db:reset or db:test.

Overall: the migration is readable and the long comments are mostly accurate and proportionate. The Task 6 cleanups (tenant_tables() list, probe helpers, tests.entry/revision) look good. One Major finding in the cost tests, plus Minors.

**[Major] supabase/tests/database/040_refs.test.sql:727, 760-762, 802-804, 950-951, 973-975 (and `tests.costs` at :101): the cost-bound assertions can pass vacuously.**
- `tests.costs.temp_bytes` is nullable. `tests.cost` (:96) computes it from `v_plan -> 0 -> 'Plan' ->> 'Temp Written Blocks'`.
- If that key is ever absent (a different EXPLAIN shape, a Postgres upgrade, a top node that doesn't aggregate the function's temp I/O), `temp_bytes` becomes NULL.
- Then `temp_bytes >= 1024*1024`, `temp_bytes <> 0` and `temp_bytes > 10*1024*1024` are all NULL, so every `is_empty` over those predicates passes.
- No test shows the measurement works. The at-limits probe is documented as writing 8.49 MB, but nothing asserts it is above zero.
- These bounds are the only guard for decision 29's ~10 MB worst case and for the round 2 and 3 regressions, so a silent measurement failure would hide exactly the regressions they exist for.
- Suggested change:
  1. Make `temp_bytes` `not null` in `tests.costs`, or add `or temp_bytes is null` to each bound query.
  2. Add a positive control: `select ok((select temp_bytes from tests.costs where probe = 'draft at limits') > 0, ...)`. This depends on work_mem being 4 MB, so say so in the comment, or use a lower bound such as 1 MB.

**[Minor, borderline Major] 040_refs.test.sql:469, 477, 498, 727, 761, 803, 951, 974: wall-clock `< 1 second` bounds are thin on a slower machine.**
- The slowest accepted probe ("long chains") is documented at 0.4 to 0.5 s locally. That is a 2x margin against 1 s, and the measurement includes EXPLAIN ANALYZE overhead and the trigger work.
- Two more spots are tighter than they look:
  1. `set local statement_timeout = '3s'` at :824 stays in force for the rest of the file. It also covers the single `insert into tests.shapes` that builds all six documents, including 60,000 array elements, with no measured time.
  2. `set local statement_timeout = '5s'` at :431 likewise covers the setup of the 10,000-level documents.
- Temp-byte bounds are deterministic; time bounds are not. I picked Minor because nothing is wrong today, but the controller may want to raise it if CI is slower than a laptop.
- Suggested change: keep the byte bounds strict and loosen the time bounds to something like 5 s. The regressions they caught were 4 to 8 s and 3 GB, so the temp-byte bound stays the real guard. Raise the statement_timeout guards to 10-30 s, or build the shapes before lowering them.

**[Minor] 040_refs.test.sql:469/477/498 vs. 85-98: duplicated timing scaffolding.**
- The 10,000-level and 15,000-reference checks use `set_config('tests.t0', clock_timestamp()...)` plus `cmp_ok(...)`, a second mechanism for what `tests.cost` (defined at the top of the file) already measures.
- Suggested change: use `tests.cost` there too, so one mechanism with one set of bounds is left.

**[Minor] 040_refs.test.sql:713-722, 750-755, 791-797, 904-911: repeated probe scaffolding.**
- Each probe repeats `act_as(...)`, `insert into tests.costs select 'label', * from tests.cost($$...$$)`, a `results_eq` on state and an `is_empty` on bounds.
- `tests.save_shape` already wraps the draft-update plus revision-insert pair for the shapes. The long-key, control-character and at-limits probes each hand-write it again.
- The assertions are also inconsistent: :724 reads the whole `tests.costs` table ordered by probe, which only works because it holds exactly three rows at that point. :757 and :799 use `like` filters.
- Suggested change: generalize `save_shape` into something like `tests.probe_doc(label, doc_sql, revision_key, version)` and filter by label pattern everywhere.

**[Minor] 040_refs.test.sql:142-179: the same rich-text fixture is written out three times (about 6 lines each).**
- Suggested change: store it once in a `tests.rich_doc` table, as `tests.edge_doc` already does.

**[Minor] 040_refs.test.sql:509-536 vs. 567-635: redundant key coverage.**
- The ad hoc `throws_ok` cases (65 chars, multi-byte, escaped) overlap the table-driven `tests.bad_keys` x 5 places (60 documents), which in turn is followed by 12 individual `throws_ok` cases of the same keys.
- Only the table-driven pair plus the 64/65 boundary cases add information. The 12 repeats exist for readable output, which the table-driven `is_empty` already provides by listing failures.
- Suggested change: drop the repeats, or keep them and state that in the comment.

**[Minor] 040_refs.test.sql:891-893: tautological check.**
- It re-runs the same regex shape as the function body, so it only proves the shapes are fixtures the function would accept. That is fine as a fixture sanity check; the comment should say so.

**[Minor] 040_refs.test.sql:853-866, 405-408, 733-736 (and :448, :822): historical "before" numbers in test comments.**
- Figures like "1.1 GB in 1.1 s" and "3.5 GB in about 4 s" belong in the review record. They go stale and make the comment longer than the behaviour it explains.
- Suggested change: keep one sentence per probe on what it is and what bound it enforces.
- Related: the :822 "at most 8.0 MB" disagrees with the 8.49 MB at-limits figure (:774). It is correct only for the shapes, not the file.

**[Minor] supabase/migrations/20261102000400_refs.sql:70 and 89: the number is 67, not 68.**
- `."key"` with a 64-character key is 1 + 2 + 64 = 67. With 127 steps the path is about 8.5 KB (8,509 bytes), not "about 8.6 KB". The comment at :93 already says 8.4 KB measured.
- The same figure appears in `040_refs.test.sql` at :769 (about 8.5 KB), so it agrees there.

**[Minor] 20261102000400_refs.sql:265, 268, 273: `offset 0` is used as an optimization fence with no comment saying why.**
- Without one, a later cleanup would remove it and silently change the plan, for instance by flattening the set-returning-function subqueries. The memory and temp-file claims in the header depend on that.
- Suggested change: one line on the first occurrence, e.g. "offset 0 stops the planner flattening this subquery, which keeps the set-returning functions evaluated one row at a time."
- Security-relevant (function body): send any change back through the security review. A comment-only edit is safe.

**[Minor] 20261102000400_refs.sql:244-269 vs. comment 220-230: alias `c` is used for two different nested subqueries.**
- One sits at :266 (resolves the child node) and the other at :269 (the counts). The comment's "c keeps the containers and counts the references in each" matches only the outer one. The comment's p/e/c/r letters also do not map one to one onto the aliases (the node-resolving subquery is unnamed in the comment).
- Suggested change: rename the inner alias, e.g. `ch`, and add it to the comment.
- Security-relevant (function body): a rename is behaviour-neutral, but re-verify through the security review.

**[Minor] 040_refs.test.sql:641: `is(char_length(...), 64, ...)` asserts a property of the test literal, not the function.**
- It is harmless but adds nothing a reader needs; fold it into the previous assertion's comment.

Not findings (checked):
- `private.drafts_sync_refs` and `private.revisions_write_refs` share an insert-select, but the duplication is small and security-relevant, so leave it.
- Error handling in `extract_refs` is consistent: the SQLSTATEs match the spec, `22P02` is raised before `P0001`, and the `XX000` guard on `v_found` is sensible.
- Test plan count and comment structure are coherent.
