PASS

Task 8 (assets, storage buckets and storage RLS), security review round 1. Commit 318da7d, diff 5aa4e94..318da7d. No Critical or Major findings. Three Minors, all defence in depth with no current exposure. Minor 1 has to be resolved or explicitly accepted by Task 10.

1. pass: No SECURITY DEFINER function anywhere. The catalog query over every postgres-owned function that is not an extension member returns 10 functions in `private`. All have `prosecdef = f`, `proconfig = {search_path=""}`, and none grants EXECUTE to PUBLIC. The new storage policies call `storage.foldername(text)` and `auth.uid()`, both `prosecdef = f`. The migration adds no functions; the triggers reuse Task 6's `private.force_actor()` and `private.check_actor()`. Deferred Minor (Task 4 security r1, Minor 2) is cleared: `010_catalog.test.sql` now runs four checks over every postgres-owned non-extension function in any schema, as the deferred Minor asked: no definer, `search_path` pinned to `''`, nothing outside `api`/`cms`/`private`/`tests`, and anon executes nothing.
2. pass: `supabase/config.toml:14` sets `schemas = ["api"]`. Nothing is added to `api`. `cms.assets` is reachable only by direct SQL, not through the Data API.
3. pass: on `cms.assets`, `relacl = {postgres=arwdDxtm, authenticated=r, service_role=r}`. Column ACLs: `authenticated` has INSERT on `id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, default_alt, created_by` and UPDATE on `focal_x, focal_y, default_alt, archived_at`; `service_role` has UPDATE on `public_path` only. `anon` has nothing. This matches §4.5 and the Task 8 Interfaces exactly. No DELETE for any API role ("not hard-deleted", §4.3). The `storage.objects` grants are Supabase's defaults; RLS limits them (item 4).
4. pass: `cms.assets` has `relrowsecurity = t`. The select, insert and update policies apply to `authenticated` only and each uses the §4.5 membership `EXISTS` with `(select auth.uid())`, checked per request. There is no platform-admin clause, and the test confirms that an `aal2` platform admin sees no asset. `storage.objects` and `storage.buckets` have RLS on. The only two policies on `storage.objects` are `media_private_select_member` and `media_private_insert_member`; `storage.buckets` has none.
   Controller note on the policy form: the text comparison `m.tenant_id::text = (storage.foldername(objects.name))[1]` grants a strict subset of what the plan's `::uuid` form grants. I probed as `editor_labak` in a rolled-back transaction:
   - Denied (42501): the labak UUID in uppercase, a leading space, a leading `/`, the `{uuid}` form, the bare `<labak>` with no folder, the demo UUID in lowercase, and the demo UUID in uppercase.
   - Allowed: `<labak>/a.jpg`, `<labak>//a.jpg`, `<labak>/../<demo>/x/a.jpg`, `<labak>/x/../../<demo>/f202/b.png`.
   Every allowed name begins with the editor's own tenant. `select` after these inserts showed only the editor's four literal labak-prefixed names, not demo's fixture object. So the form cannot be bypassed and is equivalent for access (Minor 2 covers the dot segments). It also avoids the cast error the `::uuid` form could raise, since Postgres does not guarantee short-circuit evaluation.
5. pass: `assets.tenant_id` is NOT NULL, with `unique (tenant_id, id)`. The new foreign keys are composite with `tenant_id`: `draft_refs_tenant_id_target_asset_id_fkey (tenant_id, target_asset_id) → assets(tenant_id, id)` and `revision_refs_… ON DELETE RESTRICT`. `assets_tenant_id_fkey → tenants(id)` is single-column, but `tenants` is not a tenant table. The catalog test now includes `assets` in the tenant-table set. A reference to a foreign asset fails the composite FK with 23503, the same as a nonexistent one, so the refs add no oracle.
6. not applicable: no functions in this task. See Minor 1 for Task 10's `register_asset`.
7. not applicable.
8. not applicable.
9. not applicable.
10. pass: grepping the diff for `eyJ`, `secret` and `sb_secret` finds nothing; no keys or tokens are added.
11. not applicable.
12. not applicable.
13. pass, with one contradiction-adjacent point under Minor 1: the spec wants client-generated asset IDs (§4.3), while §4.1 rule 3 wants the covert channel from constraint checks closed. Reported, not resolved.
14. pass: `git diff --stat 5aa4e94..318da7d` lists only the four `supabase/` files. No `.claude/**` change.

Further findings:

- [Minor] `supabase/migrations/20261102000500_assets_storage.sql` (`id uuid primary key`): cross-tenant existence oracle (deferred from Task 6).
  - **Confirmed:** `editor_labak` inserting an asset with demo's asset ID gets `23505 duplicate key value violates unique constraint "assets_pkey"`. An outsider gets 42501 from RLS before the key check, so it needs a member of some tenant.
  - **Why Minor:** it is unreachable today, because `cms` is not exposed and no `api` function inserts assets yet. It also reveals only whether a 122-bit random UUID the caller already knows exists in some other tenant, and for published media §5.6 makes the ID public anyway (`media-public/{tenant_slug}/{asset_id}/…`). The resource-exhaustion rule does not apply; I rated it to the full cross-tenant standard on the "no current exposure" ground.
  - **Uncertainty:** Task 10's `api.register_asset(p_asset_id, …)` takes the client-chosen ID by spec, which makes this reachable by design. Task 10's security review must re-rate it there; at that point it is a Minor/Major borderline.
  - **What a fix would need:** error mapping in `register_asset` cannot hide it, because success versus failure already distinguishes the cases. The asset ID must stop being globally unique across tenants:
    - (a) Key by `(tenant_id, id)` and drop the global uniqueness of `id`. Storage paths and the refs' FKs are already tenant-scoped. `update_asset` and `archive_asset` must then resolve the ID under RLS without ambiguity for a user in two tenants. This changes the plan's Interfaces (`id uuid primary key`).
    - (b) Server-generated asset IDs. This changes spec §4.3.
    - (c) Accept the leak explicitly.
    Each needs Einar's decision.
- [Minor] `supabase/migrations/20261102000500_assets_storage.sql` (the storage policies) and the `assets_check` constraint: object names and `original_path` are only prefix-checked. Probes accepted `.`/`..` and empty segments in `media-private` names, and an asset row with `original_path = '<labak>/<id>/../../<demo>/<f202>/b.png'` (`traversal asset row ok`). There is no current exposure:
  - The local Storage API (v1.82.1, `dist/storage/backend/secure-path.js`) rejects any `.` or `..` segment with "contains dot path segment".
  - S3 keys are literal.
  - A storage copy looks up the literal name, which can only be an object the editor's own tenant uploaded.
  As defence in depth, Task 10's `register_asset` and Task 20's worker copy should require `original_path = tenant_id || '/' || id || '/' || filename`, with no `/`, `.` or `..` in `filename`. The policy could also reject dot and empty segments.
- [Minor] `supabase/tests/database/050_assets_storage.test.sql`: no test pins the oracle's current behaviour or the case-sensitive folder match (uppercase own UUID denied). Adding them would make a later decision on Minor 1 visible in the suite.

Method: catalog queries and persona probes ran through `_helpers.sql` in rolled-back transactions on the local stack. I copied `_helpers.sql` into the container's `/tmp` for the probes and deleted it afterwards. I also read the Storage API source inside its container. I did not reset the database or run HTTP writes. `git status --porcelain` in the worktree is empty. The main checkout shows only the controller's own changes in `docs/execution/`, which I did not touch.

Files:
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/migrations/20261102000500_assets_storage.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/tests/database/050_assets_storage.test.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/tests/database/010_catalog.test.sql
- /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/supabase/tests/database/040_refs.test.sql
