# Task 6: quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02, after spec r1 and security r1 passed
- Change: bcbc955
- The reviewer's report, verbatim:

---

PASS

No Critical or Major findings. All are Minor. I ran only `git show bcbc955` and `cat` of the 030 test file, and relied on the controller's `pnpm db:test` run (Files=6, Tests=282, PASS). Nothing was modified.

Tests would mostly fail on a regression. The `updated_at = '2000-01-01'` followed by `is(updated_at, now())` catches a trigger that stops setting `updated_at`. The owner `version = 99` case shows the trigger overrides any writer. The `zz_probe_change_slug` probes catch either lock trigger reverting to BEFORE. The cross-tenant composite-FK cases are built so that RLS and grants pass and only the FK can fail. The unfiltered-update cases check labak rows afterwards in owner context.

Findings (all Minor):
1. 010_catalog.test.sql, composite-FK catalog check: the `tenant_tables` array is hardcoded. A new tenant table in Tasks 7-11 that nobody adds to it goes unchecked silently. The list is also repeated in the `col_not_null` lines. Derive the set from `cms` tables that have a `tenant_id` column (`pg_attribute`), or assert that every such table is in the list.
2. 010 and 030 assert "no UPDATE or DELETE on revisions" three times: the 010 catalog check, `table_privs_are`/`column_privs`, and the two `ok(not has_table_privilege …)` lines in 030. Drop the two 030 lines. In 010, the `(values ('cms.revisions')) as t(tbl)` cross join is scaffolding for Task 10's audit_log, and the comment should say so.
3. The `tests.probe_change_slug` function and trigger pattern is copy-pasted in 020 and 030. `tests.column_privs` is defined inside 030, though Tasks 7-11 will need it. Move both into `_helpers.sql` (test-only code).
4. 030: `plan(88)` is a hand-counted literal, and the file's assertions depend on earlier ones. Examples: versions 2, 3, 4; c001's slug renamed and then archived; c002's pointer moved to d003. Consider `no_plan()`, or list the mutations in the fixture header.
5. 030: about 40 repeated `'00000000-0000-4000-8000-00000000c00x'` literals. A `tests.entry('c001')` helper, in the style of `tests.tenant()` and `tests.persona()`, would remove them. The fixture header also doesn't say which personas come from `tests.seed()`.
6. 030, 1 MB check: only 1048577 is tested, so a `<=` changed to `<` goes undetected. Add a case at exactly 1048576 bytes of `data::text`. The `null` message also can't tell which CHECK fired, though only one applies to `data`.
7. 030: a comment cites "review focus 5", which has no target in the repo. Remove it or name the document.
8. content.sql: the same membership `exists(...)` predicate is written nine times across the policies, and the two update policies repeat it in both `using` and `with check`. They are consistent today. A later edit that changes one copy is the risk. SECURITY-RELEVANT (policies): do not refactor without security review. A "keep identical" comment is the safe change.
9. content.sql, `private.force_actor`: `to_jsonb(new) ? tg_argv[0]` serialises the whole row, including up to 1 MB of `data`, on every draft write just to validate a column name. Checking `pg_attribute` for `tg_relid` would avoid the copy. Optional. SECURITY-RELEVANT (trigger function): route through security review if changed.
10. tenancy.sql: the new comments "exactly as the plan's Task 5 interface defines it" record plan provenance, not design reasoning. The comments on why there is no cascade and why the trigger is AFTER are useful and should stay.

Files, all under /Users/einarzoega/litljomi-cms/supabase/:
- migrations/20261102000300_content.sql
- migrations/20261102000200_tenancy.sql
- tests/database/030_content.test.sql
- tests/database/010_catalog.test.sql
- tests/database/020_tenancy.test.sql
- tests/database/_helpers.sql

---

## Controller ruling

PASS accepted. All ten Minors are deferred to Task 7, which extends these migrations and tests next. Minor 1 matters most: the tenant-table list in `010` must not silently miss Task 7's `draft_refs` and `revision_refs`. Minors 8 and 9 are security-relevant, so any change to them goes through Task 7's security review. Minor 7: "review focus 5" refers to the plan's "Review focus" item 5; the comment should name the plan.
