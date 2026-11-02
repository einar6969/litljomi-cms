# Task 27 follow-up (CMS `seed:labak-site`, a06b9a1..3695e23): security review (cms-security-reviewer, Opus)

PASS

One commit, 4 files: `package.json` (+1 script), `tests/integration/scripts/seed-labak-site.ts` (new), `tests/integration/src/fixtures.ts` (+`LABAK_LOCAL_SITE`), `tools/checks/__tests__/seed-labak-site.test.ts` (new). Script not run; stack untouched; nothing written; `git status --porcelain` empty.

- Loopback only: the script uses only `secretClient()` (`clients.ts:14`) and `ownerQuery()`/`closeAll()` (`sql.ts`), both through `env.ts`, which reads `supabase status -o json` and throws `refusing a non-local stack` unless apiUrl, dbUrl and mailUrl are 127.0.0.1/localhost (`env.ts:46-49`), at import time. No URL in the script (asserted, `seed-labak-site.test.ts:21-27`); site URLs loopback (`fixtures.ts:44-45`).
- Secret key out of output: logs only the base URL (lines 15, 25); failures log `error.code error.message` and the caught error's message (24, 28); the webhook secret is an RPC parameter, never logged.
- Existing seeds and suites unchanged: seed.ts untouched (and asserted not to reference `LABAK_LOCAL_SITE`, test line 31); fixtures appended only; nothing imports the script; the design e2e ("labak has no site", `design.spec.ts:178-204`) holds after `pnpm db:reset`; idempotent (lines 13-14).
- Nothing else new: no migration, grant, policy, app code or `.claude/**`.

Checklist: 1–6 n/a; 7 pass (`admin_create_site` only with service_role; `20261102001000_api_admin.sql:46`); 8–9 n/a; 10 pass (secret key from `supabase status` at runtime under tests/integration, decisions 36.6/37.5, local tests only); 11–13 n/a; 14 pass.

- [Minor] `fixtures.ts:46`: `webhookSecret: 'labak-local-secret'` committed local test value (like DEMO_SITE's `s3cr3t`); note in the hosted provisioning step that LABAK's hosted secret is freshly generated.
- [Minor] `seed-labak-site.test.ts:14-18`: textual slice to end of file; fails closed; defence in depth only (env.ts is the real guarantee).
