# Task 32, round 1: code-quality review (cms-quality-reviewer, Sonnet)

Scope: lane-b `ba8defc..753f88b`. Read the diff and files by hand; no builds, tests or stack access. `status.test.ts` and `confirm/page.test.tsx` not read in full.

PASS

No Critical or Major findings. Code well commented and consistent; tests check behaviour. The confirm action's tests cover the type and hash allowlists, files in place of fields, Auth errors, a thrown error, no session, and no token in the logs; the e2e specs cover cross-device sign-in, the scanner case and single use; the status-badge tests check classes, not just tone names.

## Minors
1. [Minor] `apps/cms/src/app/auth/confirm/__tests__/actions.test.ts`: the first `it.each` and "logs nothing about a successful sign-in" use `.rejects.toThrow('REDIRECT /')`, a substring match that also passes on `REDIRECT /login?error=link`; the last test is the weaker (the no-session failure path logs nothing). Other tests catch most of it (exact `/^REDIRECT \/$/` in the `next` cases; `verifyOtp` asserted called). Rated Minor; higher arguable. Fix: `/^REDIRECT \/$/` in both.
2. [Minor] `apps/cms/e2e/support/sign-in.ts:46-54` (`settledLanding`): `toPass()` has no explicit timeout; `SETTLE_MS` (500 ms) is both the heading-visibility timeout and the fixed sleep; a later redirect than the window would be missed. Give `toPass` a `{ timeout }`, two named constants, and say in the doc comment which redirect the 500 ms covers (the picker's one-tenant redirect).
3. [Minor] `apps/cms/src/app/auth/confirm/actions.ts` (`verified`): `data.session !== null && data.session !== undefined` → `data.session != null` or `Boolean(data.session)`.
4. [Minor] Token-hash regex written three times (actions.ts, `auth-confirm.test.ts`, the actions test's `HASH` fixtures); the integration copy is intentional; add a comment in actions.ts that the integration test guards that assumption.
5. [Minor] `apps/cms/e2e/design.spec.ts` header comment (~lines 5-6): one very long line; re-wrap.
6. [Minor] `apps/cms/e2e/support/test.ts`: `guardLoopback` mutates and returns the context; optional note that `route` covers only interceptable requests (header already says so).
7. [Minor] `apps/cms/e2e/support/mailpit.ts`: `waitForNewMessage` re-runs the search every 250 ms; acceptable at test scale.

Commands (read-only): `git diff ba8defc..753f88b` (stat and full), cat of the reviewed files, grep of globals.css for the warning token.
