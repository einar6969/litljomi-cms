# Task 2 (Local Supabase stack and pgTAP harness): security review, round 4 (scoped to fix round 3)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Change: `188fd51..81d18b5` (81d18b5)
- Result: **PASS**; both round 3 Minors ADDRESSED; 1 new Minor.
- Probes: stub `supabase` binary, copies of the wrapper and mutation runs under `scratchpad/sec-r4-probe/`; every database probe rolled back; database left in its reset state. No sandbox refusals.

## Checklist (verbatim in substance)
1 pass (every helper `search_path = ''`, schema-qualified, no security definer; diff adds only comment lines; no migrations). 2 not applicable (no `cms`, `private`, `api`). 3 not applicable for §4.5; helper grants unchanged; the new comment is accurate. 4–9, 11, 12 not applicable. 10 pass (no secrets; messages print only the directory and `result.error.message`). 13 pass (§8.5). 14 pass (no `.claude` change).

## Round 3 Minors
- `DB_TEST_DIR` flag injection: ADDRESSED. `tools/db/test.mjs:10` takes the directory only from `import.meta.url`; `process.env` is used only to pass the environment to the child. With a stub CLI, `DB_TEST_DIR` set and extra arguments (`--db-url=postgresql://evil 'x; y'`), the CLI received only `test`, `db` and the two absolute `*.test.sql` paths. A file named `--db-url=postgresql:x.test.sql` is passed as an absolute path and cannot become a flag. Empty-list guard: empty folder and helpers-only folder → message, exit 1, CLI never started; missing folder → exit 1. Residual (inherent): `PATH` decides which `supabase` runs.
- Grant comment: ADDRESSED (`_helpers.sql:111-112`); the test's "every role can execute…" claims only that the three roles can execute, which is accurate.

## Assertions weakened or vacuous? No (mutation runs)
- `seed()` denial: the three privilege checks kept; granting EXECUTE on `seed()` to authenticated makes test 14 fail.
- `act_as` validation: three `throws_ok` unchanged; the only removal is the assertion that could never fail.
- Claim clearing: removing `set_config(..., '', true)` from `act_as_owner` makes test 37 fail.
- New anon assertions: making `act_as_anon` add `sub` and `aal` makes tests 29–31 fail.
- `lives_ok` on `seed()`: a failing seed now shows as a test failure.
Suite: Files=2, Tests=41, PASS.

## New finding
- Minor `001_helpers.test.sql:23-25`: the comment calls the moved `throws_ok(..., '42501', null, ...)` a "behavioural proof of the privilege checks above", but it accepts any 42501: with EXECUTE granted to authenticated, `seed()` still fails with "permission denied for table users" (invoker insert into `auth.users`), so the test passes. Expecting the message 'permission denied for function seed' passes on the real helpers and fails on the mutation. No security impact: the static checks catch the regression.

## Controller ruling
Parked: the static `has_function_privilege` checks (tests 12–14) already fail on that regression, so nothing is unguarded; the expected-message refinement is carried to the next task that edits `001_helpers.test.sql` (Task 4 at the latest, when PUBLIC's default EXECUTE is revoked and the grant tests are revisited). Cost if wrong: one over-broad assertion until then.
