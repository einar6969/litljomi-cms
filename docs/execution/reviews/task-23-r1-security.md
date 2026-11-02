# Task 23, security review, round 1 (cms-security-reviewer; added by the controller, decision 37.6)

Diff `6c368c2..31c6b0f` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS

No Critical or Major findings, one Minor. The diff touches only `apps/cms/**` (18 files; no migrations, no `supabase/**`, no `.claude/**`). `git status --porcelain` empty after.

1. pass: no SQL added; `api.create_entry`, `save_draft`, `set_slug` are `prosecdef = f`, `proconfig = {search_path=""}`, schema-qualified bodies.
2. pass: `createEditorClient`/`createBrowserEditorClient` use `db: { schema: 'api' }` with the publishable key; `entry_list`, `entry_detail`, `my_tenants` `security_invoker=true`.
3. pass: the three functions' ACL `{postgres=X, authenticated=X}`; views `authenticated=r` only.
4. pass: `cms.drafts`/`cms.entries` policies check `cms.memberships` against `auth.uid()` per request; no platform-admin clause.
5. n/a.
6. pass: `createEntryAction` (`actions.ts:462-476`) takes the tenant only from `resolveTenant` (`api.my_tenants`, slug regex and length), requires `active`, `getType(tenant.slug, type)` by strict equality, passes the type's own `name` and `version`; `saveDraftAction`/`setSlugAction` take no tenant; `loadEntryContext` (`entry-context.ts:810-820`) resolves tenant from the entry under RLS, requires active and the type in the module; the entry page filters by id, tenant and type; the database stays authoritative; every argument validated (UUIDs, version 1..2^31-1, slug regex ≤ 200, typeof and length checks), data through `draftValidator` (strips unknown keys), unit tests show no database call on bad input.
7–9. n/a.
10. pass: no key or `privileged/` import; boundary lint exits 0; `entry-context.ts` imports `server-only`; deep client imports `@litljomi/cms-schema/src/slugify.ts` and `src/fields/link.ts` pull only pure code (no `process.env`, `server-only` or secrets), avoiding the barrel's `node:crypto`; actions imported as `'use server'` references.
11. n/a. 12. n/a (no cache-removal text). 13. pass (refusing edits in a suspended tenant is stricter, not a conflict). 14. pass.

e2e outside the sandbox: pass (`editing.spec.ts` uses `./support/test`, which aborts non-loopback requests in the context, the second tab included; only relative paths or `http://localhost:3100`; reads only `e2e/.auth`; `playwright.config.ts` unchanged).

Error mapping: pass (`failureOf`, `entry-context.ts:783-790`, passes only `version_conflict`, `slug_taken`, `slug_locked`, `auth`; all else generic `error`; actions return codes, never messages; Zod issues carry paths and default messages).

Resource use: editor's own input under the 1 MB server-action body limit; Minor at most under the threat model; no finding.

- [Minor] `apps/cms/src/lib/tenant.ts:23` (Task 22, reached by `createEntryAction` at `actions.ts:465`): `resolveTenant` throws `my_tenants: ${error.code} ${error.message}`, uncaught in `createEntryAction`; in dev mode a raw PostgREST message could reach the browser (production shows a digest). Own query, not another tenant's data. Catch it or keep only the code.
