PASS

I found no Critical or Major findings. There are two Minors, and neither fails an item.

Scope: `feb827c` (shown on its own: the range `10dbbb5~1..7caffe3` starts after `feb827c`, so it leaves that commit out) and `git diff 10dbbb5~1..7caffe3` excluding docs.

What I ran:
- `pnpm db:reset && pnpm db:test`: 13 files, 1252 tests, PASS.
- `pnpm test:integration`: 6 files, 67 tests, passed.
- `pnpm test`: 25 files, 342 tests, passed.
- `pnpm lint`: clean.
- Catalog queries and probes inside rolled-back transactions, run with `docker exec supabase_db_litljomi-cms psql`.
- I finished with `pnpm db:reset`, exit 0.

**`git status --porcelain` after the review:** it shows ` M docs/execution/deferred-minors.md` and `?? docs/execution/reviews/c1-cleanup-r1-spec-quality.md`. I did not create either of them. Both are under the controller's `docs/execution/` area, and the second looks like the parallel spec/quality review's output, so they were probably written by the controller or that review while mine was running. Please confirm. My commands only ran tests, queried the database and reset it.

1. pass: the catalog query for functions in `cms`, `private` and `api` where `prosecdef` is true or `search_path=""` is missing returned 0 rows. The only function body changed is `api.request_publish`; it still uses fully qualified `cms.tenants` and `t.status` (`supabase/migrations/20261102000800_api_editor.sql:275`).

2. pass: no exposure changes. The only `tools/checks/__tests__/supabase-config.test.ts` change is a comment (+3 lines). The A1 integration tests pass.

3. pass: the `audit_log` grants now match §4.5's "INSERT only, through the audit triggers" more tightly than before.
   - Live catalog, table level: `authenticated` has SELECT only; `service_role` has nothing; `anon` has nothing.
   - Column level: `authenticated` and `service_role` have INSERT on `tenant_id, actor_id, action, target_type, target_id, at, details`, not on `id`. No UPDATE, DELETE or REFERENCES for either.
   - All 12 trigger inserts name exactly `(tenant_id, actor_id, action, target_type, target_id, details)` (`20261102000700_audit.sql:88-237`), and every one of those columns is granted.
   - Probes:
     - `insert ... overriding system value` as `service_role` fails with "permission denied for table audit_log". As `authenticated` it fails with the same error.
     - A plain `service_role` insert succeeds (`INSERT 0 1`, rolled back).
   - The pgTAP suites cover the legitimate writers: 070 (editor, worker as `service_role`, owner and system events) and 060/090 (worker status changes as `service_role`). All passed.
   - Nothing reads back a generated `id` with RETURNING, so the missing SELECT for `service_role` breaks nothing; it had none before either.
   - `EXECUTE` on `request_publish` is `{postgres=X, authenticated=X}`: no PUBLIC and no anon.

4. pass: no RLS or policy changes in the migrations. The new assertions in 060 tests (platform admin at aal2, `service_role` reads) compare the exact set of rows (`set_eq`) instead of counting them, which is stronger. The 080 test adds a restrictive policy temporarily and drops it inside the test transaction.

5. not applicable: no table or foreign-key changes. The `refs.sql` and `assets_storage.sql` edits are comments only; I checked them line by line.

6. pass: `request_publish` still takes the tenant from the entry. The check now fails closed: `not exists (... t.id = v_tenant_id and t.status = 'active')`, so a tenant row the caller cannot see counts as inactive. 080's new test makes the tenant active and hides it with a restrictive policy, so it would fail if the check went back to the old `exists ... <> 'active'` form. A new null-expected-version test returns `version_conflict`.

7. pass: no worker or admin changes. 010 still asserts 14 such functions, `service_role` only (comment added). 100 still asserts 23 functions (comment added). Both passed.

8. not applicable: the commit function is unchanged. 090 gains a comment only.

9. not applicable.

10. pass: no secret-key references in the diff. The integration helpers only gained error handling, and their error messages carry an HTTP status and a user id, not keys.

11. not applicable.

12. not applicable.

13. pass: no contradictions with the spec. Decision 32 ruling 5 is met in both copies: `packages/schema/src/fields/link.ts:21-29` and `packages/rich-text/src/doc-schema.ts:46-55` require `u.username === '' && u.password === ''`, and the editor's `isAllowedUri` uses that rule (`packages/rich-text/src/tiptap.ts:57`). Bypass probes with Node's WHATWG URL, using the same predicate:
    - Refused: `labak.is%40evil.com` (does not parse); `https:\\u@evil.com`; `https:/u@evil.com`; `https:u@evil.com`; `https:////u@evil.com`; `u@@evil.com`; `u:@evil.com`; a tab before `@`; `%00@`; `a%3Ab@`; the IDN user `labаk.is@x`; `[::1]@x`; `javascript:`; `JaVa\tscript:`.
    - Accepted, but stored without credentials, because the canonical `new URL(s).href` is what gets stored: `https://@evil.com` becomes `https://evil.com/`, and `https://labak.is\@evil.com` becomes `https://labak.is/@evil.com` (host `labak.is`). `@` in the path, query or fragment is harmless.
    - `mailto:u:p@x.is` is accepted. A mailto URL has no user or password parts, so this matches the ruling.

    The 64-character cap on `FIELD_KEY` (`packages/schema/src/define-type.ts:35`) is stricter than or equal to the database's `^[A-Za-z0-9_-]{1,64}$`, so no conflict.

14. pass: `git diff --stat 10dbbb5~2..7caffe3 -- .claude` is empty.

**Test-only changes weaken no security assertion.**
- 040 adds a 1 MB temp-file limit next to the 5-second one, plus a `work_mem` precondition.
- 050, 060 and 080 replace row counts with exact row sets, or add cases.
- 070 adds the OVERRIDING SYSTEM VALUE refusals for both roles and exact per-column grant sets.
- In the integration tests: the A2 cross-tenant asset test now requires SQLSTATE 23503 and an unchanged draft version; the A4 overwrite test now checks the stored bytes; cleanup and Mailpit failures now throw.
- The entry-point boundary test now fails closed on computed `import()` and `require()` calls, and has a self-test that proves it can fail.
- The harness changes are tests plus a comment and a quote-style change in `state.mjs`.

**Further findings:**
- [Minor] `packages/rich-text/src/safe-url.ts:15-23`: `isHttpsUrl` checks URLs that come from resolvers and contexts, not from editors, so ruling 5 ("the shared link validator") does not cover it. It still accepts `https://user:pass@host`. As defence in depth it could refuse credentials too. Nothing is exposed today and the change did not touch it.
- [Minor] `supabase/migrations/20261102000700_audit.sql:286-288`: `service_role` keeps INSERT on `tenant_id`, `action`, `target_type` and `details`, so it can write arbitrary audit rows directly, including platform events with a null tenant; `actor_id` and `at` are still forced by `audit_force_actor`. This is unchanged from before the cleanup (it had table-level INSERT) and is needed because the triggers run as the invoker. §4.5 grants `service_role` what the worker and CLI need, so I note it rather than count it as a failure.
