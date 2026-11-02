PASS

Security review, Task 12, round 1. Worktree: `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next`. Diff: f8bca05..5b336e0, docs excluded.

I found no Critical or Major issues. Gates A1, A2, A3, A4, A5 and A14 are really proven by the tests, against the local stack.

**What I ran** (local stack, from the worktree)
- `pnpm db:reset && pnpm db:test`: Files=13, Tests=1246, PASS.
- `pnpm test:integration`: 6 files, 67 tests passed. That is auth-passwordless 6, http-boundary 31, concurrency 5, storage-boundary 8, impersonation-parity 13, fixtures 4.
- `pnpm lint`: clean. `pnpm check:slugs`: clean.
- At the end I ran `pnpm db:reset` again.
- The worktree's `git status --porcelain` is empty.
- The main checkout shows `docs/execution/{deferred-minors.md,progress.md,state.json}` modified and `reviews/task-12-r1-spec.md` untracked. Those are controller and spec-review files; I wrote nothing there. My scratch probe file is deleted.

**Probes I made myself**
- **Every `worker_*`/`admin_*` function is tested.** A catalog query over `pg_proc` in `api` lists 11 `worker_*` and 3 `admin_*` functions. All 14 are executable by `service_role` only (authenticated f, anon f). All 14 are in the A3 `it.each` list, which checks anon and all five personas.
- **Storage refusals come from RLS.** An editor upload to `media-public`, to `delivery`, to `media-private/<demo tenant>/…` and to `media-private/labak/…` each returned 403 "new row violates row-level security policy". It is not a MIME or bucket error: migration `20261102000500_assets_storage.sql:114-115` gives `media-public` and `delivery` `allowed_mime_types = null`.
- **GraphQL is closed.** `POST /graphql/v1` returns 406 PGRST106 "Invalid schema: graphql_public".

1. pass: The diff has no migrations and no new functions. The test suite still runs the existing catalog tests (pgTAP 1246/1246).
2. pass: A1 is proven over HTTP.
   - `http-boundary.test.ts:697-704`: `cms`, `private` and `public` each give PGRST106 for tables and rpc, for anon, an editor and the secret key.
   - `:706-719`: raw `Accept-Profile`/`Content-Profile: cms` gives 406 PGRST106.
   - `:727-736`: GraphQL is not ok for an editor or anon (my probe: 406 PGRST106).
3. pass: The tests check grants as observed behaviour.
   - Anon gets 42501 "permission denied for schema api" on functions and views (`:813-817`, plus 2 A14 cases).
   - `service_role` is refused editor functions (`:858-861`).
   - All worker and admin functions are refused to authenticated (`:827-848`).
   - The catalog query above matches §4.5.
4. pass: RLS is exercised through PostgREST.
   - `entry_list` shows own-tenant rows only, and `my_tenants` shows demo only for editor_demo (`:778-784`).
   - editor_demo, outsider and revoked get `not_found`, and the draft version is unchanged (`:786-799`).
   - platform_admin at aal1 sees no tenants (A14 case).
   - [Minor] No A14 case runs at `aal2`. `auth.jwt()->>'aal'` is the only claim any policy reads (`tenancy.sql:101`, `publishing.sql:163-193`, `audit.sql:267`). Only its deny side (aal1) is cross-checked between REST and SQL; the aal2 allow side is not.
5. not applicable: There is no schema change. The cross-tenant asset reference is still refused over REST, with no refs written (`:801-811`).
6. pass:
   - `create_entry` with another tenant's `p_tenant_id` gives `not_found` over both REST and SQL (A14).
   - `register_asset` with a path that does not match the asset gives `forbidden` (A14).
7. pass: See item 3. The secret key reaches `worker_claim_requests`, `worker_previous_release` and `worker_sites`, and `worker_sites` returns the demo site (`:820-856`).
8. pass: `concurrency.test.ts`, all five tests real.
   - Each uses two `pgAs` connections with an open transaction. `expectBlocked` (`sql.ts:1202-1217`) polls `pg_stat_activity.wait_event_type = 'Lock'` for that connection's backend pid and throws after 2 s. So a missing lock would fail the test, not pass it.
   - save_draft waits on the in-flight commit. The revision holds the validated data with `draft_version` 3, and the draft becomes 4.
   - Unpublishing B waits for the commit of A that references B.
   - Unpublishing B first makes the commit of A end `failed_validation`, with `invalid_reference`/`unpublished` at `$."link"`.
   - A save after `worker_read_request` makes the request `superseded`, with no revision written.
   - Two `worker_begin_release` calls give one building release and one null, with the second call shown waiting.
9. not applicable: Release content is not in this task. Test 3 above checks that the database's published state decides the commit's outcome.
10. pass, with one Minor:
    - No key is committed: `git grep` for `sb_secret_|sb_publishable_|eyJhbGciOi|SUPABASE_SECRET` in `tests` and `supabase/tests` at 5b336e0 finds nothing. The keys are read at runtime from `supabase status -o json` with stderr ignored (`env.ts:514-531`).
    - `env.ts:532-535` refuses any API, DB or mail URL whose hostname is not exactly `127.0.0.1` or `localhost`, which fails closed. `supabase status` reports only the local containers. Every HTTP and pg call goes through `env.*`. Emailed `/verify` links are fetched with `redirect: 'manual'`, and the OAuth and SSO redirects are not followed.
    - `DEMO_SITE.webhookSecret = 's3cr3t'` is the plan's own fixture value (plan line 954).
    - The ESLint secret-key rule passes; the tests never read `SUPABASE_SECRET_KEY`.
    - Using the local demo secret key in test code does not contradict §3.1/§8.1. Spec §11.1 A3 needs an HTTP test with the secret key, and the key is the local stack's, not the project's.
    - [Minor] Plan Task 29 step 5 re-runs `http-boundary.test.ts` and `storage-boundary.test.ts` against staging. `env.ts` (correctly, for now) refuses that, so Task 29 must change it deliberately under its gate. Spec §11.1/§10 also say A1–A4 run "against staging". Proving them locally in Task 12 is the plan's sequencing, and Task 29 is the re-run. This is not a contradiction, but those gates should be marked "local" until Task 29.
11. not applicable.
12. not applicable.
13. pass: I found no contradiction with the spec. The staging point is noted under item 10.
14. pass: The diff touches no `.claude/**` file (the 20 files are `tests/integration/**`, `012_auth_hook.test.sql`, root `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` and `pnpm-lock.yaml`).

**Focus points**
- **A14 parity is real.**
  - `pgAs` (`sql.ts:1144-1160`) connects as postgres, runs `begin`, then `set_config('role', …, true)` and `set_config('request.jwt.claims', …, true)`. That is the mechanism PostgREST uses.
  - Each case asserts `rest == expected` and then `sql == rest` (`impersonation-parity.test.ts:1036-1041`), so a difference on either side fails.
  - [Minor] The impersonated claims are only `{sub, role, aal}`, without amr, email, session_id, aud or the `request.headers`/`request.method` GUCs. This is equivalent today, because no policy or function reads anything but `sub`, `role` and `aal` (grep of `auth.jwt()`/`current_setting` in the migrations). It would diverge silently if one ever does.
- **Decisions 18, 19, 21 and 22 are reproduced over HTTP.**
  - Correct and admin-set passwords give 403 "Only email sign-in is allowed", and a wrong password gives 400.
  - No `mfa_amr_claims` row records `password`.
  - Sign-up, anonymous, phone, id_token, PKCE forgery, web3, SSO and OAuth give no token.
  - Email change needs both addresses, also over PKCE.
  - TOTP gives aal2, which survives refresh. A later magic link is aal1. `/reauthenticate` gives no token.
  - The 403 message can only come from the hook, and Auth calls it as `supabase_auth_admin`, so these tests are decision 22's proof.
  - The 012 change keeps the "amr JSON null" case: `'null'::jsonb` is not SQL NULL. It adds three malformed-amr cases and pins the null-claims result.
- **Implementer findings**
  - (a) Deleting an Auth user who still has a membership fails closed: HTTP 500, nothing deleted, nothing unaudited. This is security-neutral, and the test pins it. Whether to keep it is an operational decision for Einar, already open in `deferred-minors.md`. No security finding.
  - (b) `{"claims": null}` for an allowed method with no claims: I agree with keeping it. Auth answers 500 (fail closed) according to the N1 investigation, and Auth always sends claims. No finding.
- **Lockfile.**
  - The new packages are `@supabase/{supabase-js,auth-js,functions-js,postgrest-js,realtime-js,storage-js}@2.118.0`, `@supabase/phoenix@0.4.5`, `iceberg-js@0.8.1`, `tslib@2.8.1`, `pg@8.23.1`, `pg-pool@3.14.0`, `pg-protocol@1.16.1`, `pg-types@2.2.0`, `pg-connection-string@2.14.1`, `pg-int8`, `pg-cloudflare` (optional), `pgpass`, `split2`, the `postgres-*` packages, `xtend` and `@types/pg@8.23.1`.
  - Every entry has a sha512 integrity hash and the expected name.
  - None of the installed packages has a preinstall, install, postinstall or prepare script (checked in `node_modules/.pnpm`), and `allowBuilds` is unchanged.
  - I could not check the hashes against the registry (no network).

**Further findings**
- [Minor] `storage-boundary.test.ts:1273,1278,1301,1305,1335,1339`: the refusal assertions are `error not null` plus "object absent", not the RLS error itself. My probe confirmed every current refusal is RLS 403, and the positive controls use the same helper. A future refusal for another reason (MIME, bucket) would still pass. Asserting status 403 or the RLS message would pin the reason.
- [Minor] `storage-boundary.test.ts:1309-1317`: the upsert overwrite attempt uploads identical bytes, so it rests only on the error. An overwrite that succeeded silently would not show in the content.
