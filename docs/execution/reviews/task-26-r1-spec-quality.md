# Task 26, combined spec-and-quality review, round 1 (Sonnet)

Verbatim report.

PASS

Commands run in /Users/einarzoega/litljomi-cms/.worktrees/lane-b:
- `pnpm lint`, `pnpm typecheck`, `pnpm check:slugs`: clean.
- `pnpm test`: 27 files, 355 tests, all passed.
- `node --test "tools/harness/__tests__/*.test.mjs"`: 32 of 32 passed.
- `pnpm --filter demo-site test:e2e`: run once, 6 of 6 passed, no lock or port error.
- `git status --porcelain` is empty.

**Spec check**
- Present with the required names: package `demo-site`, Next 16, deps `@litljomi/cms-sdk` and `@litljomi/rich-text`; `next.config.ts` with `remotePatterns` for `CMS_MEDIA_HOST` only plus `transpilePackages`; layout with `CmsReleaseMarker`; `events/page.tsx`; `events/[slug]/page.tsx` with `generateStaticParams` and `notFound()`; the revalidate route with exactly `createRevalidateHandler({ secrets: () => env.CMS_WEBHOOK_SECRETS.split(','), revalidate: tag => revalidateTag(tag, 'max') })`; `src/lib/cms.ts`; generated `src/types/cms.ts`.
- `package.json` has `"start": "next start -p 3101"` and `gen:types`, which calls `@litljomi/cli gen-types --module demo --out …`.
- Fixtures are under `e2e/fixtures/delivery/demo/` and served by a `node:http` server (`fixture-server.ts`).
- The tests are Vitest HTTP tests, and Playwright is not installed. They cover each required behaviour: marker with the bundle hash on `/events/x`, `/events` listing with markers, unknown slug gives 404, bad signature gives 401.
- Markers are inside `EventSummary` and `EventDetail` in `src/app/events/event.tsx`; the layout renders only the release marker.
- Extras are justified:
  - `event.tsx` shares the marker-bearing components between the list and the detail page.
  - `@litljomi/cli` is what decision 35 asks for.
  - `generate.ts`, `harness.ts`, `fixtures.test.ts` and the workspace and tsconfig entries are support for the above.
- The deferred Task 18 row is fully addressed in the SDK, and each item has a test:
  - the handler verifies raw bytes (a Uint8Array body);
  - it makes the cheap checks (timestamp format and tolerance, signature shape) before reading the body or calling `secrets()`;
  - a throwing `secrets()` gives a plain 500 `{revalidated:false}`;
  - the client cross-checks `bundle.tenant` and `bundle.release` against the pointer;
  - the no-store test now inspects the fetch options;
  - the `readJson` typing comment is added.
- The controller still has to mark that row cleared in `docs/execution/deferred-minors.md`; the implementer did not touch it, and it is the controller's file.

**Can the tests fail?**
- Marker moved to the layout: the layout has no entry, so the `/events/x` assertion `toEqual([{id, hash}])` fails.
- Wrong or altered hash: the markers are compared with the bundle's `contentHash` on both pages, so a changed entry or a duplicate marker fails.
- Missing 404: removing `notFound()` makes `getEntry` return null, `event.data` throws, the page returns 500, and the 404 assertion fails.
- Revalidate: the tests check the bad signature, wrong secret, stale timestamp, and both secrets. They cannot check the `'max'` argument to `revalidateTag`; that is only pinned by reading the route.
- Red step (Minor): the missing-site red step was never run, but it is adequate. Before the app exists, `next build` in the harness cannot succeed, so `beforeAll` fails and every test is red. The e2e tests were not run against a deliberately broken page. Seeing at least the 404 and marker-in-layout mutations fail once would be better evidence, but I do not rate this above Minor because the analysis above holds.

**Findings**
- [Minor] spec: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/e2e/fixtures/generate.ts:44` and `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/e2e/fixtures.test.ts:20-23`: the fixture `contentHash` is `contentHash(r.data)`, while spec §7.2 and Task 20 step 3 define the hash over the complete projected record minus the `contentHash` field.
  - This is acceptable for a fixture. Task 26 only requires the site to echo the bundle's hash, and the site never computes it.
  - But the test title says "the real content hash of each entry record", which claims more than it checks, and it pins a formula that Task 20 will contradict.
  - Suggested change: reword the title and comment to "a deterministic stand-in hash, not the §7.2 formula", and add a note that Task 20 or 21 should regenerate the fixture or replace this test when the worker's hash exists.
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/package.json:7`: the `gen:types` path `--out ../../apps/demo-site/src/types/cms.ts` is relative to `tools/cli`, because `pnpm --filter` runs there.
  - It works, and `cli.test.ts` pins that the committed types equal `renderTypes(demo)`.
  - The script itself is not tested, and the path breaks if the package moves.
  - Suggested change: add a short comment or a note in the README on the cwd.
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/e2e/harness.ts:76-79`: `stop()` sends SIGTERM but does not wait for the `next start` child to exit, so a port or `.next` handle can outlive the run. It also starts on a random free port rather than 3101. The latter is fine for parallel safety.
  - Suggested change: await the child's `exit` in `stop()`.
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/e2e/fixture-server.ts:24`: `startsWith(root + sep)` assumes `root` is already normalized. The default is, but the exported `root` parameter is not. Normalize `root` once.
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/packages/sdk/src/revalidate-handler.ts:4-8`: the doc comment has grown to a very long line. The staleness check now exists in both the handler and `verifyWebhook`; they share `DEFAULT_TOLERANCE_SECONDS`, so no divergence today. Wrap the comment, and keep one comment noting that the early check is deliberate.
- [Minor] quality: `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/apps/demo-site/e2e/site.spec.ts:33-36`: the "has the fixture entry x" test duplicates `fixtures.test.ts`. The `x?.` casts could be avoided with one guard. Harmless.

**Security flags for the controller**
- `packages/sdk/src/revalidate-handler.ts` and `webhook.ts` changed. Webhook verification now takes raw bytes, and the order of the checks changed. Both are security-relevant and should go through the security review. They are required by the deferred row, not an extra.
- `/Users/einarzoega/litljomi-cms/.worktrees/lane-b/tools/cli/src/cli.ts:23` does a dynamic `import('@litljomi/module-${name}')`, guarded by the `MODULE_NAME` regexp. This is the code-loading and boundary area, so the security review should look at it.
- Any change to those two areas goes back through the security review.
