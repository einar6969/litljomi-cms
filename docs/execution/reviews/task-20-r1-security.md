# Task 20, security review, round 1 (Opus)

Verbatim report.

PASS

Task 20 security review, round 1. Diff reviewed: 91d3334..2803b63, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt.

**What I ran:**
- `pnpm db:reset`, then `pnpm db:test`: 15 files, 1313 tests, PASS (includes 096_release_build).
- `apps/cms pnpm test:integration`: 22/22 pass (build-release 9).
- Worker unit tests: 85/85.
- `pnpm lint`: exit 0.
- Catalog queries and curl probes, listed under the items below.
- The stack was reset at the end, no background process is running, and `git status --porcelain` is empty.

**Checklist**

1. pass. `pg_proc`: every `api.worker_*` has `prosecdef = f` and `proconfig = {search_path=""}`. A count of `prosecdef` over `api`, `cms` and `private` returns 0. The replaced `worker_finish_release` (supabase/migrations/20261102001200_release_build.sql) is `security invoker`, `set search_path = ''`, and schema-qualifies every name, including the `pg_catalog.cardinality` and `jsonb_array_length` calls.
2. pass. The migration adds no object outside `api`, and no new view or schema exposure.
3. pass. The `worker_finish_release` ACL is `{postgres=X, service_role=X}` (`create or replace` kept the grants), with no PUBLIC or anon entry. Column grants are unchanged: on `cms.assets`, service_role can UPDATE only `public_path`; on `cms.tenants`, service_role can UPDATE only `(name, status)`.
4. pass. Unchanged by this task. `cms.releases` has `releases_select_member`, a membership EXISTS check per request, so editors can read their own tenant's releases and `releases.error`. The console policy requires `aal2`.
5. not applicable. No new table.
6. pass. `worker_finish_release` derives the tenant from the release row (`for update`). The bundle path, request IDs and asset public paths are all checked against that tenant and slug. In the worker, `buildRelease(tenantId)` checks `snapshot.release.id === releaseId` and `snapshot.tenant.id === tenantId` (build-release.ts:152). The slug comes from the snapshot, which reads `cms.tenants` (build-release.ts:151).
7. pass. Only service_role can execute (item 3). The new rules can only add refusals, and both run before anything is read or changed:
   - `'delivered'` without a bundle path raises 22023.
   - `'failed'` with any request IDs or public assets raises 22023.

   They cannot mark requests or assets wrongly: a failed release links nothing, and a delivered release still needs the exact `{slug}/releases/{N}.json` path. The pgTAP tests in 096 lines 55–106 cover these rules.
8. not applicable. Task 20 does not touch the commit path.
9. pass. Entries come only from `worker_release_snapshot`'s `published` CTE, `published_rev_id is not null and archived_at is null` (20261102000900_api_worker.sql). This is one SQL statement, so one snapshot.
   - The bundle is assembled only from `built`, which is a subset of `snapshot.entries` (build-release.ts:319–326). No fallback or previous-bundle path adds an entry; `previousBundle` is only returned.
   - Omitted entries are removed from the context, so other entries resolve them to null. The loop repeats until no further omission (build-release.ts:296–317).
   - Integration tests for unpublish, archive and never-published drafts run against the real snapshot, and each would fail if inclusion or copying came from anywhere else.
10. pass. `git grep` for `SUPABASE_SECRET_KEY`, `createAdminClient` and `.storage.from` outside tests finds them only under `apps/cms/src/privileged/**` and `tools/cli`. Lint passes. `releases.error` and alerts hold the step, an error message (PostgREST, Storage or projection), this tenant's IDs and paths, and the omitted entries of this tenant only. No key or secret is in them, and nothing from another tenant.
11. not applicable. Live checks are Task 21. The `contentHash` they rely on is correct: `entryContentHash` hashes the complete record minus `contentHash` (content-hash.ts, build-release.ts:339–355). The integration test recomputes it from the served bundle.
12. not applicable. No editor text.
13. pass. No contradiction found. Decision 34.4 is resolved without a spec change: `immutable` can be set, and I verified it below.
14. pass. `git diff 91d3334..2803b63 --stat -- .claude` is empty.

**Focus checks (own evidence)**

- **Cache headers on the served URLs.** I fetched with curl after the integration run:
  - `/storage/v1/object/public/delivery/labak/current.json` served `cache-control: public, max-age=30`.
  - `labak/releases/13.json` and `labak/releases/14.json` served `public, max-age=31536000, immutable`.
  - Both had `Content-Type: application/json`.
- **Bundle and pointer order.**
  - The bundle is uploaded with `upsert:false` and read back byte for byte (build-release.ts:178–183).
  - The pointer is written only after that, read back, and checked for release and bundle (build-release.ts:186–208).
  - Every failure through step 8 lands in the catch and marks the release failed, recording `pointerWritten`.
  - The previous bundle is checked for format and release number (build-release.ts:144) and for tenant (build-release.ts:153).
- **Media paths.** I checked whether a crafted asset row can make the worker copy another tenant's object or write outside `{slug}/{asset_id}/…`. It cannot:
  - The DB check only enforces the prefix `original_path LIKE tenant_id/id/%`, so `T/A/../x/a.jpg` would pass the database.
  - The worker, however, requires `original_path === privateMediaPath(tenantId, id, filename)` exactly, and the filename rules refuse `/`, `\`, `.`, `..` and control characters (storage-paths.ts; build-release.ts:271–277). A failing asset makes its entry omitted (`asset_path_invalid`), and the unit test covers this (build-release.test.ts:413–422).
  - Archived assets are never copied or resolved.
  - Only assets in included entries' `refs` are copied (build-release.ts:334). The snapshot returns only assets referenced by published revisions, so assets of never-published drafts are never candidates.
- **Duplicate destination counted as success.** This cannot deliver a different object:
  - media-public has no storage policy for `authenticated`, so only the worker writes it.
  - Asset IDs are globally unique (`assets_pkey`), and `filename` cannot be updated.
  - The tenant slug cannot be updated by anyone (service_role UPDATE is `(name, status)` only).
  - The editor's original is immutable: storage policies give `authenticated` only SELECT and INSERT on media-private, with no UPDATE or DELETE.
  - media-private is restricted to image MIME types.
- **URL helpers.** `canonicalHttpsUrl` refuses user or password and returns `new URL().href`. `resolveAsset` and the rich-text image both deliver the canonical form.
- **canonicalJson.** It now refuses own or inherited `toJSON` and accessor properties.

**Findings (all Minor; none fails an item)**

- [Minor] apps/cms/src/privileged/worker/build-release.ts:176–180, 237–244: a release that fails at or after `bundle_upload` leaves its bundle publicly readable at a predictable path, recorded nowhere. Verified: `labak/releases/13.json` (a failed release, `bundle_path` null) is served with 200.
  - Media copied by a failed build likewise stays in media-public with `public_path` null.
  - No current exposure beyond M1's: M1 keeps every delivered bundle anyway, and the content was published at build time.
  - However, M3 retention (§7.2) cannot find these objects from `releases.bundle_path` or `assets.public_path`. Suggestion for M3: record the uploaded paths in the failed release's error, or delete them on failure.
- [Minor] build-release.ts:189–196: the pointer write does not check that the current pointer's release is not higher than N, and does not re-check that the release is still `building`. Today the DB serialises builds (one `building` per tenant, numbers max+1), so the pointer cannot move backwards. If a stale `building` release is ever force-failed while its worker is still running (an operator, or a future sweep), that worker could still write an older pointer. A cheap guard: read `current.json` before writing and refuse a higher release.
- [Minor] Availability, no security property: a worker killed mid-build (e.g. by `maxDuration`) leaves the release `building` forever, and nothing in M1 recovers it, so every later build of that tenant returns `busy`. This includes unpublishes, so withdrawal stops reaching the site.
- [Minor] Same class of availability issue: a permanently unreadable previous bundle (build-release.ts:141–146), or an asset row whose private object is missing (an editor can insert `cms.assets` directly; build-release.ts:165–173), makes every build fail. That blocks the tenant, which is broader than §7.1's "one failing entry does not block the tenant".
  - The missing-object case can only be caused by an editor in their own tenant, and affects only that tenant.
  - The cost is a few Storage calls per attempt and no temp space, far under the resource-exhaustion bounds.
  - The fix would be to treat a per-asset copy failure as an omission of the entries that reference it.

The review left the working tree unchanged (`git status --porcelain` empty) and the stack reset.
