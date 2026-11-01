# Task 1 (Monorepo skeleton, boundary checks and CI): spec review, round 2

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: whole task `6dc46af..3c5438f` (f95d874, fix 3c5438f); fix-only `e2f395a..3c5438f`
- Result: **PASS** (no findings)

Report (verbatim):

PASS

Task 1 as a whole still does what the plan text says, read with R1–R10 and the fix rulings. The fix (3c5438f) stayed inside F1–F11. No Critical, Important or Minor findings.

Plan Step 1 tests
- The two findTenantSlugLiterals tests keep the same fixtures, slugs and assertions. ['labak','demo'] is now the constant SLUGS, with the same values.
- The five ESLint boundary tests are unchanged in meaning: same paths, code strings and expectations (toContain for the module, admin-client, secret and packages-import-apps cases; toEqual([]) for the allowed-in-privileged/ case).
- I read the diff only for the test rename SECRET -> RESTRICTED_SYNTAX (F3). It does not change what is asserted.
- The old test "returns nothing when ... the root does not exist" is replaced by a toThrow test. F1 requires that change.

Task text
- findTenantSlugLiterals(roots: string[], slugs: string[]) keeps the exact signature and still returns SlugHit[] ({file, line, slug}). It matches only string and no-substitution template literals equal to a slug.
- It throws "check:slugs root does not exist: <root>" for a missing root (F1).
- Exclusions are still the registry file, __tests__, and *.test.*. Symlinks are now skipped (F6/F7).
- runCheck(repoRoot) scans only the roots that exist and states scanned roots, absent roots and the slug count. It exits 1 and prints file:line:slug on a hit, and creates no placeholder directories and has no required-roots check (C-F1).
- The CLI takes an optional repo-root argument. The root scripts are unchanged: lint, typecheck, test, check:slugs, harness:test.
- The plan's secret selector is still the first generated selector, verbatim. The other spellings are covered per R4: computed env, computed key, and destructuring (including process['env']).
- apps/cms/src/privileged/** has the secret selectors off, but static and dynamic module-import rules still apply there. Tests prove it (F2).
- Dynamic import() and require() are covered for modules, privileged/ and apps/. The @/modules/ and ./modules/ aliases are also covered, and the registry exception is kept.
- CI has the four jobs on Node 22 with pnpm install --frozen-lockfile. The supabase/setup-cli version is pinned to 2.121.0 (F11). Actions stay on release tags, as C-F11 rules.
- pnpm-workspace.yaml sets allowBuilds: esbuild: false (F9). pnpm install --frozen-lockfile returned "Already up to date" with no build-script notice.
- docs/**, .claude/** and tools/harness/** are untouched by the fix commit. It changes 10 files, all inside Task 1's file list or its fixtures (the new repo-clean and repo-with-slug fixtures).

Commands run (all from /Users/einarzoega/litljomi-cms)
- git status --porcelain, git log --oneline -3, git diff --stat e2f395a..3c5438f, git diff f95d874 3c5438f --stat, git show 3c5438f --stat
- pnpm lint, pnpm typecheck, pnpm check:slugs, pnpm test, pnpm install --frozen-lockfile
- grep and cat on the test files, package.json and ci.yml

Results
- pnpm lint and pnpm typecheck exit 0.
- pnpm check:slugs exits 0. It prints "roots scanned: none", "roots absent: apps/cms/src, packages" and "0 tenant slug(s) checked (modules/ is absent)".
- pnpm test exits 0 with 55/55 tests passing (38 ESLint-boundary and 17 slug tests).
- pnpm install --frozen-lockfile exits 0.
- git status --porcelain at the end shows only the controller's two pre-existing modifications, docs/execution/progress.md and docs/execution/state.json. I changed nothing.

No plan or spec contradictions found. One observation, not a finding: pnpm test prints a Vitest deprecation notice for vitest.workspace.ts. This is expected, because R3 chose Vitest 3.2 specifically so that the plan's file works as written.
