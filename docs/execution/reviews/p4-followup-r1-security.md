# Phase 4 follow-up (decision 39.3), security review, round 1 (cms-security-reviewer)

Diff `288bbe2..df055f4` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. No Critical or Major findings, three Minors. No changes; stack not stopped, started or reset; every probe rolled back (labak still active, no probe asset, no `pgtap`/`tests` left).

pgTAP file not run in full by the reviewer: inside its own rolled-back transaction tests 1–3 passed, then `tests.seed()` stopped on `duplicate key … users_pkey (b001)` (e2e users already in the stack); behaviour checked by hand instead. *Controller note: `101_asset_tenant_active.test.sql` ran in full in the controller's `pnpm db:reset && pnpm db:test` on a freshly reset stack before this review: 19 files, 1405 tests, PASS.*

1. pass: both functions invoker, `search_path = ''`, schema-qualified (`migration:391-447`); `prosecdef = f`, `proconfig = {search_path=""}`; 0 definer functions.
2. pass: `schemas = ["api"]` unchanged; no views or schemas added.
3. pass: `proacl` `{postgres=X/postgres,authenticated=X/postgres}`, owner postgres, kept by `create or replace`; anon "permission denied for schema api"; no grant change.
4. pass: `cms.assets` and `cms.tenants` policies unchanged; by hand with labak suspended (rolled back): outsider, non-member platform admin at aal2, revoked member and a demo editor on a labak asset all `not_found`; a labak member `tenant_inactive` on both, nothing written; active again: update OK; fail-closed for a hidden tenant row in the test file (543-552).
5. n/a.
6. pass: `update_asset` derives the tenant from the visible asset row (431-433); `register_asset` authorises `p_tenant_id` by membership first (401-406), the insert policy and the exact path re-check; a labak member passing demo's id gets `not_found`; bodies otherwise match Task 10 (on an inactive tenant `update_asset` now raises `tenant_inactive` before its later `not_found`, intended).
7–9. n/a.
10. pass: nothing under `privileged/**` or `tools/cli`; no secret in the diff; e2e logs print only date-key findings.
11. pass: `status.ts:343-345` site-less delivered release → "Enginn vefur tengdur", tone `error`, final, never `ok`; "Birt á vef ✓" and "Tekið af vef" need `sites > 0` and all live; before delivery "Í birtingu…" (89); omitted publish "Birting á vef mistókst" (92); removed guards safe.
12. pass: `is.ts:124` `noSite` promises nothing about caches.
13. pass: implements decision 39.3.
14. pass: no `.claude/**` change.

Error mapping: `asset-actions.ts` unchanged; `tenant_inactive` → `authOrError` → `code: 'error'` (tests 162-164, 243-245); no database message reaches the client.
e2e outside the sandbox: `editing.spec.ts:73` `page.setContent` loads no resources; other tests on `http://localhost:3100` served by `next start -H 127.0.0.1`; loopback and repository only.

Minors:
- `migration:407-415`, `437-442`: the tenant status is checked without locking the `cms.tenants` row; a suspension committed between check and write lets one in-flight asset write through (member in own tenant, milliseconds, publishes nothing); defence in depth only.
- (pre-existing) `storage.objects` policy `media_private_insert_member` checks membership, not tenant status, so a member of a suspended tenant can still upload an object that `register_asset` then refuses (orphan private object).
- `101_asset_tenant_active.test.sql` not run by the reviewer (see the controller note above).
