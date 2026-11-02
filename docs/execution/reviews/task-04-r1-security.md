# Task 4: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent (no implementer summary, no other reviews)
- Change: c6ad33f (base ae76b78)
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major issues in Task 4 (commit c6ad33f, base ae76b78). There are two Minors.

Checklist:

1. pass: there is no SECURITY DEFINER function, and the hook's search_path is ''.
   - Catalog query over api, cms and private: one function only, `private.passwordless_access_token(jsonb)`. It has prosecdef=f, proconfig={"search_path=\"\""}, provolatile=s and owner postgres.
   - No function owned by postgres in any schema is SECURITY DEFINER (`select ... where p.prosecdef and p.proowner='postgres'::regrole` returns 0 rows).
   - Every function call in the body is `pg_catalog.`-qualified (`supabase/migrations/20261102000110_passwordless_auth_hook.sql:21-49`). Operators and types resolve through the implicit pg_catalog.

2. pass: `cms` and `private` are not exposed.
   - `supabase/config.toml:14` sets `schemas = ["api"]`. The running PostgREST has `PGRST_DB_SCHEMAS=api`.
   - HTTP checks against 127.0.0.1:54321 with both the anon and the service-role key, `Accept-Profile` set to `cms`, `private`, `public`, `graphql_public`, `auth`, `storage` or `extensions`: every one returns `PGRST106 "Only the following schemas are exposed: api"`. `api` returns the OpenAPI root.
   - An RPC to `passwordless_access_token` with `Content-Profile: private` returns PGRST106. `/graphql/v1` returns PGRST106 too, and pg_graphql is not in pg_extension.
   - `api` holds no functions or views yet.

3. pass: the grants are exactly what the spec and decision 18 say.
   - Schema ACLs:
     - `api` and `cms`: `{postgres=UC, authenticated=U, service_role=U}`
     - `private`: `{postgres=UC, supabase_auth_admin=U}`
     - No PUBLIC entry on any of the three.
   - `has_schema_privilege`: anon has no USAGE or CREATE on api, cms or private. authenticated and service_role have USAGE on api and cms, and nothing on private.
   - Hook ACL (aclexplode): exactly postgres EXECUTE and supabase_auth_admin EXECUTE, neither grantable.
   - supabase_auth_admin has USAGE on private and no other USAGE or CREATE on the three schemas. It is a member of no other role.
   - The global default revoke is in place: pg_default_acl has `postgres | <global> | f | {postgres=X/postgres}`.
   - The revoke is effective. In a rolled-back transaction I created functions in api, cms and private, a procedure in api, and a function in a brand-new schema. Every one got proacl `{postgres=X/postgres}`, and anon, authenticated, service_role and supabase_auth_admin had no EXECUTE. Tables, views and sequences created in cms or api got a NULL ACL.
   - No table grants exist yet, as Task 4 intends.
   - Revoking the hook from service_role (beyond §4.5's PUBLIC, anon and authenticated) matches decision 18's "supabase_auth_admin only".

4. not applicable: there are no `cms` tables yet.

5. not applicable: there are no tenant tables yet.

6. not applicable: there are no `api` functions yet.

7. not applicable: there are no `worker_*` or `admin_*` functions yet.

8. not applicable: there is no commit path yet.

9. not applicable: there are no releases yet.

10. pass: no secrets in the commit.
    - `git show c6ad33f | grep -Ei 'eyJ|sb_secret|sb_publishable|service_role_key|secret *='` finds nothing (exit 1).
    - The secret-like lines in `config.toml` are earlier `env(...)` references or comments.
    - I used the local keys only on the command line and did not print them.

11. not applicable.

12. not applicable.

13. pass: I found no contradiction with the spec.
    - The hook's allowlist, its amr rule, its 403 body, its grants and its config URI match §4.4, the "Auth hook grant" in §4.5, and decision 18.
    - Proving execution as supabase_auth_admin by static grants plus HTTP follows decision 22.

14. pass: the commit changes no `.claude/**` file (`git show --name-only c6ad33f | grep -c '^\.claude'` returns 0).

**Hook break attempts.** I ran 51 adversarial events in a transaction I rolled back. Each result is "refused" (the exact 403 body) or "issued" (`{"claims": <input>}`).

- **Event shape:** a SQL NULL event, JSON null, an array or a string are all refused.
- **Method, refused:**
  - a number, array, object or boolean
  - case variants (`Otp`, `MAGICLINK`, `Token_Refresh`)
  - leading or trailing spaces, and a Cyrillic look-alike
  - `mfa/totp`, `email/signup`, `pkce`, `id_token`
- **Refresh with bad claims:** absent, null, an array or a string are all refused.
- **amr, refused:**
  - `[null]` and `[otp,null]`
  - method null, a number, an array or an object
  - nested arrays, `[otp,[]]`, `[otp,"password"]`, `[otp,{}]`
  - `[OTP]`, `[token_refresh]`
  - a `Method` key instead of `method`
  - amr given as a number or as `true`
  - `[otp]` with a duplicate key where `password` comes last (jsonb keeps the last value)
  - for totp: `[password,totp]`, `[mfa/totp]`, `[email/signup]`
- **Issued, matching the spec's rule:** `[otp,otp]`, `[totp]` alone, and amr elements carrying extra keys.
- **Claims unchanged:** an allowed method with extra claims (`role: service_role`, `aal2`, nested nulls) returns them byte-equal (`(result)->'claims' = ev->'claims'` is `t`).
- **Other notes:**
  - A duplicate `authentication_method` key keeps the last value. That is not reachable, because GoTrue serialises the event itself.
  - An absent claims object yields `{"claims": null}`. The N1 evidence (`docs/verification/n1-passwordless-investigation.md:23`) shows that Auth answers that with 500, so it fails closed.
  - The NULL fall-through of the investigation's hook is fixed (`hook:36-45`).

**Execution as supabase_auth_admin.** I read the GoTrue container logs without changing anything. At 03:09Z (before the commit and the reset), the run_hook entries for `pg-functions://postgres/private/passwordless_access_token` show:
- `/verify` (magic link): "Hook ran successfully"
- `grant_type=refresh_token`: "Hook ran successfully"
- `grant_type=password`: "Hook errored out", error "403: Only email sign-in is allowed"

The running auth container has `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true` with that URI, and `GOTRUE_DISABLE_SIGNUP=true`. auth.users currently holds 0 rows. I created no users.

`pnpm db:test` output: 4 files, 132 tests, "All tests successful", PASS.

Further findings:

- `/Users/einarzoega/litljomi-cms/supabase/tests/database/010_catalog.test.sql:23-24` (**Minor**): nothing tests that the global default revoke itself exists.
  - "anon executes nothing in api" passes trivially while `api` is empty.
  - Removing the `alter default privileges ... revoke execute on functions from public` line would leave the suite green until a later task adds functions.
  - Suggested assertion: pg_default_acl has a row for postgres with defaclnamespace = 0 and objtype 'f' whose ACL has no PUBLIC entry.
  - This is Minor, not Major, because Task 4 Step 1 lists the exact tests and does not require this one, and I checked the revoke directly (item 3).
- `/Users/einarzoega/litljomi-cms/supabase/tests/database/010_catalog.test.sql:15-20` (**Minor**): the "no security definer" and search_path checks cover only api, cms and private, while §4.2 says v1 contains no SECURITY DEFINER at all.
  - Supabase's pre-existing default ACLs still grant EXECUTE and ALL to anon, authenticated and service_role for objects postgres creates in `public` and `storage` (pg_default_acl rows `postgres|public|f` and `postgres|storage|f`).
  - So a later migration that put a function in either schema would get anon EXECUTE regardless of the global PUBLIC revoke.
  - Nothing does this today: there are 0 postgres-owned definer functions, and `public` and `storage` are not exposed through PostgREST.
  - Suggestion for a later task, e.g. Task 8 (storage): widen the definer and search_path checks to every function owned by postgres.

Working tree: I made no changes. `git status --porcelain` shows the controller's `M docs/execution/progress.md` and `M docs/execution/state.json`, which were there at the start, plus `?? docs/execution/reviews/task-04-r1-spec.md`, which appeared during my run. That file is the spec review's record, not mine. I did not run `db:reset`, connect as supabase_auth_admin or supabase_admin, or use anything hosted.

---

## Controller ruling

PASS accepted. The controller confirmed the default ACLs (`postgres|-|f|{postgres=X/postgres}`, and Supabase's per-schema rows for `public` and `storage`). Both Minors are deferred in `docs/execution/deferred-minors.md`. Minor 1, an assertion that the global default revoke exists, goes to Task 5, which extends `010_catalog.test.sql`. Minor 2, widening the definer and `search_path` checks to every postgres-owned function, goes to Task 8, as the reviewer suggests. Both are listed at checkpoint C1. The untracked spec report the reviewer saw was the controller's own record.
