# Task 15: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent. The controller added it to this low-tier task because the task builds the projection and content hash, and it owns security items deferred from Task 14.
- Change: e97329c on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Security review, Task 15, round 1. Commit `e97329c` on `m1/lane-b`, worktree `/Users/einarzoega/litljomi-cms/.worktrees/lane-b`.

I found no Critical or Major finding, and five Minors. Both deferred security items from Task 14 are cleared: resolver output is now checked, and the nesting-depth cap makes `safeParse` fail instead of throwing.

**What I ran**
- `pnpm test`: 17 files, 223 tests, all pass.
- `pnpm lint`: exit 0. `pnpm typecheck`: exit 0.
- An esbuild probe, kept outside the repository at `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/t15/probe1.ts`.
- `git status --porcelain` is empty afterwards.

1. not applicable: the diff has no SQL and no functions. It touches only `packages/rich-text`, `packages/schema` and `pnpm-lock.yaml`.
2. not applicable: no change to `api`, `cms` or `private`.
3. not applicable: no grants.
4. not applicable: no tables or policies.
5. not applicable: no tables.
6. not applicable: no database functions.
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: the commit function is Tasks 9–11 and 19.
9. pass, as far as this task goes: the projection makes an unpublished reference null.
   - `packages/schema/src/projection.ts:60-70`: `resolveEntry` returns null when `ctx.entry` does.
   - Link field (`fields/link.ts:43-46`): projects `{ entry: null }`. No `_ref` or ID of the unpublished entry is delivered.
   - Rich text (`fields/rich-text.ts:21-24`, `rich-text/src/project.ts:49-50`): the link mark is removed, so no `_ref` remains.
   - Image (`fields/image.ts:29-33`): null.
   - Probe and tests: `projection.test.ts` gets `{ entry: null }` with an empty context.
   - Which entries a release contains, and what `ctx.entry` returns, are built in Task 20. See Minor 4.
10. pass: `git show --name-only e97329c` lists no `.env` file. A grep for `secret`, `SECRET` and `service_role` over the changed files finds nothing. Nothing is logged.
11. pass, as far as this task goes: `contentHash` is SHA-256 over `canonicalJson` of the projected record (`content-hash.ts:33-35`).
    - Resolved asset URLs and entry summaries are inside that record. `content-hash.test.ts` shows the hash changes when an asset URL changes.
    - Two different projections cannot produce the same string. Keys and strings are escaped with `JSON.stringify`, keys are sorted by UTF-16 code unit, and there are no duplicate keys. Probe: `{"":4,"z":3,"😀":2,"￿":1}`.
    - `undefined` values are dropped and `-0` becomes `0`, exactly as `JSON.stringify` does, so the hash follows what a site receives.
    - NaN, Infinity, BigInt, functions and cycles throw. Cycles throw a `RangeError`.
    - Non-plain objects are not rejected; see Minor 1.
    - The markers themselves are Tasks 18 and 21.
12. not applicable: the diff adds no editor text.
13. pass: no contradiction with the spec.
    - `packages/schema` imports only `@litljomi/rich-text`'s main entry: `projection.ts:2`, `fields/rich-text.ts:1`, and a string in the `codegen.ts` prelude. Nothing imports `/editor`. This matches decision 24 and the revised §3.1.
    - For the controller: decision 24 and the §3.1 revision (`5631b50`) are on `m1/phase-1` and not yet in `m1/lane-b`. The worktree's copy of `docs/architecture.md` §3.1 still says schema may depend on "Zod" only. That is a branch-sync matter, not a contradiction.
14. pass: the diff does not touch `.claude/**`.

**Deferred items from Task 14**

*Resolver output (cleared).*
- `rich-text/src/safe-url.ts:7-23` checks it, and so do `projection.ts:42-70` and `project.ts:50,82`.
- Probe results against `isRootRelativePath`:
  - Rejected: `//evil.com`, `/\evil.com`, `\/evil.com`, `/\\evil`, `/\t/`, `/\n/`, `/\r/`, `/\0/`, DEL, `/x\v`, leading or trailing space, `javascript:`, `data:`, `https://…`, empty string, `frettir/x`.
  - Accepted: `/..//evil.com`, `/a/../../evil.com`, `/%2f/…`, `/%5c/…`, and paths with NBSP, U+2028, U+FEFF, U+3000 or U+FF0F. Every one of them resolves to the same origin when parsed against `https://site.is/a/b`.
- `isHttpsUrl` rejects `http:`, `data:`, `javascript:`, `blob:`, `//host`, `/a`, `https://` with no host, and anything with whitespace or control characters. See Minor 2.
- `resolveAsset` and `resolveEntry` return copies with exactly the interface fields. Probe: the extra fields `original_path`, `signed`, `draft` and `focal.z` are all stripped.

*Depth cap (cleared, for the validator paths).*
- `doc-schema.ts:117-140` is iterative, and Zod's pipe stops after a failed refine.
- Probe results: `safeParse` returns `false` without throwing for:
  - 3,000 and 100,000 nested blockquotes;
  - 5,000 nested lists;
  - 100,000-deep nesting under `heading.attrs`, `link.attrs.href` and `text.text`;
  - 100,000-deep nested arrays in `content`;
  - a cyclic document.
- A document 200,000 blocks wide passes in 145 ms.
- `projectEntry` with a 100,000-deep document throws `ProjectionError`, not a `RangeError`. The draft validator returns `false`.
- See Minor 3 for the paths that skip the validator.

**Codegen injection: no finding.**
- Type names must match `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Probe: `a{}` throws.
- A field key that is not an identifier is emitted as a JSON string. Probe: `a"; } export const x = 1; interface Z {` stays inside a quoted property name.
- Labels are never emitted, and `tsType()` comes from field-kind code.

**Projection leaks: no finding.**
- The publish validator strips unknown top-level keys. Image, link and rich-text shapes are strict.
- `projectEntry` iterates only `type.fields`. No draft, private-path or internal fields reach the output.

**Minor findings**
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/content-hash.ts:17-22`: `canonicalJson` accepts non-plain objects and sparse arrays.
  - It serialises a Date as `{}` (so `new Date(0)` and `new Date(1)` hash the same), a Map as `{}`, `new String('ab')` as `{"0":"a","1":"b"}`, and `[1,,2]` as `[1,,2]`, which is not JSON.
  - It also ignores inherited `toJSON`. `JSON.stringify` differs on all of these, so if such a value ever reached a bundle, the site would receive something the hash does not cover.
  - Why Minor: nothing reaches this today. Projected values are Zod output from JSON plus copies made by the resolvers.
  - Fix: throw unless the prototype is `Object.prototype` or null, and treat holes like `undefined`.
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/safe-url.ts:15-23` and `packages/schema/src/projection.ts:42-53`: the asset URL is checked but delivered in its raw form, not canonicalised.
  - `https:m.test/a` and `https:/evil.com` pass. Node parses them to the host `m.test` or `evil.com`, but a browser resolves them against the page as same-origin paths, for example `https://site.is/a/m.test/a`.
  - `https://user:pw@host` is also accepted.
  - The scheme is always `https:`, so there is no exposure, and the resolver is platform code (Task 20).
  - Fix: deliver `new URL(s).href` and reject URLs with credentials, as hrefs already are.
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/rich-text/src/project.ts:91-114`, `render.tsx`, and `FieldKind.project`: the depth cap runs only inside the validator.
  - Probe: calling `richText(...).project(doc100000deep, ctx)` directly throws `RangeError: Maximum call stack size exceeded`.
  - `projectEntry` always validates first, and `RichText` receives already-projected documents from validated releases, so no current path skips the cap.
  - The deferred row already gives Task 19 the job of catching exceptions. Task 20 and preview should also project only through `projectEntry`.
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/projection.ts:31-36`: the `ProjectionContext.entry` doc says "null when it is not published (spec §6.2)".
  - It does not state §7.1's exact predicate: included if and only if `published_rev_id IS NOT NULL AND archived_at IS NULL`.
  - Stating it here would keep Task 20's context implementation tied to the withdrawal rule.
  - Wording only; nothing is exposed today.
- [Minor] `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/define-type.ts:31-37`: field keys are not validated, and there is no lint rule enforcing decision 24.
  - Probe: a field named `__proto__` is dropped silently from the validator, the projection and the hash, consistently, while `out`'s prototype is set.
  - There is no ESLint rule that stops `packages/schema/**` from importing `@litljomi/rich-text/editor`. The grep shows no such import today, and §3.1's "Enforced in CI" list does not require one.
  - Both are module-author inputs, with no current exposure.

---

## Controller ruling

PASS accepted. The branch-sync note is handled: `m1/phase-1` is merged into `m1/lane-b` before Task 16, so the worktree gets decisions 23 and 24 and the revised §3.1.

The Minors are deferred:
- **To Task 16:**
  - the `canonicalJson` prototype and sparse-array check, together with the same Minor from the combined review;
  - field-key validation in `defineType`;
  - an ESLint rule that `packages/**` and `modules/**` import `@litljomi/rich-text/editor` nowhere.
- **To Task 20:**
  - delivering canonical asset URLs and rejecting credentials;
  - stating the §7.1 inclusion predicate in `ProjectionContext.entry`'s documentation and implementing it there;
  - projecting only through `projectEntry`.
- **To Task 19 (existing row):** catching projection exceptions.
