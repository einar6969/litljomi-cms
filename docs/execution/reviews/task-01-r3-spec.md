# Task 1 (Monorepo skeleton, boundary checks and CI): spec review, round 3

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: whole task `6dc46af..d2ca911` (f95d874, 3c5438f, d2ca911); fix-only `4a821ca..d2ca911`
- Result: **PASS** (no Critical or Important findings)

Report (verbatim in substance):

Commands: `git status --porcelain` (only the controller's docs/execution/progress.md and state.json, pre-existing); `git diff --stat 4a821ca..d2ca911` (exactly eslint.config.mjs, tools/checks/__tests__/eslint-boundaries.test.ts, tools/checks/__tests__/no-tenant-slugs.test.ts, tools/checks/no-tenant-slugs.ts); `pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm test` all exit 0, Vitest 85/85 (67 boundary, 18 slug).

Round 2 fix items against the rulings:
- C-S1: `eslint.config.mjs:104` sets `linterOptions: { noInlineConfig: true }` globally. Tests cover `eslint-disable-next-line no-restricted-syntax`, `/* eslint-disable */`, `/* eslint no-restricted-syntax: off */` above a secret read, and `eslint-disable-next-line no-restricted-imports` above a forbidden import; all still report.
- C-S2: the plan's selector is still the first form in `memberReads`, verbatim; R4 selectors unchanged. `Identifier`, `Literal`, `TemplateElement` name selectors added; the TS property-signature key is covered by `Identifier` (tested with `type E = { … }`). `eslint.config.mjs` has its own exemption (lines 110-114); the privileged-path rules still apply to it. The boundary test file needs no exemption (inputs built so the bare name never appears as an exact literal); a test shows only `eslint.config.mjs` is exempt among root files. Every listed test input is present, including `process.env.OTHER` clean and the name allowed in privileged/ and tools/cli. C-S2b not implemented, as ruled.
- S3: `no-tenant-slugs.ts:343-347` compares `realpathSync` on both sides in `isEntryPoint()`; a test runs the CLI via a symlink under `os.tmpdir()`, expects exit 1 on repo-with-slug, cleans up.
- S4: tools/cli/** has the privileged static, `import()` and `require()` rules; only the secret-name selectors are off. Tests: static, dynamic, require are errors; reading the secret in tools/cli is clean.
- S5 and S8 (part): module regex matches `~/modules/`, `#modules/`, bare `modules/`; privileged regex matches `#privileged/`; registry exception unchanged; a test per form, static and dynamic, plus the registry allowed through each form.
- S7: ignore narrowed to `tools/checks/__tests__/fixtures/**`; tests that other `__tests__/fixtures` folders are linted and the tools/checks fixtures still ignored; `pnpm lint` passes.
- No-change items (S6, S8 rest, S9–S12): untouched; the `.test.*` exclusion unchanged.

`:not(...)` clauses: skip the name selectors inside an already-matched `process.env` read or destructuring pattern so each access reports once (test "reports each access once"). Within the rulings; adds and removes no coverage. Security not judged.

Whole task: deliverables unchanged by the fix (signature, roots and exclusions, script names, CI, Step 1 tests). No files or scripts added; nothing under .claude/**, docs/** or tools/harness/** touched (R10).

Minor, not blocking: `eslint.config.mjs:112-113` file-scoped override is beyond the literal C-S2 text, but C-S2 asks for it; in scope.

No plan/spec contradictions.
