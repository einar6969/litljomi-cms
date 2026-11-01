# Task 1 (Monorepo skeleton, boundary checks and CI): security review, round 2

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01
- Change: fix-only `4a821ca..d2ca911`; whole task `6dc46af..d2ca911`
- Result: **PASS**. Every round 1 finding ruled "fix" is ADDRESSED; no new Critical or Important; 3 Minor and 2 notes.
- Probes: ESLint Node API with the repo config, 86 secret cases and 70 import cases (`scratchpad/task1/secrev2/`); nested-config and symlink experiments in disposable `$TMPDIR` directories.

## Checklist (verbatim in substance)

1–9, 11, 12: not applicable (no SQL, functions, schemas, grants, tables, worker, release, live check or editor text).
10: pass. `SUPABASE_SECRET_KEY` only in `.env.example:4` (commented placeholder), `eslint.config.mjs` (the rule) and the boundary tests; `git grep -E 'sb_secret_|sb_publishable_|eyJ…|BEGIN … PRIVATE KEY|service_role_key'` finds nothing; CI uses no secrets. 60 of 86 secret cases caught outside privileged/ and tools/cli; every round 1 read form is caught except string concatenation (accepted): `import { env } from 'node:process'`, aliases of `process.env`, `globalThis.process.env`, `process.env!`, `as any`, template keys, `Reflect.get`, zod and `createEnv` schemas, `env.SUPABASE_SECRET_KEY` from `@/env`, TS types, interfaces, enums, `ProcessEnv` augmentation, root files. Allowed in privileged/ and tools/cli; look-alikes (`tools/clix`, `tools/cli-evil`, `privileged-not`, `editor/privileged`, `apps/demo-site/src/privileged`) still caught. `eslint .` exits 0.
13: pass. No spec contradiction; key allowed in tools/cli while privileged/ imports are forbidden there (S4) is consistent with §8.1 item 2.
14: pass. No `.claude` change; fix diff touches only eslint.config.mjs, tools/checks/no-tenant-slugs.ts and two test files; no permission, sandbox, CI or package-script change.

## Round 1 findings ruled "fix"

- S1 ADDRESSED: `eslint.config.mjs:79` global `noInlineConfig: true`; disable-next-line, block disable, rule off, rule reconfiguration, disable-line, and import-rule disables all still report.
- S2 ADDRESSED: name selectors (`:49-53`) in every block carrying `secretSyntax`; plan selector verbatim (`:39-41`); R4 selectors kept (`:43-45`); exemption (`:86-89`) only for the root `eslint.config.mjs` (nested `eslint.config.mjs` files still caught; root config still bound by the privileged import rules); boundary test file linted with no exemption.
- S3 ADDRESSED: `no-tenant-slugs.ts:98-102` realpath on both sides; file symlink, directory symlink, relative and direct paths exit 1 on repo-with-slug; `--preserve-symlinks-main` fails closed; importing as a module does not run the check; clean fixture and repo exit 0.
- S4 ADDRESSED: `eslint.config.mjs:115-118`; static, `import type`, `export *`, `import = require`, `import()`, `require()`, template `import()`, `@/privileged`, `.mjs` from tools/cli all caught; key read in tools/cli clean.
- S5 + S8 (#privileged) ADDRESSED as ruled: `~/modules/`, `#modules/`, bare `modules/` and `#privileged…` forms caught statically and dynamically; registry exception unchanged; `registry-evil` and `registry/../labak` caught.
- S7 ADDRESSED: ignore only `tools/checks/__tests__/fixtures/**`; other fixtures folders linted.

## Questions verified

- `:not(...)` clauses: a name is skipped only as a direct child of a `memberReads` match or a descendant of a `destructuredReads` Property, and those selectors always travel with the name selectors, so a skipped node always sits inside a reported node. Edge cases (computed identifier key, defaults, nested patterns, rest, renamed binding, template key) all report.
- `noInlineConfig` cannot be undone as lint runs today (ESLint 9.39.5, root `eslint .`, CI `pnpm lint`; no flags or env in package.json, .github, turbo.json; nested configs ignored by root `eslint .`). It could be undone by `ESLINT_FLAGS=v10_config_lookup_from_file` / `--flag unstable_config_lookup_from_file`, a new root `eslint.config.js` (the boundary tests would catch it), or running ESLint from a subdirectory (M3).

## New findings

- M1 (Minor) `eslint.config.mjs:16`: registry exception bypassable through path normalization (pre-existing lookahead `(?!registry(\.|$))`, extended to the new forms): `@/modules/registry.ts/../labak`, `@/modules/registry./../labak`, `#modules/registry.x/../labak`, `../../../../modules/registry.x/../labak/src`, `import('modules/registry.x/../labak')`, from packages/sdk `../../../modules/registry.x/../labak/src/index`. Suggested: require `registry` as the last segment, e.g. `(?!registry(\.[^/]*)?$)`, or forbid `/../` after `modules/`.
- M2 (Minor) `eslint.config.mjs:13` vs `:16`: privileged pattern matches a segment anywhere; module pattern only at a fixed prefix, so `#/modules/labak`, `#src/modules/labak`, `src/modules/labak`, `@modules/labak`, `~modules/labak` (and `@privileged/…`, `$privileged/…`) miss. Each needs a configured alias that a reviewer would see; same class as accepted S8.
- M3 (Minor) `package.json:8`: with ESLint 10 (file-location config lookup default) or the v9 flag, nested configs would silently override the root config. Suggested: `eslint -c eslint.config.mjs .`, or a CI check rejecting any `eslint.config.*` besides the root `.mjs`.
- Note: `apps/cms/src/dist/x.ts` is ignored by the pre-existing `**/dist/**` (also `.next`, `.turbo`); low risk.
- Note: name selectors miss JSX attribute names and JSX text (neither reads the key; a string attribute value is caught).
- Quality, not security: shorthand destructuring not matched by `destructuredReads` (`const { env: { SUPABASE_SECRET_KEY } } = process`, `function f({ SUPABASE_SECRET_KEY } = process.env)`, `… = process.env as Record<…>`) reports twice at the same column; the comment at `eslint.config.mjs:47` ("each read is reported once") does not hold there.

Working tree: nothing modified by the reviewer; HEAD d2ca911; no permission denials or sandbox refusals.
