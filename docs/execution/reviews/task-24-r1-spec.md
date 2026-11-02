# Task 24, spec review, round 1 (cms-spec-reviewer)

Diff `31c6b0f..94566a2` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS. No Critical or Major findings; three Minors.

Rulings: (a) `prepareUpload(file, tenantId)` accepted (the path needs the tenant id; throws on a non-canonical UUID; HEIC, PDF and a 20971521-byte JPEG rejected, 1 KB PNG accepted, all in `upload.test.ts`). (b) `assetPreviewAction` and `updateAssetAction` accepted (the preview uses `createSignedUrl(path, 600)`; `update_asset` is in the task's Consumes; both validate arguments, use only the editor's session and check the tenant is active); `@tiptap/extension-list` accepted (needed for the `HubOrderedList` fix of the Task 14 row; declared only in `packages/rich-text`). (c) the `editing.spec.ts` notice check replaced by `toHaveCount(0)` accepted (every news field has a component; the notice is unit-tested in `fields.test.tsx`).

Task text: all files and interfaces present; `registerAssetAction(tenantSlug, assetId, path, filename)` reads the object back with the editor's session and derives mime, bytes, width, height and sha256 from the bytes with sharp (`server/image-metadata.ts`), then `register_asset`; review focus 4 and 2 covered by unit and e2e tests; e2e checks the object in `media-private` and 404 from `media-public`. Decision 37.7: `sharp@0.35.5` and `@tiptap/react@3.32.2` pinned exactly; toolbar bold, italic, H2, H3, bullet, ordered, blockquote, hard break, link; no image button (unit-tested); existing images kept. Decision 38.1: `updateNotifier: false` and `verifyDepsBeforeRun: error` asserted by `tools/checks/__tests__/pnpm-workspace.test.ts`.

Deferred rows: Task 14 spec-quality and security rows done (comment; `HubOrderedList` start/type normalised incl. live paste; non-string href mounts with no href; `setLink`/`toggleLink` refuse a link with neither href nor entry); Task 22 quality row done (literal test removed, probe uses `support/test`, `CMS_PORT`, `RESEND_BACKOFF_MS`, `signIn` throws on `/login`, `magicLinkOf` comment, `<any,'api'>` comment, one `isActive`, comments on the mock and the glob loop); Task 23 spec-quality done (unused keys removed, `useAutosave` memoized, three-reads comment, unit tests for the four fields); Task 23 security done (`resolveTenant`/`listMyTenants` throw `my_tenants: ${code}` only, tested).

Minors:
- `apps/cms/e2e/auth.spec.ts:2`, `apps/cms/e2e/support/local.ts:3`: literal `3100` remains in comments (and correctly in `supabase-config.test.ts:46-56`).
- `docs/plans/2026-11-01-m0-m1.md:1537`: the plan still says `prepareUpload(file)`; update it with the ruling.
- `apps/cms/src/editor/form/fields/RichTextField.tsx:84`: link button behaviour with an empty editor; noted only.

Commands (via `pnpm -C`): lint 0, typecheck 0, `pnpm test` 57 files 1024 passed, check:slugs ok; no e2e or database; relied on the controller's e2e (media 3, full 11). `git status --porcelain` clean.
