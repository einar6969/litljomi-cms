# Task 14: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02 (a security review ran in parallel; the controller added it for this low-tier task because it builds the public renderer and link rules)
- Change: 8452545 on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Commands run in /Users/einarzoega/litljomi-cms/.worktrees/lane-b: `git show 8452545` (stat and root config diffs), file reads of the package and tests, `pnpm vitest run --project rich-text` (5 files, 17 tests pass), `pnpm typecheck` (clean), `pnpm lint` (clean). I changed nothing. I did not re-run the failing-first step and did not check the evidence for it. I ran no database commands. The `failed to copy trust settings` lines in the output are sandbox noise.

**Spec compliance.** The task's files, interfaces and Step 1 behaviours are all present. Nothing is missing, and nothing contradicts §5.4 or §3.1.
- Files: the six sources and five test files are all there.
- Names and signatures match the task: `richTextDocSchema`, `toPlainText`, `RichTextResolver`, `projectRichText`, `RichText({ doc })`, `richTextExtensions()`.
- Runtime dependencies are exactly the task's list, with `react` as a peer dependency. Dev-only additions are react, react-dom, their types and jsdom.
- Step 1 behaviours:
  - The schema rejects a table, heading level 1, a `javascript:` link and an image without `alt`.
  - Plain text of two paragraphs is `"a\n\nb"`.
  - Projection drops an image with a null asset and unlinks an entry link with a null path.
  - Rendering `<script>` text is escaped (`&lt;script&gt;`).
  - Review focus 2: the pasted table plus `style` plus `<s>` case is checked for no `table`, `strike`, `style` or `color`, keeps "x" and "y", and validates against `richTextDocSchema`.
- The renderer has no `dangerouslySetInnerHTML`, and external links get `rel="noopener noreferrer"`.

**Points the controller asked about**
- **Root `tsconfig.json` change** (`lib: ["ES2023","DOM"]`, `jsx: "react-jsx"`): acceptable and minimal. The root tsconfig is the only typecheck config and typecheck is clean. Scoping it to the package would need a new tsconfig, which is more than the task asks. Adding DOM types to the whole check does weaken accidental-DOM-use detection in `packages/schema`. Noted, not a defect.
- **`vitest.workspace.ts` `rich-text` project with jsdom:** fine. jsdom is only needed by the render test and by Tiptap's `generateJSON`.
- **Duplicated `isSafeHref`:** acceptable. §3.1 forbids rich-text from depending on schema, so a documented copy is the right trade. Drift between the two copies is possible; see the Minor below.
- **Extra exports and structural choices:** all reasonable and consistent with Task 15. `isSafeHref` is exported from `doc-schema.ts` but not from `index.ts`. The extra types are needed by Task 15 and the renderer. The structural choices are sensible:
  - The doc needs at least one block.
  - A list item or blockquote holds any block.
  - Empty paragraph content may be omitted.
  - `text` must be non-empty.
  - Plain-text separators: `\n\n` between blocks, `\n` between list items and for a hard break.
- **Test strength:** each Step 1 behaviour is covered by an assertion that can fail, and the tests run against the real extensions, not mocks. The failing-first evidence is plausible, since every test file imports a module that did not exist before the commit.

**Findings (all Minor)**
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/tiptap.test.ts` "clamps pasted heading levels" only asserts that the output validates. It never checks that the text of `<h1>`/`<h4>` survives, or that `<h3>` stays a level-3 heading. A regression that dropped content would still pass. Suggest asserting the texts "a", "b" and "c" are present and the `<h3>` is `level: 3`. (The file is in `src/__tests__/`.)
- [Minor] quality: nothing tests that the `HubLink` and `HubImage` attributes match the schema, which the task asks for. Examples: an `entry` link attribute, or an image with `asset`/`alt`/`caption`, round-tripped through `editor.getJSON()` or `generateJSON` and then validated. `HubImage.parseHTML` returning `[]` (a pasted `<img>` is dropped) and `renderHTML` are also untested. Suggest one test that builds a doc with `entry` and `image` nodes and checks it against the schema and through the extensions.
- [Minor] quality: `src/project.ts`, `projectInline` has a convoluted first line: `if (n.type === 'hardBreak' || !n.marks) return n.type === 'hardBreak' ? n : { type: 'text', text: n.text };`. Split it into `if (n.type === 'hardBreak') return n;` followed by `if (!n.marks) return { type: 'text', text: n.text };`.
- [Minor] quality: `src/project.ts`, dropping an image can leave a `listItem` or `blockquote` with `content: []`. This renders an empty `<li>` or `<blockquote>`. Suggest pruning containers that become empty, and a test for it. The pruning rules are not specified by the task, so this could instead be left for the controller to decide.
- [Minor] quality: the `isSafeHref` copy in `doc-schema.ts` has no guard against drifting from `packages/schema/src/fields/link.ts`. A cross-package test would break the dependency rule, so the fix would be a pointer comment in both files. The rich-text copy already says "Same rule as the schema package's link field"; the schema copy does not point back.
- [Minor] quality: the `as unknown as z.ZodType<…>` and `z.lazy(...) as …` casts in `doc-schema.ts` are consistent with `ref.ts` in the schema package. They are acceptable, but the hand-written types and the Zod shapes are kept in sync by hand only. The schema tests cover the main shapes.

---

## Controller ruling

PASS accepted. Whether the six Minors are deferred or fixed depends on the parallel security review's outcome. If it needs a fix round, Minors in the same files may be fixed there. Otherwise they go to Task 15, which edits these packages.
