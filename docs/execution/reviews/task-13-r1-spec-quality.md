# Task 13: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02 (low tier; no security review: the diff touches none of the 14 checklist subjects)
- Change: a411e47 on `m1/lane-b` (worktree `.worktrees/lane-b`)
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major findings. The files, signatures and tests match the Task 13 text. The Minors below are for the controller to take or defer.

**Commands run (in the worktree):**
- `git show a411e47 --stat`
- `grep` and `sed` on the plan, to read the Task 13 and Task 15 text
- `pnpm vitest run --project schema`: the output was swamped by certificate "failed to copy trust settings" noise, so I did not read the test counts myself. I rely on your 16/16.
- `pnpm lint`: no errors in the output.
- `pnpm typecheck`: no errors in the output.
- `git status --porcelain`: empty, so the review left the tree clean.

**Spec compliance**
- All listed files exist: `package.json` with `@litljomi/cms-schema` and `zod@^4`, `index.ts`, `field-kind.ts`, `define-type.ts`, `extend-type.ts`, `ref.ts`, the three field files, `slugify.ts`, and the three test files.
- Signatures match:
  - `refSchema` and `Ref` as specified.
  - `FieldKind` has the required members.
  - `text`, `date`, `link`, `defineType`, `extendType`, `slugify` as specified.
  - `ContentType` has `draftValidator`, `publishValidator`, `queryColumns`.
  - `ProjectionContext` is declared.
- Behaviour:
  - Draft validation makes every field optional, checks types and strips unknown keys.
  - Publish validation enforces required fields.
  - `link` allows only `https:`, `http:` and `mailto:`, and uses strict objects so mixed shapes are rejected.
  - `slugify` follows decision 2 and matches the slug regex.
- The extra interface members are acceptable:
  - `FieldKind.withOptions`: needed. `extendType` must apply `fieldOverrides` (label and required) without mutating the base, and a copy needs the field's own options.
  - `ContentType.preview`, `orderBy`, `transforms`: needed. `queryColumns` and the later schema-version transforms read them, and the spread of `d` carries them through `extendType`.
  - `FieldOptionOverrides`, `TypeDefinition`, `AnyFieldKind`, `ExtendOptions` and the field option types are only type exports.
  - Empty `ProjectionContext`: matches "declared here, implemented in Task 15".
  - None of these contradicts a stated signature.
- Fit with Tasks 15 and 16:
  - Task 15's `image` and `richText` must implement `withOptions`, or `extendType` overrides on them fail. Task 16's LABAK type overrides the `image` and `body` labels, so this matters.
  - Task 15 should know about this requirement. It is not in the plan text.
- spec: [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/fields/link.ts:40`: `link.project` returns the stored value unchanged. Its type is `FieldKind<LinkValue, LinkValue>`, but `tsType()` (line 41) says `{ entry: EntrySummary | null }`. Task 15's test expects a link to an unpublished entry to project as null, and Task 15's file list does not include `link.ts`. Task 15 will have to edit `link.ts` and change the projected type. Fix now with a distinct projected type, or make sure Task 15's brief says to edit `link.ts`.
- spec: [Minor] Process deviation: the test-first order was reversed. Moving `index.ts` away produces a failing run, but that only shows the import fails. It does not show each assertion can fail. From reading the code, each claimed behaviour would fail on regression:
  - draft versus publish
  - `max` on publish and on draft
  - single-line text
  - unknown-key stripping
  - `javascript:`, `data:` and relative hrefs
  - mixed link shapes
  - non-existent dates
  - the `extendType` override, addition and non-mutation checks
  - the `extendType` error cases
  - the Icelandic mapping
- The deviation itself is a Minor process finding. If you want proof, have the implementer or controller run a mutation check on each rule.

**Quality**
- quality: [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/define-type.ts:4-29`: the `preview`, `orderBy` and `transforms` shape is written out twice, in `TypeDefinition` and in `ContentType`. Define it once, for example `ContentType extends TypeDefinition<F>`.
- quality: [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/field-kind.ts:3-7`: the doc comment and the line comment on `ProjectionContext` overlap. Merge them. The `{}` interface may also trigger lint. Lint passes, so this is only a note.
- quality: [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/define-type.ts:38`: the preview title and sort columns accept only non-empty strings. That is fine for `text` and `date`, but when Task 15 or 16 uses a non-string field for `orderBy` it silently yields null. A short comment would help.
- quality: [Minor] Test gaps, none of which hides a defect:
  - The draft schema for `date` is not tested. A cleared date sent as `''` fails the draft type check. That is probably intended; if the editor sends `''` for a cleared field, it breaks, so decide and test it.
  - `preview.media` is not tested.
  - `extendType` keeping `name`, `version` and `transforms` is not asserted.
  - The tests use `ext.fields.title?.label`, which is fine.
- quality: [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/ref.ts:8`: the double cast `as unknown as` is acceptable but hides the typing. Add a one-line comment saying why.
- Error handling in `extendType` is good: unknown overrides and duplicate extra fields throw clear errors.

**Security flag for the controller (a suggestion only, not a quality finding):** `isSafeHref` in `link.ts:16-23` relies on `new URL` and a trim check. WHATWG URL parsing strips embedded tabs and newlines. A value such as `"ht\ntps://x"` therefore passes validation while the stored string still contains the newline. This is not a protocol bypass, because the parsed protocol is checked, but the stored string is not normalized. Route any change to this check through the security review.

Files:
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/define-type.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/extend-type.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/field-kind.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/fields/link.ts`
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/ref.ts`

---

## Controller ruling

PASS accepted. The controller re-ran `pnpm vitest run --project schema` in the worktree: 3 files, 16 passed.

Deferred, to `deferred-minors.md`:
- **To Task 15**, which edits this package and whose brief will say so: `link.project` and its projected type (Task 15 edits `link.ts`); `image` and `richText` must implement `withOptions`; the duplicated `preview`/`orderBy`/`transforms` shape; the `ProjectionContext` comment; the `orderBy` comment; the `ref.ts` cast comment; the test gaps (draft `date` `''`, `preview.media`, `extendType` keeping `name`/`version`/`transforms`).
- **To checkpoint C1:** the reversed test-first order. No regression is hidden: the reviewer traced every claimed behaviour. Later Lane B briefs stress the order.
- **To Task 18's security review:** the href normalization note (stored string keeps embedded tabs or newlines). Task 18, the SDK and markers, is the first Lane B task with a security review; the rich-text renderer comes in Task 14. It is not a protocol bypass.
