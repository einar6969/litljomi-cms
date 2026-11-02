# Task 15: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02 (a security review ran in parallel)
- Change: e97329c on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Commands run in /Users/einarzoega/litljomi-cms/.worktrees/lane-b: `git show e97329c` (stat, source diff, test diff), `pnpm test` (17 files, 223 tests passed), `git status --porcelain` (clean). I also read plan Task 15, the deferred-minors rows owned by Task 15, and spec line 423 (§6.2 nullable references). I did not re-run lint, typecheck or check:slugs.

Files and interfaces:
- All files the task lists exist, with the names and signatures from the task text: `image`, `richText`, `PublicAsset`, `EntrySummary`, `ProjectionContext`, `projectEntry`, `ProjectionError`, `canonicalJson`, `contentHash`, `generateDeliveryTypes`.
- `projectEntry` runs the publish validator first and throws `ProjectionError`.
- `canonicalJson` and `contentHash` behave as specified. A test pins the hash `71669b86…ef9e`.
- Package dependencies follow decision 24: `schema` imports only the main entry of `@litljomi/rich-text`.

Deferred Minors owned by Task 15 are all cleared:
- **Task 13, `link.project` and `tsType`:** `link.project` now resolves entry references, and the projected type `LinkProjected` matches `tsType()`.
- **Task 13, `withOptions`:** `image` and `richText` implement it, and tests cover `extendType` overrides on both.
- **Task 13, quality items:** `ContentType extends TypeDefinition`, which removes the duplicated shape. The `ProjectionContext` comments no longer overlap, and the `queryColumns` and `ref.ts` cast comments are added. New tests cover draft `date` `''`, `preview.media`, and `extendType` keeping name, version, orderBy and transforms.
- **Task 14, resolver output:** `isRootRelativePath` and `isHttpsUrl` check resolver output, in both the rich-text projection and the schema's `resolveAsset` and `resolveEntry`.
- **Task 14, depth cap:** `RICH_TEXT_MAX_DEPTH` is checked iteratively before parsing.
- **Task 14, pruning:** emptied `listItem`, list and `blockquote` nodes are pruned, and the pruning rule is documented.

Points you asked me to judge:

1. **Link projection `{ entry: null }`.** I rate this a Minor spec deviation and ask the controller to ratify it.
   - The plan's literal assertions, `related: EntrySummary | null` and `.related` being `null`, cannot hold when `link` is the only entry-reference kind. `link` was already approved in Task 13 with `tsType` `{ href: string } | { entry: EntrySummary | null } | null`.
   - It satisfies the intent of spec §6.2 and line 423: the reference resolves to null and the delivery types mark it nullable.
   - The test was adapted to `toEqual({ entry: null })`, and the codegen test asserts the actual string. It is not a vacuous test.
   - Task 16 and the sites must treat `{ entry: null }` as "not published".
2. **`ContentType<F = any>`.** This is fine and the comment explains it. It does weaken type checking on `projectEntry` and `generateDeliveryTypes` inputs, but `unknown` was impossible because of the invariant `keyof F`. No finding.
3. **Extra exports.** `resolveAsset`, `resolveEntry`, `isRootRelativePath`, `isHttpsUrl` and `RICH_TEXT_MAX_DEPTH` are needed for the Task 14 security deferrals and for sharing the checks. They are small and justified. The security reviewer should confirm the URL checks.
4. **Image `alt`.** The per-use alt replaces the asset default even when empty. This matches the stored shape, which requires `alt: string`, and spec §5.6 ("alt per use"). An empty alt is a deliberate decorative image. The code comment says "replaces" but not "even when empty". No finding.
5. **`canonicalJson` and `contentHash`.** These match the task text, and the tests cover key order by code unit, `undefined`, arrays, escaping, the non-JSON rejections and the pinned hash.

Findings:
- [Minor] quality: packages/schema/src/content-hash.ts:21: `canonicalJson` silently serialises class instances such as `Date`, `Map` and `Set` as `{}`, so two different records can hash alike. Suggest rejecting objects whose prototype is not `Object.prototype` or `null`, with a test. Cyclic input would overflow the stack, which is acceptable for JSON-shaped data.
- [Minor] spec: packages/schema/src/__tests__/projection.test.ts and codegen.test.ts: the plan's literal expectations were adapted (point 1). Record the adaptation in the progress notes so Task 16 consumers see it.
- [Minor] quality: packages/schema/src/codegen.ts:41: duplicate type names in the input produce duplicate interfaces, and the function does not check for them. Suggest throwing on duplicates, or leave it to the registry.
- [Minor] quality: packages/schema/src/fields/image.ts:28: the comment should add "even when empty" to the alt replacement.

---

## Controller ruling

PASS accepted.

**Point 1, ratified.** Spec §6.2 requires only that a reference to an unpublished entry resolve to null in releases and that delivery types mark entry references as nullable. `{ entry: null }`, typed `{ entry: EntrySummary | null }`, satisfies both. The plan's literal assertion assumed a bare reference field, which this slice does not have. The plan wording goes to C1, and a note is added to `progress-notes.md` for Task 16 and the sites.

**Minors deferred:**
- the `canonicalJson` prototype check, with whatever the parallel security review says, to Task 16 unless that review rates it higher;
- duplicate type names in codegen to Task 16, which builds the registry;
- the `image` alt comment to Task 16.
