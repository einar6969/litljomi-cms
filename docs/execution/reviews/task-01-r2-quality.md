# Task 1 (Monorepo skeleton, boundary checks and CI): quality review, round 2

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-01
- Change: whole task `6dc46af..d2ca911`
- Result: **APPROVED** (no Critical or Important; 10 Minor)
- Ran: `vitest run tools/checks` (85 pass), `eslint .` (clean); `git status --porcelain` empty.

Round 1 findings in the current code: 1 resolved (throws on missing root; runCheck reports scanned/absent roots and absent modules/; CLI tests incl. symlink); 2 resolved (static, dynamic, require, alias forms); 3 resolved (`RESTRICTED_SYNTAX`); 4 partly resolved (Minor 1); 5 resolved; 6 resolved; 7 resolved; 8 resolved; 9 resolved (`esbuild: false`).

`eslint.config.mjs` is readable and maintainable: helpers (`esqueryRegex`, `dynamicSyntax`, `names`, `imports`, `syntax`) clearly named, comments true, no dead or duplicated selector logic; per-zone blocks repeat group lists by agreed design.

Minor (verbatim in substance):
1. eslint-boundaries.test.ts lines 19, 22, 76, 79, 109, 112, 115–116, 119, 189, 193, 241, 244: `toContain(...)` where exactly one rule should fire; use `toEqual([IMPORT])` / `toEqual([RESTRICTED_SYNTAX])`.
2. Same file 24–38 (`it.each` "forbids %s outside the registry"): assertions are length > 0, one distinct rule id, one of two ids; weaker than the alias-forms table at 209–221. Use `[code, ruleId]` rows with `toEqual([ruleId])`; 39–44 then redundant.
3. Same file 90–93: expected `[RESTRICTED_SYNTAX, RESTRICTED_SYNTAX]` is correct (privileged and apps selectors both match) but looks like a typo; add a comment.
4. eslint.config.mjs 48: `alreadyReported` uses `${s} > *` for member reads and `${s} *` for destructuring without explanation; add a comment.
5. eslint.config.mjs 105–108: registry block identical to the base block, exists to undo the apps/** module restriction; add a comment.
6. eslint.config.mjs 10–12: "feed" → "feeds"; the alias sentence belongs on `modulePaths`.
7. no-tenant-slugs.test.ts 14–21, 59–65: `scan()` and the symlink test leave temp dirs; clean up in `afterEach` or `try/finally`.
8. Same file 28–30: test "ignores the module registry and identifiers that merely contain the slug" overlaps 31–33 and 43–45; rename to "reports nothing for a clean core fixture" or delete.
9. Same file 72, 94, 108: `toContain(...:2:labak)`; optionally assert the full-line format.
10. eslint-boundaries.test.ts ~98 (security-relevant if acted on): no test for `import.meta.env.SUPABASE_SECRET_KEY`.
