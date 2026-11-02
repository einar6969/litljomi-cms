# Task 14: security review, round 2 (fix diff)

- Reviewer: fresh `cms-security-reviewer` (Opus), fix round, 2026-11-02
- Fix diff: 8452545..e6dbcd8 (82d08f5, e6dbcd8) on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS
No full re-review needed. The fix is contained to the four rich-text source files and `link.ts`, and I re-probed every surface it touches.

Security review, fix round 2, Task 14. Commits 82d08f5 and e6dbcd8 (`git diff 8452545 e6dbcd8`) on `m1/lane-b`, worktree `/Users/einarzoega/litljomi-cms/.worktrees/lane-b`. `git status --porcelain` printed nothing before or after the review. The probes are in `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/probe-r2/`: `p.tsx` and `p.mjs` (bundled with the worktree's esbuild 0.28.2 and run under jsdom), plus the esbuild metafiles `meta.json` and `meta2.json`.

Tests: `pnpm vitest run --project rich-text` passed 6 files and 29 tests. `pnpm vitest run --project schema` passed 3 files and 17 tests.

**Round 1 Major: resolved.** This was `rel` missing on external links.
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/render.tsx:8-14` now decides externality from `new URL(href).protocol`. A probe rendered unnormalized hrefs straight through `RichText`, bypassing the schema. `HTTPS://x.is`, `ht\ttps://x.is`, `\u0001https://x.is` and `Mailto:a@b.is` all get `rel="noopener noreferrer"`. `/a` gets none.
- The schema also stores the canonical form, so every accepted href is fixed twice over.

**What you asked me to judge:**

1. **Allowing `undefined` in `isAllowedUri` (`packages/rich-text/src/tiptap.ts:57`): no unsafe href reaches the editor DOM.**
   - Tiptap Link's `renderHTML` (`@tiptap/extension-link/dist/index.js:412-430`) passes the href that will actually be rendered. `undefined` only means that no `href` attribute is emitted: the DOM is `<a target="_blank" rel="noopener noreferrer nofollow">t</a>`.
   - `parseHTML` checks `!href ||` first, so pasted HTML never reaches the `undefined` branch.
   - `HTMLAttributes` is `{}`, so nothing merges an href back in.
   - Probes: an editor loaded with `{href:'javascript:alert(1)'}` renders `href=""`. With both `javascript:` and an `entry` set, it renders `href=""`. `setLink({href:'javascript:…'})` returns false.
   - A new effect, not a security issue: `setLink({})` now succeeds and creates a link mark with neither `href` nor `entry`. The schema rejects that on save, so it fails closed. See the Minor below.

2. **Normalization opens no new bypass.**
   - I ran 23 inputs through both copies of the rule. Every accepted href:
     - keeps its protocol on re-parse;
     - is idempotent (`new URL(out).href === out`);
     - starts with `https://`, `http://` or `mailto:`.
   - Both copies produce the same output for every accepted input.
   - Examples:
     - `HTTPS:example.com` and `https:\\evil.com\x` become `https://…`.
     - `mailto:/..//evil.com` becomes `mailto:/.//evil.com`, still `mailto:`.
     - `Mailto:a@b.is?body=<script>` becomes `mailto:a@b.is?body=%3Cscript%3E`.
     - `https://a.is/%0a"><x>` is percent-encoded.
     - The bidi override in `mailto:‮evil` is percent-encoded.
     - `http://0x7f.1/` becomes `http://127.0.0.1/`.
     - IDN hosts become punycode, which is safer than before.
   - `javascript:` in a fragment (`https://a.is/#javascript:…`) and in a mailto path (`mailto:javascript:alert(1)`) stays under its outer scheme and is harmless.
   - Every rejected input returns `success: false` and does not throw. Zod 4 does not run the `.transform` after a failed `.refine`, so `new URL` is never called on bad input.
   - Credentials in the URL (`https://labak.is@evil.com`) are accepted, as they were before this fix. See the Minor below.

3. **The main-entry test is correct today, but weaker than a bundler check.**
   - Independent check: I bundled `packages/rich-text/src/index.ts` with esbuild and React external. The metafile has 100 inputs: the 5 own files (`doc-schema`, `plain-text`, `project`, `render`, `index`) and zod. None are `tiptap`, `prosemirror` or `linkify` inputs.
   - Control: bundling `src/tiptap.ts` gives 44 tiptap or prosemirror inputs.
   - `package.json` `exports` is exactly `"."` and `"./editor"`, which also blocks deep imports of `src/tiptap.ts`.
   - No code in the worktree imports `richTextExtensions` from the main entry.
   - The test's limits are a Minor below.

4. **`start` cannot carry anything unsafe.**
   - The schema is `z.number().int().positive().optional()` inside a `strictObject` with `type: z.null().optional()`.
   - It rejects 0, -1, 1.5, 1e21, 2^53+2, Infinity, `"3"`, `true`, `null`, `type:'a'` and extra keys.
   - Projection copies only the number (`project.ts` `orderedList` case). React renders it as a numeric attribute: `<ol start="3">`, and at most `start="9007199254740991"`.

**Checklist**

1. not applicable: no SQL or functions in the diff.
2. not applicable: no `api`, `cms` or `private` objects.
3. not applicable: no grants.
4. not applicable: no tables or policies.
5. not applicable: no tenant tables.
6. not applicable: no database functions.
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: no commit path.
9. not applicable: no release content decision.
10. pass: the diff stat lists only `packages/rich-text/**` and `packages/schema/src/{fields/link.ts,__tests__/fields.test.ts}`. There is no client, key or environment access.
11. not applicable: no markers.
12. not applicable: no cache wording.
13. pass: the round 1 contradiction is settled by decision 23 and spec §3.1 as revised (`docs/architecture.md:131`).
    - The dependencies are zod plus the MIT `@tiptap/*` packages.
    - The Tiptap configuration is exported only from `./editor` (`packages/rich-text/package.json` `exports`; `src/index.ts:13`).
    - The esbuild metafile confirms the main entry loads no Tiptap.
    - I found no new contradiction.
14. pass: `git diff 8452545 e6dbcd8 --stat | grep -c .claude` gives 0.

**Further findings**

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/tiptap.ts:57`: a non-string href makes the editor throw.
- **Observed:** with `href` set to `null`, `5` or `["javascript:alert(1)"]`, `isSafeHref` throws a TypeError (`null.trim`, `s.trim is not a function`) inside `renderHTML`, and the whole editor fails to mount.
- **Why Minor:** it fails closed, it predates this round, and only schema-invalid draft data can trigger it.
- **Suggested change:** `url === undefined || (typeof url === 'string' && isSafeHref(url))`.
- **Related, functional (for the Task 24 link dialog):** because `undefined` is now allowed, `setLink({})` succeeds and creates a link mark with neither `href` nor `entry`. The schema rejects it on save (probe: `safeParse` false).

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/__tests__/entry-points.test.ts:12-22`: the import-graph check is a regex walker, not a resolver.
- **Gaps:**
  - It records bare specifiers but does not follow them, so a package that pulls in Tiptap transitively would pass.
  - It misses `require(...)` and template-literal dynamic imports.
- **Today it is correct:** the esbuild metafile agrees, and the walker fails loudly on paths it cannot resolve.
- **Defence in depth:** assert over an esbuild metafile, or add an ESLint `no-restricted-imports` rule for `@tiptap/*` and `prosemirror-*` outside `src/tiptap.ts`.

[Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/doc-schema.ts:45-54` and `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/fields/link.ts:18-31`: URLs with credentials are accepted.
- **Observed:** `https://labak.is@evil.com` and `https://user:pass@evil.com/` are stored and rendered.
- **Why Minor:** normalization does not introduce this, and no spec requirement covers it. It is a phishing-shaped link only a tenant's own editor can create.
- **Option:** reject when `username` or `password` is non-empty.

[Minor, outside security scope; for the spec and quality reviewers] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/doc-schema.ts:89-95`: some pasted ordered lists still fail the schema.
- **Observed:** Tiptap parses pasted `<ol type="a">` and `<ol type="I" start="2">` to `type:"a"` and `type:"I"`. It parses `<ol start="0">`, `<ol start="-2">` and `<ol start="abc">` to `start` values 0, -2 and null.
- **Effect:** the schema rejects each one, so the whole document fails validation. This fails closed and is not a security issue, but it affects paste fidelity (Task 24, review focus 2).

**Unchanged and still deferred** (controller ruling, round 1):
- Resolver output is not checked. A resolved entry path of `//evil.com` still renders as `<a href="//evil.com">` with no `rel`. Deferred to the Task 15 and Task 18 security reviews.
- No depth cap. Deferred to Task 15, with Task 19 catching the exception.

---

## Controller ruling

PASS accepted. The Minors are deferred:
- **To Task 24 (the editor), all in the editor area:**
  - the non-string href throw in `isAllowedUri`;
  - `setLink({})` creating an empty link mark;
  - pasted ordered lists with `type` or a non-positive `start` invalidating the whole document. This is paste fidelity, the same area as the r2 combined review's Minor.
- **To checkpoint C1:**
  - the regex import walker, with the suggestion of an ESLint `no-restricted-imports` rule;
  - URLs with credentials (`https://user@host`). Rejecting them would narrow the accepted href rule, and that is Einar's decision.
