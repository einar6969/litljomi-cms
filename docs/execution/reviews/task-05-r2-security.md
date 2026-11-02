# Task 5: security review, round 2 (fix diff)

- Reviewer: fresh `cms-security-reviewer` (Opus), fix round, 2026-11-02
- Fix diff: feb8734
- The reviewer's report, verbatim:

---

PASS
No full re-review needed. The fix is small (2 files, +13/−3) and touches only the two round-1 findings.

**Round 1 findings**
- [Major] No test failed if `tenants_select_console` lost its `platform_admins` clause: **resolved.** `supabase/tests/database/020_tenancy.test.sql:66-71` adds two cases: `editor_labak` at aal2 sees only `labak`, and `outsider` at aal2 sees no tenant.
  - I checked that these tests can fail. As `postgres`, in one transaction that I rolled back, I created pgTAP, replaced the policy with `using ((select auth.jwt() ->> 'aal') = 'aal2')`, and ran the 020 test with `_helpers.sql` included. Result: `1..44`, `not ok 35 - editor with aal2 still sees only own tenant` (it also returned `demo`), `not ok 36 - user without membership at aal2 sees no tenant` (two rows), "failed 2 tests of 44".
  - Control: the same script with the real policy gives `1..44` and no failures.
- [Minor 1] The slug trigger was column-specific: **resolved.** The catalog now shows `CREATE TRIGGER tenants_lock_slug BEFORE UPDATE ON cms.tenants FOR EACH ROW WHEN ((old.slug IS DISTINCT FROM new.slug)) EXECUTE FUNCTION private.tenants_lock_slug()` (`pg_get_triggerdef`).
  - Probe (rolled back): I added a BEFORE UPDATE trigger `a_change_slug`, which sorts before the lock and sets `NEW.slug`, then ran `update ... set name=...`. Result: `ERROR: slug_locked`. The column-specific trigger would have let this through.
  - Behaviour is otherwise unchanged. As `service_role`, `MERGE ... UPDATE SET slug` and `INSERT ... ON CONFLICT DO UPDATE SET slug` still raise `slug_locked`, and the 020 lives_ok tests for name and status updates pass.
- Minor 2 was deferred to C1 by the controller. Not re-judged.

**Checklist items the fix touches**
1. pass: `private.tenants_lock_slug` has `prosecdef = f` and `proconfig = {search_path=""}` (catalog query). The trigger change adds no function.
4. pass: RLS policies are unchanged (`pg_policy` lists `tenants_select_member` and `tenants_select_console`, the latter requiring `aal2 AND EXISTS platform_admins`). The policy's `platform_admins` half is now covered by tests that fail when it is removed (mutation above).
13. pass: no contradiction with the spec. §4.1 rule 7 (slug immutable) and §4.5 (console read needs platform admin and aal2) are met.
14. pass: `git diff feb8734~1 feb8734 --stat -- .claude` is empty. The commit changes only `supabase/migrations/20261102000200_tenancy.sql` and `supabase/tests/database/020_tenancy.test.sql`.

Items 2, 3, 5 and 6–12 are not touched by the fix. Grants are unchanged and still checked by `table_privs_are`; `pnpm db:test` passes them.

**Test run:** `pnpm db:test` gives "Files=5, Tests=185 ... Result: PASS". The first attempt failed in setup with `TestDbEnablePgtapError ... duplicate key value violates unique constraint "pg_extension_name_index"`, most likely because another reviewer ran the suite at the same moment (both runs create the pgTAP extension). The rerun was clean. This is not a finding about the change.

**Further finding**
- [Minor] `supabase/migrations/20261102000200_tenancy.sql:56-60`: a BEFORE UPDATE trigger whose name sorts after `tenants_lock_slug` can still change `NEW.slug` after the lock has run. Probe (rolled back): adding `z_change_slug`, which sets `NEW.slug := 'probe-z'`, then running `update cms.tenants set name='via-z'` gave `UPDATE 1` and slug `probe-z`. The implementer's observation is correct.
  - Why Minor: no such trigger exists, and creating one needs table-owner DDL, which only comes through a reviewed migration. `service_role` and `authenticated` cannot create, disable or drop triggers ("must be owner", round 1 probes). The migration comment (lines 40-43) correctly limits its claim to triggers that fire earlier. No current exposure, so this is a defence-in-depth gap only.
  - Possible fix: an `AFTER UPDATE ... FOR EACH ROW WHEN (old.slug IS DISTINCT FROM new.slug)` trigger, which sees the final row whatever order the BEFORE triggers run in. A one-line catalog test listing `cms.tenants`' triggers would also work. I make no change; this is for the controller to decide or defer.

**Cleanup:** all probes ran in transactions that I rolled back. Afterwards the database has no `pgtap` extension, no `tests` schema, the two original policies and one trigger on `cms.tenants`. `git status --porcelain` shows only the controller's files under `docs/execution/`, plus a new `docs/execution/reviews/task-05-r2-spec.md` that is not mine. I wrote only the probe scripts, in the scratchpad.

Files:
- `/Users/einarzoega/litljomi-cms/supabase/migrations/20261102000200_tenancy.sql`
- `/Users/einarzoega/litljomi-cms/supabase/tests/database/020_tenancy.test.sql`
- Probe scripts: `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/mut1.sql` (mutation), `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/ctrl.sql` (control), `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/trig.sql` (trigger order)

---

## Controller ruling

PASS accepted. The untracked spec report the reviewer saw is the controller's record.

The trigger-order Minor is deferred to Task 6. Task 6 adds the same immutable-slug pattern for `entries`, so it can use an AFTER trigger, or a catalog test pinning `cms.tenants`' triggers, for both tables.

The pgTAP setup collision came from two reviewers running `pnpm db:test` at the same moment. From now on, the controller tells parallel reviewers not to run `pnpm db:test` at the same time: one runs it, the other relies on the controller's output or uses rolled-back probes.
