# Task 1 (Monorepo skeleton, boundary checks and CI): security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-01. Task 1 is not on the plan's security-sensitive list; the controller ran this review because quality fix 3c5438f changed the secret-key and import boundary rules (checklist item 10).
- Change: `6dc46af..3c5438f` (f95d874, 3c5438f)
- Result: **PASS** (no checklist item fails), with 2 Important and 9 Minor findings. Per the per-task loop, the findings go to a fresh implementer (fix round 2), then spec, security and quality reviews run again.

## Checklist (verbatim summary)

1–9, 11, 12: not applicable (no SQL, grants, tables, functions, worker, release, live check or editor text in this diff).
10: pass. `SUPABASE_SECRET_KEY` appears only in `.env.example:4` (commented placeholder, no value), `eslint.config.mjs` (the rule) and the boundary tests. No secret value committed (`git grep` for `sb_secret_`, `sb_publishable_`, JWT-shaped `eyJ…`, private-key headers: nothing). `.gitignore` keeps `.env*` and re-allows only `.env.example`. CI uses no secrets. 90 bypass cases linted through the ESLint Node API with the repo config: caught outside privileged/ and tools/cli: `process.env.KEY`, `process['env'].KEY`, `process.env['KEY']`, `process['env']['KEY']`, `process.env?.KEY`, `process.env.KEY!`, destructuring including `{ ['KEY']: k }`, `import process from 'node:process'`; every code extension; look-alike paths. Admin-client imports caught: `@/privileged/…`, relative, `~/privileged`, `src/privileged`, `@litljomi/cms/privileged/…`, `../Privileged/`, `import type`, `export *`, `export {…} from`, `export * as`, `import x = require()`, side-effect imports, `import()`/`require()` with literal or template prefix.
13: pass. No contradiction with the spec in this diff. Forward plan conflict noted for Task 17.
14: pass. No `.claude/**` change; nothing widened. `allowBuilds: esbuild: false`; `ignoredBuilds: []`, `pendingBuilds: []`; no root lifecycle script, no `.npmrc`, no `dangerouslyAllowAllBuilds`. CI: top-level `permissions: contents: read`, triggers `push`/`pull_request` only, actions on tags (C-F11), `supabase/setup-cli` `version: 2.121.0`.

## Findings (verbatim in substance)

Important
- S1 `eslint.config.mjs` (no `linterOptions`): inline directives silence every boundary rule (`// eslint-disable-next-line no-restricted-syntax`, `/* eslint-disable */`, `/* eslint no-restricted-syntax: off */`); same for the import rules. Implementer agents fix lint failures, so this is the most realistic bypass. Hardening: `linterOptions: { noInlineConfig: true }`, or at least a CI check rejecting such comments.
- S2 `eslint.config.mjs:36-47`: secret selectors match only the `process.env…` shape. Missed outside privileged/: `import { env } from 'node:process'; env.KEY`; `const { env } = process; env.KEY`; `const e = process.env; e.KEY`; `globalThis.process.env.KEY`; `process.env!.KEY`; `(process.env as any).KEY`; ``process.env[`KEY`]``; `const { env: { KEY } } = process`; `({ KEY: k } = process.env)`; parameter default `({ KEY } = process.env)`; `const { KEY } = process.env as Record<…>`; `Reflect.get(process.env, 'KEY')`; and the common central env schema `z.object({ SUPABASE_SECRET_KEY: z.string() }).parse(process.env)` in `apps/cms/src/env.ts`, then `env.SUPABASE_SECRET_KEY` anywhere (the real risk). Hardening: outside privileged/ and tools/cli, forbid any occurrence of the name via `Identifier[name='SUPABASE_SECRET_KEY']`, `Literal[value='SUPABASE_SECRET_KEY']`, `TemplateElement[value.cooked='SUPABASE_SECRET_KEY']` (eslint.config.mjs needs its own exemption). Accepted limits of lint: string concatenation, whole-environment leaks, a different variable name, and calling `createClient(url, key)` from `@supabase/supabase-js` directly outside privileged/ (forbidding that import outside privileged/ with a narrow publishable-client exception is for Task 17 to decide).

Minor
- S3 `tools/checks/no-tenant-slugs.ts:95`: the entry guard compares `resolve(process.argv[1])` with the real path; run via a symlinked path the script prints nothing and exits 0 even on a slug hit (reproduced). `pnpm check:slugs` and CI unaffected. Fix: `realpathSync` on both sides.
- S4 `eslint.config.mjs:97`: the `tools/cli/**` override switches off the static privileged-path import rule and all `no-restricted-syntax`, so tools/cli may import `apps/cms/src/privileged/admin-client`; wider than R4.
- S5 `eslint.config.mjs:15`: module path regex matches only `@/`, `./`, `../`; misses `~/modules/labak` and bare `modules/labak`.
- S6 Not enforced, not on the spec's CI list: packages importing apps by workspace package name (`@litljomi/cms…`); one module importing another (ruled out by the §3.1 table).
- S7 `eslint.config.mjs:65`: global ignore `**/__tests__/fixtures/**` also applies under apps/cms/src; narrow to `tools/checks/__tests__/fixtures/**`.
- S8 Not linted (accepted limits): `typeof import(...)`, `import(variable)`, template-built paths, `createRequire`, `module.require`, `#privileged/…` subpath imports (cheap to add to the regex).
- S9 `no-tenant-slugs.ts:9`: `TEST_FILE` skips `.test.{js,jsx,ts,tsx,mts,cts,…}`, wider than the plan's `**/*.test.ts`.
- S10 `turbo.json:5`: if lint later runs per package through turbo with nearer configs, the root boundary rules would silently stop applying; keep a root `eslint .` run in CI.
- S11 Forward note for Task 17: plan line 1136 has `src/app/api/internal/worker/route.ts` and `src/app/api/cron/sweep/route.ts` importing `src/privileged/worker/pipeline.ts`, which the current rule forbids. Task 17 must relax it narrowly (those route files, the pipeline entry only, never admin-client), with a security review.
- S12 CI actions on mutable tags: accepted under C-F11; SHA pinning is a G2 item.

Working tree: reviewer modified nothing in the repository; probe scripts only in the scratchpad (`scratchpad/task1/secrev/`) and `$TMPDIR`. No permission denials or sandbox refusals.
