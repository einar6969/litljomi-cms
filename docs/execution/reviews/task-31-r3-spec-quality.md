# Task 31, combined spec-and-quality review, round 3 (cms-quality-reviewer)

Step 2. Diff `4bd7eb4..f664a22` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

FAIL

The only open Major is the missing suspended-notice screenshot. Everything else is Minor.

Commands run: `git diff 4bd7eb4..f664a22`, `pnpm lint` (no errors; only the "failed to copy trust settings" certificate noise), `pnpm typecheck` (clean), `pnpm test` (62 files, 1122 tests passed). I read all the `step2-*` screenshots I judged necessary: image-field 375, image-field-error 1440, tenant-home 375, tenant-picker 375, not-found 375, notice-conflict 375, notice-signed-out 1440, publish-no-site 768. I did not open the other widths.

**Findings**

- [Major] spec: `apps/cms/e2e/design.spec.ts` (comment at lines 3-8; no suspended case). Plan line 1620 says step 2 styles the suspended notice "and add[s] those screens to the screenshot spec". The suspended notice (`t/[tenant]/layout.tsx:20-29`, `tone="warning"`) has no screenshot.
  - Because of that, the warning-tone contrast and the layout of the `h1` and `p` inside the Notice `div` have never been looked at.
  - I rate it Major because a required screen is missing and its warning-tone contrast and the `h1`-in-Notice layout have never been looked at. The cause is real: no seeded user can reach it without a database write.
  - It clears if Einar records a waiver for this one screen. Alternatively, shoot it without the database, for example a Playwright route/mock of `api.my_tenants` returning `status: 'suspended'`, or a component render.
  - The static check is fine: `text-ink` on `bg-recessed` with a `border-l-warning` edge. The ink-on-recessed pairing is the same as the other Notices, which look fine in the screenshots.

- [Minor] quality: `apps/cms/src/app/not-found.tsx:10`. `no-underline hover:bg-recessed` repeats what `buttonClasses('secondary')` already has (hover is already `hover:bg-recessed`), and appending `no-underline` after it relies on Tailwind class order. Suggest dropping `hover:bg-recessed`, and putting the underline reset in a small `linkButtonClasses` helper or the `buttonClasses` base. This stays Minor and is not a defect today.

- [Minor] quality: `apps/cms/src/editor/form/fields/ImageField.tsx:130,177-181`. `busyPicker` hardcodes the disabled look on the `<label>` (`border-hairline bg-recessed text-muted`), duplicating the `disabled:` styles in `Button.tsx`. If those change, the picker drifts. It is acceptable, and the picker has no `disabled` state of its own. A short comment saying it mirrors the Button's disabled style would help.

- [Minor] quality: `ImageField.tsx:33`. `toneOf` classifies by `notice.endsWith('Saved')`, the same string test the aria-live branch uses at about line 200. Compute `live = notice === 'uploading' || notice.endsWith('Saved')` once so the tone and the live/alert choice cannot diverge.

- [Minor] quality: `design.spec.ts:3-8`. The header comment grew an over-long line. The picker test also has no test id for the `none` notice, but `getByText` is fine.

- [Minor] spec: `ImageField.tsx` focal button has `min-h-0` and `p-0` (intentional). Its focus ring relies on the global focus style, which I did not verify for this button. This is not rated higher because it is an image-sized target and the label is covered separately.

**Checks, all OK**
- No change to copy, behaviour, server actions, status logic or autosave. The diff is styling plus `buttonClasses` and `LinkCard` extraction. `status.ts` is untouched.
- Test selectors are kept:
  - `#field-image` and `#field-image-alt` are kept.
  - The file input is `sr-only`, still inside its `<label htmlFor>`, still focusable and named, so `setInputFiles` works.
  - `data-testid` and the `role="alert"` / `aria-live="polite"` choice are unchanged.
  - The e2e run (27 passed) confirms it.
- The accent rule holds. Accent appears only as the fill of the primary button and the success edge, with ink text on it. Red is used only for the danger button text/border, the error edge and the "Enginn vefur tengdur" pill, never accent text on white.
- Focus ring on the file-picker label: `has-[:focus-visible]:outline-2 outline-offset-2 outline-ink` is correct. The screenshots show the dark focus ring on inputs.
- Tap targets: `BASE` gives `min-h-[44px]`, so the picker label, the buttons and the not-found link meet 44 px. `LinkCard` is at least 56 px.
- No horizontal scroll at 375 is asserted in `shoot` for every step 2 screen, and the 375 screenshots show nothing clipped. At 375 the image-field buttons stack full-width, and the notice and form layouts are clean.
- Reuse: `LinkCard`/`LinkCardList` are shared by the picker and the tenant home, and `buttonClasses` is shared by the picker label and the not-found link. No duplication beyond the Minors above.
- Screenshots look correct and pleasant. The warning tone could not be judged because there is no screenshot of it. The image preview is a flat brown block, which is the fixture's content.
- The spec itself can fail:
  - Headings and text are asserted before each shot.
  - The conflict and signed-out notices are asserted by role and text.
  - The image preview is polled until it has loaded (`naturalWidth`) before the shot.

The known items you listed (`ok` and `error` tones from `status.ts`, no multi-tenant picker) are not rated.
