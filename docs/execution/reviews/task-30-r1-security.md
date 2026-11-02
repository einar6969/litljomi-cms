# Task 30, security review, round 1 (cms-security-reviewer)

Diff `f55b64d..8aa9d69` in `.worktrees/lane-b`. Report as returned by the reviewer:

PASS

Stack note: the pgTAP suite could not be run. The catalog checks ran while the stack was up with this change applied. Then `pnpm db:reset` failed because the spec reviewer had run `pnpm db:stop` ("No such container: supabase_db_litljomi-cms"); two `pnpm db:start` runs failed ("Starting database from backup...", PostgREST `schema "api" does not exist`, `HealthCheckTimeoutError: supabase_rest_litljomi-cms unexpected status 503`). The restored volume looks left over from the interrupted reset; deleting it (`supabase stop --no-backup`) was not done. Someone must rebuild the stack and run `pnpm db:reset && pnpm db:test` before Task 30 is accepted. Worker unit tests pass (155/155, `npx vitest run src/privileged/worker` in apps/cms); the 6 integration files need the integration config and the stack. No containers running; `git status --porcelain` empty.

1. pass: no SECURITY DEFINER; `prosecdef = f`, `proconfig = {search_path=""}` for `worker_fail_stale_releases()`, `worker_pointer_check(uuid)`, `worker_finish_release(...)`; 0 definer functions in api, cms, private; names schema-qualified.
   - [Minor] `20261102001400_worker_recovery.sql:21-22`: comment says service_role has "UPDATE of status and error"; the grant also covers `bundle_path` and `delivered_at`. Wording only.
2. pass: both functions in `api`, invoker; no exposure added.
3. pass: proacl `{postgres=X/postgres,service_role=X/postgres}`; false for authenticated and anon, true for service_role; revokes at lines 76–79; no table grant changed (existing SELECT on `cms.releases` and column UPDATE `(status, bundle_path, delivered_at, error)`, `20261102000600_publishing.sql:220-223`); counts updated in 010 and 100.
4. n/a: no table, RLS or policy change; media-private storage policies still SELECT and INSERT only (`20261102000500_assets_storage.sql:134-145`), so an original cannot be removed after the pre-commit check.
5. n/a: no new tables.
6. pass: `worker_pointer_check` derives the tenant from the release; `worker_fail_stale_releases` takes no parameters and updates only `status` and `error` of `building` rows older than 420 s (`pg_catalog.now()`); `missingOriginals` (`process-request.ts:530-546`) builds the path from `read.tenant.id`, never editor input.
7. pass: service_role only; `worker_finish_release` still raises `forbidden` unless `building` and locks `FOR UPDATE` (`20261102001200_release_build.sql:51-57`); the stale UPDATE re-checks on the locked row, so exactly one of finish and stale-fail wins; no other path updates `cms.releases.status`. A failed release cannot be revived.
8. pass: commit functions unchanged; the asset check precedes `worker_commit_publish`, which still copies `drafts.data` and checks the version; references come from `private.extract_refs(d.data)`, not `draft_refs` (`20261102001100_worker_phase3.sql:129`); assets joined on tenant; a changed draft is superseded; a cross-tenant or unknown asset (filename null) is skipped by the check and refused by the commit.
9. pass: release content only from `worker_release_snapshot`; a missing original fails before commit, so a live entry keeps its revision and nothing is added. Forward-only pointer: (c) `build-release.ts:229-242`, (b) `243-250`, (a) monotonic 270 s at `251-254` right before the upload, (d) no repair (`221-241`). Release numbers are `max(number)+1` over all releases (`20261102000900_api_worker.sql:459-462`). The upload-hang window is decision 37's accepted local residual.
   - [Minor] `build-release.ts:187-188, 224`: every `forbidden` from `worker_finish_release('delivered')` is classed `finish_refused` and the release is not marked failed; `forbidden` is also raised for a bundle-path or request-count mismatch (`20261102001200_release_build.sql:59-77`), so such a release stays `building` until the 420 s sweep. One-tenant liveness delay; pointer and content untouched.
10. pass: changes only under `apps/cms/src/privileged/**` and `supabase/**`; secret key only in test fixtures under `privileged/worker/__tests__`; alerts carry ids, numbers, codes, steps and messages only; `{code:'asset_missing', assetIds}` lists only own-tenant assets.
11. n/a: live confirmation unchanged (`confirmRelease` refactor filters retry sites, `allSettled`).
12. n/a: no editor text.
13. pass: no contradiction; note for the spec side: a copy failure at build time still fails the whole build (`build-release.ts:200-209`, unchanged), consistent with "other copy failures still fail the build".
14. pass: no `.claude/**` change.

Further findings:
- [Minor] `process-request.ts:533-544` (resource use): one Storage `exists` request per distinct unpublished asset, sequential; ≤ 1,000 references (decision 28); editor-in-own-tenant via the worker only; estimated seconds locally, tens of seconds hosted, under `maxDuration`. Parallel checks would bound it.
- [Minor] `build-release.ts:146-148, 229-242`: an unreadable or malformed `current.json` while a delivered release exists refuses and alerts every later build of the tenant, with no repair (as decision 37 intends). Fails closed; an operator fixes it.
