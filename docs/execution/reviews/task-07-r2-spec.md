PASS

The fix does what decisions 27 and 28 require. I found no Critical or Major findings. I did not run `pnpm db:reset` or `pnpm db:test`, as instructed. I relied on the controller's output (`040_refs.test.sql ... ok`, Tests=462, PASS). `git status --porcelain` shows only the controller's two modified files (`docs/execution/progress.md` and `docs/execution/state.json`).

**Checked against the diff (`supabase/migrations/20261102000400_refs.sql`)**
- **Depth:** `jsonb_path_exists(v_doc, 'strict $.**{128} ? (object||array)')` rejects a container at level 129 with 54000. It runs first and visits each node at most once, so it is linear. Tests cover 128 nested objects and arrays (allowed), 129 (rejected), and a scalar inside level 128 (allowed). A reference at level 120 is still found with its full path. The depth check also runs before reference validation.
- **Key length:** one regexp scan of `v_doc::text` finds each string, and a string followed by `:` is a key. Only matches longer than 64 characters in escaped text are decoded and measured with `char_length`, so the limit counts characters of the key itself, not bytes or escaped text. Tests cover exactly 64 (allowed) and 65 (rejected) at top level, nested, in an array element, on a reference object and in a reference-free subtree. They also cover 64 and 65 multi-byte characters and keys with escaped characters. A long string value that ends in `": ` is not mistaken for a key.
- **Reference count:** `strict $.**._ref.type()` with `limit 1001` rejects more than 1,000 references with 54000. 1,000 is allowed and 1,001 is rejected, including 1,000 spread over several places with one reference nested inside another. Both limits are checked before the walk, and tests confirm they come before `22P02` and `invalid_reference`.
- **Draft and revision data:** tests cover draft update and insert as editor and revision insert as `service_role`, for depth, key and count. Refused saves leave `draft_refs` untouched.
- **Lean walk:** it enters only containers that have a reference below them, and each row carries a `steps` array instead of the subtree. The `v_refs = 0` case returns early. The round 1 behaviours are retained by the existing assertions: the plan went from 97 to 153 tests with none removed, and the controller's run is green.
- **Spec and plan:** `docs/architecture.md` §4.3 and the plan's decision 28 text match the implementation.

**Regression tests can fail**
- **Deep document (27):** the ~1 MB, 10,000-level document is rejected in under 1 s. The test comment says the old walk took 8 s and wrote 3 GB, so the bound would fail on it. This is tested for both draft and revision.
- **Long-key probe (28):** it uses 100 levels of 900-character keys with 13,000 references (~975 KB). It is measured through `tests.cost`, which counts temp-written blocks from EXPLAIN ANALYZE BUFFERS and elapsed time, and asserts 54000 with under 1 MB and under 1 s. The old behaviour wrote 3.5 GB in about 4 s, so it would fail. A second probe with 1,000 references isolates the key limit, and the revision path is also measured.
- **Document at the limits (28):** 126 levels, 64-character keys and 1,000 references, between 1,000,000 bytes and 1 MB. It is accepted as a draft save and as a revision, with bounds of 64 MB and 3 s, and all 1,000 full paths are verified in both the draft and revision refs tables.

**Findings**
- [Minor] `supabase/tests/database/040_refs.test.sql` (at-limits section, comment above `tests.at_limits`): a document at all three limits is accepted only if its paths fit the primary-key btree limit. The test uses repeating keys, which compress. With incompressible keys of the same shape, the index refuses the write with 54000 (the comment says so). That is a conservative outcome, but it means "exactly 1,000 references accepted" does not hold for every document that fits all limits. Decision 28 does not address this, so I rate it Minor. Flagging it for the controller in case it should be recorded in the spec.
- [Minor] Temp-file size versus the ruling: the ruling says "the worst case is bounded at a few MB". The measured ~27 MB of temp files (comment: "about 27 MB … 0.25 s") is larger. I don't think it conflicts with the ruling. The ruling's operative requirements are the three limits, linear-time checks before the walk and regression tests bounding temp-file and run time, and all of those are met. "A few MB" reads as an estimate of the stored paths: 1,000 paths of ~8.5 KB is ~8.5 MB, and the extra temp-file volume comes from the walk's intermediate rows. The test bound of 64 MB is roughly 2.4 times the measurement. The gap is still real, so I'm noting it for the controller and not settling it.

I found nothing extra or off-task in the `supabase/` diff. The test helpers and the `tests.costs` table are test-only. The range `0f7ca02..b8d2849` also contains non-Task-7 files (other tasks, review files and docs), which I did not review.

**Commands run:** `git diff 0f7ca02..b8d2849` (stat, migration and test diffs), `git status --porcelain`, and `grep`/`sed` on `docs/architecture.md` and the plan.

**Files:**
- `/Users/einarzoega/litljomi-cms/supabase/migrations/20261102000400_refs.sql`
- `/Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql`
