# Task 31, combined spec-and-quality review, round 1 (cms-quality-reviewer)

Step 1. Diff `ea76aa9..3a3eada` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

FAIL

Commands run: git diff and file reads, `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs` (ok), `pnpm test`. Lint, typecheck and slugs showed no errors beyond macOS "failed to copy trust settings" noise. The `pnpm test` tail was only that noise, so I cannot confirm it passed. I read the 27 screenshots at 375, 768 and 1440 (login, login invalid link, entry list, form live, removed, publish error and rich text). I did not run e2e. I did not verify the Tailwind 4.3.3 release age; it needs a registry check.

**Findings**

[Major] spec/quality: `apps/cms/src/proxy.ts:13` (matcher), `apps/cms/src/app/globals.css:11-26` and the `design.spec.ts` login test: the self-hosted fonts do not load on the sign-in page.
- The proxy matcher excludes only `api/`, `_next/static`, `_next/image` and `favicon.ico`. A signed-out request to `/fonts/*.woff2` is therefore redirected to `/login` (HTML). The `isPublicPath` check does not cover it.
- The login screenshots (`step1-login-*`, `step1-login-link-invalid-*`) show the fallback system font. The wordmark and h1 are visibly not Bricolage Grotesque or Albert Sans, unlike the signed-in screens.
- The first screen an editor sees ignores the design's fonts.
- Suggested change: exclude `fonts/` in the matcher, or make `/fonts/` a public path.
- Security flag: this touches the proxy and auth routing, which the security checklist covers. Send it back through the security review.
- Test gap: add an assertion to the login screenshot test that the fonts really loaded, for example `document.fonts.check('16px "Albert Sans"')` and the same for Bricolage, or a 200 response with a font content-type for the woff2 requests. The current spec only checks horizontal overflow, so it cannot catch this.

[Minor] `apps/cms/src/editor/publish/PublishPanel.tsx:~1135` and `StatusBadge.tsx:462`: judgment call 1, "Tekið af vef" in the `ok` tone.
- The screenshot `step1-form-removed-768.png` shows an accent-green pill for "the entry is no longer on the site". For a non-technical editor, green reads as "live".
- Keeping `status.ts` unchanged is correct, since the tone there means the operation succeeded.
- Preferred fix, not a blocker: render the removed state neutrally in the panel, for example when `state.label === t.publish.removed`. This is presentation only. It would diverge from the entry list, where only "Birt" is green and "Tekið af vef" would also be neutral, so this is arguably consistent.
- Leaving it is acceptable; raise it with Einar at the step-1 screenshot approval.

[Accepted] Judgment call 2, the input border.
- I computed `color-mix(muted 75%, white)` as about 3.3:1 against white, slightly under the 3.4 in the comment. That still meets WCAG 1.4.11 (3:1). The comment can say 3.3.
- Other contrasts, computed: muted on white 5.7:1 and on the recessed surface 5.2:1. Danger text on white is 5.3:1 and white on the danger fill is 5.3:1. Ink on accent is high. The accent-text mix is about 6.0:1, not the 6.4 the comment claims.

[Minor] `globals.css:35`: the comment says 6.4:1 for `--color-accent-text`; it is about 6.0:1. The token is defined but unused (harmless; the brief requires it).

[Minor] `globals.css` (base `button` and `input` rules) and `ui/Button.tsx`: button styling is declared twice, once as global base rules and once as Tailwind utilities in `Button`. The toolbar then needs unlayered overrides (`globals.css:322-339`), which depend on cascade-layer order and are fragile. Suggest a comment explaining why, or deleting the global `button` rule once all buttons use `Button`.

[Minor] `globals.css:288-319`: on mobile the entry table becomes `display:block`. Some screen readers (Safari/VoiceOver) then drop the table semantics. Consider `role="table"`, `role="row"` and `role="cell"` on the elements, or accept this.

[Minor] `apps/cms/src/editor/form/SlugField.tsx:~96` and the screenshots: the "Slóð vistuð" Notice is a `<p>` with `max-width: 68ch`, so at 768 px it is narrower than the inputs above it (`step1-form-live-768.png`). Add `max-w-none` to Notice.

[Minor] `ui/Field.tsx` (design note): the help and error spans sit inside the `<label>`, so they become part of the control's accessible name. This matches the previous `LinkField` behaviour (the error span was already inside the label) and the tests select by label, so nothing regressed. If `help` is ever used, the name will change.

[Minor] `design.spec.ts:28`: `waitForTimeout(150)` after the resize is a fixed sleep. `document.fonts.ready` plus a `requestAnimationFrame` wait would be more robust. The spec otherwise reads clearly. Its only assertion is the 375 px overflow, so it protects layout but not the fonts, contrast or the accent rule (see the Major above).

[Minor] `EntryForm.tsx` (the wrapping `<div className="grid …">`): the `<form>` and `PublishPanel` inside are not re-indented. Cosmetic.

**Checked and fine**
- Markup keeps `aria-live="polite"`, `data-testid="publish-state"`, `data-tone`, `data-testid="slug-notice"` and `slug-suggestion`.
- Roles (`status`, `alert`, `note`), labels and button names are unchanged. Copy comes from the `t.*` strings. `status.ts`, the server actions and autosave are untouched.
- Label association is preserved, and the `htmlFor` ids match.
- Tokens: ink focus ring, `prefers-reduced-motion`, fixed px sizes, radii 8 and 12 px, 44 px tap targets and `motion-safe` on the pulsing dot.
- Accent is used as fill only (buttons, the badge, the notice edge, the wordmark mark); text on it is ink.
- No horizontal overflow in any 375 px screenshot, and no clipped text.
- The OFL notice and the exact-pinned Tailwind 4.3.3 are present.

**Screenshots with a problem**
- `step1-login-{375,768,1440}.png`: wrong font (the Major).
- `step1-login-link-invalid-{375,768,1440}.png`: wrong font (the Major).
- `step1-form-removed-{375,768,1440}.png`: the green "Tekið af vef" pill (Minor).
- `step1-form-live-768.png` and `-1440.png`, and `step1-form-richtext-*`: the Notice and the status text are narrower than the inputs (Minor).
- `step1-form-richtext-*`: the image fields ("Velja myndChoose File No file chosen") are unstyled, which is step 2 and expected.
- The rest look good: clear hierarchy, no layout breaks, and the accent is never used as text.
