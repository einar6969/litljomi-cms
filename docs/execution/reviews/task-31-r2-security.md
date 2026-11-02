# Task 31, security review, round 2 (cms-security-reviewer)

Step 1, fix diff `3a3eada..4bd7eb4` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS

Security review of Task 31 (editor design), step 1, round 2. Fix diff only: `git diff 3a3eada..4bd7eb4` in `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next`. No Critical or Major findings, and my one round-1 Minor is resolved. I don't need a full re-review: the fix is small, and outside the matcher and the e2e spec it only changes markup and CSS. I changed nothing. `git status --porcelain` was empty at the end, and I did not touch the stack, `pnpm db:*` or e2e.

**Files in the fix (7):**
- `apps/cms/src/proxy.ts`
- `apps/cms/src/__tests__/proxy-matcher.test.ts` (new)
- `apps/cms/e2e/design.spec.ts`
- `apps/cms/src/app/globals.css`
- `apps/cms/src/editor/form/EntryForm.tsx` (indentation only; the tokens are the same)
- `apps/cms/src/editor/publish/PublishPanel.tsx` (one class removed: `lg:sticky lg:top-6`)
- `apps/cms/src/ui/Notice.tsx` (`max-w-none` added)

**The matcher exclusion (apps/cms/src/proxy.ts:13):** `'/((?!api/|_next/static|_next/image|fonts/|favicon\\.ico).*)'`. The negative lookahead is anchored right after the leading `/`, so only paths starting with exactly `/fonts/` are excluded.

I checked edge cases with Next 16.4.3's own `unstable_doesMiddlewareMatch`, using the same config, from a scratch script outside the repository. `true` means the proxy runs:
- `/fonts/a.woff2` → false. `/fonts/` → false. `/fonts` → true.
- `/fontsx/a` → true. `/t/x/fonts/a` → true.
- `//fonts/a` → true. `/FONTS/a` and `/Fonts/a` → true.
- `/%66onts/a` → true. `/fonts%2Fa` → true.
- `/fonts/../t/demo/event`, `/fonts/%2e%2e/t/demo` and `/fonts/a/../../t/demo` → true. URL parsing turns them into `/t/demo...` before the match.
- `/fonts/..%2ft%2fdemo` → false. `%2f` is not a path separator in Next routing, so this cannot reach an editor route (at most a 404).
- `/./fonts/a` → false. It normalizes to `/fonts/a`, which is genuinely static.

**What `/fonts/` can serve:**
- `apps/cms/public/` holds only `fonts/`, with two `.woff2` files and `OFL.txt`.
- No app route or segment named `fonts` exists under `apps/cms/src/app`: `find -iname '*font*'` finds nothing, and the routes are `(editor)`, `t/[tenant]/...`, `login`, `auth/callback` and `api/...`.
- `next.config` has no rewrites, redirects, `basePath` or i18n that could map `/fonts/*` onto a page.

**The proxy is not the boundary anyway:**
- `apps/cms/src/lib/supabase/proxy.ts:10-11` says so: "A convenience, not the boundary".
- The editor layouts check the session again: `src/app/(editor)/layout.tsx:12` and `src/app/(editor)/t/[tenant]/layout.tsx:16` both call `requireUserId`.
- Every server action uses `createEditorClient` (the editor's own session), and RLS and the `api` functions decide access.

So even a theoretical raw-path bypass would reach no data. I could not try a raw request (`curl --path-as-is /fonts/../t/...`) because no server is running on 3100 and I was told not to start one. This is noted only for completeness, not as a finding: the page-level guard and RLS cover it, and the existing `api/` exclusion has the same theoretical shape.

**The test:** `npx vitest run src/__tests__/proxy-matcher.test.ts` gives 2 passed. It can fail:
- Dropping the trailing slash (`fonts` instead of `fonts/`) would exclude `/fontsx/a.woff2` and fail the test.
- A non-anchored `fonts/` would exclude `/t/demo/fonts/a` and fail the test.
- `/login` and `/t/demo/event` are asserted as matched.

The test does not cover `/fonts` (no slash), `//fonts/...` or case variants. These behave safely, as shown above, so the missing asserts are not rated.

**Round-1 Minor (design.spec.ts):** resolved. `apps/cms/e2e/design.spec.ts:76-77` now uses `route.fallback()`, with a comment saying the context-level loopback guard still applies. `grep -rn "route.continue\|route.fulfill" apps/cms/e2e` finds nothing.

The new font assertions (design.spec.ts:41-47) only call `document.fonts` in the page. They make no network calls and handle no secrets.

**Checklist (only the items the fix touches):**
1. not applicable: no SQL or functions in the fix.
2. not applicable: no schema or exposure changes.
3. not applicable: no grants.
4. not applicable: no RLS changes. Pages and RLS still decide access when the proxy does not run (see above).
5. not applicable.
6. not applicable: no tenant resolution changes. `EntryForm.tsx` only changes indentation, and `PublishPanel.tsx`/`Notice.tsx` only change classes.
7. not applicable.
8. not applicable.
9. not applicable: the `PublishPanel` status logic is untouched.
10. pass:
    - The fix adds no secret, key or env reference; the diff has no `SECRET`, `service_role` or key material.
    - `/fonts/` serves only the public font files and the OFL licence.
11. not applicable.
12. pass: no editor text changed; `i18n/is.ts` is not in the diff.
13. not applicable: no contradiction with the spec found.
14. pass: `git diff --stat` shows no `.claude/**` path.

**Further findings:** none.

**Files:**
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/proxy.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/__tests__/proxy-matcher.test.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/e2e/design.spec.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/lib/supabase/proxy.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/public/fonts/`

The scratch probe script is `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/e172fb7c-0fee-4a6b-8a7c-c9476d276896/scratchpad/m.cjs`, outside the repository.
