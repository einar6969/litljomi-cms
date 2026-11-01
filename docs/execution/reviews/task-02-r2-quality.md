# Task 2 (Local Supabase stack and pgTAP harness): quality review, round 2 (scoped to fix round 2)

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-01
- Change: `5719355..b814f5e` (b814f5e)
- Result: **APPROVED** (4 Minor). `pnpm db:test` Files=2, Tests=39, PASS; working tree clean.
- Line numbers refer to the review package diff.

Round 1 "Fix" items: 1 ADDRESSED (empty-list guard); 2 ADDRESSED (directory from `import.meta.url`; the `DB_TEST_DIR` flag risk is the known security Minor); 4 ADDRESSED (CLAUDE.md warning); 5 ADDRESSED (savepoint comment); 6 ADDRESSED (consistent two-line `set_config`); 7 ADDRESSED (null `p_user`, null or unknown `p_aal` raise; readable messages); 8 ADDRESSED (001 covers every helper; 000 untouched); 9 ADDRESSED (execute only on the six post-switch helpers; `seed()` revoked from public). Plan count 35 correct. Assertions specific and readable; each helper has a test that fails if it regresses.

Minor (verbatim in substance)
1. 001_helpers.test.sql:71 "rejected act_as leaves the role unchanged" runs in owner context right after `throws_ok`, whose subtransaction rolls back any `set local role` anyway; it cannot fail (false assurance). Delete it (plan 34) or restructure.
2. 001_helpers.test.sql:78 "authenticated cannot call seed" sits inside the act_as aal1 block; duplicates the privilege checks at 55-57 but is the only behavioural proof; placement easy to misread. Comment or move it.
3. 001_helpers.test.sql:50 bare `select tests.seed();` prints a row into the TAP stream; use `lives_ok($$select tests.seed()$$, 'seed runs')` and adjust the count.
4. 001_helpers.test.sql:89-92 after `act_as_anon` only `role` and `uid` are checked; nothing asserts `aal` and `sub` are absent (optional).

Out of scope: the `DB_TEST_DIR` and PUBLIC-grant-comment security Minors; round 1 item 3 (ruled no change).

## Controller rulings (final fix round, Task 2 fix round 3)
- Fix quality Minors 1–4 (for 1, delete the vacuous assertion; for 2, move the behavioural `seed()` denial next to the seed assertions with an explicit `act_as` and a comment; for 3, `lives_ok`; for 4, assert `aal` and `sub` absent after `act_as_anon`), with the plan count adjusted.
- Fix security round 3 Minors: remove the `DB_TEST_DIR` override (extra to the rulings, untested, new surface); the empty-list guard is demonstrated instead by running a copy of the wrapper from a temporary tree with an empty `supabase/tests/database`. Correct the grant comment in `_helpers.sql` to say the explicit grants are needed once Task 4 revokes PUBLIC's default EXECUTE, and that PUBLIC still has it until then; keep the test's assertions accurate to that.
- Then scoped spec, security and quality re-reviews.
