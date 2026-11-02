# Task 18: security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02, independent (medium tier: security review required)
- Change: 5313a5b and 41515f0 on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

Security review, Task 18, round 1. Commits 5313a5b and 41515f0 on `m1/lane-b`, diff `11b7c93..41515f0`, worktree `/Users/einarzoega/litljomi-cms/.worktrees/lane-b`.

I found no Critical or Major issue. There are 8 Minors, listed below.

**What I ran:**
- `pnpm exec vitest run --project sdk --project schema`: 12 files, 109 tests, all pass.
- `pnpm lint`: exit 0.
- `pnpm typecheck`: passes.
- Two probe scripts in the scratchpad (`p1.mts`, `p2.mts`). They import the worktree sources and write nothing to the worktree.
- `git status --porcelain` in the worktree is empty after the review.

**Checklist**

1. not applicable: the diff has no SQL and no database functions.
2. not applicable: nothing changes the schemas or what is exposed.
3. not applicable: no grants change.
4. not applicable: no tables or policies change.
5. not applicable: no tenant tables change.
6. not applicable: no database functions. In the client, the tenant comes from site configuration, and the pointer must name the same tenant (`client.ts:39`).
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: no commit path.
9. not applicable: release content is decided by the worker (Task 20). The SDK client reads only the current pointer and the bundle it names (`client.ts:37-43`). It has no fallback to earlier releases.
10. pass:
   - The SDK has no Supabase key, `process.env` read or logging. `grep -rniE "supabase|service_role|SECRET_KEY|sb_secret|console\.|process\.env" packages/sdk/src packages/sdk/package.json` finds nothing.
   - The secret-key ESLint rule covers `packages/**` (`eslint.config.mjs:123-126`), and lint passes.
   - The handler's responses contain no secret or signature: `{revalidated:false}` on failure, `{revalidated:true, at}` on success (`revalidate-handler.ts:569,584`). The test at `revalidate-handler.test.ts:307-314` checks this.
   - Webhook secrets come in through a site callback and never leave the process.
   - Spec §3.1 "none (Next.js as peer)": the only import outside the package is `node:crypto`. `package.json` has peers `next ^15 || ^16` and `react ^19`, and only dev dependencies otherwise.
   - Lockfile additions:
     - The new packages are next 16.4.3 and its tree: `@next/env`, `@next/swc-*`, `@swc/helpers`, `sharp` 0.35.5 and `@img/*`, `styled-jsx`, `postcss`, `caniuse-lite`, `baseline-browser-mapping`, `client-only`, `detect-libc`, `tslib`, `@emnapi/runtime`, `@img/colour`.
     - No added line has a tarball, git, http, file or link source.
     - None of the installed packages has a `preinstall`, `install`, `postinstall` or `prepare` script. I checked each `package.json` in `node_modules/.pnpm`.
     - `allowBuilds` in `pnpm-workspace.yaml` is unchanged.
     - The importer section lists `next` under `dependencies`. That is pnpm's record of an auto-installed peer; the published `package.json` keeps it as a peer.
   - Webhook verification:
     - The HMAC is SHA-256 over `${ts}.${body}`, as hex.
     - The signature must match `^[0-9a-f]{64}$`. It is compared with `timingSafeEqual` on equal-length 32-byte buffers, and every secret is checked with no early exit (`webhook.ts:625-633`).
     - Empty or non-string secrets are skipped. Duplicate secrets are harmless, and an empty list or unset values return 401.
     - The timestamp must be a non-negative safe integer within 300 s either way. A negative, NaN or Infinity tolerance or `nowSeconds` fails closed.
     - The handler accepts at most 15 digits in the timestamp header, so there is no overflow. Duplicate timestamp or signature headers (joined as "a, b") return 401.
     - The verifier wraps everything in try/catch and returns false; it never throws.
   - Probes, all as expected: negative tolerance → false; NaN `now` → false; Infinity tolerance → false; `[null,'s']` → true; secrets passed as a string → false; uppercase or padded signature → false; timestamp passed as a string → false; future +300 → true, +301 → false.
   - Replaying a captured request within the 5-minute window is possible. The spec accepts that, and the only effect is an idempotent `revalidateTag('cms')`.
   - Minor 10a, `revalidate-handler.ts:574`: the verifier checks `req.text()`, the UTF-8-decoded string, not the exact raw bytes. Probe: prefixing a UTF-8 BOM to a signed body still returns 200, and invalid byte sequences collapse to U+FFFD. The handler ignores the body, so nothing is affected. Verifying `arrayBuffer()` bytes would make the guarantee exact.
   - Minor 10b, `revalidate-handler.ts:573-575`: any request with a numeric timestamp header makes the handler read the whole body and compute an HMAC per secret before the cheap checks (tolerance, signature format) run. This is an unauthenticated work amplifier, bounded by the platform's body limit. Check the tolerance and signature format before reading the body.
   - Minor 10c, `revalidate-handler.ts:579`: if the `secrets()` callback throws, the exception propagates and the framework returns 500 (probe: "env missing"). No secret is exposed. A 401 or 500 that the SDK controls would be tidier.
11. pass:
   - `CmsEntryMarker` renders `<span hidden data-cms-entry data-cms-hash>` exactly as the plan states (`markers.tsx:483-485`).
   - `parseEntryMarkers` reads only `span` tags with both attributes. It ignores `meta`, so a release marker can never be taken for an entry marker (probe `metaRelease` → []).
   - `CmsReleaseMarker` and `parseReleaseMarker` are documented as diagnostic only, and nothing in the SDK treats them as proof.
   - Attribute order does not matter. Duplicate attributes keep the first value, as browsers do. Uppercase tag and attribute names work. React's escaping (`&quot; &amp; &#x27; &lt; &gt;`) round-trips, as the test shows. Text escaped by React (`&lt;span …&gt;`) is not parsed as a marker.
   - A stale page cannot contain the new hash, because the hash exists only in the new bundle. So a `present` check cannot be satisfied by stale data.
   - The SDK cannot stop a site from rendering a marker away from the entry's content. Spec §7.3 places that duty on the site, and the Task 26–27 reviews cover it. This is not a finding against Task 18.
   - Minor 11a, `parse-markers.ts:499,516`: the regex scanner accepts markers in places a browser does not render as elements. Probes return `[{id:'e',hash:'h'}]` for markers inside `<!-- … -->`, inside `<script>…</script>`, inside `<template>`, and inside another tag's attribute value (`<div title="<span data-cms-entry='e' …>">`). There is no current exposure: React escapes `<` in text and attributes, so content cannot plant a marker. But the parser is the live-check contract (decision 7), and skipping comments, raw-text elements and template contents would make false `present` results impossible rather than merely unlikely.
   - Minor 11b, `parse-markers.ts:533`: a marker with an id but an empty or missing hash is dropped. A `<span data-cms-entry="E">` is therefore invisible to an `absent` check, which could report a withdrawal as live while the entry is still rendered. There is no current exposure, because `CmsEntryMarker` always renders `contentHash` from a bundle entry and the types require it. Consider returning id-only markers, or a separate check, so `absent` fails closed.
   - Minor 11c, `parse-markers.ts:499`: unterminated `<span` sequences make the scan quadratic. Probe: 140 KB of `"<span a"` took ~4.7 s, and 240 KB of `'<span a="x" '` took ~10 s. Valid React HTML does not trigger this. The Task 21 worker should cap response size, or the scan should stop at a missing `>`.
12. not applicable: no editor text.
13. pass: no contradiction with the spec found.
   - The plan's peers (`react`, `next`) fit §3.1 "none (Next.js as peer)", because there are no runtime dependencies.
   - The two deferred Minor rows routed here are closed for anything the SDK delivers or renders:
     - Task 13 `isSafeHref` normalization: both copies now store `new URL(s).href` (`packages/schema/src/fields/link.ts`, `packages/rich-text/src/doc-schema.ts:54,75`).
     - Task 14 resolver output: checked at projection by `resolveAsset` and `resolveEntry` (`packages/schema/src/projection.ts`) and the rich-text `project.ts:50,82`. Entry paths must be root-relative and asset URLs must be `https:`; anything else becomes null.
     - The SDK only passes bundle data through and renders nothing from it except the marker attributes. Raw asset-URL canonicalization stays with Task 20, as its own deferred row says.
14. pass: `git diff --stat 11b7c93 41515f0 -- .claude` is empty. No permission or sandbox file changed.

**Other findings**

- [Minor] `packages/sdk/src/client.ts:441-443`: the bundle is not cross-checked against the pointer. `bundle.tenant === o.tenant`, `bundle.release === pointer.release`, and `pointer.bundle === releases/${pointer.release}.json` are not verified. Only the pointer's tenant, format and path shape are checked. Tampering would need write access to the delivery bucket, so this is defence in depth only.
  - The path rule itself is strict: `^releases\/\d+\.json$`, ASCII `\d`. My probes reject `../x.json`, absolute URLs, a leading `/` and query strings.
  - No `no-store` is used. The pointer is fetched with `{ next: { tags: ['cms'], revalidate: 3600 } }` and the bundle with `{ cache: 'force-cache' }`. Fetch errors and bad formats throw, and error messages contain only the URL and status.
- [Minor] `packages/schema/src/content-hash.ts:28-36`: an array's own `toJSON` is ignored by `canonicalJson` but used by `JSON.stringify`. Probe: `canonicalJson` gives `[1,2]`, `JSON.stringify` gives `"x"`. A non-deterministic accessor at an index also diverges (probe: `[0]` vs `[1]`).
  - Objects with an own `toJSON` already throw, because functions are rejected.
  - Not reachable today: data from JSON or the database has no functions or accessors.
  - The Task 16 row is otherwise resolved. Arrays are walked by index, with an own or overridden iterator ignored (test at `content-hash.test.ts:9-21`), and Proxies are rejected through `util.types.isProxy`, including nested ones (test at `content-hash.test.ts:22-28`).
- [Minor] `packages/schema/src/define-type.ts:103-106`: the `fields` prototype check closes the literal `__proto__:` case, and the tests cover it. A `fields` object that is a Proxy with a lying `getPrototypeOf` would pass, but module code is trusted, so there is no exposure. I note it only for completeness.

Files: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/webhook.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/revalidate-handler.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/parse-markers.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/client.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/markers.tsx`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/content-hash.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/schema/src/define-type.ts`, `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/pnpm-lock.yaml`. Probe scripts: `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/p1.mts` and `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/p2.mts`.

---

## Controller ruling

PASS accepted. The two rows routed to this review are confirmed closed: the Task 13 `isSafeHref` note and the Task 14 resolver output.

The Minors are deferred:
- **To Task 21**, the live check, which consumes the parser:
  - 11a: skip comments, raw-text elements, template contents and attribute values;
  - 11b: make `absent` fail closed on markers that have an id but no hash. This one comes first, because a withdrawal must never be reported live wrongly;
  - 11c: cap the response size or stop the scan at a missing `>`.
- **To Task 26**, the first site using the handler and client:
  - 10a: verify the raw bytes;
  - 10b: run the cheap checks before reading the body;
  - 10c: a controlled response when `secrets()` throws;
  - cross-check the bundle against the pointer, also noted by the combined review.
- **To Task 20**, the release build, which uses `contentHash`: an array's own `toJSON` and accessors in `canonicalJson`.
- **To checkpoint C1:** the Proxy `fields` note.

The combined review's three Minors are deferred with these: the bundle cross-check to Task 26; the `no-store` test robustness and the `readJson` typing comment to Task 26.
