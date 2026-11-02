# Task 24, security review, round 1 (cms-security-reviewer)

Diff `31c6b0f..94566a2` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. No Critical or Major findings; three Minors. Worktree clean. Checks: `pnpm lint` 0; `check:slugs` ok; Vitest over the five Task 24 test files, 65 passed; read-only catalog queries; no e2e; stack untouched.

1. pass: no migration; `register_asset`, `update_asset` `prosecdef = f`, `search_path=""`, schema-qualified.
2. pass: `api.asset_list` `security_invoker=true`; nothing added to `api`, `cms`, `private`.
3. pass: ACL `{postgres=X, authenticated=X}`; no grant change.
4. pass: `media-private` private, `file_size_limit 20971520`, types `{image/jpeg,image/png,image/webp}`; policies `media_private_select_member` and `media_private_insert_member` (authenticated, membership by folder per request); no UPDATE or DELETE policy, so no swap between the read-back and `register_asset`.
5. n/a.
6. pass: `registerAssetAction` (`asset-actions.ts:45-79`) tenant only via `resolveTenant`, active required, exact path `${tenant.id}/${assetId}/${filename}` with `SAFE_FILENAME` and a canonical assetId; `register_asset` re-checks membership and path. `assetPreviewAction`/`updateAssetAction` (98-144) take the tenant from the asset row under RLS, check it in `my_tenants` and active; signed path from the row's `original_path` (no editor UPDATE grant on it).
7–9. n/a.
10. pass: `createEditorClient` uses the publishable key; no secret or `privileged` in editor code or e2e; lint boundary rules pass; errors only as codes; `resolveTenant`/`listMyTenants` throw `my_tenants: <code>` only (tested); `e2e/support/editor-api.ts` reuses only the editor's own apikey and Bearer headers, `requireLoopback` on every fetch, `redirect: 'error'`; fixture `rugbraud.jpg` a real 286-byte 64×48 JPEG.
11. n/a.
12. pass: no cache-removal promise ("Fjarlægja mynd" only clears the field).
13. pass: no contradiction.
14. pass: no `.claude`, `.npmrc` or `supabase` change.

Upload validation (`image-metadata.ts:21-35`): size first (0 or > 20971520 refused); type from sharp's content sniffing, jpeg/png/webp only; positive safe-integer dimensions; sha256 over stored bytes; extension must match the detected type; nothing client-sent is used.

Resource exhaustion (editor, own tenant): `sharp().metadata()` reads the header only (20 MB junk 129 ms, ~1 MB RSS; 20 MB comment-segment JPEG 7 ms); at most ~40 MB per call; within the Minor bounds, no finding.

Rich text: `isAllowedUri` only `undefined` or a string passing `isSafeHref`; `setLink`/`toggleLink` refuse neither href nor entry, `javascript:` refused; `HubOrderedList` normalises start and drops type (parse and paste paths tested); `HubImage` parses no pasted `<img>`; `@litljomi/rich-text/editor` and `@tiptap/react` imported only in `RichTextField.tsx`; the main entry imports no Tiptap.

Lockfile and workspace: `@tiptap/react 3.32.2`, `sharp 0.35.5` exact; `@tiptap/extension-list ^3.32.2` resolves to 3.32.2; new `@floating-ui/{core,dom} 1.8.0`, `@floating-ui/utils 0.2.12`, `@tiptap/extension-{bubble,floating}-menu 3.32.2` (optional), `use-sync-external-store 1.7.0`, `@types/use-sync-external-store 0.0.6`, `fast-equals 5.4.5`, each with an integrity hash, no tarball or registry override; `sharp`, `@img/colour`, `detect-libc` lose `optional`; none declares install/preinstall/postinstall/prepare scripts; `allowBuilds` unchanged; `pnpm-workspace.yaml` adds only `updateNotifier: false` and `verifyDepsBeforeRun: error`, with a config test.

Minors (own tenant only):
- `asset-actions.ts:58-59`: a refused or never-registered object stays in `media-private` (no delete policy); readable only by members, never previewed or published; orphan storage.
- (Task 10 design) `api.register_asset` is callable directly over PostgREST, so an editor can declare their own mime, bytes, dimensions and sha256, skipping the server derivation; path, membership and keys still hold; bucket limits still bound the object. Defence in depth: the worker could re-derive or verify metadata at publish.
- (pre-existing) `register_asset` and `update_asset` do not check `tenant_inactive`; a direct RPC by a member of a suspended tenant is not refused at the database layer.
