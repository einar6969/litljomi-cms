# Task 2 (Local Supabase stack and pgTAP harness): spec review, round 3 (scoped to fix round 2)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: `5719355..b814f5e` (b814f5e)
- Result: **PASS** (1 Minor)

Report (verbatim in substance):

(a) Each "Fix" item done as ruled; item 3 untouched. 1: tools/db/test.mjs:17-21 exits 1 with "db:test: no *.test.sql files in <dir>". 2: :10 resolves `dir` from the script location. 4: CLAUDE.md `db:test` line warns never to run `supabase test db` directly. 5: _helpers.sql:4-5 comment states the savepoint is a guard, never released. 6: `set_config(...)` formatting consistent in act_as, act_as_anon, act_as_service (_helpers.sql:61-98). 7: act_as raises on a null user and on a null or non-aal1/aal2 `p_aal` (:66-71), no new interface. 8: 001_helpers.test.sql adds 35 assertions (five personas and both tenants plus unknown-name exceptions; five seeded users; `aal` default aal1 and explicit aal2; act_as_anon and act_as_service role and claims; act_as_owner returning to `session_user` from authenticated, anon and service_role; the item 7 validation). 9: execute granted only on persona, tenant, act_as, act_as_anon, act_as_service, act_as_owner, not seed; asserted with `has_function_privilege`. 3: package.json not in the diff.

(b) No helper name, signature or default changed (`act_as(uuid, text default 'aal1')`); 000_harness.test.sql not in the diff.

(c) Only CLAUDE.md (`db:test` line), _helpers.sql, new 001_helpers.test.sql and tools/db/test.mjs touched.

(d) `DB_TEST_DIR` override (test.mjs:10): Minor, extra to the rulings; a commented test-only seam that changes nothing by default and is the only way to exercise the item 1 guard; accepted. `revoke execute … from public` on `tests.seed()`: within the ruling (PUBLIC's default execute would defeat the narrower grants); `throws_ok(…, '42501', …)` shows it works.

Minor: tools/db/test.mjs:10 now passes absolute paths to `supabase test db` (previously repo-relative); harmless.

Commands: `git diff --stat 5719355 b814f5e`; read of the diff and _helpers.sql; `pnpm db:test` → Files=2, Tests=39, PASS; `git status --porcelain` only the controller's pre-existing changes.
