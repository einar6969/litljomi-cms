# Task 22, spec review, round 1 (cms-spec-reviewer)

Diff `c29aa8b..1bf5641` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS

Every file, interface, string and test the task names is present and matches the plan text, decision 37 items 3–5 and the controller rulings. Nothing Critical or Major.

Findings, all Minor:
- `apps/cms/src/lib/supabase/proxy.ts:28`: refresh logic sits in a helper; `src/proxy.ts` is a thin wrapper; reads `supabasePublicEnv` from an earlier module. Not a deviation.
- Extra files beyond the list, covered by the rulings or needed for the behaviour: `(editor)/layout.tsx`, `t/[tenant]/page.tsx`, `not-found.tsx`, `lib/tenant.ts`, `lib/auth/routing.ts`, `lib/auth/session.ts`, e2e support files, `editor-session.setup.ts`, `global-setup.ts`, unit tests, `.gitignore`. The `signOut` action and the `listMyTenants` redirect in the picker go slightly beyond the text, within "Icelandic shell" and "tenant picker": acceptable.
- Plan Step 2 (e2e failing first) could not be observed; not weighed.

Checked: `requestMagicLink` (`shouldCreateUser: false`, `emailRedirectTo` `${CMS_PUBLIC_URL}/auth/callback`); every outcome redirects to `/login?sent=1` with "Ef netfangið er skráð færðu tölvupóst"; callback exchanges the code, same-origin redirect only (`safeRedirectPath`), failure to `/login?error=link`; `/t/[tenant]` via `api.my_tenants`, `notFound()`, "Vefur óvirkur", page re-resolves; picker; `src/proxy.ts` refresh and `/login` redirect; Playwright 1.64.1 and `e2e` script; config.toml port 3100 and `email_sent = 60`, runbook updated; `seed:local` reuses `seedIntegration()`; one saved session reused via `sessionState`; four Icelandic templates wired with Icelandic subjects; probe spec on loopback; global setup spawns `process.execPath`, no lint changes; `auth.spec.ts` covers the three tests (unknown address also gets no mail); no earlier interface changed.

Commands: `pnpm lint` 0; `pnpm typecheck` 0; `pnpm test` 48 files 904 passed; `pnpm check:slugs` ok; `git diff`. No database, stack or e2e command; `git status --porcelain` empty.
