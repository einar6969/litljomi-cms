# Task 16: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent. The controller added it to this low-tier task for the ESLint boundary rules, the canonical-UUID references of decision 25, `canonicalJson`, the field-key validation and the lockfile pruning.
- Change: 11b7c93 on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Security review, round 1, of Task 16 (commit 11b7c93 on m1/lane-b, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-b). No Critical or Major findings. Six Minors, listed under the items and at the end.

Commands run in the worktree (output shown after each):
- `pnpm lint`: exit 0.
- `pnpm check:slugs`: "check:slugs ok, roots scanned: packages, roots absent: apps/cms/src, 2 tenant slug(s) checked".
- `pnpm typecheck`: clean.
- `pnpm test`: 21 files, 301 tests passed.
- Two probes, both kept in the scratchpad: an ESLint `lintText` probe (/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/probe-eslint.mjs) and a Vitest probe run with `--root` set to the scratchpad (/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/vt/probe.test.ts).
- `git status --porcelain` is empty at the end.

1. not applicable: the diff has no SQL, migrations or functions.
2. not applicable: no `api`, `cms` or `private` objects in the diff.
3. not applicable: no grants in the diff.
4. not applicable: no tables or policies in the diff.
5. not applicable: no tables in the diff.
6. not applicable: no database functions. Module `checks` take no tenant input.
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: no commit path in the diff.
9. pass: `labak.site.news.checks` and `demo.site.event.checks` (modules/labak/src/index.ts:36-48, modules/demo/src/index.ts:33-39) decide present or absent only from the `ReleaseView` they are given. The release is built from the database's published state; the modules keep no publish state of their own. Unpublishing uses the previous release only to decide whether the home page was showing the entry.
10. pass: the secret-key and privileged rules are still in the `packages/**` and `modules/**` blocks (eslint.config.mjs:125-126 and 132-133). `noInlineConfig: true` is unchanged (line 107). Probe results:
   - `process.env.SUPABASE_SECRET_KEY` in modules/labak and in packages/schema is flagged by `no-restricted-syntax`.
   - Importing `../../../apps/cms/src/privileged/admin` from a module is flagged twice, by the app rule and the privileged rule.
   - `// eslint-disable-next-line` before a module import has no effect (ESLint's noInlineConfig note), and the import is still flagged.
   - No secret appears anywhere in the diff.
11. pass (limited scope): `LiveCheck` is `{ path, expect }` only (packages/schema/src/module.ts:18). Nothing treats a release marker as proof; the marker and hash checks belong to Task 21. The checks match §7.4:
   - present: own path, `/frettir`, and `/` when the entry is among the release's first 6;
   - absent: the same pages, using the previous release's position for `/`.
   Paths are built from DB slugs, which are constrained to `^[a-z0-9]+(?:-[a-z0-9]+)*$` (supabase/migrations/20261102000300_content.sql:17). A null slug throws.
12. not applicable: the only editor-visible text is field and type labels. None of it promises removal from caches.
13. pass, with two contradictions reported and not fixed:
   - [Minor] tools/checks/__tests__/eslint-boundaries.test.ts:360-363 asserts that `modules/**` may import `@litljomi/rich-text`'s main entry. Spec §3.1 allows modules only `schema` and core extension-point types. Nothing imports it today; the modules' package.json files list only `@litljomi/cms-schema`.
   - Decision 25's database layer (`private.extract_refs`, the 22P02 rule) does not exist on any local branch yet (Task 7 is not done). I could only compare the regex with the decision text. It matches: lowercase 8-4-4-4-12 with no version or variant check, so the nil UUID is accepted. Task 7 must use the same rule, neither stricter nor looser.
14. pass: `git show --stat 11b7c93` lists no `.claude/**` path.

Checks you asked for:

- **Decision-25 regex** (packages/rich-text/src/doc-schema.ts:61, used by packages/schema/src/ref.ts:11 and packages/schema/src/fields/image.ts:15). The probe ran the same inputs through `canonicalUuid`, `refSchema('entry')`, the image draft schema and a rich-text link mark. Every layer rejected all of these:
   - upper case and a single upper-case letter;
   - braces; unhyphenated; a misplaced hyphen; a 13-digit last group; a non-hex `g`; a full-width `ａ`;
   - leading or trailing space, `\n`, `\r`, U+2028 and NUL;
   - `urn:uuid:`;
   - `null`, `undefined`, a number, `{}`, `[uuid]` and a boxed `String`.
   The canonical form and the nil UUID are accepted. JavaScript `$` without the `m` flag does not match before a trailing newline, and that case is covered.
- **canonicalJson** (packages/schema/src/content-hash.ts). Compared with `JSON.stringify`, the results agree for:
   - symbol keys and non-enumerable properties (both dropped);
   - an own `__proto__` key from JSON.parse;
   - getters, `toJSON` that is not a function, extra non-index properties on arrays, a polluted `Object.prototype`, holes and `undefined` in arrays.
   `toJSON` as a function (plain or null-prototype object) throws, as do Date, Map, Set, boxed primitives, class instances, typed arrays and objects with the Array prototype. Throwing is the safe direction. The two divergences are in the Minors below.
- **defineType field keys**: `__proto__`, `constructor`, `valueOf`, `__defineGetter__`, `__lookupGetter__`, `isPrototypeOf`, `toLocaleString` and `propertyIsEnumerable` are all rejected, and so are the unicode keys `ﬁ`, `İ` and `a`+U+200B. `extendType` goes through `defineType` (packages/schema/src/extend-type.ts:24), so extra fields are checked too. One gap is in the Minors below.
- **Lockfile**: the only added lines are the `modules/demo` and `modules/labak` importers (each a link to packages/schema) and the vitest snapshot key without `happy-dom`. The removed packages were:
   - `happy-dom@21.0.4`, which was only an optional peer of vitest;
   - `ws`, `entities@7.0.1`, `buffer-image-size`, `@types/ws`, `@types/whatwg-mimetype` and `whatwg-mimetype@3.0.0`, all marked `optional: true` and depended on only by happy-dom.
   No package.json on any commit has ever named happy-dom (`git log -S happy-dom` on *.json, *.ts and *.mjs is empty; `git grep happy-dom` outside the lockfile is empty). It entered the lockfile in 8452545 (Task 14) as peer drift. `@tiptap/html` was never in Git history. Its leftover copy in node_modules/.pnpm is local install residue and is not in the lockfile. Nothing new was added.

Further findings, all Minor:

- [Minor] eslint.config.mjs:25-28: the new module-to-module rule misses the most natural relative form. From modules/labak/src/x.ts, these all lint clean:
   - `import m from '../../demo/src/index'`
   - `import m from '../../demo'`
   - `import('../../demo/src/index.ts')`
   - `export * from '../../demo/src/index'`
   - `import '../../demo/fixtures/event.json'`
   The rule only matches `@litljomi/module-*` or a path containing `modules/`, and the test's relative case (`../../../modules/demo/...`) is contrived. It still catches `@litljomi/module-*` imports and re-exports, including `import type`. Rated Minor rather than Major because:
   - neither the task nor the CI-enforced list in §3.1 requires this rule;
   - no module imports another today;
   - module code crosses no data or credential boundary.
   A fix would also restrict `^\.\./\.\./[^.]` relative paths, or resolve the import against the file's own module root.
- [Minor] eslint.config.mjs:22: the editor rule can be bypassed with a redundant `./` segment. `import { x } from '../../rich-text/src/./tiptap'` from packages/schema lints clean. The package-name forms, deep paths, `.tsx`, `export … from` and `import type` are all caught, and the `exports` map only exposes `.` and `./editor`. The real guarantee for sites, that the main entry never loads Tiptap, is enforced separately by packages/rich-text/src/__tests__/entry-points.test.ts. No current exposure.
- [Minor] packages/schema/src/content-hash.ts:22: `Array.from(v, fn)` follows `Symbol.iterator`, while `JSON.stringify` reads `length` and indices. An array with its own or overridden iterator therefore hashes differently from what JSON delivers. Probe: `[1,2]` with an own iterator yielding 9 gave canonical `[9]` against JSON `[1,2]`; an Array subclass gave the same mismatch. Also, a Proxy whose `getPrototypeOf` trap lies passes the plain-object check (canonical `{}` while `JSON.stringify` throws). Hashed records are projected from JSON-parsed database data, so there is no current exposure. An index-based walk fixes the first point: `Array.from({ length: v.length }, (_, i) => v[i])`.
- [Minor] packages/schema/src/define-type.ts:43: a literal `__proto__:` key (not computed) in a `fields` object literal sets the object's prototype instead of creating a field. `Object.keys` never sees it, so the field is dropped silently instead of rejected. Probe: `{ title, __proto__: text(...) }` was accepted with keys `title` only. Module code is developer-written, so there is no exposure. A check that `Object.getPrototypeOf(d.fields)` is `Object.prototype` or `null` would close it.
- [Minor] tools/checks/__tests__/eslint-boundaries.test.ts:360-363: the §3.1 contradiction listed under item 13.

Files reviewed: /Users/einarzoega/litljomi-cms/.worktrees/lane-b/eslint.config.mjs, packages/rich-text/src/doc-schema.ts, packages/schema/src/{content-hash.ts,define-type.ts,ref.ts,fields/image.ts,module.ts,library/news.ts}, modules/{labak,demo}/src/index.ts, pnpm-lock.yaml, tools/checks/__tests__/eslint-boundaries.test.ts (all under the worktree).

---

## Controller ruling

**PASS accepted.** The lockfile pruning is confirmed as stale optional-peer drift.

**Item 13 (a).** The lint test permits `modules/**` to import `@litljomi/rich-text`'s main entry, which §3.1 does not allow. This is an enforcement gap, not a violation: no module imports it, and the code matches the spec. It is Minor and deferred to Task 17, which touches lint: forbid it and fix that test.

**Item 13 (b).** The controller is passing the "same rule, nil UUID included" note to Task 7.

**Other Minors:**
- Deferred to Task 17: the relative module-to-module forms, and the `./` segment in the editor rule.
- Deferred to Task 18, which is next in Lane B and touches `packages/schema`: the iterator-based array walk and the Proxy prototype in `canonicalJson`, and the literal `__proto__` field.
