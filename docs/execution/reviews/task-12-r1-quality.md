PASS

I reviewed the diff and the full text of each new file. I ran only `git diff` and `git status --porcelain`, which came back empty, so nothing changed in the checkout. I did not run the tests or touch the database. I rely on the reported results: 1246 pgTAP PASS, 67 integration tests passed, lint and typecheck pass.

No Critical or Major findings. The tests mostly assert behaviour. Many positive controls precede the negative assertions, and `expectBlocked` proves the interleaving instead of assuming it from timing. The Minors are below. None of them touches security-relevant code.

**Connection cleanup**

[Minor] tests/integration/src/concurrency.test.ts:559-666, sql.ts:1367. Cleanup of `pgAs()` clients happens only in `afterAll(closeAll)`. If `expectBlocked` or an assertion throws mid-test, `w` or `w1` keeps its transaction and locks open until the end of the file. Later tests in the file can then wait on those locks for up to the 120 s `testTimeout`. The last test takes the tenant row lock in `worker_begin_release`, so a failure in tests 1 to 4 could cascade into it. When `closeAll` finally ends the connections, the un-awaited `pending` query promise also rejects with no handler. That can surface as an unhandled rejection that hides the real failure.
- Suggested change: add an `afterEach` that rolls back and ends the open `pgAs` clients, for example a non-pool-closing `closeClients()` split out of `closeAll`.
- Suggested change: attach `pending.catch(() => {})` before `expectBlocked`.
- I rated this Minor because it only matters on a failure path.

[Minor] impersonation-parity.test.ts:1186. `viaSql` ends with `rollback` but never closes the client. It stays in the `open` set, so 12 connections pile up until `afterAll`. The module-private `close()` in sql.ts does rollback plus `end`. Use `withTx`, or export `close`.

[Minor] sql.ts:1322-1327. If `connect()` throws, the client is not ended. If `pg_backend_pid` or `begin` throws, the client stays in `open` and is only cleaned up by `closeAll`. Wrap the setup in try/catch and `close(client)` on failure.

[Minor] global-setup.ts:824-827. `closeAll()` is not in a `finally`. If `seedIntegration` throws, the pg pool stays open and can keep the process alive. Use `try { await seedIntegration() } finally { await closeAll() }`.

**Test quality**

[Minor] http-boundary.test.ts:978-988 ("a reference to another tenant's asset fails the write"). It asserts only `expect(error).not.toBeNull()` plus 0 refs. Any failure passes it, such as a bad argument or a validation error. Neighbouring tests assert exact codes. Assert the expected code or message, and assert the draft is still at version 1.

[Minor] http-boundary.test.ts:867-872 and 874-881. The first A1 test (`cms` tables) is subsumed by the `it.each` case for `cms`. Drop it or keep only the `it.each`.

[Minor] storage-boundary.test.ts:1436-1494. The A4 tests depend on the first test's upload of `labakPath`, and the `beforeAll` is `async` with nothing awaited. If the first test fails, the later ones fail confusingly. Upload in the `beforeAll` and assert there, and drop the `async`.

[Minor] auth-passwordless.test.ts:334-348. The exact upstream status codes (422, 404 and so on) in the "no token" table couple the tests to the GoTrue version. The `access_token` undefined check is the behaviour. This is acceptable because the version is pinned, but a comment saying so would help.

[Minor] auth-passwordless.test.ts:315-325. The `signup-${Date.now()}` user is deleted only on the happy path, so a failing run leaks it. A rerun is not affected because the email is unique. Push its id into `created` (export a helper) so `afterAll` handles it.

[Minor] http-boundary.test.ts:1051-1079. The test pins a known defect as the expected outcome (Auth 500 on user deletion). It is documented, and the comment says to update it when the triggers are fixed. Leave it. A failure midway leaks a user with a labak membership, which is harmless to other tests.

**Duplication and readability**

[Minor] auth-api.ts:88-95 and clients.ts:454-461. `retry429` and `retryRateLimited` are two copies of the same retry loop. `sleep` is defined in clients.ts and re-exported from auth-api.ts (lines 55 and 58). Move `sleep` into a small shared module, and either share the retry loop or comment why there are two.

[Minor] impersonation-parity.test.ts:1191-1195, 1181. The comment says `to_jsonb(r)` of a scalar function gives `{"<function name>": value}`. For a base-type return, `r` is the scalar itself, so `to_jsonb` gives the bare value. `unwrap` only works because `Object.values('<uuid string>')` has length 36 rather than 1, and a one-character string would be unwrapped wrongly. The `c.rpc !== 'worker_sites'` special case is hard-coded. Add a `setof: true` flag on the `Case`, and either remove `unwrap` or correct its comment.

[Minor] auth-api.ts:60, 78, 83. `Record<string, any>` is used without a comment saying why (untyped Auth JSON). Prefer `unknown` or add a one-line reason.

[Minor] auth-api.ts:125-127. `deleteThrowawayUsers` ignores the response status, so a failed delete is silent. Throw or log on a non-200 or non-404 response.

[Minor] auth-api.ts:140-142 and 144-147. The `fetch` calls to Mailpit do not check `res.ok`. A Mailpit error gives a confusing "no mail for X" or a JSON parse error after 10 s.

[Minor] env.ts:691-696. `stdio: ['ignore','pipe','ignore']` discards the CLI's stderr. When the stack is down, the failure is a bare "Command failed" and your helpful message is lost. Catch the error and rethrow with "is the local stack running (pnpm db:start)?".

[Minor] fixtures.test.ts:1-4. The header says the test "needs no database". `fixtures.ts` imports no env, but `globalSetup` seeds for the whole run, so in practice it does need the stack. Reword the comment.

[Minor] seed.ts:1268-1277. If a first run died between adding the revoked member and deleting the membership, the audit has an "added" row but no "removed" row. A rerun then calls `admin_add_membership` again. This works only if that function is idempotent. A comment or a guard on the existing membership would document it.

**Flakiness**

- `expectBlocked`: polling `wait_event_type = 'Lock'` every 20 ms with a 2 s timeout is sound. An idle-in-transaction backend shows `Client`, so a false positive is unlikely. Under a slow CI machine 2 s could be tight. Consider 5 s, since a false failure there is cheap.
- Auth rate limits: `retry429` and `retryRateLimited` retry for up to about 200 s, which is longer than the 120 s `testTimeout`, so the test timeout wins. Session caching and `fileParallelism: false` are sound. `sleep(31_000)` and `sleep(1100)` are deliberate and commented.
- Mailpit: 40 polls of 250 ms is fine. The messages are filtered by address and `clearMail` runs before each wait, so there is no cross-test mixing while files run sequentially.
- Reruns on a seeded database: the seed is idempotent. Leftover requests and releases are handled by `worker_claim_requests(1000)` and the cleanup of building releases. The `auth.mfa_amr_claims where authentication_method = 'password'` check is global, so it also fails if anything else ever signs in with a password. That is the intended invariant.

Relevant files, all under /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/tests/integration/src/: `sql.ts`, `concurrency.test.ts`, `impersonation-parity.test.ts`, `http-boundary.test.ts`, `storage-boundary.test.ts`, `auth-api.ts`, `auth-passwordless.test.ts`, `clients.ts`, `env.ts`, `seed.ts`, `global-setup.ts`, `fixtures.test.ts`.
