# Task 14: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent. The controller added it to this low-tier task because the task builds the public renderer and link rules.
- Change: 8452545 on `m1/lane-b`
- The reviewer's report, verbatim:

---

FAIL

Security review, round 1, Task 14 (commit 8452545, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-b). There is one Major finding, the missing `rel` on some external links. Nothing reaches XSS. The worktree is still clean: `git status --porcelain` printed nothing after the review.

**How I tested.** I ran `pnpm vitest run --project rich-text`: 5 files and 17 tests passed. I also bundled two probe scripts with the repository's esbuild into /private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/probe/. They import the worktree sources directly and run the schema, `projectRichText`, `RichText` (through `renderToStaticMarkup`) and `generateJSON(html, richTextExtensions())` under jsdom.

1. not applicable: the commit has no SQL or functions.
2. not applicable: no `api`, `cms` or `private` objects.
3. not applicable: no grants.
4. not applicable: no tables or policies.
5. not applicable: no tenant tables.
6. not applicable: no database functions.
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: no commit path.
9. not applicable: no release content decision.
10. pass: `git show 8452545 --stat` lists only `packages/rich-text/**`, `pnpm-lock.yaml`, `tsconfig.json` and `vitest.workspace.ts`. There is no Supabase client, key or environment access in `packages/rich-text/src`.
11. not applicable: no markers.
12. not applicable: no editor text about caches.
13. pass, with one possible contradiction for the controller (not rated as a security failure):
   - Spec §3.1 says `packages/rich-text` "May depend on: none (React as peer)". The `packages/schema` row of the same table lists third-party dependencies ("Zod").
   - The plan's Task 14, and therefore `packages/rich-text/package.json:14-21`, adds `zod`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link` and `@tiptap/extension-image`.
   - `src/index.ts` exports `richTextExtensions` from the same entry point that sites import for `RichText` (§3.1: sites depend on `rich-text`), so sites pull Tiptap into their dependency graph.
   - Plan and spec may disagree here. I did not resolve it.
14. pass: the diff touches nothing under `.claude/**` (`grep -c .claude` on the stat gives 0).

**Probe results behind the findings below.**
- **Stored `href` (schema):** `richTextDocSchema` rejected all of these: `javascript:`, `JaVaScRiPt:`, a leading space, `java\tscript:`, `java\nscript:`, `\u0001javascript:`, `javascript&colon;`, `data:text/html,…`, `vbscript:`, `//evil.com`, `/x`, `file:` and a bidi-override host.
- **Attribute injection:** `http://a"onmouseover="…` renders as `href="http://a&quot;onmouseover=&quot;…"`, so React escapes it.
- **Pasted HTML:** `generateJSON` dropped `<script>`, `<iframe>`, `<style>`, `<img onerror>`, `onclick`, `style`, `target`, `rel`, `class`, `id`, `<u>`, `<sub>`, `<mark>` and `<span style>`. It also dropped every unsafe link variant above, keeping only the text. A pasted `entry` attribute is ignored.
- **Text, `alt` and caption:** escaped. `alt='"><script>'` gives `alt="&quot;&gt;&lt;script&gt;"`, and the caption `<img onerror>` comes out as escaped text.
- **Schema strictness:** it rejects an extra key in `_ref`, the wrong `_kind`, a non-UUID `_ref`, a link carrying both `href` and `entry`, an entry link with `_kind` `asset`, attrs on `hardBreak`, attrs on `doc`, `src` on `image`, `listItem` or `text` at the top level, empty text, and an own `__proto__` key.
- **Raw HTML:** there is no `dangerouslySetInnerHTML` in `src`. The only `innerHTML` is in the test helper.
- **Editor rendering:** Tiptap Link's `renderHTML` (`@tiptap/extension-link/dist/index.js:412-430`) blanks any `href` that fails `isAllowedUri`, which is `isSafeHref` here. Crafted stored data therefore cannot put a script link into the editor DOM, and `openOnClick` is false.
- **Licences:** every `@tiptap/*` package (3.32.2), every `prosemirror-*` package, `linkifyjs`, `orderedmap`, `rope-sequence` and `w3c-keyname` is MIT. There is no `@tiptap-pro` package and no Tiptap Pro registry in `pnpm-lock.yaml`. Non-MIT licences appear only in the dev-only jsdom chain.

**Further findings**

[Major] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/render.tsx:6`: `rel="noopener noreferrer"` is missing on some external links.
- **Cause:** `isExternal = /^(https?:|mailto:)/` matches the raw string, case-sensitively. `isSafeHref` (`doc-schema.ts:42-49`) accepts any string whose WHATWG-parsed protocol is allowed, and stores it unnormalized.
- **Effect:** these external links render without `rel`, which the task requires:
  - `HTTPS://example.com` gives `<a href="HTTPS://example.com">t</a>`
  - `Mailto:a@b.is`
  - `ht\ttps://example.com`
  - `\u0001https://example.com`
- **Reachable by paste:** `<a href="HTTPS://Example.com" onclick=… style=…>` turns into `{"href":"HTTPS://Example.com"}`, which validates and renders without `rel`.
- **Rating:** with no `target`, the practical exposure is referrer leakage, not reverse tabnabbing. Still, a stated security requirement of the task is not met, and `render.test.tsx` only checks lower-case `https://`, so I rate it Major.
- **Fix:** decide externality from `new URL(href).protocol`, or store the normalized `new URL(s).href` in the schema, or both.

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/doc-schema.ts:42-49` and `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/fields/link.ts:16-23`: verdict on the deferred `isSafeHref` note.
- **No protocol bypass:** browsers use the same WHATWG parser, so a stored string that parses to `https:`, `http:` or `mailto:` navigates as that protocol. Every encoded, case, whitespace, tab/newline and C0 variant of `javascript:`, `data:` and `vbscript:` is rejected.
- **But the stored value is not canonical:** tabs, newlines, C0 characters and upper-case schemes survive. Any consumer that checks prefixes on the string (this renderer, sites' own code, feeds) can misclassify it, and the Major above is that failure.
- **Recommendation:** normalize to `new URL(s).href` at validation time, in both copies of the rule.

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/project.ts:47-48,67-72`: resolver output is not checked before rendering.
- **What happens:** `entryPath()` and `asset().url` pass through unchecked. With an entry path of `//evil.com` the result is `<a href="//evil.com">`, with no `rel`. With `data:text/html,x` the result is `<a href="data:…">` and `<img src="data:…">`. A `javascript:` path is neutralised only because React 19 replaces it (`javascript:throw new Error('React has blocked…')`).
- **Why Minor:** the resolver is trusted platform code from later tasks, so nothing is exposed today.
- **Defence-in-depth:** require entry paths to be root-relative (`/` but not `//` or `/\`) and asset URLs to be `https:`, or check this in the renderer. Recommend that the Task 15 and 18 reviews check it.

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/doc-schema.ts:73-98`: deep nesting makes the validator throw instead of failing.
- **Observed:** a document nested about 3,000 `blockquote`s deep (about 100 KB, well under the 1 MB draft limit) makes `richTextDocSchema.safeParse` throw `RangeError: Maximum call stack size exceeded` instead of returning `success: false`. `projectRichText` and `RichText` recurse the same way.
- **Impact:** the write still fails closed, and only the editor's own tenant can be affected. Data crafted through the API could still make the save, publish or worker path throw instead of returning a validation error.
- **Recommendation:** add a depth cap. Task 15 and 19 should catch the exception.

[Minor, outside security scope; for the spec and quality reviewers] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/tiptap.ts:41-50` against `doc-schema.ts:81`: the editor produces ordered lists the schema rejects.
- **Observed:** Tiptap's `orderedList` always emits `attrs: {start, type}`. A plain `<ol><li><p>x</p></li></ol>` gives `{"type":"orderedList","attrs":{"start":1,"type":null},…}`, which `richTextDocSchema` rejects, so no ordered list from the editor or from a Word paste can validate.
- **Effect:** this fails closed, so it is not a security issue, but it affects review focus 2 (Task 24).

The only files that matter are under /Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/: `render.tsx`, `doc-schema.ts`, `project.ts` and `tiptap.ts`.

---

## Controller ruling

**FAIL accepted, on the Major.**

**Contradiction (item 13), confirmed by the controller.** Spec §3.1 gives `packages/rich-text` "May depend on: none (React as peer)". The plan's Task 14 lists `zod` and five Tiptap packages as dependencies, and the implementation follows the plan. The spec wins, so the controller stops and reports to Einar (CLAUDE.md; Einar's stop conditions). Task 14 is blocked and Lane B waits for his ruling.

**Ordered lists.** The editor emits ordered lists that the schema rejects. The reviewer rated this outside its scope. The controller treats it as a functional defect: the combined review missed it, and under the ratings a wrong behaviour is Major. It belongs in the Task 14 fix round.

**After Einar's ruling,** the fix round covers:
- the `rel` Major;
- the ordered-list defect;
- `href` normalization in both copies of the rule, the reviewer's recommendation for the deferred `isSafeHref` note;
- whatever the dependency ruling requires.

**Deferred:**
- the resolver-output checks, to the Task 15 and Task 18 security reviews;
- the depth cap, to Task 15, with Task 19 catching the exception.
