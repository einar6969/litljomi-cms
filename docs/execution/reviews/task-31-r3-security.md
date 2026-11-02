# Task 31, security review, round 3 (cms-security-reviewer)

Step 2. Diff `4bd7eb4..f664a22` in `.worktrees/lane-a-next` (step 2 commit `602195e` and spec fix `f664a22`). Added by the controller's boundary check (unsandboxed e2e spec changed). Report as returned by the reviewer:

PASS

I found no Critical or Major findings. There is one Minor finding about comment wording.

Scope: `git diff 4bd7eb4..f664a22` in /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next. It changes 8 files and nothing under `.claude/**` or `supabase/**`. I ran nothing against the database and no e2e. `git status --porcelain` is empty.

1. not applicable: no SQL or functions changed.
2. not applicable: no schema or exposure changes.
3. not applicable: no grant changes.
4. not applicable: no RLS changes.
5. not applicable: no tables changed.
6. not applicable: no functions. On the app side, the tenant still comes from `currentTenant(slug)`, which resolves it per request.
7. not applicable: no `worker_*` or `admin_*` changes.
8. not applicable: commit path untouched.
9. not applicable: release logic untouched. The new test publishes to LABAK on the local stack only and expects `t.publish.noSite` ("Enginn vefur tengdur", /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/e2e/design.spec.ts:193). It does not change the worker or the status code.
10. pass: no secret key is imported or referenced in the diff. The new spec uses only the stored `editor_labak` session state and the magic-link sign-in. No credential is written to disk. The only files the spec writes are PNGs under `apps/cms/e2e-screenshots/`, which is gitignored (/Users/einarzoega/litljomi-cms/.gitignore:16). The JPEG fixture `e2e/fixtures/rugbraud.jpg` (64x48 baseline JPEG, 286 bytes, committed in 94566a2) is only read.
11. not applicable: confirmation logic untouched.
12. pass: no new editor text. Only existing `t.*` strings are reused.
13. pass: no contradiction with the spec found.
14. pass: the diff does not touch `.claude/**` and widens no permission or sandbox setting.

Focus checks:

(1) e2e spec, /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/e2e/design.spec.ts
- It still imports `test` from `./support/test`, so every new test gets the context-level loopback guard: `context.route(url => !isLoopbackUrl(url), abort)` in `support/test.ts`.
- The diff adds no `page.route`, `context.route` or `routeFromHAR`. The one existing `page.route` (line 80, from step 1) is unchanged and ends with `route.fallback()`, so the guard still applies.
- `signIn(page, 'outsider@test.local')` goes through `support/sign-in.ts`. The Mailpit calls use `requireLoopback(MAILPIT_URL…)` with `redirect: 'error'` (`support/mailpit.ts:7,10`), and the magic link is checked with `requireLoopback` (`mailpit.ts:43`).
- The outsider is the seeded user with no membership (`tests/integration/src/fixtures.ts:23`, `supabase/tests/database/_helpers.sql:122`). The test only expects the empty picker.
- `context.clearCookies()` affects only that test's browser context.
- The wrong-type file is passed as an in-memory buffer through `setInputFiles`. Nothing is written to disk.

(2) Source changes
- `(editor)/t/[tenant]/layout.tsx`: the order is unchanged: `requireUserId`, then `currentTenant(slug)`, then `notFound()`, then `isActive` (lines 17–20). The inactive branch only wraps the same h1 and p in `<Notice as="div" tone="warning">` and still renders no children.
- `t/[tenant]/page.tsx`: `notFound()` and `isActive` returning null are unchanged (lines 13–15). Only the markup changes, from `Link` to `LinkCard`, with the same `encodeURIComponent` hrefs.
- `(editor)/page.tsx`: `requireUserId` and `listMyTenants` are unchanged. The picker shows the same fields (`tenant.id`, `slug`, `name`).
- `not-found.tsx`: class changes only.
- `ui/Button.tsx`: adds `buttonClasses`, a pure string helper. Behaviour is unchanged.
- `ui/LinkCard.tsx`: a new presentational `Link` wrapper.
- `ui/Notice.tsx` (unchanged) spreads its HTML attributes, so `data-testid`, `role` and `aria-live` still reach the element.
- `ImageField.tsx`: `ACCEPT` and the input's `accept`, `required`, `disabled` and `onChange` (which clears `value` and calls `upload(file)`) are unchanged. The only addition is `className="sr-only"`. `prepareUpload`, `uploadOriginal`, `updateAsset` and the signed-URL preview are untouched. The focal-point marker keeps inline `left` and `top` computed from numeric `focalX` and `focalY`. Nothing new is sent to the client.

Further findings:
- [Minor] /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/e2e/design.spec.ts:8–9: the header says "the only thing written is the PNG files". The step-2 tests also create drafts, upload an original to local Storage and publish on the local stack. These writes all stay on loopback, so nothing is exposed, but the comment understates what the spec writes. Better wording would be "the only files written are the PNGs".
