# C3 follow-up, CMS side (9d9cd3c..d87cc4f): security review (cms-security-reviewer, Opus)

PASS

`pnpm exec vitest run --project cms` on the confirm page, confirm action, proxy matcher and icon tests: 4 files, 63 passed. No e2e or database; stack untouched; `git status --porcelain` empty.

1–6 n/a (no SQL, exposure, grants, RLS, tables, functions).
7. n/a. `auth.admin.signOut` here is not privileged: `GoTrueAdminApi.js:65-83` sends `POST /logout?scope=local` with the client's own headers (publishable key, `server.ts:10-13`) and `Authorization: Bearer <passed token>` (`lib/fetch.js:95-96`); Auth revokes only that token's session; no secret key.
8–9 n/a.
10. pass: no secret/service-role/`sb_secret` in the diff; new error paths log only `error.status`/`error.code` or `error.name` (`actions.ts:371,373`), tested with a token in the message (`actions.test.ts:208-217`); `getUser()` reduced to a boolean (`page.tsx:421-428`), email absent (`page.test.tsx:285-296`); no email in URLs.
11. n/a. 12. pass ("Þú ert þegar skráð/ur inn", `is.ts:21`; runbook sentence; nothing about caches).
13. Possible contradiction for the controller: spec §4.4 "email magic link / one-time code"; Q3 removes the code from `magic_link.html`; decision 42 amends only §9.1 and §2.2. Weakens nothing (Auth and the hook still accept `otp`). Whether "/" means "or" or "both" is not the reviewer's to decide.
14. pass.

Focus:
- Action order (`actions.ts:38-52`): hash regex and `email`/`invite` check before any client; `getSession()` reads the old token (try/catch → null); `verifyOtp`; on error, no session or throw → false before any revoke (bad link keeps the old session); `admin.signOut(previous, 'local')` only after a session is issued and only when tokens differ; revoke failure logged without tokens. Covered by unit tests (`actions.test.ts:179-232`, incl. call order), integration (`auth-confirm.test.ts:113-138`) and e2e (`auth.spec.ts:84-118`).
- Cannot revoke another user's sessions: token only from the visitor's cookies; Auth checks the JWT signature; a planted stolen token only revokes what its holder could revoke anyway; `local` leaves other devices alone.
- CSRF/login-CSRF: cross-site POST blocked by Next's origin check; GET changes nothing (`setAll` no-op in a Server Component, `server.ts:17-22`); an attacker's link still swaps on press, now after a visible notice, and the old session is revoked — Einar's accepted limitation (Q1).
- Template: `{{ .Token }}` and "kóði" gone (`magic_link.html:18`); link unchanged; nothing external; config test (`supabase-config.test.ts:113-118`); runbook (`staging.md:176-177`) matches.
- Favicon: one `rect` and one `path`; no script/href/url()/image/@import (`icon.test.ts`); matcher `icon\\.svg$` (`proxy.ts:465`); look-alikes still proxied (`proxy-matcher.test.ts:132-135`).
- `sourceLabel`: `text({ max: 80 })` (`modules/labak/src/index.ts:546`), single line, refuses `\r`/`\n` (`fields/text.ts:19`), 80 in draft and publish, projects `string | null` (`labak.test.ts:504-523`).
- e2e: `newLoopbackContext(browser, options?)` keeps `guardLoopback` (`e2e/support/test.ts:109-110`); URLs `CMS_URL`; `page.request.get(href)` (`auth.spec.ts:77`) bypasses `context.route` but `href` is checked against `^/icon\.svg` and resolves against the loopback base.

Findings:
- [Minor] `actions.ts:338-346` with `lib/supabase/proxy.ts:20-25`: no test of the proxy refreshing an expired old session on the same POST; outcome depends on Next merging Set-Cookie; fails closed (visitor signed out). A later e2e with an expired access token would settle it.
- [Minor] `proxy.ts:465` (pre-existing): `favicon\\.ico` has no `$`, so `/favicon.icoX` skips the proxy check (pages and the database check again); add `$`.
- [Minor] `page.tsx:421-428`: every GET makes one Auth `getUser` call, anonymous visitors included; below the resource bounds.
