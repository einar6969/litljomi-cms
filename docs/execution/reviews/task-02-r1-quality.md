# Task 2 (Local Supabase stack and pgTAP harness): quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-01
- Change: whole task `c35e720..20e1748` (7933579, 20e1748), excluding docs/
- Result: **CHANGES REQUESTED** (1 Important, 8 Minor). `pnpm db:test` passes (4 tests); working tree clean.
- Line numbers refer to the review package diff, not the files.

Report (verbatim in substance):

Important
1. `tools/db/test.mjs:11-17`: if the filtered list is empty, `supabase test db` gets no file arguments and falls back to running every `.sql` file, `_helpers.sql` included — the hazard the wrapper exists to prevent (rename or delete of `000_harness.test.sql`, or a wrong path). Fix: exit 1 with "no *.test.sql files in <dir>" when the list is empty.

Minor
2. `tools/db/test.mjs:7`: `dir` is cwd-relative; resolve it from the script location (`fileURLToPath(new URL('../../supabase/tests/database', import.meta.url))`) or comment that it runs from the repo root.
3. `package.json`: `SUPABASE_TELEMETRY_DISABLED=1` repeated in three scripts and set again in test.mjs; POSIX-only inline form. Optional; the plan/T1 likely dictate it.
4. `CLAUDE.md` `db:test` line: no warning that `supabase test db` must not be run directly. Fix: append "Always use this script, never `supabase test db` directly (it would run `_helpers.sql` outside a transaction)."
5. `_helpers.sql` savepoint comment is cryptic; say the savepoint is a guard, deliberately never released.
6. `act_as_anon`/`act_as_service` duplicate `act_as` apart from role and claims (`set local role` cannot be parameterised; leave them), but the `set_config(...)` formatting differs (multi-line vs one line); make it consistent.
7. `act_as(p_user, p_aal)` does not validate: `act_as(null)` builds claims with `"sub": null`; a typo such as `'aal 2'` gives claims no policy recognises and looks like a plain denial. Fix: raise if `p_user is null` or `p_aal not in ('aal1','aal2')`, no new interface.
8. Coverage (the harness test is verbatim from the plan): `act_as` and `act_as_owner` covered; test 3 would also pass if the role were left as `anon` or `service_role`. Not covered: `tests.tenant`, `act_as_anon`, `act_as_service`, the `p_aal` claim, `persona` for four of five names, the unknown-name exceptions, `seed` (users never counted). Suggest assertions: `throws_ok` on unknown persona and tenant, one per persona and tenant UUID, `auth.jwt()->>'aal'` after `act_as(..., 'aal2')`, `current_user` after `act_as_anon` and `act_as_service`, five seeded users.
9. (Security-relevant, flag for re-review) `grant execute on all functions in schema tests` gives anon, authenticated and service_role execute on `tests.seed()`; it is invoker so the insert fails for them; raised for misuse-resistance.

Otherwise: `tests.*` names clear, every function `search_path = ''` with `pg_catalog.`-qualified calls, the stub labelled, the wrapper's missing-CLI message useful, null exit status mapped to 1.

## Controller rulings
- Fix: 1, 2 (resolve from the script location), 4, 5, 6, 7, 9 (grant execute only on the functions needed after a role switch: `persona`, `tenant`, `act_as`, `act_as_anon`, `act_as_service`, `act_as_owner`; not `seed`).
- Fix 8 without changing the plan's verbatim `000_harness.test.sql`: add `supabase/tests/database/001_helpers.test.sql` covering every helper (each persona and tenant UUID, unknown-name exceptions, `aal` claim, `act_as_anon` and `act_as_service` role and claims, `act_as_owner` returning to `session_user` from each role, five seeded users, the validation from 7).
- No change: 3 (rulings T1 and the plan's script names; one inline variable per script is the agreed form).
- Because 7 and 9 change the impersonation helpers, spec and security reviews run again before a scoped quality re-review.
