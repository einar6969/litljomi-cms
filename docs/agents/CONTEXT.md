# Context for agents working in the Hub

Read this instead of exploring. `CLAUDE.md` is already in your context; this adds where things are and how a task ends. Don't read `docs/architecture.md` whole: open the sections your task names.

## Where things are

| Area | Path |
|---|---|
| Editor pages | `apps/cms/src/app/(editor)/t/[tenant]/` |
| Editor components, form fields | `apps/cms/src/editor/`, `apps/cms/src/editor/form/fields/` |
| Editor strings (Icelandic, one file) | `apps/cms/src/i18n/is.ts` |
| Worker and everything holding the secret key | `apps/cms/src/privileged/` |
| Field kinds, types, modules, snapshot, type generation | `packages/schema/src/` |
| SDK for client sites | `packages/sdk/src/` |
| Rich-text format and renderer | `packages/rich-text/src/` |
| Tenant modules | `modules/<tenant>/src/index.ts`; registry `apps/cms/src/modules/registry.ts` |
| CLI (`provision`, `gen-types`, …) | `tools/cli/src/` |
| Migrations, database tests | `supabase/migrations/`, `supabase/tests/database/` |
| Integration tests, local seeds | `tests/integration/` |
| Browser tests | `apps/cms/e2e/` |
| Reference site integration | `apps/demo-site/` |

**The spec by section** (`docs/architecture.md`): §3 modules and the manifest · §4.1 governing rules · §4.3 tables · §4.5 grants · §4.6 `api` functions · §5.2 field kinds · §5.3 schema evolution · §5.4 rich text · §5.6 media · §6 publishing · §7.2 bundle · §7.3 site integration · §7.4 what proves "live" · §10.2 exclusions · §11.3 hard to reverse.

**Plans:** `docs/plans/media-library.md` (library slices L1–L12). **Current work and rulings:** `docs/clients/dld/STATUS.md`, `docs/clients/dld/ENHANCEMENTS.md`.

## Rules that are easy to miss

- **Generic.** No tenant or client name in `apps/cms/src` or `packages/` (`pnpm check:slugs`). Client-specific things live in `modules/<tenant>` and in the client's own site.
- **Production has no backups.** Migrations are additive and forward-only: no dropped object, no changed signature, new checks only on new nullable columns.
- **The local stacks are shared.** There are two slots: slot 1 (`CMS_STACK_SLOT` unset) and slot 2 (`CMS_STACK_SLOT=2` on every `pnpm db:*`, `pnpm test:integration`, `pnpm test:delivery`, seed and browser command, run from your own worktree; `pnpm db:slot` prints its ports). Use a slot only if your brief says you hold it, and never stop, reset or reconfigure the other. Without one you may run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:slugs`, `pnpm check:schema`. Not `pnpm db:*`, `pnpm test:integration`, `pnpm test:delivery` or the browser suite. Write the browser spec anyway and say it was not run.
- **Never** read `.env*`, touch the hosted project, run anything `--linked`, deploy, or merge.
- **Editor-facing strings** go in `is.ts` in Icelandic and are listed in your report as DRAFT. Einar approves them in one batch.
- **Versions.** A PR that changes a shipped file of `packages/sdk` or `packages/rich-text` raises that package's version (`docs/runbooks/operations.md` §2, step 11).
- After editing a `package.json` version, run `pnpm install` before any script.

## How a task ends

1. Work on the branch your brief names, in your own worktree. Tests first where there is logic.
2. Run the checks your brief allows. Leave full suites to CI.
3. Commit; push the branch; open a PR against `main`. The PR body says what changed, what was not run, and ends with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Commit messages end with the `Co-Authored-By` line your harness gives you.
4. Report: PR URL and full head sha, files changed, commands with pass and fail counts, choices the brief left open, new strings, what remains to run on the stack.

Reviewers: review the diff against `main`, judge it against the brief and the spec, not against its own tests. Findings as `file:line`, each Critical, Major or Minor; Minors don't block. On PASS post exactly `Review: PASS <full head sha>` as a PR comment.
