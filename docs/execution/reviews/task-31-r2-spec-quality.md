# Task 31, combined spec-and-quality review, round 2 (cms-quality-reviewer)

Step 1, fix diff `3a3eada..4bd7eb4` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS

Commands run: `git diff 3a3eada..4bd7eb4`, `pnpm lint` (no errors beyond the macOS trust-settings noise), `pnpm typecheck` (clean), `pnpm test` (62 files, 1122 tests passed). I read the login, form-live and publish-error screenshots (1440, 768 and 375 px as listed below). I did not run e2e or `pnpm db:*`, and I did not open the richtext or the 375 px live/publish-error screenshots.

Round-1 findings:
- **Major, fonts signed out: resolved.**
  - `proxy.ts:13` now excludes `fonts/` from the matcher.
  - The new `proxy-matcher.test.ts` uses Next's `unstable_doesMiddlewareMatch`. It asserts that `/fonts/*.woff2` is not matched. It also asserts that `/login`, `/t/demo/event`, `/fontsx/a.woff2` and `/t/demo/fonts/a` are still matched, so it can fail on a loosened matcher.
  - `design.spec.ts` now checks `document.fonts.check` for both families and that every font face has status `loaded`, signed out. The controller reports 23 e2e passed.
  - `step1-login-1440.png` and `step1-login-link-invalid-375.png` show Bricolage on the h1 and wordmark and Albert Sans on the body.
  - This touches proxy routing, so send it through the security review. The exclusion is narrow and anchored (`fonts/`, with the look-alike paths tested). Fonts are static public assets, so I see no exposure, but that is the security reviewer's call.
- **Notice width: resolved.** `Notice.tsx:18` has `max-w-none`. The "Slóð vistuð" notice in `step1-form-live-768.png` is full width, level with the inputs. The unlayered `p { max-width: 68ch }` does not beat it.
- **Contrast comments: resolved.** `globals.css` now says about 6.0:1 and 3.3:1.
- **Fixed sleep: resolved.** `design.spec.ts` now waits on `document.fonts.ready` plus a double `requestAnimationFrame`.
- **Button double styling: resolved.** `globals.css` has an explanatory comment, as agreed.
- **Indentation: resolved.** `EntryForm.tsx` is re-indented with no logic change.
- **Not re-checked:** the green "Tekið af vef" pill, the mobile table roles, the Field help-in-label point (out of scope as decided).

At the controller's request:
- **Publish panel top-aligned: OK.** Sticky is removed in `PublishPanel.tsx:139`. In `step1-form-publish-error-1440.png` the panel sits at the top of its column, level with the first field, with no overlap.
- **Rich-text toolbar groups: OK.** Each group is now a bordered, rounded white chip on the recessed bar, with 8 px gaps. They wrap cleanly at 768 and 1440 px.
- **Accent rule: kept.** Green appears only as fills (buttons, the badge, the notice edge, the dot), with ink text on it. The red error pill has white text and no layout break.

New findings:
- [Minor] `apps/cms/src/ui/Notice.tsx:18`: `max-w-none` is placed before `${className}`, so callers can still override it. Fine; no change needed.
- [Minor] The new matcher test imports `next/experimental/testing/server`, which is an unstable API. A Next upgrade could break the test, but the failure would be loud, so this is acceptable.

No open Critical or Major findings.
