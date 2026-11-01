# Task 1 (Monorepo skeleton, boundary checks and CI): spec review, round 4 (scoped to fix round 3)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: fix-only `f05e33b..6a48046` (6a48046)
- Result: **PASS** (no Critical or Important; 1 Minor)

Report (verbatim in substance):

(a) Fix items as ruled
- M1 (`eslint.config.mjs:16`): module regex `modules/(?!registry(\.[^/]*)?$)`, so `registry` is exempt only as the last segment; `..` after `modules/` or `privileged/` is never exempt. Tests ("registry exception") cover every listed bypass form plus `registry/..` and `modules/../modules/registry`; registry-allowed tests pass; new extension-allowed test.
- M3 (`package.json:8`): `lint` is `eslint -c eslint.config.mjs .`. The test copies the config to a temp dir with a nested config turning the rules off and runs ESLint with `v10_config_lookup_from_file`: without `-c` exit 0 (bypass is real); with the real lint script's args exit 1 with `no-restricted-syntax`. CLAUDE.md:39 does not state the command literally (no change). ci.yml:33 calls `pnpm lint` and inherits `-c`.
- Double report (`eslint.config.mjs:50-68`): `secondNameNode` skips the second node of shorthand `{K}`, `{K = d}`, `import {K}`, `export {K}`; tests assert exactly one report for the listed forms and extras; renamed forms reported once each; the comment is now true.
- Quality 1, 2, 3, 5, 6, 7, 8, 9 done as suggested (`toEqual`; `[code, ruleId]` table with redundant tests folded in; two-report comment; `alreadyReported` comment; registry block comment; "feeds" and alias sentence moved; temp dirs cleaned in `afterEach`; test renamed; full-line slug assertions via `LEAK_LINE`).
- Inline-config tests now expect the `noInlineConfig` note before the violation (made visible by the ruleIds helper change), consistent with Quality 1.
- No-change items untouched (M2, Quality 10 / `import.meta.env`, `**/dist/**` and JSX notes). Diff touches only eslint.config.mjs, package.json and the two test files.

(b) Deviations: `esqueryRegex` `\x2f` (needed for `[^/]`, tested) accepted; double-report fix also for `import {KEY}`/`export {KEY}` accepted; test rename exactly per Quality 8, assertion unchanged, accepted; M3 test is the first allowed option, accepted.

(c) Deliverables hold: script names unchanged except `-c` on `lint`; `findTenantSlugLiterals` signature and behaviour unchanged; roots and exclusions untouched; plan selector not in the diff; Step 1 assertions unchanged in meaning; CI jobs untouched.

Commands: `git diff f05e33b..6a48046`; `pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test` all exit 0, Vitest 111/111 (93 + 18); `grep -n lint CLAUDE.md .github/workflows/*.yml`; `git status --porcelain` only the controller's pre-existing docs/execution changes.

Minor: the renamed Step 1 test title ("reports nothing for a clean core fixture") differs from the plan's wording; meaning unchanged. No plan/spec contradictions.
