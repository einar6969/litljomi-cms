# Task 27 follow-up (CMS `seed:labak-site`, a06b9a1..3695e23): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

PASS

Commands: `git diff a06b9a1..3695e23` in lane-a-next; grep/cat over `tests/integration/src/seed.ts`, `scripts/seed-local.ts`, `src/env.ts`, `src/clients.ts`, `src/sql.ts`. Lint, typecheck, tests and the script not re-run. Tree untouched.

Spec met: `pnpm seed:labak-site` exists (labak tenant, http://localhost:3200, `/api/cms/revalidate`, `labak-local-secret`); fails with "run `pnpm seed:local` first" without the tenant; idempotent by tenant_id + base_url (as `seed.ts:56`); `api.admin_create_site` with seed.ts's parameters via the secret client; `env.ts` throws "refusing a non-local stack" for non-loopback hosts; seed.ts and suites unchanged; `LABAK_LOCAL_SITE` kept out of `seedIntegration`; nothing extra.

Quality: follows seed-local.ts (try/catch/finally, `process.exitCode = 1`, `closeAll()`); specific error messages (RPC name, code, message; `error.message`, not the raw object); duplication with seed.ts minimal (extracting a helper would touch the existing seed).

- [Minor] `tools/checks/__tests__/seed-labak-site.test.ts:23-27`: source-text test; `toContain('refusing a non-local stack')` is the weakest part (would not catch a weakened check keeping the string). Acceptable without a live stack.
- [Minor] `seed-labak-site.test.ts:15`: slice to end of file; bound it at the closing `} as const`.
- [Minor] `seed-labak-site.ts:17`: the RPC is not wrapped in `retryRateLimited` (fine for one hand-run call).

None touch security-relevant code.
