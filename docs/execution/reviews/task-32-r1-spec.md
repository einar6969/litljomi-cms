# Task 32, round 1: spec-compliance review (cms-spec-reviewer, Sonnet)

Scope: lane-b `ba8defc..753f88b` (8803fb9, 2681fd3, 753f88b).

PASS

No Critical or Major findings. Read-only (diff and repository); no builds, tests or stack access; relied on the controller's test output. Commands: `git diff ba8defc..753f88b` (stat and per-path), grep for `auth/callback`, `warning`, `b45309` and the confirm test names in the lane-b worktree.

## Requirement check
- Templates: `magic_link.html` → `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`; `invite.html` same route with `type=invite`; `email_change` and `reauthentication` untouched; other copy unchanged.
- GET page (`apps/cms/src/app/auth/confirm/page.tsx`): one "Halda áfram" button in a form; verifies nothing; hidden fields token hash, type, next; covered by `page.test.tsx`.
- Action (`apps/cms/src/app/auth/confirm/actions.ts`): `confirmSignIn(formData)` server action; only it calls `verifyOtp`, with the cookie client; type `email` or `invite`; hash `^(?:pkce_)?[0-9a-f]{56}$`; any failure → `/login?error=link`; success → `safeRedirectPath(next)` (default `/`); logs only Auth status and code; `actions.test.ts` covers allowlist, malformed hash, unsafe `next`, failure redirect.
- `/auth/callback` replaced: route and test deleted; `PUBLIC_PATHS`, `emailRedirectTo` (`login/actions.ts`), `additional_redirect_urls` (`supabase/config.toml`), `tools/checks/__tests__/supabase-config.test.ts`, `proxy.ts` comments, `routing.test.ts` updated; `docs/runbooks/staging.md` G3.7, step-14 row and section 6 rows cover the confirm URL and hosted-template upload, stating `{{ .SiteURL }}` is the staging CMS host. Remaining `auth/callback` mentions only in the plan, old reviews and a `routing.test.ts` assertion.
- Decision 18 hook test (`tests/integration/src/auth-confirm.test.ts`): real mail; PKCE and non-PKCE requests; `/verify` with `type` and `token_hash` returns a token whose `amr` is an email method; second use 403; password sign-in 403; invite; wrong-type or made-up hash. Assertions can fail.
- e2e (`apps/cms/e2e/auth.spec.ts`): link requested in one context, signed in from a separate fresh context; requesting browser stays signed out; third context sees the link used up. Scanner opens without pressing; stays signed out; the editor then signs in with the same link. `signIn` clicks "Halda áfram". New `mailpit.ts`/`test.ts` support keeps the loopback guard on extra contexts.
- Tones: `DisplayState.tone` `'pending' | 'ok' | 'neutral' | 'warning' | 'error'`; "Tekið af vef" `neutral`, "Enginn vefur tengdur" `warning`; `isFinal` unchanged; `BadgeTone` extended, `warning` = `bg-warning text-canvas`, `--color-warning: #b45309`; `status.test.ts` and new `status-badge.test.tsx`; `design.spec.ts` asserts `data-tone`, `rgb(180, 83, 9)` and white text, no pulse on `neutral`.

## Scope calls
- `referrer: no-referrer`: small, tested hardening; keep; Minor at most, not flagged.
- Confirm-page screenshot: in scope ("update the screenshot spec" for a new screen).
- `auth-passwordless.test.ts` reading the token hash from the new link: needed (templates no longer carry a `/verify` URL; `verifyUrlFor` keeps implicit and PKCE flows covered). In scope.

## Minor
- [Minor] `apps/cms/src/app/login/actions.ts` (doc comment): one over-long line after the edit; cosmetic.
