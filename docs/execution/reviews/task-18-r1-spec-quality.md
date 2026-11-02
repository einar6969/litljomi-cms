# Task 18: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02 (medium tier; the security review ran in parallel)
- Change: 5313a5b and 41515f0 on `m1/lane-b`
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major findings. The three Minors are below.

Commands run, all in /Users/einarzoega/litljomi-cms/.worktrees/lane-b:
- `git diff --stat 11b7c93 41515f0`
- `git status --porcelain` (empty at the end)
- Read every SDK source and test file plus the schema diffs.
- `pnpm test`: 25 files, 327 tests passed.
- `pnpm lint`: clean.
- `pnpm typecheck`: clean.
- grep of docs/architecture.md for the marker, pointer and header text.
- The pnpm output carried repeated "failed to copy trust settings of system certificate" lines. They are sandbox noise and did not affect results.

Spec compliance
- All files the plan lists exist: package.json, index.ts, bundle.ts, webhook.ts, markers.tsx, parse-markers.ts, client.ts, revalidate-handler.ts and the four test files. The task text asks for nothing else, and the extra edits to tsconfig.json and vitest.workspace.ts are needed to run the SDK tests.
- The interfaces match the plan: `Pointer`, `Bundle`, `BundleEntry`, `signWebhook(body, secret, ts)`, `verifyWebhook` with default tolerance 300, the headers `x-cms-signature` and `x-cms-timestamp`, `CmsEntryMarker`, `CmsReleaseMarker`, `parseEntryMarkers`, `parseReleaseMarker`, `createCmsClient` and `createRevalidateHandler`.
- The fetch options are exact: `{ next: { tags: ['cms'], revalidate: 3600 } }` for the pointer and `{ cache: 'force-cache' }` for the bundle. The client throws on format other than 1. The handler returns 401 or 200 `{ revalidated: true, at: ISO }` and calls `revalidate('cms')` once.
- Every Step 1 test is present:
  - Round trip, wrong secret, 301 s rejected, and either rotation secret.
  - Marker render and parse round trip.
  - Exact fetch options, including the `toHaveBeenNthCalledWith` checks, plus a `no-store` check.
  - Format 2 throws.
  - Tampered body returns 401 and a valid request calls `revalidate('cms')` once.
- The exact-options assertions would fail if a tag or the revalidate value were dropped. The `no-store` test would fail if `no-store` were added.
- The `next` peer `^15 || ^16` matches spec §7.3 and the controller ruling.

Additions beyond the text (acceptable, none contradicts the spec)
- Tenant mismatch check on the pointer: acceptable. It is defensive and tested.
- `releases/<n>.json` path regex on the pointer: acceptable. It is tested and stops path escape from the delivery base.
- Rejecting a non-ok HTTP response: needed and tested.
- Strict marker parsing (HTML entity decoding, order-independent attributes, ignoring incomplete markers, null on conflicting release markers): acceptable. The tests cover each rule.
- The handler requires the timestamp header to be `^\d{1,15}$`, and the response body on 401 is `{revalidated:false}`: acceptable and tested. Timestamp header format is plain integer seconds, consistent with `signWebhook`.
- `verifyWebhook` validates input, checks every secret in constant time, and never throws: acceptable. Security owns the review of this code.
- Exported constants and the `CmsClient` type: harmless.

Deferred Minors owned by Task 18 (both cleared)
- `canonicalJson` now walks arrays by index and rejects any Proxy via `util.types.isProxy`. Tests cover an own iterator, an overridden `Array.prototype[Symbol.iterator]`, and Proxy variants (Date with a lying prototype, nested, object, array).
- `defineType` rejects a `fields` prototype that is neither Object.prototype nor null. Tests cover a literal `__proto__` key, `Object.create(parent)`, and a null-prototype object that is accepted.
- Both touch hashing and validation code. Flag to the controller that the Proxy rejection (a behaviour change to `canonicalJson`) should go through the security review's attention.

Findings
- [Minor] quality: packages/sdk/src/client.ts:36: `getBundle` checks the pointer's tenant but not `bundle.tenant`, nor that `bundle.release` matches `pointer.release`. A mismatched bundle would be served silently. Suggest an equivalent check, or a comment saying the pointer check is deliberately enough. This touches delivery integrity, so it would go back through security if adopted.
- [Minor] quality: packages/sdk/src/__tests__/client.test.ts: the "never uses no-store" test stringifies the whole call, URL included. It would false-fail if a tenant or URL ever contained that text, and it checks only `getEntries`. Inspect `call[1]` instead. The exact-options test already covers the regression.
- [Minor] quality: packages/sdk/src/client.ts:16,22: `readJson(url, init: object)` loses typing, and the `as Pointer` and `as Bundle` casts follow unvalidated JSON. Fine for v1 given the format checks. A one-line comment would help, since `getEntries` trusts the shape of `entries`.

---

## Controller ruling

PASS accepted. The `canonicalJson` Proxy rejection is covered by the parallel security review's brief. How the three Minors are handled depends on that review's outcome. The bundle tenant and release check is delivery integrity, so it is assigned at the security ruling.
