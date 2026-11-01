# Task 1 (Monorepo skeleton, boundary checks and CI): quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-01
- Change: `git diff 6dc46af..f95d874` (f95d874)
- Result: **CHANGES REQUESTED** (2 Important, 9 Minor)
- Line numbers refer to the review package diff, not the files.

Report (verbatim, as returned):

1. [Important] tools/checks/no-tenant-slugs.ts (missing root skipped via `if (!existsSync(root)) continue`; missing `modules/` returns `[]`; zero slugs returns early) and the test codifying "missing root => []": the check passes silently when it checked nothing. If `apps/cms/src` or `packages` is renamed or mistyped in `main()`, or `modules/` is relocated, `check:slugs` goes green and enforces nothing. Suggested: throw for a missing root; fail `main()` if `modules/` is missing; keep zero slugs fine with the count message; test missing root with `toThrow`; decide how roots that do not exist yet are handled; add a CLI test (spawn against a fixture repo, assert exit 1 and `file:line:slug`), which needs a `repoRoot` parameter for `main()`.
2. [Important, security-relevant] eslint.config.mjs: verified with `eslint --stdin` as `apps/cms/src/editor/x.ts`, no error for `import('@litljomi/module-x')`, `require('@litljomi/module-x')`, `import x from '@/modules/labak/x'`. `no-restricted-imports` does not cover dynamic `import()` or `require`, and the modules regex only matches `../modules/`. Suggested: `ImportExpression` and `CallExpression[callee.name='require']` selectors in `no-restricted-syntax` (mind that the rule is `off` in privileged/ and tools/cli); extend the regex to `@/` and `./`; tests for each form.
3. [Minor] eslint-boundaries.test.ts: constant `SECRET = 'no-restricted-syntax'` holds a rule id; rename to `SYNTAX`/`RESTRICTED_SYNTAX`.
4. [Minor] eslint-boundaries.test.ts: only `toContain` is asserted. Missing: a negative test that `process.env.OTHER` is allowed; privileged/ cannot import modules; registry.ts cannot read the secret; `toEqual([IMPORT])` where one rule should fire; `import.meta.env` and `process['env'].SUPABASE_SECRET_KEY` (the second is security-relevant).
5. [Minor] eslint.config.mjs: `^@/privileged(/|$)` is subsumed by `(^|/)privileged(/|$)`; repeated message strings could be shared constants.
6. [Minor] no-tenant-slugs.ts: `statSync` follows symlinks (loop risk); use `readdirSync(dir, { withFileTypes: true })`, skip symlinks; extract an `isCoreSourceFile` helper.
7. [Minor] no-tenant-slugs.ts: inconsistent import ordering (trivial).
8. [Minor] no-tenant-slugs.test.ts: the "ignores" test bundles four skip rules in one assertion; split per rule.
9. [Minor] pnpm-workspace.yaml: `allowBuilds: esbuild: set this to true or false` is a placeholder; make it explicit.
10. [Minor] ci.yml: four jobs repeat the same setup steps (note only; structure is agreed).
11. [Minor, possibly security-relevant] ci.yml: `supabase/setup-cli@v1` with `version: latest` is unpinned; actions pinned to tags, not SHAs.

Reviewer's own note: `pnpm test` output was swamped by macOS "failed to copy trust settings" noise, so the reviewer relied on the controller's and spec reviewer's test runs; `check:slugs` exits 0 with "ok (0 tenant slug(s) checked)".
