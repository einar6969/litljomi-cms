# Task 32, round 1: security review (cms-security-reviewer, Opus)

Scope: lane-b `ba8defc..753f88b`. No `.claude/**` changes, no SQL migrations. Nothing written; `git status --porcelain` empty. The CMS was not running on :3100, so the confirm page's response headers were not measured.

PASS

No Critical or Major findings; three Minors.

1. n/a (no migrations or SQL functions).
2. n/a: exposed schemas and `api` unchanged; `supabase/config.toml` changes only `additional_redirect_urls`.
3. n/a.
4. pass: no policy/RLS changes. Decision 18's hook still gates the new path (`tests/integration/src/auth-confirm.test.ts`): lines 56–62 the CMS's exact call (`POST /verify {type:'email', token_hash}`) issues a token whose every `amr` method is in the email list, for PKCE (`pkce_`) and non-PKCE requests; line 66 second use 403; lines 70–74 a password the editor set 403; lines 84–87 invite with the same `amr` check; lines 99–103 wrong type or made-up hash no token. Login CSRF: Minor below.
5. n/a. 6. n/a (tenant from URL, unchanged). 7. n/a. 8. n/a. 9. n/a.
10. pass: `actions.ts` uses `createEditorClient` (publishable key); logs only `error.status`/`error.code` (line 40) or `error.name` (line 45), never the token; `actions.test.ts` captures console output; `page.tsx:8` `referrer: 'no-referrer'`.
    - [Minor] The token hash is in the GET query string, so it lands in hosting request logs (Vercel) and browser history; anyone with log access (Litljómi staff) could use an unconsumed link within its one-hour single-use life. Same exposure as the old `{{ .ConfirmationURL }}` in Supabase's logs; inherent to the server-verified link specified. Defence in depth: `history.replaceState` to drop the query after load, keep the hash only in the form.
    - Cacheability: `page.tsx` reads `searchParams`, so it renders dynamically (`private, no-cache, no-store`); not measured; confirm with `curl -D -` on a running `next start`.
11. n/a to confirmation logic (unchanged): `isFinal` still `tone !== 'pending'` (`status.ts:54`); `sites === 0` → `warning`, final, never "Birt á vef" (`status.ts:99`); `ok` and `neutral` only via `sites_live_ok === sites` (`status.ts:101`), unpublish now `neutral` instead of `ok`; only `PublishPanel.tsx:144` uses `.tone`, presentation only.
12. pass: `i18n/is.ts:117` (`removedDetail`) says older copies may remain in caches; promises no removal.
13. pass: no contradiction with §4.4/§4.5/§8.1.
14. pass: `git diff --stat ba8defc..753f88b -- .claude` empty.

## Other checks
- GET never verifies: `page.tsx` renders escaped hidden inputs and a button; `verifyOtp` only in the `'use server'` action (`actions.ts:38`).
- Origin check: no `serverActions.allowedOrigins` in `apps/cms/next.config.ts`, so Next.js's default Origin-vs-Host check applies; a cross-site auto-submit is refused.
- Inputs: type `email`/`invite` (`actions.ts:35`); hash `/^(?:pkce_)?[0-9a-f]{56}$/` (line 9); non-string → null → fail; every failure → `/login?error=link`; `next` via `safeRedirectPath` (`routing.ts:11-18`), tests cover `//evil`, `/\evil`, `/\t/evil`, `https:`, `javascript:`, `t/acme`, empty.
- `/auth/callback` removal complete: `git grep auth/callback` (excl. docs/execution, docs/plans) only `routing.test.ts:36` (asserts it needs a session). Public paths exactly `{'/login','/auth/confirm'}` (`routing.ts:4`), exact match. `additional_redirect_urls` `["http://localhost:3100/auth/confirm"]`, config test updated. Runbook G3.7 and section 6 rows say `/auth/confirm`, no wildcard or localhost; hosted-template upload in G3.7 with `{{ .SiteURL }}` the staging CMS host; accurate.
- Templates link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email|invite`, no `next`; `email_change`, `reauthentication` unchanged; template test asserts exactly one link and nothing external.
- e2e loopback guard: new contexts from `newLoopbackContext` (`e2e/support/test.ts:20`) with the same `guardLoopback`; no other `newContext`; `magicLinkOf` still `requireLoopback` (`mailpit.ts:44`); Playwright config and global setup unchanged.

## Further findings
- [Minor] `page.tsx:21-39`, `actions.ts:24-30`: login CSRF / session swap. Cross-site auto-submit is blocked, but a user who presses "Halda áfram" on someone else's link is signed in as that link's owner, silently replacing any session, and the page does not say which account. Needs a valid link to an existing account (self sign-up off: an existing editor or a revoked member, who has no tenants); the victim sees the attacker's tenants; the console still needs `aal2`. Minor under the trusted-editor model. Follows from decision 41.1's cross-device behaviour, which PKCE used to prevent. Possible C3 hardening: show the target account on the confirm page, or warn when a session exists.
- [Minor] `login/actions.ts`: `emailRedirectTo` no longer affects the emailed link (built from `{{ .SiteURL }}`); it only keeps the allow-list entry meaningful; docstring could say so.
