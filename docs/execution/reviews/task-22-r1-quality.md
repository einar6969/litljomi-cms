# Task 22, quality review, round 1 (cms-quality-reviewer)

Diff `c29aa8b..6c368c2` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS

Commands: `git diff`, `git show` for `auth.spec.ts`, `pnpm lint` clean. `pnpm typecheck` and `pnpm test` not run by the reviewer; e2e out of bounds. No Critical or Major findings; none touches security-relevant code.

Findings (all Minor):
- `apps/cms/src/app/login/__tests__/actions.test.ts`, "has one neutral Icelandic message for every outcome": asserts a literal only; delete or move to an i18n test.
- `apps/cms/e2e/probe.spec.ts:4`: imports from `@playwright/test`, skipping the loopback route guard in `./support/test` (talks only to 127.0.0.1); import from `./support/test` or comment the exemption.
- `apps/cms/e2e/support/local.ts`, `apps/cms/playwright.config.ts:361-362`: port 3100 written three times; one `CMS_PORT` constant.
- `apps/cms/e2e/support/sign-in.ts:292`: name the 2000 ms backoff and tie it to `max_frequency`.
- `apps/cms/e2e/support/sign-in.ts:296`: a callback failure redirecting to `/login?error=link` still satisfies `waitForURL`; check the landing path is not `/login`.
- `apps/cms/e2e/support/mailpit.ts:227`: `magicLinkOf` regex depends on the template keeping one `href` containing `/auth/v1/verify`; note it.
- `apps/cms/src/lib/supabase/proxy.ts:1140`: `createServerClient<any, 'api'>`; use the database type or comment.
- `apps/cms/src/app/(editor)/t/[tenant]/page.tsx:501` and `layout.tsx`: inactive-tenant logic split; a shared `isActive` helper.
- `tools/checks/__tests__/e2e-loopback.test.ts`: comment the partial `node:child_process` mock.
- `tests/integration/scripts/cms-next.sh:1242-1247`: comment the unmatched-glob double condition.

Test quality good where it matters (callback open-redirect set, `safeRedirectPath`, neutral-outcome and never-log-the-email cases, DB-error-is-thrown in `resolveTenant`, proxy cookies, e2e-loopback env and `.env*` refusal). Loopback visibility easy to follow; only gaps the probe import and the repeated port.
