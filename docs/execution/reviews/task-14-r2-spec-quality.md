# Task 14: combined spec-and-quality review, round 2 (fix diff)

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, fix round, 2026-11-02
- Fix diff: 8452545..e6dbcd8 (82d08f5, e6dbcd8) on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Commands run in the worktree:
- `git diff 8452545 e6dbcd8`
- `pnpm vitest run --project rich-text --project schema`: 9 files, 46 tests, all pass.
- `pnpm typecheck`: clean.
- `pnpm lint`: clean.
- grep for other users of `richTextExtensions`: nothing outside the rich-text package imports it from the main entry.

Earlier findings:
- Decision 23 is implemented.
  - `package.json` has `exports` of `"."` → `src/index.ts` and `"./editor"` → `src/tiptap.ts`. `index.ts` no longer re-exports `richTextExtensions`.
  - `entry-points.test.ts` walks the relative import graph from `index.ts` and asserts no `tiptap.ts`, `@tiptap*` or `prosemirror*`. It also checks that the same walker does see `@tiptap` from `tiptap.ts`, so it cannot pass vacuously. A third test pins the `exports` map.
  - The test would fail if someone re-added the export.
- Ordered lists are fixed.
  - The schema accepts `attrs { start?: positive int, type?: null }`, and the type is updated to match.
  - Projection keeps `start`, even when it is 1, and drops `type`.
  - Render emits `<ol start="3">`.
  - Tests cover `generateJSON` of `<ol>` and `<ol start=3>`, the schema cases (`start: 0` and `type: 'a'` rejected), projection and render. Each would fail on regression.
- The security Major (`rel` missing on upper-case or odd-scheme links) is fixed in two layers.
  - The schema canonicalizes valid hrefs with `new URL(s).href`, and `render.tsx` decides `isExternal` from the parsed protocol.
  - Tests cover the canonical forms (`HTTPS:`, `Mailto:`, tab, newline, control character) and the rendered `rel`. They also cover an internal link without `rel`, and a pasted `HTTPS://` link through the Tiptap extensions.
  - `packages/schema/src/fields/link.ts` makes the same change and has its own canonical-form test. The two copies are identical, and a comment in each file says to keep them in sync. I found no new problem there.
- The four Minors from round 1 are resolved.
  - Heading clamp: the test now asserts the text of a, b and c is kept and that h3 stays level 3.
  - Entry link and image attrs: the `Editor` round-trip test checks that the refs, alt and caption survive and that the output validates.
  - Pasted `<img>`: dropped, and the result validates.
  - `projectInline`: split into two clear early returns.
- The failing-first capture was partial, so I judged test strength from the code. Every new test asserts a specific outcome that the old code could not produce: the `attrs` rejection, the missing `rel`, the missing export and the non-canonical hrefs.

New findings:
- [Minor] quality: `packages/rich-text/src/tiptap.ts:56`: `(url as string | undefined) === undefined || isSafeHref(url)` is a cast that works around Tiptap's typing for entry links with no href. It is commented, but a one-line note on why `url` can be undefined (Tiptap's `renderHTML` still asks about entry links) would help. Optional.
- [Minor] quality: `packages/rich-text/src/doc-schema.ts` (`start: z.number().int().positive()`): I did not run this. A pasted `<ol start="0">` or `start="abc"` may make Tiptap emit `start: 0` or `NaN`, which the schema would reject. That would make the whole pasted doc invalid rather than just that list. It is an edge case, so optional: add a test showing the actual behaviour, or accept it and document it.
- [Minor] quality: `packages/rich-text/src/__tests__/entry-points.test.ts`: the import regex is textual and only follows relative specifiers. It is adequate for the current files. It would miss a dynamic import built from a variable, which is unlikely.

Security note: the `isSafeHref` and `canonicalHref` logic in `doc-schema.ts`, `link.ts` and `render.tsx` is security-relevant code. I suggest no changes to it.

---

## Controller ruling

PASS accepted. The three new Minors are deferred: the `tiptap.ts` comment and the `<ol start="0">` paste behaviour go to Task 24, the editor task that exercises pasting, and the textual import walker goes to C1.
