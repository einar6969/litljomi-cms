# Task 4: spec-compliance review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Change: c6ad33f
- The reviewer's report, verbatim:

---

PASS

No Critical or Major findings. Task 4 as amended by decision 22 is met. Both carried-over Minors are cleared.

Findings (all Minor, no action needed):
- supabase/tests/database/012_auth_hook.test.sql:1-154: Step 4b lists every case, and the file has them. Allowed methods return exactly {"claims": ...}. The refused methods are password, oauth, sso/saml, anonymous, email/signup, oauth_provider/authorization_code, web3, mfa/recovery_code, mfa/webauthn, mfa/phone, passkey, an unknown method and a missing method. The extras (JSON-null method, empty string, "OTP") are within the spirit of the task. The amr cases run for both token_refresh and totp, with all the allowed, refused and mixed shapes listed. The definition checks (plpgsql, stable, not security definer, search_path "", owner postgres) and the aclexplode grantee check (exactly postgres and supabase_auth_admin) are present. So are the execute check for supabase_auth_admin and its usage on private with no other privilege in api, cms or private. Per decision 22, execution as supabase_auth_admin is covered by the HTTP spot check, not a role switch.
- supabase/migrations/20261102000100_schemas_and_privileges.sql:21: the task does not list `revoke all on schema api, cms, private from public;`. It is consistent with "no privileges for anon", and I do not count it as scope creep.
- Commit trailer says "Claude Opus 5.5". The task fixes only the subject line, which matches. I did not judge the trailer against the attribution reminder.

Requirement checks:
- **Single commit (decision 16):** c6ad33f is the only commit. In it, `[api] schemas = ["api"]` in config.toml is set together with the migration that creates api, cms and private.
- **Commit message:** the subject is exactly `feat(db): schemas, default privileges, catalog tests`.
- **Files:** the 7 changed files are the 6 the task lists plus 001_helpers.test.sql, which the carried-over Minor requires. Nothing is missing and nothing extra.
- **Schemas migration:**
  - creates the three schemas;
  - issues `alter default privileges for role postgres revoke execute on functions from public` with no `in schema`;
  - grants usage on api and cms to authenticated and service_role, with no table grants;
  - grants anon and private nothing;
  - runs `drop extension if exists pg_graphql`.
- **Hook migration:** `private.passwordless_access_token(event jsonb) returns jsonb` matches decision 18. It is plpgsql, stable, security invoker, `search_path = ''`, and reads no tables. The allowlist is as specified. For token_refresh and totp, amr must be a non-empty array of objects with every method allowed, else it returns the exact 403 error. Execute is revoked from public, anon, authenticated and service_role, and usage on private plus execute go to supabase_auth_admin only.
- **config.toml:** `[auth.hook.custom_access_token]` is enabled with uri `pg-functions://postgres/private/passwordless_access_token`. There is no `[remotes.*]` block.
- **010_catalog.test.sql:** the 10 assertions are identical to Step 1, and plan(10) matches.
- **012 plan count:** plan(81) matches the assertion count: 23 method cases, 42 amr cases and 16 other assertions.
- **Minor (1):** the `seed()` denial in 001_helpers.test.sql now expects `permission denied for function seed`.
- **Minor (2):** supabase-config.test.ts has the `setting(path)` helper, which throws "supabase/config.toml: missing <path>". It also has a message on the array check, a `NEVER_EXPOSED` constant, and one `it.each` test per setting. It asserts the hook enabled and its URI, `schemas` equal to `["api"]`, and no `remotes`. That is 12 tests, matching the reported 12.
- **Step 4a:** I re-ran the read-only requests against the local stack (publishable key used on the command line only). Accept-Profile api returned 200. cms, private, public and graphql_public returned 406 PGRST106 ("Only the following schemas are exposed: api"). This matches the controller's report. I did not re-check 4b (it writes to the stack) and relied on the controller's reported results.

Commands run (all read-only):
- `git show c6ad33f` (stat and diffs)
- `sed` and `cat` on the plan, the migrations, the tests and the config test
- `supabase status -o env`
- `curl` GETs to http://127.0.0.1:54321/rest/v1/ with various Accept-Profile headers
- `git status --porcelain`: only docs/execution/progress.md and state.json, modified before my review

I did not run the pgTAP or vitest suites myself and relied on the controller's output. I wrote nothing.

---

## Controller ruling

PASS accepted. The three Minors call for no change, so none is deferred. The `state.json`/`progress.md` modifications the reviewer saw were the controller's own `state.mjs commit 4 c6ad33f`. The co-author trailer follows the session's attribution instruction.
