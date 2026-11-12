# Password sign-in: implementation plan

> **Status: APPROVED by Einar on 2026-11-12 (decision 72).** Hosted rollout is not covered.

**Goal:** editors and platform admins sign in with email and password instead of a magic link (spec §4.4 as amended on 2026-11-12). New editors set their first password from the invite email; a forgotten password is reset by email.

**Einar's words (2026-11-12):** "i want to implement account passwords auth, instead of the current system." and, asked whether sign-in should include a CAPTCHA, "no CAPTCHA. also, no password rules."

**Replaces:** decision 18's hook (it refused passwords; the new one refuses magic links and OTP codes), decision 20's verification procedure (inverted), and decision 43's "magic link only". Decision 66 parked M5 finding 7 until a password system: PW-02 resolves it by keying Auth's limits on the editor's address. The guessing risk that remains is accepted (spec §4.4, §11.2).

**Not in scope:** CAPTCHA; password rules beyond Auth's minimum of 6; the leaked-password check; a "change password" screen for a signed-in editor (a reset does it); MFA for editors; passkeys. Platform admins keep TOTP and `aal2` for the console, unchanged.

## How a task runs

As in `docs/plans/m5.md`: local, one task, one branch `pw/<task-id>-<slug>`, one PR, separate reviews, up to date with `main`, green CI, and the KING merges (decision 61). PW-01 to PW-03 are security tasks: spec review and security review, then quality review. Test first. Global constraints as in `m4.md`. The tasks run in order: each needs the one before it.

## PW-01: The sign-in hook and Auth configuration

- **Spec:** §4.4, §4.5 "Auth hook grant", §11.2.
- **Scope:**
  - A new migration creates `private.sign_in_access_token(event jsonb)`: same shape, grants and fail-closed checks as today's hook, with the allowed methods `password`, `recovery`, `invite`, `email_change`, `totp` and `token_refresh`. For `token_refresh` and `totp`, every `amr` method must be one of `password`, `recovery`, `invite`, `email_change` or `totp`. `magiclink`, `otp` and anything else return 403 with a message that names no method. The same migration drops `private.passwordless_access_token`.
  - `supabase/config.toml`: the hook URI points to the new function; `minimum_password_length = 6`; `password_requirements = ""`; leaked-password check off; `secure_password_change` stays on.
  - The test helpers that sign in through a magic link (`tests/integration/src/auth-api.ts`, `clients.ts`, the persona matrix's setup, `editor/__tests__/*.integration.test.ts`) sign in with a password instead. Seeded test users get a password from the seed or fixture files, never a real one.
  - `tools/checks` and `tools/cli/src/boundary-check.ts` check the new hook and its new expectations.
- **Acceptance:** pgTAP covers every method with valid, empty, missing and malformed `amr`, and pins the grants (only `postgres` and `supabase_auth_admin` may execute). Integration: a password sign-in gets a session; a magic-link and an OTP verification each get 403; a session whose `amr` holds `magiclink` can't refresh; an invite and a recovery link each sign in. The persona matrix passes.

## PW-02: Sign-in with a password

- **Spec:** §4.4, M5 finding 7.
- **Scope:**
  - `/login` asks for email and password. The server action signs in with the editor's cookie client and then routes as today (tenant home, the console's MFA step, a safe `next` path). Wrong password, unknown address and malformed input give one message, so the answer never shows whether an account exists. A rate limit gets its own message. Neither the address nor the password is ever logged or echoed back.
  - `requestMagicLink` and its notices are removed. Sign-out is unchanged, including discarding a pending session.
  - **The editor's address, not the server's (finding 7).** Auth's per-IP limits must key on the visitor's own address. Start by proving locally how GoTrue accepts a forwarded address from a server call (for example `Sb-Forwarded-For`, and what it requires), and only trust an address Vercel sets. If it can't be done with the publishable key, sign in from the browser client straight to Auth instead. Report the finding before building on it.
  - The browser-test helpers (`apps/cms/e2e/support/sign-in.ts`, `editor-session.setup.ts`, `console-admin.ts`) sign in with a password.
- **Acceptance:** unit tests for every action outcome. An integration test exhausts the sign-in limit for one address and shows that another address can still sign in. Browser tests: sign-in, a wrong password, and a platform admin's sign-in followed by TOTP. The existing browser suite passes.

## PW-03: First password and password reset

- **Spec:** §4.4.
- **Scope:**
  - A "Gleymt lykilorð?" link on `/login` opens a form that requests a reset email (`redirectTo` the confirm page). It always shows the same confirmation.
  - The confirm page accepts `invite`, `recovery` and `email_change` links, and refuses `email` (magic link). As today, the link is verified by the button's POST, never the GET.
  - After an invite or a recovery link, the CMS takes the editor to a set-password page before any other page, and returns them to where they were going once the password is set. A failed or refused update says so and keeps them on the page.
  - Templates: `invite.html` says the editor will choose a password; a new Icelandic `recovery.html` follows the token-hash and POST pattern; `magic_link.html` no longer carries a link and says to sign in with a password at the CMS address, because Auth's OTP endpoint can still send it.
  - New Icelandic strings in `src/i18n/is.ts` are listed in the PR for Einar's approval of the copy, as with decision 51.3.
- **Acceptance:** browser tests: an invite leads to a set password, sign-out, then sign-in with it; a reset makes the new password work and the old one fail; opening a link by GET uses nothing up; a signed-in visitor opening another account's link is asked first (M3-14). Unit tests for the confirm types and the redirect rules.

## PW-04: Documents

- **Docs only** (decision 54): no PR or review needed.
- **Scope:** the staging runbook's Auth section (hook URI, password settings, templates, the hook check of decision 20 inverted: a magic link and an OTP code are refused, a password signs in); `.env.example` if anything changes; `docs/king/OPEN-ISSUES.md` (finding 7 and S26 updated, the accepted guessing risk added); `BRIEF.md`'s decisions table.

## Local acceptance

On the local stack: `pnpm db:reset`, `pnpm db:test`, `pnpm test`, `pnpm test:integration`, `pnpm lint`, `pnpm typecheck`, and the full browser suite run by Einar. An editor and a platform admin each go from invite to set password to sign-in.

## Hosted (separate approval)

Not covered by approving this plan. On staging: `supabase db push` and, in the same minute, the hook URI in the dashboard (sign-ins fail between the two; staging has no editors); the password settings; the invite, recovery and magic-link templates; advance `staging`; reset the passwords of the test and admin accounts; run the inverted hook check and the staging browser suite. Production waits for its own decision.
