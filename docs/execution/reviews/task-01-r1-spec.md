# Task 1 (Monorepo skeleton, boundary checks and CI): spec review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: `git diff 6dc46af..f95d874` (f95d874)
- Result: **PASS**

Report (verbatim):

PASS

Task 1 does what its text says, read with the Global constraints and R1-R10. No Critical or Important findings.

Findings:
- Minor - /Users/einarzoega/litljomi-cms/pnpm-workspace.yaml:6-7: R9 says to stop and report if a build script needs approval. The file contains pnpm's generated placeholder `allowBuilds: esbuild: set this to true or false`, so esbuild's build script is neither approved nor denied. `pnpm install --frozen-lockfile` still completes and prints the approve-builds notice. The implementer reported it. The controller should decide whether to set it explicitly to false or ask Einar.
- Minor - /Users/einarzoega/litljomi-cms/tsconfig.json:1-6: this file is not in the task's file list. `pnpm typecheck` needs it to cover tools/checks/** (R7), and it excludes the fixtures. Accepted.
- Minor - /Users/einarzoega/litljomi-cms/eslint.config.mjs: only the boundary rules are configured, with no recommended set. The task asks only for the boundaries, so this is accepted.
- Minor - /Users/einarzoega/litljomi-cms/.gitignore:6: `.pnpm-store/` is gitignored and also in the ESLint ignores. This is harmless housekeeping.
- Minor - /Users/einarzoega/litljomi-cms/.github/workflows/ci.yml:105-106: the database job calls `pnpm db:test` and `pnpm test:integration`, which don't exist yet. R8 requires this and no db:* scripts were added, so it matches the ruling. The workflow has the four required jobs, triggers on push and pull_request, uses Node 22, and installs with --frozen-lockfile.
- Minor - The commit trailer reads "Claude Opus 5.5", while the current attribution reminder says "Claude Sonnet 5.5". The task text doesn't specify a trailer, so I'm only flagging it for the controller.

Verified:
- **Files:** every listed file is present. CLAUDE.md changes are limited to the Commands section, and nothing under .claude/**, docs/** or tools/harness/** was touched. The only extras are tsconfig.json and pnpm-lock.yaml.
- **Scripts:** lint, typecheck, test, check:slugs and harness:test have the required names, and harness:test has the exact command. No db:* scripts were added.
- **findTenantSlugLiterals:** it has the exact signature and return shape. Roots are apps/cms/src and packages. It skips the registry, `__tests__` directories and *.test.* files. It uses the TypeScript compiler API on string and no-substitution template literals. Slugs come from the folder names under modules/. The CLI prints file:line:slug and exits 1 on any hit.
- **Tests:** the Step 1 tests are present. Extra ESLint tests cover the R4 spellings (computed member, destructuring), relative privileged/ and modules/ imports, tools/cli, and modules/** importing from apps.
- **ESLint:** the plan's selector is used verbatim, plus the R4 variants. Rule scoping matches R4 and R5.
- **R1-R3, R9:** versions are eslint ^9, typescript ~6.0.3, vitest ^3.2.7, and packageManager is pnpm@11.1.3. .nvmrc is 22 and strict is on.
- **Commit:** the subject is exactly as specified.

Commands run in /Users/einarzoega/litljomi-cms:
- `git status --porcelain`
- `git show --stat` on HEAD
- `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs`, `pnpm test`: all exit 0
- `pnpm install --frozen-lockfile --offline`: completes, with the build-script notice

`git status --porcelain` at the end shows only docs/execution/progress.md and docs/execution/state.json modified. They were already modified before the review, and I did not change them.

I found no contradictions between the plan and docs/architecture.md.

## Controller notes

- Trailer finding: not a defect. The controller's attribution instruction for this session is "Co-Authored-By: Claude Opus 5.5"; the reviewer saw its own (Sonnet) reminder.
- esbuild `allowBuilds` placeholder: carried to the quality review and fix loop (ruling R11 in Task 1 notes).
