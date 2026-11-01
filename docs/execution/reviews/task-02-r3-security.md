# Task 2 (Local Supabase stack and pgTAP harness): security review, round 3 (scoped to fix round 2)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01
- Change: `5719355..b814f5e` (b814f5e)
- Result: **PASS** (no checklist item fails; 2 Minor)
- Probes: rolled-back pgTAP files and a stub `supabase` binary under `scratchpad/sec-r3-probe/`; database reset and verified clean at the end (`tests` absent, 0 users; `pnpm db:test` Files=2, Tests=39, PASS).

## Checklist (verbatim in substance)
1 pass: inside the transaction `tests` has 7 functions owned by postgres, not secdef, `search_path=""`, schema-qualified calls; no migrations.
2 not applicable (no Data API change).
3 not applicable for §4.5. Inside the transaction: the six switch helpers have `{=X/postgres,postgres=X,anon=X,authenticated=X,service_role=X}`; `seed()` only `{postgres=X/postgres}` (executable only by postgres and supabase_admin); no global default ACL adds to `tests`; schema ACL `{postgres=UC,anon=U,authenticated=U,service_role=U}`, `create` false for the three roles (`create table tests.zz` as anon → 42501). `b_roles.test.sql` 23/23: persona and tenant work as authenticated; `seed()` → 42501 as authenticated, service_role, anon; every role switch works from every role. Nothing survives the transaction. PUBLIC keeps the default EXECUTE on the six helpers, only inside the uncommitted transaction.
4–9, 11, 12 not applicable.
10 pass: no secrets in the diff; the new messages print only the directory and `result.error.message`.
13 pass: the `act_as` checks reject only a null `p_user` and an `aal` outside aal1/aal2; every planned `act_as` call (plan lines 463, 579-588, 634, 638, 699) uses a persona UUID with the default, 'aal1' or 'aal2'; claims still exactly `sub`, `role`, `aal`; 'AAL2' rejected; a rejected `act_as` leaves the earlier subject unchanged.
14 pass: no `.claude` change; diff limited to CLAUDE.md, 001_helpers.test.sql, _helpers.sql, tools/db/test.mjs.

## Questions checked
- F1 still holds (`_helpers.sql:104-105`): after every act_as variant, `act_as_owner()` gives postgres, null `auth.uid()`, `auth.jwt()`, `auth.role()`, `request.jwt.claims` ''.
- Savepoint guard holds: a plain run stops at `_helpers.sql:7` (exit 3); `tests` absent, 0 users afterwards.
- Empty-list guard holds: an empty folder or one with only `_helpers.sql` → "no *.test.sql files", exit 1, CLI never started; a missing folder or empty `DB_TEST_DIR` → non-zero.
- Default path safe: resolved from the script location; only the `*.test.sql` files are passed, as absolute paths.

## Findings
- Minor `tools/db/test.mjs:11,15,23`: paths built from `DB_TEST_DIR` are passed as-is, so a value starting with `-` becomes a CLI flag. Reproduced with a sub-folder literally named `--db-url=postgresql:/u@%zz`: the CLI received `--db-url=postgresql://u@%zz/a.test.sql`, printed "Connecting to remote database..." and failed to resolve the host; nothing was reached. Effect: the run could target a non-local database, and with no path arguments `supabase test db` would run every `.sql` file including `_helpers.sql`, bypassing the empty-list guard. Needs a crafted folder and control of the environment (which could run `supabase test db --db-url` directly anyway), so no privilege boundary is crossed, but it is new surface; no test uses the override. Remedies: `path.resolve(dir)`, or restrict it to the repository.
- Minor `_helpers.sql:111-114`: the explicit grants to anon, authenticated, service_role repeat what PUBLIC has by default inside the transaction; correct, but the comment and the test (`001_helpers.test.sql:29-34`) suggest the three roles are the only grantees.

## Process notes
- Sandbox refusal: running `supabase test db --help` without `SUPABASE_TELEMETRY_DISABLED=1` was refused (`EPERM … ~/.supabase/telemetry.json.tmp…`). Not worked around; re-run with the variable set (the project's standard form).
- The reviewer wrote nothing in the repository.
