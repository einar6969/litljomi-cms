# Task 5: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent
- Change: 5ec57b4; separate section on the controller follow-up 153eda0
- The reviewer's report, verbatim:

---

FAIL

Security review, Task 5 (tenancy tables and RLS), round 1. Commit 5ec57b4, with a separate section on 153eda0.

The implementation is sound. Isolation held in every probe I ran, the grants match exactly, and nothing uses a definer function. The review fails on one Major finding: the tests do not check one security requirement, so it could be removed without any test failing.

Evidence I gathered myself:
- Catalog queries as `postgres` (read-only).
- Adversarial probes and a mutation probe, each in a transaction I rolled back. The pgtap extension was created inside that transaction, as `supabase test db` does.
- `pnpm db:test`: 5 files, 183 tests, Result: PASS.
- After the probes, the database has no `tests` schema, `cms.tenants` has 0 rows and the console policy is unchanged.

1. pass: `pg_proc` for api/cms/private shows two functions, `private.passwordless_access_token` and `private.tenants_lock_slug`. Both have `prosecdef = f` and `proconfig = {search_path=""}`. The trigger function body uses no unqualified names (`supabase/migrations/20261102000200_tenancy.sql:40-49`). The policies call only qualified `auth.uid()` / `auth.jwt()`.

2. pass: `supabase/config.toml:14` has `schemas = ["api"]`. Schema ACLs: `cms` has U for authenticated and service_role; `private` has U only for `supabase_auth_admin`. `api` holds no functions yet.

3. pass: table ACLs as configured:
   - `tenants`: `authenticated=r`, `service_role=arw`
   - `memberships` and `platform_admins`: `authenticated=r`, `service_role=ard`
   - no `anon` entry and no PUBLIC entry; `pg_attribute.attacl` is empty for `cms`, so there are no column grants.
   This matches Task 5 and §4.5 ("SELECT (policies restrict to own rows)" and "SELECT (own tenants; console policies)"). `anon` gets "permission denied for schema cms". The trigger function's `proacl` is `{postgres=X/postgres}`, with no PUBLIC entry. The global default ACL `postgres / - / f = {postgres=X/postgres}` is in place. `cms.membership_role` has a NULL typacl, which means default PUBLIC USAGE on the type. That is harmless and standard.

4. fail (Major finding below; the RLS itself is correct): `relrowsecurity = t` on all three tables. FORCE is off, which §4.5 does not require; the owner `postgres` has BYPASSRLS anyway. Policies (`pg_policies`):
   - `memberships_select_own` and `platform_admins_select_own`: `user_id = (select auth.uid())`.
   - `tenants_select_member`: EXISTS over `cms.memberships`, read per request under the memberships own-row policy, so no recursion.
   - `tenants_select_console`: `aal = 'aal2'` AND EXISTS over `platform_admins`.
   All four are `TO authenticated`, SELECT only.
   Probes:
   - An editor forging `aal2` still sees only `labak`.
   - The platform admin with a missing `aal`, `"AAL2"` or `["aal2"]` sees 0 tenants.
   - With no `sub`, all three tables return 0 rows.
   - The platform admin at aal2 sees 2 tenants and 0 memberships, so no implicit membership or content access.
   - The revoked user sees nothing.
   - `SELECT … FOR UPDATE/FOR SHARE`, `LOCK TABLE`, `TRUNCATE` and `DELETE` as editor all get 42501.
   - [Major] `supabase/tests/database/020_tenancy.test.sql:60-66`: no test can fail if the console policy loses its `platform_admins` clause. Every non-admin persona runs at aal1, so a policy reduced to `aal = 'aal2'` passes all tests. Mutation probe: I changed the policy to `using ((select auth.jwt() ->> 'aal') = 'aal2')` in a rolled-back transaction and reran 020: 42 of 42 ok. As a sanity check, dropping the aal clause instead does fail (`not ok 31`).
     Why it matters: the hook accepts `totp` for any user, so an editor who enrols TOTP gets aal2. A regression would then show every tenant to that editor, and later console policies (`publish_requests`, `releases`, `sites`, `site_deliveries`, `audit_log`) will repeat this pattern. §4.5 requires platform_admins membership and aal2.
     Why Major and not Minor: I was unsure whether this counts as a "required" test, since §8.5's persona list does not name a non-admin at aal2. I chose the higher rating because one half of a stated security condition is untested.
     Fix: add a case where `editor_labak` (and/or `outsider`) acts at `'aal2'` and sees only `labak` (or nothing).

5. pass: `memberships.tenant_id` is NOT NULL (catalog test `col_not_null`). The only `cms` foreign key on `memberships` points at `tenants`, which is not a tenant table (§4.3), so no composite key is needed. `platform_admins` and `tenants` are not tenant tables.

6. not applicable: no `api` functions yet. The trigger takes no tenant input.

7. not applicable: no `worker_*` or `admin_*` functions yet.

8. not applicable.

9. not applicable.

10. pass: neither commit adds a secret. On the lint ignore, see the 153eda0 section.

11. not applicable.

12. not applicable.

13. pass: I found no contradiction between the change and the spec, and I report none.

14. pass: `git diff 5ec57b4~1 153eda0 --stat -- .claude` is empty.

Slug immutability, probed as `service_role`:
- `UPDATE`, `MERGE … UPDATE SET slug` and `INSERT … ON CONFLICT DO UPDATE SET slug` each raise P0001 `slug_locked`. `MERGE` as the owner also raises it.
- `ALTER TABLE … DISABLE TRIGGER` gives "must be owner"; `DROP TRIGGER` gives "must be owner"; `SET session_replication_role` gives permission denied.
- `DELETE` and `TRUNCATE` give 42501.
- Calling `private.tenants_lock_slug()` directly gives "permission denied for schema private".
- Changing the case of a slug is blocked by the check constraint, which allows lowercase only.

Further findings:
- [Minor] `supabase/migrations/20261102000200_tenancy.sql:51-55`: the trigger is column-specific (`BEFORE UPDATE OF slug`). PostgreSQL does not fire a column-specific trigger when another BEFORE UPDATE trigger changes `NEW.slug`, because only the SET list counts. No such trigger exists today, so there is no current exposure. A plain `BEFORE UPDATE … WHEN (old.slug IS DISTINCT FROM new.slug)` would close this for future migrations.
- [Minor] `supabase/migrations/20261102000200_tenancy.sql:96`: `service_role` has table-level UPDATE on `tenants`, so it can change `tenants.id` (the tenant prefix of storage paths). The probe was blocked only by the `memberships` foreign key (NO ACTION) and would succeed for a tenant with no rows that reference it. This matches the plan's grant, `cms` is not exposed, and §4.1 rule 7 covers only the slug. A defence-in-depth note, not a breach.

Separate section: commit 153eda0
- ESLint ignore `.worktrees/**` (`eslint.config.mjs:90`): no finding. In flat config the pattern is relative to the config file, so it matches only the root-level `.worktrees/` and cannot hide `apps/**`, `packages/**`, `modules/**` or `tools/**`. `.worktrees/` is gitignored (`.gitignore:11`, `git check-ignore` confirms) and `git ls-files` lists 0 files under it. So CI (`.github/workflows/ci.yml:33`, `pnpm lint`) never sees that directory, and merged Lane B code is linted at its real paths on the phase branch. The one residual point: Lane B code is checked inside its worktree by the worktree's own `eslint.config.mjs` (branch `m1/lane-b`). A weakening of that config would be visible in the Lane B diff and would take effect on merge, where reviews and CI apply. No finding.
- `state.mjs render` appending `docs/execution/progress-notes.md` (`tools/harness/state.mjs:20-21,156-162,236,393`): no finding. The path is a constant, and only `renderProgress` reads it. No gate, `done` check, checkpoint check or review check reads `progress.md`: per `git grep`, the only readers are the render tests. Gates come from `gates.json` and state from `state.json`. Text in notes cannot approve a gate (CLAUDE.md). No finding.

Files: `/Users/einarzoega/litljomi-cms/supabase/migrations/20261102000200_tenancy.sql`, `/Users/einarzoega/litljomi-cms/supabase/tests/database/020_tenancy.test.sql`, `/Users/einarzoega/litljomi-cms/supabase/tests/database/010_catalog.test.sql`, `/Users/einarzoega/litljomi-cms/supabase/tests/database/_helpers.sql`, `/Users/einarzoega/litljomi-cms/eslint.config.mjs`, `/Users/einarzoega/litljomi-cms/tools/harness/state.mjs`.

Note on `git status --porcelain`: I wrote nothing. It changed during the review because of the controller's concurrent work under `docs/execution/` (at the end: `M docs/execution/progress.md`, `M docs/execution/state.json`).

---

## Controller ruling

FAIL accepted, on the Major: no test fails if the console policy loses its `platform_admins` clause. A fresh Opus implementer adds aal2 cases for non-admin personas in `020_tenancy.test.sql`.

The migration's column-specific slug trigger (Minor 1) is fixed in the same round. It is the task's own unreleased migration, nothing hosted has applied it, and the fix is one trigger clause that will be re-reviewed. Minor 2 (service_role can update `tenants.id`) is deferred to C1. It matches the plan's grant; a change there would be a plan decision for Einar.

Commit 153eda0 has no finding.
