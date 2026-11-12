# Media library: design and split

> **Status, 2026-11-12:** the library is ordered by Einar's ruling below, and he left the split to the coordinator. **The first version is L1–L6; building starts with L1.** The later slices (L7–L12) are proposals: each is a row in `docs/clients/dld/ENHANCEMENTS.md`, and Einar approves which go in. Of the open decisions in section 11, the coordinator takes 1 (the ruling itself says "per file"), 3 and 9 as recommended and 7 into the copy batch; 2, 4, 5, 6 and 8 go to Einar with the enhancement list.
>
> No code is changed by this document. Nothing here was run on the local stack or on production; section 12 lists what must be probed before the slice that depends on it.

**Goal:** a library page in the CMS where all of a tenant's images and documents live in one place, built for every tenant, in slices that ship one at a time.

**The ruling** (Einar, 2026-11-12, verbatim; it names the first client, the design names none):

> "I want a library page in the CMS where all of a site's images and documents live in one place. From the reference:
> - grid and list views, search, filters (images, documents, video), newest first;
> - upload several files at once;
> - per file: alt text, caption, photographer/credit, tags, folder;
> - "missing alt text" and "unused" filters;
> - where each file is used ("Notkun"); the Hub already tracks which entries reference each image;
> - several sizes per image, and documents (PDF), not only images.
>
> Split it as you see fit. My expectation: a first version before DLD's editors start (the library screen, multi-upload, caption and credit, usage, unused), and the heavier parts (documents, image sizes, folders) after. Treat it as boundary work wherever it touches the database, storage, publishing or the SDK. It replaces "several images in one upload" and "archive unused images" in your candidate list; v1 of the spec excluded a media library, and my ruling overrides that."

**Standing rules that shape the design:** every enhancement is generic; implement directly, keep tests passing, add tests where they help; anything touching the database, sign-in or publishing is tried on the local stack first, because production has no backups. So every migration here is additive and forward-only, and nothing is deleted.

**Reading the citations:** `mig/…` is `supabase/migrations/…`; `cms/…` is `apps/cms/src/…`; `§` is `docs/architecture.md`.

**The short version**

- The first version is six slices (L1–L6): three boundary PRs and about five app-logic PRs.
- Caption and credit are stored per file and delivered with every use of the image. The bundle stays format 1; existing sites keep working unchanged.
- Thumbnails are made on the server when a file is registered, with the editor's own session, and stored beside the original. The grid never loads an original.
- "Unused" means: no current draft and no currently published revision refers to the file. History does not count.
- Documents, folders, tags, a web-sized published copy and "remove from the library" each come later as their own slice. Video files are not part of this plan.

---

## 1. What exists today

| Thing | Fact | Where |
|---|---|---|
| The asset row | `cms.assets`: `id` (chosen by the uploading client), `tenant_id`, `original_path`, `filename`, `mime`, `bytes`, `width`, `height`, `sha256`, `focal_x`, `focal_y`, `default_alt`, `public_path`, `created_at`, `created_by`, `archived_at`. `mime` is one of JPEG, PNG, WebP; `bytes` at most 20 MB; `width` and `height` are `NOT NULL` | `mig/20261102000500_assets_storage.sql:19-42` |
| Length limits | `filename` 255, `original_path` 400, `default_alt` 1,000 characters | `mig/20261105140000_editor_limits.sql:93-96` |
| What an editor may write | `INSERT` of the registration columns; `UPDATE (focal_x, focal_y, default_alt, archived_at)`. Never `public_path`. No `DELETE` for anyone | `mig/20261102000500_assets_storage.sql:101-106` |
| RLS | Select, insert and update need a membership in the row's tenant. No platform-admin clause | same file, `:71-96` |
| Buckets | `media-private` (private, 20 MB, the three image types), `media-public` and `delivery` (public, worker-written) | same file, `:115-118` |
| Storage policies | Editors may select and insert in `media-private` where the first folder is a tenant they belong to. No update, no delete | same file, `:134-152` |
| Where alt text lives | **Per use:** `alt` inside each image value, `{ _ref, _kind: 'asset', alt }`. **Per file:** `default_alt`, a default only. The site always receives the use's alt, even when empty; the default is never substituted | `packages/schema/src/fields/image.ts:12-18, 30-37` |
| Default alt in practice | A new upload starts its use with an empty alt (`cms/editor/form/fields/ImageField.tsx:117`). The editor can push a use's alt up to the file's default (`:203-211`). Nothing copies the default down, because nothing picks an existing file | — |
| Focal point | Per file, `focal_x` and `focal_y` in 0..1. Delivered as `focal` on the image value | `cms/privileged/worker/projection-context.ts:58-71`; `packages/sdk/src/bundle.ts:38-51` |
| When file metadata reaches a site | At the tenant's next release. Releases are built only from committed publish requests and housekeeping, so a changed focal point waits for the next publish of anything | `cms/privileged/worker/sweep.ts:9-20`; `mig/20261104180000_withdrawal_confirmation.sql:250` |
| How usage is recorded | `cms.draft_refs` is rebuilt by trigger on every draft write; `cms.revision_refs` is written once per revision. Both carry `target_asset_id` with a same-tenant foreign key. Their only indexes are the primary keys `(tenant_id, entry_id or revision_id, path)` | `mig/20261102000400_refs.sql:25-51, 301-354`; `mig/20261102000500_assets_storage.sql:46-51` |
| Usage for an editor | None. No editor-facing `api` view or function returns it. The editor's views are `my_tenants`, `entry_list`, `entry_detail`, `asset_list`, `publication_status`, `tenant_sites`, `revision_list` and `release_pointer_lag`; elsewhere the refs tables are read only by worker, admin and archive code | grep of `supabase/migrations/`, 2026-11-12 |
| `api.register_asset` | Member of the tenant, tenant active (row locked `FOR SHARE`), path exactly `{tenant_id}/{asset_id}/{filename}`. Records what the caller declares | `mig/20261103000700_asset_trust.sql:53-84` |
| `api.update_asset` | Sets focal point and default alt together; tenant from the row; tenant active | same file, `:88-115` |
| `api.archive_asset` | Callable by `authenticated`, as invoker under RLS, so by a member of the file's tenant. Locks the row `FOR UPDATE`; refuses with `published_reference` while a revision that some entry's `published_rev_id` points to refers to the file; otherwise sets `archived_at`. It does not look at drafts, does not check that the tenant is active, and nothing reverses it | `mig/20261102000800_api_editor.sql:220-249, 314-324` |
| What "archived" does | The commit refuses a reference to an archived file (`invalid_reference`); the release build leaves archived files out; the detail page answers 404; the image field still shows it | `mig/20261104150000_publish_state.sql:288-293`; `cms/privileged/worker/build-release.ts:509-511`; `cms/app/(editor)/t/[tenant]/assets/[assetId]/page.tsx:42`; `cms/app/(editor)/t/[tenant]/asset-actions.ts:85` |
| Who calls `archive_asset` | Nobody. No file under `apps/cms/src` names it | grep, 2026-11-12 |
| `api.asset_list` | A `security_invoker` view: `id, tenant_id, filename, mime, width, height, focal_x, focal_y, default_alt, original_path, archived_at`. No size, no date | `mig/20261102000800_api_editor.sql:370-373` |
| Upload | One file. The browser checks type and size, uploads to `media-private` with the editor's session, then a server action downloads the object, derives type, size, dimensions and SHA-256 with sharp (header only), and calls `register_asset` | `cms/editor/upload.ts:54-70`; `cms/app/(editor)/t/[tenant]/asset-actions.ts:43-75`; `cms/editor/server/image-metadata.ts:21-35` |
| What the editor shows | An image field: one file input, per-use alt, "use as default alt", the focal point picker, a link to the file's detail page. A detail page: the original, file name, dimensions, default alt, focal point. No list, no picker, no archive | `ImageField.tsx:152-237`; `cms/editor/media/AssetDetail.tsx:45-137` |
| Previews | Every preview is the **original**, through a signed URL valid 600 seconds | `asset-actions.ts:98-112`; `cms/editor/upload.ts:13, 73-76` |
| Lists | A list adds one empty item at a time | `cms/editor/form/fields/ListField.tsx:112-116, 218-223` |
| Rich text | The format has an image node with a per-use `caption`; the editor has no button to insert one | `packages/rich-text/src/doc-schema.ts:107-113`; `cms/editor/form/fields/RichTextField.tsx:18` |
| Publish re-check | For each referenced file that is not public yet, the worker checks the original exists, downloads it and compares type, size, dimensions and hash with the row | `cms/privileged/worker/process-request.ts:318-334, 348-363, 397-421` |
| Public copies | The release build copies each newly referenced original to `media-public/{tenant_slug}/{asset_id}/{filename}`, one after another. The database refuses any other public path | `build-release.ts:246-253`; `mig/20261102001200_release_build.sql:88` |
| Orphans | The sweep deletes every `media-private` object older than a day that no asset row names as its `original_path` | `mig/20261103000700_asset_trust.sql:146-169`; `cms/privileged/worker/media-orphans.ts:29-39` |
| Retention | Public media leaves `media-public` once no unexpired release refers to it; one object per file | `mig/20261103200000_retention.sql:148-228` |
| Delivered image value | `{ id, url, width, height, mime, alt, focal }`. `focal` was added later as an optional field of format 1 | `packages/schema/src/projection.ts:6-14, 46-59`; `packages/sdk/src/bundle.ts:38-51` |
| What the SDK checks | Only `format`, tenant and release. The bundle is otherwise untyped JSON | `packages/sdk/src/client.ts:35, 60-78` |
| Known media findings | No pixel-size cap; EXIF and GPS are published with originals; no per-tenant quota | `docs/verification/m5-review.md:17, 31` |
| Image transformations | Not on the Free plan | `supabase/config.toml:135-137` |
| Editor limits | `authenticated` has a 3-second statement timeout; PostgREST returns at most 1,000 rows | `mig/20261105140000_editor_limits.sql:153`; `supabase/config.toml:19` |

---

## 2. The target

### 2.1 Against the ruling

| The ruling asks for | Target | Slice |
|---|---|---|
| A library page with all of a site's files | `/t/{tenant}/assets`, linked from the sidebar | L4 |
| Grid and list views | Both, from the same rows. The choice is kept in the URL | L4 |
| Search | One box: file name, alt text, caption, credit (tags when they exist). Substring match, no full-text index (§10.2 stands) | L1, L4 |
| Filters: images, documents, video | Type chips appear once a tenant can hold more than one kind: "Myndir" and "Skjöl" arrive with documents. No video chip (section 7.5) | L11 |
| Newest first | The default order; also oldest, name, largest | L4 |
| Upload several files at once | On the library page and inside the picker, with a state and an error per file | L5, L6 |
| Alt text per file | The existing `default_alt`, edited in the library, copied into a new use when a file is picked | L4, L6 |
| Caption, credit per file | New columns, edited in the library, delivered to the site with the image | L1, L3, L4 |
| Tags, folder per file | Later, each its own slice | L9, L10 |
| "Missing alt text" filter | Images whose default alt is empty | L1, L4 |
| "Unused" filter | Files that no current draft and no published revision refers to (section 4.1) | L1, L4 |
| "Notkun" | The entries that use the file, each a link, marked "Á vefnum" or "Í uppkasti" | L1, L4 |
| Several sizes per image | Recommended: one web-sized published copy, sites resize from it. A full set of sizes only on evidence (section 7.2) | L12 |
| Documents (PDF) | A second kind of file, a `file` field kind, links from rich text and link fields | L11 |
| Replaces "several images in one upload" | Pick or upload many into a list of images in one step | L6 |
| Replaces "archive unused images" | "Taka úr safni" for unused files, and putting them back | L7 |

### 2.2 Against the reference

| The reference shows | The Hub | Why |
|---|---|---|
| Title "Myndasafn", a summary line with file count, total size and a linked unused count | The same | — |
| A refresh button | Left out | The page reloads like any other |
| Left column: "Allar skrár", "Án möppu", "MÖPPUR" | Left out until folders exist (L10) | An empty column is noise |
| Search, type chips, sort, grid/list toggle, quick filters | The same, in the Hub's own toolbar (`tools`, `search`, `seg` in `globals.css`) | — |
| "Velja allt" and checkboxes on cards | Arrive with the first bulk action (L7) | Selection with nothing to do is noise |
| Cards: thumbnail or PDF icon, file name, "2048×716 · 60,5 KB" | The same | — |
| Right-hand detail panel with preview, type, size, dimensions, upload date | The same at 1024 px and up; a full-width page below that | — |
| Fields "Alt texti", "Myndatexti", "Ljósmyndari / heimild", "Mappa", "Merki", one "Vista breytingar" | The first three in L4; folder and tags with their slices. The focal point picker sits in the same panel | The Hub already has focal points |
| "Notkun 2" with the entries and their type | The same, each a link to the entry | — |
| "Slóðir": copyable URLs of the original and of each size | **Left out on purpose** | Content stores references by id, never URLs (§4.1 rule 2). A pasted URL gets no alt text, no usage, no live check, and breaks when the file is withdrawn from public storage (§5.6). Originals are private here |

The Hub's look is its own (`docs/design/ui-level-up/BRIEF.md` §3): cards, 1 px borders, Bricolage headings, accent as a fill, 44 px targets. The reference is taken for features and layout only.

---

## 3. Data model

### 3.1 New fields on a file

| Field | Column | Per file or per use | Limit | Reaches a site? | Slice |
|---|---|---|---|---|---|
| Alt text | `default_alt` (exists) and `alt` in each use (exists) | Both: the file holds a default, the use holds what is delivered | 1,000 | The use's `alt`, as today | — |
| Caption | `caption text` | **Per file** | 1,000 | **Yes:** `caption` on the delivered image value | L1, L3 |
| Credit | `credit text` | **Per file** | 300 | **Yes:** `credit` on the delivered image value | L1, L3 |
| Thumbnail | `thumb_path text` | Per file | Must equal `{tenant_id}/{asset_id}/thumb/{n}.webp` (a `CHECK`) | No. Editor only | L1, L2 |
| Tags | `tags text[]` | Per file | 20 tags, 40 characters each | No. Organising only | L9 |
| Folder | `folder_id uuid`, composite key with `tenant_id` to a new `cms.asset_folders` | Per file, one folder at most | — | No. Organising only | L10 |
| Kind | Not stored: derived from `mime` in the view (`image`, `document`) | Per file | — | `mime` is delivered already | L1 (L11 adds `document`) |

**Why caption and credit are per file.** Who took a photograph does not change with where it is shown, and a gallery then stays a plain list of images, which is what makes "pick twelve at once" possible. A page that needs its own wording under one use adds an ordinary text field beside the image in its content type, as it can today. The cost: one caption everywhere the file is shown. (Open decision 1.)

**Why alt stays per use.** The spec decided it (§5.2, §5.6) and M2 built it; the library does not reopen it. The consequence must be said in the panel: changing a file's alt text does not change the places where the file is already used. The existing help text says so (`cms/i18n/is.ts:352`).

**New `CHECK`s only on new, nullable columns.** A `CHECK` runs on every update of a row, so a limit an existing row breaks would stop that file being published or archived (`mig/20261105140000_editor_limits.sql:18-23`). New columns are null on every existing row, so no preflight is needed in L1. L11 widens two existing constraints; that slice carries its own preflight.

### 3.2 Kinds of file

| Kind | What it is | When |
|---|---|---|
| Image | JPEG, PNG, WebP, at most 20 MB. Unchanged | Today |
| Document | PDF, at most 20 MB. No dimensions, no focal point, no alt; a title per use | L11 |
| Video | **Not a file in the library.** The spec excludes video uploads (§10.2), the bucket takes 20 MB, and the platform has no transcoding or streaming. A video on a site is a link to a provider plus a still image, which is a field in a content type, not a library file (section 7.5) | Not in this plan |

### 3.3 How caption and credit reach a site

- **The delivered image value gains two keys:** `caption: string | null` and `credit: string | null`. `resolveAsset` copies exactly the `PublicAsset` fields (`packages/schema/src/projection.ts:46-59`), so both are added there, in the generated delivery types (`packages/schema/src/codegen.ts:28-40`) and in the SDK's `PublicAsset` (`packages/sdk/src/bundle.ts:43-51`). In the two type declarations sites read, they are optional (`caption?: string | null`), as `focal` is, because an older bundle lacks them.
- **The worker supplies them** from the asset row. Three `worker_*` functions return asset metadata as JSON and each gains the two keys: `worker_read_request` (`mig/20261102001100_worker_phase3.sql:96-126`), `worker_release_snapshot` (`mig/20261105130000_withdrawal_safety.sql:478-488`) and `worker_preview_draft` (`mig/20261103193500_preview_endpoint.sql:39-62`). Adding keys to their JSON is safe while the old worker still runs: it ignores them.
- **Bundle format:** stays `format: 1`. §7.2 allows additive changes, and `focal` set the precedent. No second bundle path.
- **Existing sites keep working unchanged.** The SDK checks only `format` (`client.ts:60-78`); nothing reads the new keys until a site updates its vendored SDK and types and chooses to render them.
- **One visible side effect:** in each tenant's first release after the deploy, every entry with an image gets a new `contentHash`, because the hash covers the whole projected record (§7.2). That is harmless: the live check compares each page with the hash of the same release, and only for the entries published in it (§7.4).
- **Preview** projects like a release (§7.5), so it shows caption and credit too.
- **Rich text** is unchanged in the first version. Its image node already has a per-use caption, and no editor can insert one yet. When that is built, the projected node gains `credit` and falls back to the file's caption.
- **A change to a published file's caption, credit or focal point reaches the site at the tenant's next publish**, not when it is saved. That is how focal points behave today (section 1). The first version says so in the panel; L8 removes the wait. (Open decision 2.)

---

## 4. API and security

### 4.1 Definitions

**In use.** A file is in use when either holds:

1. the current draft of an entry that is not archived refers to it (`draft_refs`, joined to `entries.archived_at is null`); or
2. the revision that an entry's `published_rev_id` points to refers to it (`revision_refs`), which is exactly the test `archive_asset` applies (`mig/20261102000800_api_editor.sql:237-242`).

**Missing alt.** An image whose default alt is null or empty is missing its alt, and so is one whose default alt is white space only.

**Unused.** Not in use, and not archived. **Older published revisions do not count.** History is append-only and never shrinks, so counting it would make every image ever published "used" for good, and the filter would be useless.

What follows from leaving history out:

- Every unused file may be taken out of the library (L7). The two lists never disagree, because clause 2 is the archive function's own test.
- Restoring an old revision whose image was since taken out still saves (the row exists), and publishing is then refused with the reference named (`invalid_reference`). The image field must say so and offer to put the file back. That is why L7 ships restore together with archive.

**Taking an in-use file out of the library** is refused: today for a published use; from L7 also for a use in a draft, with a new code `draft_reference`. A narrow race remains (a draft saved in the same instant the archive commits): the outcome is a draft that cannot be published until the file is put back or replaced, which the field shows.

### 4.2 Functions and views

All new functions are `SECURITY INVOKER` with `search_path = ''` and schema-qualified names, executable by `authenticated` only (worker functions by `service_role` only), like the rest of `api` (§4.6). No existing signature changes and nothing is dropped, so the app that is live when a migration lands keeps working.

| Object | Callable by | Does | Slice |
|---|---|---|---|
| `api.asset_list` (view, replaced with columns appended) | `authenticated` | Adds `bytes`, `created_at`, `caption`, `credit`, `thumb_path`, `kind`, `missing_alt`, `in_use`, `search_text` (file name, alt, caption and credit joined, for one `ilike`). Still `security_invoker`, so RLS decides | L1 |
| `api.asset_usage` (new view) | `authenticated` | One row per file and entry: `tenant_id, asset_id, entry_id, type, title, in_draft, in_published`. `security_invoker`; every join carries `tenant_id` | L1 |
| `api.asset_summary(tenant_id)` | `authenticated` | One JSON value: files, bytes, images, documents, missing alt, unused, archived. `not_found` for a non-member | L1 |
| `api.update_asset_text(asset_id, default_alt, caption, credit)` | `authenticated` | Edits the three texts. Same shape as `update_asset`: tenant from the row, tenant row locked `FOR SHARE`, tenant active | L1 |
| `api.set_asset_thumbnail(asset_id, thumb_path)` | `authenticated` | Records the thumbnail. The path must be the fixed one for this file, and the object must exist in `media-private` | L1 |
| `api.worker_private_orphans` (replaced, same signature) | `service_role` | Also keeps an object that an asset row names as its `thumb_path` | L1 |
| `api.worker_read_request`, `worker_release_snapshot`, `worker_preview_draft` (replaced, same signatures) | `service_role` | Asset JSON gains `caption` and `credit` | L3 |
| `api.archive_asset` (replaced, same signature) | `authenticated` | Also refuses while a draft of a live entry refers to the file (`draft_reference`) | L7 |
| `api.restore_asset(asset_id)` | `authenticated` | Clears `archived_at`; tenant active | L7 |
| `api.worker_tenants_to_release` (replaced) | `service_role` | Also lists a tenant whose latest delivered release refers to a file changed since | L8 |
| `api.set_asset_tags(asset_id, tags)`, `api.asset_tags(tenant_id)` | `authenticated` | Sets a file's tags (normalised, bounded); lists the tenant's tags with counts | L9 |
| `api.create_asset_folder`, `rename_asset_folder`, `archive_asset_folder`, `move_assets(asset_ids, folder_id)` | `authenticated` | Folders; `move_assets` takes at most 200 ids | L10 |

**Why extend the view instead of adding a search function.** The entry list already works this way: a `security_invoker` view, filtered by the app through PostgREST with the editor's session, the filter state in the URL (`cms/editor/entry-list-filter.ts`; `cms/app/(editor)/t/[tenant]/[type]/page.tsx:63-70`). The library reuses that pattern and its escaping. It adds no new kind of surface.

### 4.3 Grants, RLS and indexes

| Change | Detail | Slice |
|---|---|---|
| Column grant | `UPDATE (caption, credit, thumb_path)` on `cms.assets` to `authenticated`. Nothing new for `INSERT`: registration is unchanged | L1 |
| RLS | No new policy on `cms.assets`: the three existing policies cover the new columns. The two new views are `security_invoker` | L1 |
| Tenant lock | `update_asset_text` and `set_asset_thumbnail` lock the tenant row through the existing lock-only grant (`mig/20261103000700_asset_trust.sql:39-48`) | L1 |
| Storage | **No policy change.** The existing insert policy tests only the first folder, so an editor may already write `{tenant_id}/{asset_id}/thumb/480.webp`; the select policy lets the same editor sign it (to probe, section 12) | L2 |
| Indexes | `draft_refs (target_asset_id, tenant_id)` and `revision_refs (target_asset_id, tenant_id)`, both partial on a non-null target; `assets (tenant_id, created_at desc, id)`; `assets (thumb_path)` partial | L1 |
| Audit | `asset.updated` also records caption and credit (bounded by their limits); the audit trigger's `WHEN` clause is replaced to match, which touches no data. Thumbnails are not audited. `asset.restored` arrives with L7 | L1, L7 |
| New tenant table | `cms.asset_folders`: `tenant_id NOT NULL`, composite keys, RLS, per-column grants, and a place in §4.3's list of tenant tables, which the catalog test pins (`supabase/tests/database/010_catalog.test.sql:179, 200`) | L10 |

### 4.4 Statement limits

- Every read runs as `authenticated` under the 3-second timeout. A page is 60 files; the search box takes at most 200 characters, as the entry list does.
- `in_use` and the summary's unused count are two `EXISTS` tests per file. With the new indexes they are index lookups. To measure before L1 merges: 5,000 files and 20,000 references in one tenant, list, unused filter and summary each well under a second.
- PostgREST lets a caller filter any view column with a pattern of their choice. The new columns are short, bounded text, and the timeout bounds the rest, as accepted for the other views (`mig/20261105140000_editor_limits.sql:145-150`).
- `move_assets` and later bulk calls take at most 200 ids.

### 4.5 What must never be possible across tenants

| Never | What prevents it |
|---|---|
| Reading another tenant's files, counts or usage | RLS on `assets`, the refs tables and `entries`; the views are `security_invoker`; `asset_summary` checks membership first |
| A usage row naming another tenant's entry | Composite foreign keys make a cross-tenant reference impossible (§4.1 rule 3); the view's joins all carry `tenant_id` |
| Signing a URL for another tenant's object | Signing uses the editor's session; the storage select policy tests the first folder against memberships |
| Pointing a file's thumbnail at another tenant's object, or at any free path | The `CHECK` fixes `thumb_path` to the file's own tenant and id |
| The orphan sweep keeping or deleting the wrong tenant's objects | It compares whole object names with `original_path` and `thumb_path`; both are fixed to the row's tenant |
| Moving a file into another tenant's folder | Composite foreign key `(tenant_id, folder_id)` |
| Tag suggestions from another tenant | `asset_tags` filters by tenant, under RLS |
| A platform admin reading files without a membership | No platform-admin clause on content tables (§4.5); none is added |

Unchanged and still accepted: asset ids are global, so a guessed id collision shows as a duplicate-key error (decision 30).

---

## 5. Thumbnails

**The constraint:** the grid must never load originals. An original can be 20 MB and sits in a private bucket behind a signed URL. Today every preview in the editor is the original (section 1), so a twelve-image gallery loads twelve of them.

| Option | How | For | Against | Verdict |
|---|---|---|---|---|
| **A. Made on the server when the file is registered, stored beside the original** | The registration server action already downloads the original and opens it with sharp (`asset-actions.ts:53-55`). It also makes a 480 px WebP, uploads it with the editor's session and records it | No extra transfer: the bytes are already in memory. One code path for uploads, older files and imports. Testable in unit tests. EXIF rotation applied, EXIF and GPS dropped from the thumbnail. No privileged code | The CMS server now decodes editors' images, not only their headers. Bounded: only after the type check, with a pixel limit and a timeout | **Recommended** |
| B. Made in the browser at upload, stored beside the original | Canvas, then a second upload | No server decoding | Phones choke on large canvases; encoders differ by browser; older and imported files need a second implementation, which downloads each original to the editor's device; testable only in a browser. Needs the same database change as A | No |
| C. Made by the worker | The sweep finds files without a thumbnail | Covers every file by itself | Decodes untrusted images inside the privileged zone, next to the secret key; up to a minute with no thumbnail after an upload; eats the sweep's time budget | No |
| D. An image optimiser in front of signed URLs | `next/image` in the CMS with the signed URL as source | No stored thumbnails | Each new signature is a new source image: the optimiser downloads the full original again and bills a new transformation. A page of 60 files could pull hundreds of MB from Supabase per visit | No |
| E. Supabase transformations | `/render/image/…` | No code | Not on the Free plan; costs money per image even on Pro | No, and a money decision |

**The recommended design (A), in detail**

- **Where:** `media-private/{tenant_id}/{asset_id}/thumb/480.webp`. An original is always three path segments (`register_asset` refuses a `/` in the file name), so a four-segment path can never collide with one.
- **What:** longest side 480 px, WebP, never enlarged, rotated as EXIF says, metadata stripped. About 15–40 KB each.
- **When:** after `register_asset` succeeds. Registration never depends on the thumbnail: if making or storing it fails, the file is registered without one and shows an icon.
- **Limits on decoding:** only a file sharp has already identified as JPEG, PNG or WebP; a pixel cap (100 megapixels proposed) and a time limit. A file over the cap keeps its icon. The worker's publish re-check stays as it is: it reads headers only.
- **Recorded by:** `api.set_asset_thumbnail`, which accepts only the fixed path and only when the object exists.
- **Protected from the orphan sweep:** `worker_private_orphans` keeps any object an asset row names as its thumbnail. **Without this change every thumbnail is deleted a day after it is made** (`mig/20261103000700_asset_trust.sql:165`). L1 must be on production before L2.
- **Shown through:** signed URLs, signed in one call per page with the editor's session, valid 600 seconds like every other preview, signed again when one fails to load (the existing pattern, `ImageField.tsx:47-48, 93-96`).
- **Trust:** a member calling the API directly can store any image as their own tenant's thumbnail. It is shown only to that tenant's editors and is never published. Accepted.
- **Forms too:** the image field and the focal point picker switch to the thumbnail, so a gallery stops loading originals. "Open the original" stays a link in the detail panel.

**Files uploaded before the change** have no thumbnail. The library page asks for them: for each visible image without one, a server action (`ensureThumbnailAction`, editor's session) downloads the original, makes the thumbnail and records it, one after another, and the card swaps the icon for the picture. Each file is done once. The same function is what an import tool should call, so imported files arrive with thumbnails.

---

## 6. The editor

### 6.1 The library page

- **Route:** `/t/{tenant}/assets`. `assets` is already a reserved segment that no content type may use (`cms/modules/__tests__/registry.test.ts:30-33`). The sidebar gets a fixed link under the content types (`cms/ui/Sidebar.tsx:39-58`).
- **Rendered on the server,** with the state in the URL, like the entry list: `?q=` search, `kind=`, `filter=missing-alt|unused`, `sort=`, `view=grid|list`, `page=`, `file=`. A filtered view can be reloaded and shared, and the search form works before JavaScript loads.
- **Head:** the title, the summary line (files, total size, unused count as a link to the unused filter), and "Hlaða upp".
- **Toolbar:** search, type chips (once a second kind exists), sort, grid/list toggle, the two quick filters.
- **Grid:** cards with the thumbnail (or an icon), file name, dimensions and size. Four columns at 1440 px with the panel open, two at 375 px.
- **List:** a real table with thumbnail, name, type, size, dimensions, upload date and usage count, restyled as stacked rows below 768 px as the entry list is.
- **Paging:** 60 files, then "Sýna fleiri".
- **Detail panel:** opened by `?file={id}`. Preview, type, size, dimensions, upload date; the focal point picker; alt text, caption and credit with one "Vista breytingar"; "Notkun" with each entry as a link and its state; "Open the original". A file used on the site shows the note that changes go out with the next publish (until L8).
- **The old detail page** `/t/{tenant}/assets/{id}` stays, because image fields link to it, and renders the same panel.

### 6.2 Uploading several files

- "Hlaða upp" opens the file chooser with `multiple`. Dropping files on the page does the same; the button is the accessible path.
- Each file is checked first (type, size) with the existing `prepareUpload`, then uploaded straight to storage, three at a time, then registered. At most 50 files per batch.
- **Per file:** waiting, uploading with a percentage, processing, done, or failed with the reason and "Reyna aftur". A retry uses a new id and path; the abandoned object is removed by the orphan sweep.
- **Percentages** need the upload to go through a request that reports progress (`XMLHttpRequest` to the Storage endpoint with the editor's token), since the Storage client reports none. If that proves fragile, the states alone are enough.
- **No picture while uploading.** The page's content policy allows no `blob:` images (`cms/lib/security-headers.ts:44`), and changing it is boundary work with no need: the row shows an icon and the name, and the thumbnail when the file is registered.
- **A lost session** stops the queue, keeps what is left as waiting, and shows the existing "Innskráningin er útrunnin" notice.
- **When the batch ends** the grid reloads with the new files first, and one sentence says how many arrived and how many failed.
- Registration runs one file after another if Next.js queues server actions per tab (to probe): twelve files then take perhaps half a minute after their uploads finish. The states make that visible.

### 6.3 Where the library meets a form

**Choosing one image.** An image field gets a second button, "Velja úr safni", beside the upload button. It opens a dialog with the library in pick mode: search, newest first, images only. Choosing a file sets the field to `{ _ref, _kind: 'asset', alt }` with `alt` **copied from the file's default alt**, so the editor does not type it again and can still change it for this use. The dialog can also upload, so "upload, then use" is one flow.

**Choosing several into a list of images.** A list whose items are images gets "Bæta við úr safni" beside "Bæta við". The same dialog opens in multi-select mode; "Velja 12 myndir" appends twelve items in the order chosen, each with its alt copied. Files uploaded inside the dialog arrive selected. A list with a `max` takes what fits and says how many were left out. The generic rule: bulk add is offered when the list's item kind is `image` (and `file`, from L11). A list of groups keeps adding one item at a time.

### 6.4 Keyboard and screen readers

- The grid is one tab stop. Arrow keys move between cards, Enter opens the file's details (or confirms in the picker), Space selects in multi-select. `/` focuses the search, as on the entry list. Escape closes the panel or the dialog.
- Every card is a link named by its file name and, when it has one, its alt text. A thumbnail is decorative there and has an empty `alt`.
- The picker is a native `<dialog>`: focus is trapped, Escape closes it, and focus returns to the button that opened it. Its title names the field.
- Opening a file moves focus to the panel's heading; closing returns it to the card.
- Upload progress is one polite live region with a summary ("3 af 12"), not twelve. A failure is an alert. The page keeps a single `role="status"`, as the forms do.
- Selection counts are announced ("3 myndir valdar"). Every icon-only control has a name. Targets are 44 px.

### 6.5 At 375 px

- The toolbar wraps: search on its own row, filters and sort below, chips scroll sideways.
- The grid is two columns; the list is stacked rows.
- The detail panel covers the page, with "Til baka í safnið" at the top. No JavaScript is needed for it: it is the same `?file=` URL, laid out by CSS.
- The upload queue is a list under the head. The picker dialog fills the screen.

### 6.6 Empty and error states

| State | Shows |
|---|---|
| No files yet | A card with one sentence and "Hlaða upp" |
| No file matches | "Engar skrár passa við leitina." and "Hreinsa síu" |
| The list fails to load | The app's error page (`cms/app/error.tsx`), as for any page |
| A thumbnail is missing or fails | The file-type icon; one new signature is tried first |
| A save fails | The existing "Ekki tókst að vista. Reyndu aftur.", with the typed text kept |
| The tenant is suspended | The layout's existing notice; the page renders nothing (`cms/app/(editor)/t/[tenant]/layout.tsx:26-41`) |
| A file is wrong or too large | Named on that file's row in the queue; the others continue |

---

## 7. The heavier parts

### 7.1 Documents (L11)

**Approach:** a PDF is a second kind of asset on the same row, the same buckets and the same publish path, plus one new field kind.

| At the boundary | Change |
|---|---|
| Bucket | `media-private` also allows `application/pdf`. The 20 MB limit stays |
| `cms.assets` | The `mime` check is replaced by a wider one; `width` and `height` lose `NOT NULL`, and a new check requires them for images. This is the plan's only replaced constraint: it widens what is accepted and touches no row. A preflight stops the migration if any row would break the new check |
| Storage policies | None: they test the folder, not the type |
| Registration | The server action identifies a PDF by its leading bytes, and derives size and hash. It does not parse the document |
| The worker's re-check | `mismatchedOriginals` uses `inspectImage` and treats anything else as a mismatch (`process-request.ts:410-411`). It gets a second branch for documents: leading bytes, size, hash |
| Field kind | `file`: stores `{ _ref, _kind: 'asset', title? }`, delivers `{ id, url, filename, mime, bytes, title }`. An `image` field refuses a document at projection, so the worker rejects the publish before commit (§6.2) |
| Rich text and link fields | The link mark and the `link` kind gain a third target, a document reference, which the projection turns into a plain `href`. Sites' renderers see an ordinary link and need no change. The stored format changes in `packages/rich-text`, which §11.3 lists as hard to reverse: additive, but reviewed as such |
| Delivery | Copied to `media-public` like an image; withdrawn by the same retention. The live check already tests every public media URL it finds in an entry (`cms/privileged/worker/deliver.ts:149-155`) |
| SDK | A new `PublicFile` type. Additive; old sites have no field of this kind |
| Library | The "Skjöl" chip, a PDF icon, no thumbnail, no alt, no focal point |

**Not proposed:** other document types (Word, Excel, ZIP). Each is a new thing to serve from a public bucket. PDF only, until someone asks. (Open decision 6.)

### 7.2 Several sizes per image (L12)

**What is true today:** a site receives the URL of the original, copied as it was uploaded, and resizes it itself, in practice with `next/image`. Three problems follow, none solved by the site: the public file can be 20 MB; it carries EXIF and GPS (`m5-review.md:31`); and the full-resolution original is public.

| Option | Who makes what, where | A site addresses sizes by | Boundary cost |
|---|---|---|---|
| 1. Leave it to each site | Nothing | `next/image`, from the original | None. Two site settings to document: a one-year cache for the optimiser (public files never change, §5.6) and a `pathname` in `remotePatterns` |
| **2. One web-sized published copy** (recommended) | The registration action makes one rendition (longest side 2,560 px, metadata stripped) with the editor's session, as it makes the thumbnail, and stores it beside the original in `media-private`. At publish the worker checks the rendition and copies it, instead of the original, to its own path in `media-public` | `next/image`, from the rendition. The delivered value keeps its shape; `url`, `width`, `height` and `mime` describe the rendition | Large: new columns; the worker's re-check and copy; `worker_finish_release`'s path rule (`mig/20261102001200_release_build.sql:88`); retention's object names. A file already public keeps its public file: a rendition gets a new path, never an overwrite |
| 3. A full set of sizes | As 2, for five or six widths | `sizes: [{ url, width, height }]` on the delivered value and a `srcSet` helper in the SDK; no optimiser needed | As 2, times the number of sizes: five times the copies inside the build's 270-second limit, five times the objects to withdraw, more storage on a 1 GB plan |

**Recommendation:** option 2, after the first version, and only then decide on option 3 with real numbers from a live site. Option 2 fixes the three problems above; option 3 mostly repeats what each site's optimiser already does. Files without a rendition keep publishing their original, so nothing breaks for files uploaded earlier. (Open decision 4.)

### 7.3 Folders (L10)

- **Approach:** flat folders, one folder per file at most, as the reference shows. A new tenant table `cms.asset_folders (id, tenant_id, name, created_at, created_by, archived_at)` and `assets.folder_id`.
- **At the boundary:** a new tenant table is the heaviest kind of change here: RLS, per-column grants, composite keys, the catalog and persona suites, and §4.3's list. Removing a folder archives it and leaves its files in the library; nothing is deleted.
- **In the editor:** the reference's left column ("Allar skrár", "Án möppu", the folders), "Mappa" in the panel, and "Færa í möppu" for a selection.
- **Never reaches a site.**

### 7.4 Tags (L9)

- **Approach:** `tags text[]` on the file. No tag table: a tag exists while a file carries it. Normalised (trimmed, lower case, no duplicates), at most 20 per file.
- **At the boundary:** one column, one column grant, two small functions. The search text includes tags; the tag filter is an array test within one tenant. No GIN index (§4.3), which is fine at a few thousand files per tenant.
- **In the editor:** "Merki" in the panel with suggestions from the tenant's own tags; a tag filter in the toolbar.
- **Never reaches a site.** Tags that drive a site's pages are content, and belong in a content type.

### 7.5 "Video"

- **What it can honestly mean here:** a link to a video on a provider (YouTube, Vimeo), with a still image from the library. That is a field in a content type, placed where the site's design puts it. It is not a file, so it does not belong in the library and gets no chip.
- **What it cannot mean without a new decision:** uploading video files. §10.2 excludes it; the bucket takes 20 MB; storage is about 1 GB; there is no transcoding. It would need a video host, which costs money.
- **Proposal:** no video in this plan. A generic `video` field kind (provider, id, still image) is a separate, small enhancement for the enhancement list. (Open decision 5.)

---

## 8. The split

**Sizes:** S is one PR of app logic. M is two or three PRs, or one boundary PR. L is a migration plus API plus UI plus SDK.

**Review tiers** (`CLAUDE.md`, "How work runs"): **Boundary** is implementer, then spec and security reviewers in parallel, then quality. **App logic** is implementer, then one combined review.

| # | Slice | An editor gets | Tier | Size | Needs | First version |
|---|---|---|---|---|---|---|
| L1 | Library data and API | Nothing visible | Boundary | M | — | **Yes** |
| L2 | Thumbnails | Small previews in every image field; forms stop loading originals | Boundary (storage; decodes uploads) | M | L1 on production | **Yes** |
| L3 | Caption and credit on the site | The two texts are delivered with every image | Boundary (publishing, SDK) | M | L1 | **Yes** |
| L4 | The library page | The page: grid, list, search, filters, details, usage, unused | App logic | M (2 PRs) | L1, L2 | **Yes** |
| L5 | Upload several files | Many files at once, a state and an error per file | App logic, plus a security review of the upload request (it carries the editor's token outside the Storage client) | S | L2, L4 | **Yes** |
| L6 | The library in forms | "Velja úr safni" in an image field; pick or upload many into a list | App logic | M (2 PRs) | L4, L5 | **Yes** |
| L7 | Take out and put back | Unused files leave the library, singly or many; they can be put back | Boundary | M | L4 | No |
| L8 | File changes go live by themselves | A changed caption, credit or focal point reaches the site within minutes | Boundary (publishing) | M | L3 | No |
| L9 | Tags | Tags per file, a tag filter | Boundary + app logic | M | L4 | No |
| L10 | Folders | Folders, moving files | Boundary + app logic | L | L4, L7's selection | No |
| L11 | Documents | PDFs in the library, a file field, document links | Boundary | L | L4, L6 | No |
| L12 | Web-sized published copy | Smaller, clean public images | Boundary (publishing) | L | L2; decision 4 | No |

L3 and L4 can be built side by side once L1 is merged. L1's and L3's migrations can go to production in one `supabase db push`, before the `production` branch advances.

### How every boundary slice is tried on the local stack

Production cannot be reset and has no backup, so a clean `pnpm db:reset` is not enough. Each boundary slice also rehearses the upgrade:

1. On `main`: `pnpm db:reset`, then create real rows with the browser suite: uploaded files, a published entry, a delivered release.
2. Apply only the new migration to that database (`supabase migration up`, telemetry off), not a reset.
3. **With the old app still running** against the migrated database: upload, edit alt text, publish, run the sweep. This is the gap between `db push` and advancing `production`.
4. With the new app: the slice's own checks below.
5. On the branch: `pnpm db:reset`, `pnpm db:test`, `pnpm test`, `pnpm test:integration`, `pnpm test:delivery`, `pnpm lint`, `pnpm typecheck`, and the browser suite once before the PR.

### L1. Library data and API

- **Delivers:** the database side of the first version. Nothing an editor sees.
- **Touches:** one migration: `caption`, `credit`, `thumb_path` and their checks on `cms.assets`; the column grant; `update_asset_text`, `set_asset_thumbnail`, `asset_summary`; `asset_list` replaced with appended columns; `asset_usage`; four indexes; `worker_private_orphans` replaced; the audit function. `supabase/tests/database/` (a new file, and the pinned grants in `050_assets_storage` and `080_api_editor`). `tests/integration/src/`. `cms/lib/supabase/types.ts` if it lists views.
- **Tests:** pgTAP: each function is invoker, pinned `search_path`, executable by `authenticated` only; exact column privileges; the checks; a truth table for `in_use` (draft only, published only, an archived entry's draft, an old revision only, nothing); an editor of tenant B gets `not_found` or no rows from every new object for tenant A's file; a thumbnail path outside the file's own folder is refused; the orphan listing keeps a named thumbnail and still lists an unnamed one. Integration: the views through PostgREST; the search pattern with `%`, `_` and `*`; timings at 5,000 files.
- **Local trial:** the upgrade rehearsal. In step 3, confirm the old app's asset page and image field still work against the wider view.

### L2. Thumbnails

- **Delivers:** thumbnails for new uploads at once and for older files on first view; image fields and the focal point picker show them.
- **Touches:** `cms/editor/server/` (a thumbnail maker beside `image-metadata.ts`), `cms/app/(editor)/t/[tenant]/asset-actions.ts` (register makes one; `ensureThumbnailAction`; previews return the thumbnail URL), `cms/editor/upload.ts`, `ImageField.tsx`, `AssetDetail.tsx`, `FocalPointPicker.tsx`. No migration.
- **Tests:** unit: a JPEG with EXIF rotation, a PNG with transparency, a WebP, an image over the pixel cap (registered, no thumbnail), a corrupt file, a failed thumbnail upload (registered, no thumbnail). Action tests: session, tenant and argument checks as for the existing actions. Integration on real storage: upload, register, the thumbnail exists and is signed; an editor of another tenant cannot sign it; after a simulated day the sweep's listing leaves it alone. Browser: an image field requests no original.
- **Local trial:** upload a 20 MB JPEG and a large PNG; note time and memory of the action. Run the sweep with the grace period forced down and confirm thumbnails survive.

### L3. Caption and credit on the site

- **Delivers:** both texts in the bundle and in preview.
- **Touches:** one migration (three `worker_*` functions replaced, same signatures). `cms/privileged/worker/projection-context.ts`, `build-release.ts`, `process-request.ts`, `cms/privileged/preview/endpoint.ts`. `packages/schema/src/projection.ts`, `codegen.ts`. `packages/sdk/src/bundle.ts` and a version bump (OPEN-ISSUES R1). `apps/demo-site` renders them. Module fixtures and generated types.
- **Tests:** worker unit tests (context, bundle entry, the fallback path left alone); schema tests (`resolveAsset`, the generated prelude); pgTAP for the three functions' JSON; the Delivery suite; the local end-to-end test: set a caption, publish, read it in the bundle and in preview; the Next.js 15 fixture still parses the bundle. `pnpm check:schema` must report no change: field shapes are untouched.
- **Local trial:** the upgrade rehearsal, watching step 3 closely: the old worker must build a release from the new functions' output. Then publish on the demo tenant and read the public bundle.

### L4. The library page

- **Delivers:** the page of section 6.1, including editing alt, caption and credit, usage and the two filters.
- **Touches:** new `cms/app/(editor)/t/[tenant]/assets/page.tsx`; new components under `cms/editor/media/`; a filter module beside `entry-list-filter.ts`; `cms/ui/Sidebar.tsx`; `cms/i18n/is.ts`; `globals.css`. PR 1: route, navigation, grid and list, search, filters, sort, paging. PR 2: the detail panel, saving, usage.
- **Tests:** unit: filter parsing and the query builder; sizes and dates in Icelandic form ("60,5 KB", "4. okt. 2026"); the summary's singular and plural. Integration: the query builder against PostgREST, as `entry-list-filter.test.ts` does. Browser at 375, 768 and 1440 px: search, each filter, both views, open a file, save a caption, follow a usage link; a keyboard-only pass.
- **Local trial:** the demo and fixture tenants with a few dozen seeded files, some used, some not.

### L5. Upload several files

- **Delivers:** section 6.2.
- **Touches:** `cms/editor/upload.ts` (an upload that reports progress), a queue hook and its list component under `cms/editor/media/`, the library page.
- **Tests:** unit: the queue (states, three at a time, retry with a new id, stopping on a lost session, the 50-file cap). Browser: five files, one too large and one of the wrong type: three arrive, two are named with their reason.
- **Local trial:** twelve real photographs of 5–10 MB each, on a throttled connection.

### L6. The library in forms

- **Delivers:** section 6.3.
- **Touches:** a picker dialog under `cms/editor/media/`, a server action that lists files for it, `ImageField.tsx`, `ListField.tsx`. PR 1: single pick. PR 2: multi-select and lists.
- **Tests:** unit: selection order, the list's `max`, alt copied from the default. Browser: pick one; upload inside the picker and pick it; pick twelve into a list, reorder, publish, read the bundle; the same with the keyboard only. `list-group.spec.ts` grows a case.
- **Local trial:** a throwaway content type with a list of images, at phone and desktop width.

### L7 to L12, in brief

| Slice | Touches | Local trial and tests |
|---|---|---|
| L7 | A migration (`archive_asset` replaced, `restore_asset`, audit); selection and a bulk bar on the library page; the "taken out" filter; a notice in the image field | pgTAP for both refusals, restore and audit rows; a concurrency test against the commit's `FOR SHARE` lock; browser: take out, find, put back, and the restored-revision case of section 4.1 |
| L8 | A migration (a change timestamp on files, `worker_tenants_to_release`); the sweep | This touches the most delicate SQL in the repository (the housekeeping and withdrawal rules). pgTAP for the selection; the Delivery suite; a local run: change a caption, publish nothing, see a release and a revalidation within two minutes, and no interference with a pending withdrawal |
| L9 | A migration (column, grant, two functions, the view); panel and toolbar | pgTAP for bounds and isolation; browser |
| L10 | A migration (new tenant table, column, four functions); the catalog and persona suites; §4.3; the left column | The full catalog and persona suites; browser |
| L11 | Section 7.1's table: bucket, constraints with a preflight, registration, the worker, `packages/schema`, `packages/rich-text`, `packages/sdk`, the editor | The upgrade rehearsal with image rows in place; the trust tests extended to PDFs; a PDF published, linked, withdrawn; `pnpm check:schema` |
| L12 | Section 7.2, option 2 | The upgrade rehearsal with public files in place: a file already public must keep working through the change; the retention tests |

### The first version

**L1 to L6.** That is the ruling's list (the library screen, multi-upload, caption and credit, usage, unused) plus the two things it cannot honestly ship without: thumbnails, and the picker. Without the picker a file uploaded in the library could not be placed in an entry, and the gallery task the library replaces ("several images in one upload") would be lost.

**Could be cut if time ran short,** in this order:

1. The list view (grid only).
2. Sort choices other than newest first.
3. Upload percentages (states only), and drag and drop.
4. The summary line's total size.
5. The "missing alt text" filter (the ruling's first-version list names only "unused").
6. Thumbnails for older files on first view, if the import makes its own. Older files then show icons.

**Must not be cut:**

- Thumbnails, with the orphan-sweep change on production first.
- The tests for tenant isolation on every new view and function.
- Delivery of caption and credit (L3). Fields that are stored and never delivered would mislead editors.
- The upgrade rehearsal on the local stack for L1 and L3.
- The picker's multi-select.
- A state and a reason per file in a multi-upload.

---

## 9. Spec amendments the ruling requires

Made as each slice merges, with the ruling's decision number once the coordinator records it. "First version" rows change with L1–L6.

| Where | Today | Becomes | With |
|---|---|---|---|
| Header, Revisions | — | A line for the ruling: a media library per tenant; caption and credit per file; thumbnails | L1 |
| §4.3 `assets` row | Columns end `…default_alt, public_path, created_at/by, archived_at`; limits for `filename`, `original_path`, `default_alt` | Adds `caption` (1,000), `credit` (300), `thumb_path` (fixed form) | L1 |
| §4.3 tenant tables | Eleven tables | Adds `asset_folders` | L10 |
| §4.5 grants, `assets` | `UPDATE (focal_x, focal_y, default_alt, archived_at)` | Adds `caption, credit, thumb_path` | L1 |
| §4.5 grants, `tenants` | "…lets `register_asset` and `update_asset` lock the tenant row" | Names `update_asset_text` and `set_asset_thumbnail` too | L1 |
| §4.6 table | Three asset functions | Adds `update_asset_text`, `set_asset_thumbnail`, `asset_summary`; later `restore_asset` and the tag and folder functions. `archive_asset`: "Refused while any currently published revision, or (L7) the draft of a live entry, references the asset" | L1, L7, L9, L10 |
| §4.6 views | The editor's views are listed in prose | Names `asset_usage` | L1 |
| §4.7 | "asset registration, metadata change, archive" | Metadata includes caption and credit; adds restore | L1, L7 |
| §5.2 | "`image` (asset reference with per-use `alt`)" | "…with per-use `alt`; the file's caption and credit are delivered with it". Later adds `file` | L3, L11 |
| §5.4 | "link (external URL, or entry reference with `_ref`)" | Adds a document reference | L11 |
| §5.6 bucket table | `media-private` path `{tenant_id}/{asset_id}/{filename}` | Adds the thumbnail path, written by the editor's own session | L2 |
| §5.6 Upload | "A server action reads it, derives … and calls `register_asset`" | "…and makes a thumbnail, stored beside the original" | L2 |
| §5.6 Accepted formats | "JPEG, PNG, WebP; maximum 20 MB" | Adds PDF | L11 |
| §5.6 Editing | "focal point and default alt text per asset; alt text per use" | "focal point, default alt text, caption and credit per asset; alt text per use" | L1 |
| §5.6 In the editor | "originals are shown through short-lived signed URLs" | "thumbnails are shown through short-lived signed URLs; an original only on request" | L2 |
| §5.6, new paragraph | — | The library: in use, unused, and that history does not count (section 4.1) | L1 |
| §5.6 last bullet | "Assets referenced by a currently published revision cannot be archived" | Adds drafts, and that an archived asset can be restored | L7 |
| §5.6 Publication | "copies every asset referenced … from `media-private`" | Copies the web-sized rendition where one exists | L12 |
| §7.1 build steps | "resolve assets to public URLs" | "…with their caption and credit" | L3 |
| §7.2 | Format evolution is stated in general | Records `caption` and `credit` as additive fields of format 1, after `focal` | L3 |
| §10.1 | "Media: private originals, focal point, alt text, public copies on publish." | Adds: "a media library per tenant (listing, search, filters, usage), several files per upload, caption and credit, thumbnails" | L4 |
| §10.2 | "video and document uploads beyond images" | Unchanged until L11, then "video uploads". Adds: "hard deletion of files · copyable public file URLs in the editor" | L11, L4 |
| §11.2, first risk row | Mitigation "images only" | "images and PDF only" | L11 |
| §12 | — | A row: "No media library in v1; files reachable only from an image field" is superseded by the ruling | L4 |

§7.4, §11.3 and the bundle example in §7.2 need no change. L8 adds one sentence to §7.1 ("a release is also built when a published file's metadata changed").

---

## 10. New strings, all DRAFT

For Einar's approval in one batch. Wording follows the reference where it fits and the Hub's existing words otherwise ("alt-texti" with a hyphen, as in `cms/i18n/is.ts:253, 351`). `{…}` are filled in by the code.

### First version (L2, L4–L6)

| Key | DRAFT text | Note |
|---|---|---|
| `library.title` | Myndasafn | The Hub already says "í myndasafninu" (`is.ts:315`). See decision 7 |
| `library.filesOne` / `filesMany` | {n} skrá / {n} skrár | Summary line |
| `library.unusedOne` / `unusedMany` | {u} ónotuð / {u} ónotaðar | A link to the filter |
| `library.upload` | Hlaða upp | |
| `library.search` | Leita eftir heiti, alt-texta, myndatexta eða ljósmyndara… | "…eða merki" joins with L9 |
| `library.sort.newest` / `oldest` / `name` / `largest` | Nýjast fyrst / Elst fyrst / Heiti A–Ö / Stærst fyrst | |
| `library.view.grid` / `list` | Sýna sem reiti / Sýna sem lista | Names of the two toggle buttons |
| `library.filter.missingAlt` | Vantar alt-texta | |
| `library.filter.unused` | Ónotaðar | |
| `library.meta` | {width}×{height} · {size} | Card line |
| `library.col.*` | Skrá · Tegund · Stærð · Mál · Hlaðið upp · Notkun | List headings |
| `library.more` | Sýna fleiri | |
| `library.empty` | Engar skrár enn. | |
| `library.emptyBody` | Hladdu upp myndum til að nota þær í efni vefsins. | |
| `library.none` | Engar skrár passa við leitina. | "Hreinsa síu" exists |
| `library.detail.title` | Upplýsingar um skrá | Panel heading |
| `library.detail.close` | Loka | |
| `library.detail.back` | Til baka í safnið | Below 1024 px |
| `library.detail.alt` | Alt-texti | |
| `library.detail.altHelp` | Lýsing á myndinni fyrir þá sem sjá hana ekki. Hún fylgir myndinni þegar hún er valin í efni. Þar sem myndin er þegar í notkun gildir textinn sem þar er skráður. | |
| `library.detail.caption` | Myndatexti | |
| `library.detail.captionHelp` | Birtist með myndinni þar sem vefurinn sýnir myndatexta. | |
| `library.detail.credit` | Ljósmyndari / heimild | |
| `library.detail.creditHelp` | Til dæmis nafn ljósmyndara. Birtist með myndinni þar sem vefurinn sýnir það. | |
| `library.detail.save` | Vista breytingar | |
| `library.detail.saved` | Breytingar vistaðar | |
| `library.detail.nextPublish` | Breytingar á myndatexta, ljósmyndara og þungamiðju birtast á vefnum næst þegar eitthvað er birt. | Only for a file used on the site. Goes with L8 |
| `library.detail.original` | Opna upprunalegu skrána (í nýjum flipa) | |
| `library.usage.title` | Notkun | |
| `library.usage.none` | Þessi skrá er hvergi í notkun. | |
| `library.usage.live` / `draft` | Á vefnum / Í uppkasti | |
| `upload.title` | Hlaða upp skrám | |
| `upload.choose` | Velja skrár | |
| `upload.drop` | eða dragðu skrár hingað | |
| `upload.waiting` | Í bið | |
| `upload.uploading` | Hleð upp… {p} % | |
| `upload.processing` | Vinn úr skránni… | |
| `upload.done` | Lokið | |
| `upload.failed` | Ekki tókst að hlaða skránni upp. | "Reyna aftur" exists |
| `upload.remove` | Fjarlægja af lista | |
| `upload.progress` | Búið að hlaða upp {done} af {total} skrám. | Live region |
| `upload.resultOne` / `resultMany` | {n} skrá er komin í safnið. / {n} skrár eru komnar í safnið. | |
| `upload.failedOne` / `failedMany` | Ekki tókst að hlaða upp {f} skrá. / Ekki tókst að hlaða upp {f} skrám. | |
| `upload.tooMany` | Mest er hægt að hlaða upp {max} skrám í einu. Þeim sem voru umfram var sleppt. | |
| `editor.image.choose` | Hlaða upp mynd | **Changes an approved string** (today "Velja mynd"), so the two buttons read apart |
| `editor.image.fromLibrary` | Velja úr safni | |
| `picker.titleOne` / `titleMany` | Velja mynd úr safni / Velja myndir úr safni | |
| `picker.confirmOne` / `confirmMany` | Velja mynd / Velja {n} myndir | |
| `picker.selectedOne` / `selectedMany` | {n} mynd valin / {n} myndir valdar | Announced |
| `picker.empty` | Engar myndir í safninu enn. Hladdu upp mynd til að byrja. | |
| `editor.list.addFromLibrary` | Bæta við úr safni | |
| `editor.list.noRoom` | Aðeins var pláss fyrir {n} í viðbót. Hinum var sleppt. | |

The type and size messages for a file reuse the approved ones (`is.ts:249-250`).

### Later slices

| Slice | Key | DRAFT text |
|---|---|---|
| L7 | `library.remove` | Taka úr safni |
| L7 | `library.removeMany` | Taka {n} skrár úr safni |
| L7 | `library.removeConfirm` | Skráin hverfur úr safninu og ekki verður hægt að velja hana í efni. Henni er ekki eytt og þú getur sett hana aftur í safnið hvenær sem er. |
| L7 | `library.removeYes` | Já, taka úr safni |
| L7 | `library.removeRefused` | Skráin er í notkun. Fjarlægðu hana fyrst úr efninu sem notar hana. |
| L7 | `library.filter.removed` | Teknar úr safni |
| L7 | `library.restore` | Setja aftur í safnið |
| L7 | `library.selectAll` / `clearSelection` | Velja allt / Hreinsa val |
| L7 | `editor.image.removed` | Þessi mynd hefur verið tekin úr safninu. Settu hana aftur í safnið eða veldu aðra mynd áður en þú birtir. |
| L9 | `library.detail.tags` / `addTag` | Merki / Bæta við merki… |
| L9 | `library.detail.removeTag` | Fjarlægja merkið „{tag}“ |
| L10 | `library.folders.all` / `none` / `title` | Allar skrár / Án möppu / Möppur |
| L10 | `library.folders.new` / `name` / `empty` | Ný mappa / Heiti möppu / Engar möppur enn. |
| L10 | `library.detail.folder` / `move` | Mappa / Færa í möppu |
| L10 | `library.folders.rename` / `remove` | Endurnefna möppu / Fjarlægja möppu |
| L10 | `library.folders.removeConfirm` | Skrárnar í möppunni verða áfram í safninu, án möppu. |
| L11 | `library.kind.all` / `images` / `documents` | Allt / Myndir / Skjöl |
| L11 | `upload.type` | Aðeins er hægt að hlaða upp JPEG-, PNG- og WebP-myndum og PDF-skjölum. |
| L11 | `upload.size` | Skráin má ekki vera stærri en 20 MB. |
| L11 | `editor.file.choose` / `replace` / `remove` | Velja skjal / Skipta um skjal / Fjarlægja skjal |
| L11 | `editor.file.title` | Heiti tengils |

"Taka úr safni" is chosen over the entries' word for archived, "Í skjalasafni" (`is.ts:128`), because a library with a "Skjöl" filter would make "skjalasafn" read as "the documents".

---

## 11. Open decisions for Einar

| # | Decision | Recommended | The other option, and what each costs |
|---|---|---|---|
| 1 | Are caption and credit per file or per use? | **Per file,** delivered with every use | Per use (stored in each image value, like alt): different wording per place, but a gallery becomes a list of groups, so picking twelve at once is lost; a corrected credit must be fixed in every entry; and it changes the stored shape of the `image` kind |
| 2 | A changed caption, credit or focal point on a published file goes live at the tenant's next publish. Remove that wait? | **Yes, as L8, after the first version.** The first version says it in the panel | Accept it for good: no work, but editors will ask why a corrected credit is not on the site. L8 costs one boundary PR in the most delicate part of publishing |
| 3 | "Unused" ignores older published revisions | **Yes** (section 4.1) | Count history: nothing ever published would be unused, so the filter and "Taka úr safni" would cover only files never published |
| 4 | Several sizes per image | **One web-sized published copy (L12),** sites resize from it; decide on a full set of sizes later, on numbers | Leave it to each site: no work, but originals up to 20 MB with EXIF and GPS stay public. A full set now: about five times the public objects and copies, on a 1 GB plan |
| 5 | Video | **No video in the library.** A `video` field kind (a provider link and a still) goes on the enhancement list | Video files: needs a video host and a budget. Not possible on the present storage |
| 6 | Which documents | **PDF only, 20 MB** | Word, Excel, ZIP: each one more type served from a public bucket, and a wider check at upload and at publish |
| 7 | The page's name | **"Myndasafn"** now; revisit when documents arrive ("Myndir og skjöl") | "Skráasafn" from the start: accurate later, colder now |
| 8 | No copyable URLs in the panel (the reference's "Slóðir") | **Leave them out** (section 2.2) | Show them: editors will paste them into text, and those links break when a file is withdrawn |
| 9 | Files are never deleted, only taken out of the library. Storage is not freed | **Accept for now;** look again when storage nears the plan's limit | A real delete: destructive work on a production with no backups, refused by the spec for any file a revision ever referenced (`ON DELETE RESTRICT`) |

Not Einar's to decide, settled here: thumbnails are made on the server at registration (section 5); folders are flat; tags and folders never reach a site.

---

## 12. Before building, and what is not in this plan

**To probe on the local stack** (`CLAUDE.md`: "Probe before planning"), each before the slice named:

| Assumption | Slice |
|---|---|
| An editor's session can upload and sign `{tenant_id}/{asset_id}/thumb/480.webp` under today's storage policies, and cannot under another tenant's folder | L1 |
| `CREATE OR REPLACE VIEW` with appended columns keeps `api.asset_list`'s grants and the old app's reads | L1 |
| An invoker function can see the caller's own `storage.objects` rows under the storage policies, so `set_asset_thumbnail` can require that the object exists | L1 |
| The list, the unused filter and the summary stay far below 3 seconds at 5,000 files and 20,000 references | L1 |
| sharp makes a thumbnail from a 20 MB JPEG and a 20 MB PNG within the server action's memory and a few seconds | L2 |
| One call signs 60 thumbnail paths quickly enough for a page render | L4 |
| Next.js runs one server action at a time per tab, so registrations queue | L5 |
| An upload sent with `XMLHttpRequest` and the editor's token reports progress and passes the content policy | L5 |

**Unverified figures used above:** the Free plan's storage (about 1 GB) and egress allowances; Vercel's image-optimisation pricing. Check them before decision 4.

**Not in this plan:** inserting images in rich text (the picker makes it easy; it is its own enhancement); cropping or editing images; replacing a file in place (public files never change, §5.6); duplicate detection; a per-tenant storage quota; hard deletion; other document types; video files.

**For the import work:** an import that registers files through the public API should also call the thumbnail function and `update_asset_text`, so imported files arrive with thumbnails, captions and credits.
