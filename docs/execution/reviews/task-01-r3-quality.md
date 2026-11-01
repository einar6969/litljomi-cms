# Task 1 (Monorepo skeleton, boundary checks and CI): quality review, round 3 (scoped to fix round 3)

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-01
- Change: fix-only `f05e33b..6a48046` (6a48046)
- Result: **APPROVED** (no Critical or Important; 2 optional Minor)
- Ran: `vitest run tools/checks` (111 pass, including the lint-script test), `pnpm lint` (`eslint -c eslint.config.mjs .`, clean); `git status --porcelain` empty.

Round 2 Minor 1–9: all ADDRESSED (verbatim in substance):
1. `toContain` → `toEqual([IMPORT])` / `toEqual([RESTRICTED_SYNTAX])`; inline-config tests use `[ignoredComment, RULE]`; `ruleIds` labels rule-less messages `fatal:`/`note:`.
2. eslint-boundaries.test.ts:176-205 `[code, ruleId]` table with `toEqual([ruleId])`; redundant tests removed.
3. eslint-boundaries.test.ts:279 explains the double report.
4. eslint.config.mjs:50-52 explains `> *` vs ` *`; 53-57 explain `secondNameNode`.
5. eslint.config.mjs:105 comments the registry block.
6. eslint.config.mjs:21 "feeds"; alias sentence (26) with `modulePaths`.
7. no-tenant-slugs.test.ts:485-494 `tempDir()` helper with `afterEach` cleanup.
8. no-tenant-slugs.test.ts:513 renamed "reports nothing for a clean core fixture".
9. `LEAK_LINE` asserted per line (483, 549, 572, 594).

Changed code: registry regex `registry(\.[^/]*)?$` (eslint.config.mjs:32) correct and readable, comment 27-28 matches, bypass tests in apps and packages and privileged `..`; `esqueryRegex` `\x2f` (38-40) comment accurate and tested; `alreadyReported`/`secondNameNode` simple, commented, pinned in both directions (8 shorthand forms exactly once, 6 renamed forms still reported); lint-script test (eslint-boundaries.test.ts:424-464) proves the bypass is real with plain `eslint .` (status 0), then runs the real script's args from package.json and expects status 1 naming file and rule; fails if `-c` is dropped; cleanup correct; 30 s timeout reasonable.

Minor:
- Q3-1 eslint.config.mjs:57: comment says a name written twice (`{ KEY: KEY }`) is reported twice; true for object patterns, but `import { KEY as KEY }` / `export { KEY as KEY }` are reported once. Narrow the wording. Coverage unaffected.
- Q3-2 eslint-boundaries.test.ts:437-463 vs no-tenant-slugs.test.ts:485-494: two temp-dir cleanup styles (`try/finally` vs `tempDir`/`afterEach`); both correct; optional.

Out of scope: N1 (parked to Task 17), `import.meta.env` (C-F4).

## Controller ruling
Q3-1 and Q3-2 parked (wording and style only, no behaviour or coverage effect); taken up when Task 17 revisits eslint.config.mjs with N1. Cost if wrong: one inexact comment until then.
