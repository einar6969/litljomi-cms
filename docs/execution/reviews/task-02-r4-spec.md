# Task 2 (Local Supabase stack and pgTAP harness): spec review, round 4 (scoped to fix round 3)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Change: `188fd51..81d18b5` (81d18b5)
- Result: **PASS** (no findings)

Report (verbatim in substance):
- 001_helpers.test.sql: the vacuous "rejected act_as leaves the role unchanged" assertion removed; the behavioural `seed()` denial now follows the three `has_function_privilege` seed assertions, after an explicit `act_as(persona('outsider'))`, with a comment, followed by `act_as_owner()`; seed runs through `lives_ok($$select tests.seed()$$, 'seed runs')`; after `act_as_anon`, two new assertions check the `aal` and `sub` claims are null.
- 001_helpers.test.sql:5 `plan(37)` matches the 37 assertions.
- tools/db/test.mjs: `DB_TEST_DIR` removed (no references remain); directory still from `import.meta.url`; empty-list guard kept.
- _helpers.sql (~113): the grant comment states the grants are needed once Task 4 revokes PUBLIC's default EXECUTE and that PUBLIC has it until then; grants, signatures and the `seed()` revoke unchanged.
- Only those three files changed; 000_harness.test.sql, helper names, signatures, defaults and the `act_as` validation untouched.
- Commands: `git diff --stat 188fd51..81d18b5`; greps for the assertion count, `plan(` and `DB_TEST_DIR`; `pnpm db:test` → Files=2, Tests=41, PASS; `git status --porcelain` (only the controller's pre-existing changes).
