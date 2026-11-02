PASS

Round 3 spec review of Task 7 at 8883356. Read-only: I ran `git diff b8d2849..8883356 -- supabase/` and `git status --porcelain`, and grepped and read the migration and test files. I did not run `pnpm db:reset` or `pnpm db:test`. I rely on the controller's output (`Files=7, Tests=472, PASS`). `git status --porcelain` is unchanged.

- **Signature and pre-walk:** the signature `private.extract_refs(p_data jsonb) returns table (path text, ref uuid, kind text)` is unchanged. The three pre-walk checks are untouched and run in the same order, each raising 54000: depth over 128, key over 64 characters, and more than 1000 references. The `v_refs = 0` early return is kept.
- **Walk output:**
  - A reference found on a level is checked for `_ref` (22P02, canonical UUID regex, JSON null and non-strings rejected) before `_kind` (`invalid_reference`, P0001).
  - Path format is `$` followed by the quoted-key or `[i]` steps, as before. The walk now builds a path only when it finds a reference.
  - The document itself counts as a reference if it has a `_ref` key.
  - Nested `_ref` objects are handled by `total > is_ref`.
- **Cross-check:** a final guard raises XX000 if the walk's count differs from the `strict $.**._ref` count. The existing cross-check tests are unchanged.
- **Regression tests:**
  - The decision 27 tests (129 levels, 10,000 levels, as a draft and as a revision) are still present at lines 426–495.
  - The decision 28 tests are still present at lines 500–628: keys of 64 and 65 characters, multi-byte and escaped keys, 1000 and 1001 references, and the limits checked in order.
  - The at-limits test is still there, with its bound tightened to at most 10 MB and under 1 s (line 667). It fails if the walk spills more than the result.
- **New tests:**
  - The adversarial-shapes section adds 10 assertions, matching `plan(163)` (153 + 10).
  - It checks the shapes sit inside the limits and uses a path-evaluation cross-check.
  - It checks draft and revision acceptance, the 10 MB and 1 s bounds, full-path equality for the branching shape, and the md5 deep-chain path length.
  - The temp-bytes and time bounds can fail.
  - The md5 longest-path test checks the primary-key index refuses the longest path with 54000. This is slightly beyond the task text, but it is a regression test of the limit and not off-task.
- **Extras:** nothing off-task. The migration still has only the walk rewrite, and the tests only the new cost and shape coverage. The `set local statement_timeout = '3s'` in the test is described as a guard and sits in the last section.

[Minor] /Users/einarzoega/litljomi-cms/supabase/tests/database/040_refs.test.sql:629 — The earlier cost check (under 1 MB and under 1 s) covers `tests.costs` only up to that point, so it does not cover the later probes. The later probes have their own bounds, so there is no gap. No action needed.
