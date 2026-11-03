# Decision 46 (A1–A4 staging boundary check), security review round 1

Reviewer: `cms-security-reviewer`, 2026-11-03. Commit `13fcd44` on `m1/lane-a-next` (base `76abd1a`). Merged into `m1/phase-1` as `8f0cdd7`.

**Result: PASS** (no Critical or Major; six Minors). Offline: `pnpm --filter @litljomi/cli test` 4 files 157 tests (provision 81 unchanged); `eslint tools/cli/src` exit 0.

Checklist: 1–5, 8, 9, 11, 12 not applicable (no migration, grant, RLS or table change); 6 pass (tenant ids checked against their slug via `worker_previous_release.bundle_path` before any change; `api.my_tenants` must show the own tenant only); 7 pass (A3 needs 200 for the secret key and exactly `42501` for anon and both editors; only the read-only `worker_previous_release` is tested); 10 pass (env read as text with the `env_value` rules; keys and tokens in headers only and registered for redaction before use; response bodies never printed; origin pinned and `redirect: 'error'`); 13 pass, with a possible contradiction noted for the controller: spec §4.4 says editors are invited by the provisioning CLI, while decision 46 creates two pre-confirmed test editors without an invitation (read as an approved staging fixture); 14 pass (nothing under `.claude/`).

Blast radius within decision 46: no invite, publish, unpublish or deletion; no secret-key storage write; `current.json` never touched; re-runs reuse users, memberships, the titled entries and the objects.

Minors:
1. `boundary-check.ts:513-517`: the delete check passes on any response; require 200 with an empty JSON array (the download afterwards is the only proof today).
2. `boundary-check.ts:486-487, 336`: "refused" is any non-2xx, so 429/5xx would count; require 4xx (storage: the RLS answer).
3. `boundary-check.ts:524`: an open `delivery` boundary would write a probe under `<slug>/releases/`; use `<slug>/boundary-check/<uuid>.json`.
4. `boundary-check.ts:280-283`: each run leaves a live session per test editor (never printed); log out at the end or document it.
5. `docs/runbooks/staging.md` section 14 leftovers list incomplete (audit rows, sessions, a stray untitled entry or object from a failing run); line 979 "No other editor"; P-3's `auth.users` count becomes 3.
6. `boundary-check.ts:14-16`: comment omits the secret key's use in the A1 refusal checks.
