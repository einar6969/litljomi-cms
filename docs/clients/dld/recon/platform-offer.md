# Platform offer: what the Hub gives a new tenant today

| | |
|---|---|
| Written | 2026-11-12, from the repository alone, at `main` = `5f3fa74` |
| Role | The platform's side of a reconnaissance pass. It describes the Hub, not any client. Nothing here was checked against a client's site or needs |
| Not touched | The local stack, the hosted project, Vercel, any `.env*` file. No code was run |

**Evidence words**, as in `docs/king/BRIEF.md`:

- **Hosted:** the record says it ran on the hosted Supabase project.
- **CI:** tests pass on the local stack.
- **Code:** read in the source, with no specific check behind it.
- **Reported:** a document says so and I did not re-check it.
- **Inferred:** my own reading of what the code implies. Not tested by anyone.
- **External:** a fact about Next.js, Vercel or Supabase that the repository does not record. Verify before relying on it.

"§" is `docs/architecture.md`. "Ops" is `docs/runbooks/operations.md`. "Prod" is `docs/runbooks/production.md`. "Decision N" is in `docs/plans/2026-11-01-m0-m1.md`.

## 0. The short version

- A tenant gets a working Icelandic editor: typed forms, autosave, drafts, publish and unpublish with proof of what is live, per-entry history and restore, preview, and a password sign-in. All of it has run on the hosted project.
- The content model is expressive (12 field kinds, nesting, references), but the **editor is narrower than the format**: no image insertion in rich text, no entry links in the UI, no media library, one image upload at a time, no way to delete or archive anything.
- The site contract assumes a **Next.js 15 or 16 server runtime** with on-demand revalidation. A static export cannot meet it as written.
- **No import path exists.** None was ever built; LABAK's 21-article import is M6, which is parked.
- Onboarding a tenant *as a copy of `demo`* is a tested runbook. Onboarding a real site in its own repository is LABAK-shaped history, not a procedure.
- Production has **no backups, no export and no staging**, on the Free plan. Published images are stored twice.

## 1. What a tenant gets today

### 1.1 The editor's experience

| Area | What exists | Evidence |
|---|---|---|
| Home | Tenant overview: what is live, how many changes wait, recent changes, a link to the site (`apps/cms/src/editor/TenantOverview.tsx`, `i18n/is.ts:91-108`) | Code; merged as #62 (Reported) |
| Navigation | The module's `structure`: types, one level of labelled groups, singletons (`packages/schema/src/module.ts:39-52`) | Hosted (M2, C5) |
| Lists | One list per type: title, status, last changed. Newest edit first. **At most 200 rows, no paging** (`apps/cms/src/app/(editor)/t/[tenant]/[type]/page.tsx:26,67`) | Hosted (M2) |
| Search | A title search per list (substring, case-insensitive) and a status filter. `/` focuses it. No search across types, no full-text (`editor/entry-list-filter.ts:1-6`; §10.2) | Hosted (M2) |
| Entry form | Generated from the type. One component per field kind (`editor/form/field-registry.tsx:42-55`) | Hosted (M2) |
| Autosave | Every edit saves the draft with the version last seen (§5.5) | Hosted (M1) |
| Conflicts | A stale save opens a field-by-field comparison: keep mine or load theirs (`i18n/is.ts:147-167`) | Hosted (M2) |
| Session expiry | Unsaved work stays in the tab and saves after the same editor signs in again (`editor/form/EntryForm.tsx`, doc comment) | Hosted for expiry; the shared-browser case is CI only (OPEN-ISSUES S6) |
| Singletons | A type marked `singleton` opens its one entry, created on first open (`api.create_singleton_entry`) | Hosted (M2) |
| Images | Upload from the form, alt text per use, default alt and focal point per image, an image detail page | Hosted (M2) |
| Publish | "Birta" files a request; the worker validates and commits that exact version. Status moves "Í birtingu…" → "Bíður eftir vefnum" → "Birt á vef ✓" only after the site shows the new content hash (§7.4) | Hosted (M1, M3) |
| Unpublish | "Taka af vef" withdraws the entry; "Tekið af vef" after the site's pages are checked (§7.4) | Hosted |
| History and restore | "Fyrri birtingar" lists published revisions; restore copies one into the draft, to publish again (§5.5) | Hosted (M2) |
| Preview | "Forskoða" opens the site in draft mode with a 10-minute token (§7.5). Per site, optional | Hosted (C5; `docs/verification/production.md` 6.4) |
| Outdated drafts | A draft written before a schema change offers "Uppfæra uppkast" (§5.3) | Hosted (M2) |
| Widths | 375, 768 and 1440 px | Hosted (C5) |

**Not in the editor** (each checked in the code):

- **No media library.** There is no page that lists a tenant's images and no picker for an existing image. The only asset route is one image's detail page (`app/(editor)/t/[tenant]/assets/[assetId]/page.tsx`). An image field is a file input that takes one file (`editor/form/fields/ImageField.tsx:159-172`). Using a picture twice means uploading it twice.
- **No delete and no archive button.** See 2.4.
- **No images in rich text**, and **no links to other entries** from rich text or a link field. See 2.3.
- **No slug field.** The slug follows the title until first publish (`editor/server/auto-slug.ts:24-27`).
- **No help text under a field.** Field options are `label` and `required` plus the kind's own limits (`packages/schema/src/field-kind.ts:4-7`). §3.2 mentions help-text overrides; the code has none.
- **No tenant logo.** `branding` holds a name only, and the CMS does not read it: the header shows `cms.tenants.name` (`module.ts:31`; no use of `branding` under `apps/cms/src`).

### 1.2 Sign-in and roles

- **Email and password** at `https://vefstjorn.is` (decision 72). Hosted: `docs/verification/pw-production.md`.
- **Invitation by the CLI.** The invite mail leads to a page that sets the password. "Gleymt lykilorð?" sends a reset link. Self sign-up is off (§4.4).
- **Password rule: 6 characters, nothing else.** No CAPTCHA, no per-account lockout, guessing limited only per IP address. Accepted by Einar (S28).
- **One role: `editor`.** Every editor of a tenant can edit and publish everything in it. No approvals, no per-type rights (§10.2; `memberships.role` has one value, §4.3).
- **Editors cannot invite or remove editors.** Only the CLI can, run by Einar (§10.2; Ops §2 step 8, §5).
- **One identity pool.** An address is one account across all tenants; a person in two tenants sees both (§4.4; §11.3).
- **Platform admin** (Einar) has a read-only console behind TOTP and **no content access** without an explicit, audited membership (§4.5).
- **Emails** are in Icelandic, Litljómi-branded, sent through SendGrid. No per-tenant branding (§4.4).

### 1.3 Language

- The admin interface is **Icelandic for every tenant** (`apps/cms/src/i18n/is.ts:1`; §3.2). 103 strings were approved in one batch; expect changes once real editors use it (BRIEF §5).
- **Type, field and navigation labels come from the module**, as written there. `modules/demo` is in English; `modules/labak` is in Icelandic.
- Content: **one locale per tenant**. The manifest's type is the literal `'is'` (`module.ts:30`).

## 2. The content-modelling vocabulary

### 2.1 Field kinds

All twelve are in `packages/schema/src/fields/`. Every kind takes `label` and `required`. "Draft" checks apply on every save; "publish" checks only when publishing.

| Kind | Stores | Options | Limits and behaviour |
|---|---|---|---|
| `text` | string | `max`, `multiline` | Single line unless `multiline`. No minimum length, no pattern (`text.ts:4-9`) |
| `number` | number | `min`, `max`, `integer` | Finite numbers; `integer` means safe integers (`number.ts`) |
| `boolean` | true / false | – | Three states in the form: unset, yes, no. Required means answered (`boolean.ts:6`) |
| `date` | `YYYY-MM-DD` | – | A real calendar date, nothing shorter (`date.ts:9-16`) |
| `datetime` | ISO 8601 with offset | – | `Z` or `±HH:MM` required; kept as written (`datetime.ts:9-13`) |
| `select` | one string | `options: [{ value, label }]` | Fixed list defined in the module. Removing a value later is a breaking change (`select.ts`; `snapshot.ts:192-194`) |
| `link` | `{ href }` or `{ entry: ref }` | `entryTypes` | `href` must be absolute `https:`, `http:` or `mailto:`, no credentials (`link.ts:19-30`). **The form edits external links only**; an entry link shows a read-only notice (`LinkField.tsx:24-35`) |
| `image` | `{ _ref, _kind: 'asset', alt }` | – | One asset, alt text per use. Delivered as `{ id, url, width, height, mime, alt, focal }` (`image.ts`; `projection.ts:6-14`) |
| `reference` | `{ _ref, _kind: 'entry' }` | `to: [type names]` | One entry of the listed types, same tenant. Delivered as `{ id, type, slug, title, path }` or `null` (`reference.ts`) |
| `list` | `[{ _key, value }]` | `min`, `max` | An ordered list of any one kind, including `group` and `list`. Reorder by drag, keys or buttons (`list.ts:51-60`; `ListField.tsx`) |
| `group` | object | `fields` | A fixed set of named fields; nests (`group.ts:24-31`) |
| `richText` | ProseMirror JSON | – | The v1 node set only; see 2.3 (`rich-text.ts`) |

`slug` is not a field kind. It is a column on the entry (§4.3).

A type is `defineType({ name, version, label, fields, preview: { title, media? }, orderBy, transforms? })` (`define-type.ts:8-17`). There is no hook for custom validation: **validation is what the field options express**, and nothing across fields.

A shared library type can be reused with `extendType(base, { label, fieldOverrides, extraFields })`. Overrides change `label` and `required` only; not `max`, `preview` or `orderBy` (`extend-type.ts:3-7`). The library holds one type, `news` (`library/news.ts`).

### 2.2 Specific questions

| Question | Answer | Evidence |
|---|---|---|
| Reference to one entry? | **Yes.** `reference({ to })` | CI + Hosted (M2) |
| Reference to many? | **Yes.** `list(reference({ to }))`, ordered | Code; the demo type has one, e2e `list-group.spec.ts` (CI) |
| What a reference delivers | The target's `id, type, slug, title, path` only. The site finds the rest in the bundle by id. `null` once the target is unpublished | `projection.ts:17-23`; §6.2 |
| Reference rules that bite | The target must be **published before** the referrer can publish (§6.2 step 5). Two entries that refer to each other cannot both go first (Inferred). The picker shows at most 200 entries, by title, with no search (`reference-options.ts:13`) | Code |
| Ordered lists of nested objects? | **Yes.** `list(group({ … }))` | CI at schema level (`list-group.test.ts:55-75`). In the editor only a list of references inside a group is browser-tested |
| Image gallery with per-image alt, caption, credit, manual order? | **Can be modelled**: `list(group({ image, caption, credit }))`. Alt is built into every image use; caption and credit are sibling text fields; order is the list's. **Costly to use:** one file at a time, no multi-upload, no library | Schema: CI. A list of groups with images in the editor: Code only, never browser-tested |
| Credit or caption stored once per image? | **No.** An asset has default alt and focal point only (`assets` columns, §4.3) | Code |
| Images inside rich text? | **In the format, yes** (`image` node: asset, alt, optional caption). **In the editor, no**: no button inserts one; existing ones are kept | `doc-schema.ts:24-27`; `RichTextField.tsx:18,118-140` |
| Video embeds? | **No.** No field kind, no rich-text node (unknown nodes are rejected, not stripped), no video upload (§10.2). A module can hold a video's URL in a `link` or `text` field and the site can render it, at a fixed place on the page | `doc-schema.ts:3-4` |
| Booleans? | Yes | Hosted (M2) |
| Dates? | Yes, `date` and `datetime` | Hosted (M2) |
| Partial dates (year only)? | **No.** A year would be a `number` or `select`. Only a `date` or `datetime` field can fill `sort_at`; any other `orderBy` leaves it null | `date.ts:9`; `define-type.ts:57-66` |
| Select with a tenant-defined list? | Yes. Many-of is `list(select(…))`; nothing stops a value chosen twice (Inferred) | Code |
| Slugs | Lowercase ASCII, digits and single hyphens (`^[a-z0-9]+(?:-[a-z0-9]+)*$`), at most 200 characters. No slashes, no nesting | `20261102000300_content.sql:17`; §4.3 |
| Slug uniqueness | Per tenant and type, among entries not archived. A taken slug gets `-2`, `-3`… in the editor | `content.sql:31-32`; `auto-slug.ts:36-38` |
| Who sets the slug | The editor never does: it tracks the title until first publish. The API accepts an explicit slug (`create_entry(p_slug)`, `set_slug`) | `auto-slug.ts`; `20261102000800_api_editor.sql:30,97` |
| Change a slug after publish? | **No, ever.** A trigger refuses it once `first_published_at` is set, also after an unpublish. No redirects (§10.2) | `content.sql:116-139` |
| Is a slug required? | Only for a type with a site integration (`slug_required`) | `process-request.ts:310` |
| Manual ordering of entries? | **No.** The editor lists by last change. The bundle lists by type then entry id, so **the site must sort**. Order comes from a date field (`sortAt`), a `number` field the site sorts on, or a singleton holding `list(reference(…))` | `[type]/page.tsx:67`; `20261105130000_withdrawal_safety.sql:477` |
| Singletons with nested lists? | Yes: a singleton is an ordinary type flagged in `structure`. The demo singleton has two text fields, so nested lists in one are untested | Code; Inferred |
| One locale only? | Yes | `module.ts:30`; §10.2 |
| Scheduling? | No | §10.2 |
| Approvals, several roles? | No | §10.2 |
| Custom editor pages, hooks, tables? | No | §3.3, §10.2 |
| Custom field kinds from a module? | **Specified, not built.** The manifest has no `extensions` field and the form's registry is a fixed list. Lint also forbids a module importing anything but the schema package, so it could not ship an editor component | `module.ts:28-37`; `field-registry.tsx:42`; `eslint.config.mjs:63-73` |
| Document actions ("duplicate")? | Specified (§3.3), not built | No match in the code |

### 2.3 Rich text

Format: `packages/rich-text/src/doc-schema.ts`. Editor: `apps/cms/src/editor/form/fields/RichTextField.tsx`.

| Feature | Format | Editor toolbar |
|---|---|---|
| Paragraph, hard break | Yes | Yes |
| Headings | Levels 2 and 3 only | Yes |
| Bold, italic | Yes | Yes |
| Bullet and numbered lists, blockquote | Yes | Yes |
| Link to an external address | Yes, absolute `https:`, `http:`, `mailto:` | Yes |
| Link to another entry | Yes (`entry` reference, resolved to the entry's path) | **No** |
| Image with alt and caption | Yes | **No** |
| Underline, strike, code, tables, rules, H1, H4+, colour, alignment, embeds, raw HTML | No | No |

- Anything outside the node set is dropped on paste and rejected on save (§5.4).
- No `tel:` links, no relative links, no "open in a new tab" setting.
- A site renders with `<RichText doc>`: a fixed mapping to plain elements, images as `<figure><img>` (`render.tsx`). A site that wants `next/image` or its own markup writes its own renderer over the exported `ProjectedRichTextDoc` type.

### 2.4 Removing things

BRIEF §8 says entries can't be deleted through `api`. Exactly:

| An editor wants to | Possible? | How |
|---|---|---|
| Take a published entry off the site | Yes | "Taka af vef". The entry leaves the next release, its page must answer 404, and media nothing else uses leaves public storage in about an hour, or two if a site check keeps failing (§5.6, §7.2) |
| Remove a draft that was never needed | **No, not in the editor** | `api.archive_entry` exists and works for an unpublished entry (`api_editor.sql:134`), but no editor code calls it |
| Remove an uploaded image | **No, not in the editor** | `api.archive_asset` exists (`api_editor.sql:220`); no editor code calls it. Taking an image out of an entry leaves the asset row and its private original in place |
| Delete anything for good | **No** | No delete function exists. Revisions and the audit log are append-only; assets are "not hard-deleted in v1" (§4.3). Tenant offboarding is parked (decision 53) |

After an unpublish the entry stays in the list as a draft, its history stays, and its slug stays locked. A test entry made during onboarding stays for good (Ops §1: "Test content stays on the production project").

### 2.5 Sizes and counts

| Limit | Value | Where |
|---|---|---|
| One entry's data | 1 MB of JSON | `content.sql:46` |
| Nesting | 128 JSON levels; rich text 50 levels | `20261102000400_refs.sql:141`; `doc-schema.ts:127` |
| Object keys | `^[A-Za-z0-9_-]{1,64}$`; field keys start with a letter | `refs.sql:167`; `field-set.ts:8` |
| References in one entry | 1,000 (images count) | `refs.sql:176-177` |
| Title column | 500 characters, cut not refused | `define-type.ts:43-46` |
| Type name / slug | 100 / 200 characters | §4.3 |
| Image | JPEG, PNG or WebP, at most 20 MB. No GIF, SVG, AVIF, HEIC, PDF or video | `editor/upload.ts:11,15-19`; bucket limits in `20261102000500_assets_storage.sql:116` |
| Alt text | 1,000 characters | `asset-metadata.ts:13` |
| Entry list / reference picker | 200 rows each | `[type]/page.tsx:26`; `reference-options.ts:13` |
| Bundle | One file per tenant holding everything published. "Adequate while a tenant has up to a few hundred entries" | §7.2 |
| A page the live check reads | 5 MB | `live-check.ts:14` |
| Editor request timeout | 3 s per statement | `20261105140000_editor_limits.sql:153` |
| Per-tenant storage quota | None | `docs/verification/m5-review.md`, finding 5 |

## 3. The site-side contract

### 3.1 What the SDK is

`@litljomi/cms-sdk` (`packages/sdk`), version `0.1.0`:

- **Peer dependencies:** `next ^15 || ^16`, `react ^19` (`package.json:15-18`).
- **Ships TypeScript source**, not a build: `main` is `src/index.ts` (`package.json:10`). The site must list it in `transpilePackages`, and its TypeScript settings must accept `.ts` import endings (`tsconfig.base.json`: `allowImportingTsExtensions`, `noEmit`).
- **Server code only** (Inferred): the barrel loads `node:crypto` through `webhook.ts` and `preview-token.ts`.
- **API** (`src/index.ts`): `createCmsClient` (`getBundle`, `getEntries(type)`, `getEntry(type, slug)`), `createRevalidateHandler`, `createPreviewHandler`, `readPreviewToken`, `CmsEntryMarker`, `CmsReleaseMarker`, `focalPoint`, `focalPosition`, the webhook and token helpers, and the bundle types.
- `@litljomi/rich-text` supplies the renderer. Its `package.json` lists Tiptap and Zod as dependencies, so a site installs them even though it imports only the main entry.
- **Next.js 15 and 16** are both covered by `src/__tests__/next-compat.test.ts` (CI). Next.js 16 runs hosted on the demo site. The hosted Next.js 15 fixture was deleted on 2026-11-12 (OPEN-ISSUES B9).
- Only the **App Router** is shown or tested (Inferred from `apps/demo-site`).

### 3.2 What a site must provide

From §7.3 and `apps/demo-site`, the reference integration:

| Requirement | In the demo site | Needs a server runtime? |
|---|---|---|
| Read content with `createCmsClient`: the pointer with the fetch cache (tag `cms`, `revalidate: 3600`), then the immutable bundle. Never `no-store` | `src/lib/cms.ts`; `client.ts:70,77` | No. It is a plain `fetch` |
| A **revalidation route**: POST, verifies an HMAC signature and a 5-minute timestamp, calls `revalidateTag('cms', { expire: 0 })`, answers 2xx | `src/app/api/cms/revalidate/route.ts` | **Yes** |
| An **entry marker** inside every component that renders an entry | `src/app/events/event.tsx` | No |
| The **release marker** in the root layout (diagnostic only) | `src/app/layout.tsx` | No |
| The media host in `images.remotePatterns` | `next.config.ts:9` | Only if `next/image` optimises |
| A **preview route**: GET, verifies the token, turns on draft mode, sets a cookie, redirects. Pages then read the CMS preview endpoint per request | `src/app/api/cms/preview/route.ts`; `preview.ts:76-114` | **Yes**. Optional per site |
| A detail page that answers **404** once its entry is gone | `events/[slug]/page.tsx` (`notFound()`) | No |
| Be readable without deployment protection at its base URL (§7.4) | Vercel Standard Protection, production domain public | – |

**`next.config`:** `transpilePackages: ['@litljomi/cms-sdk', '@litljomi/rich-text']` and `images: { remotePatterns: [{ protocol: 'https', hostname: <CMS_MEDIA_HOST> }] }` (`apps/demo-site/next.config.ts:8-9`). The pattern has no `pathname`, an open Minor (OPEN-ISSUES, Minor 7). M6's own criterion is that it "allows exactly the `media-public` host" (§13.2).

**Environment** (Prod §13; Ops §2 step 11): `CMS_TENANT`, `CMS_DELIVERY_BASE_URL`, `CMS_MEDIA_HOST`, `CMS_WEBHOOK_SECRETS`, and for preview `CMS_PREVIEW_SECRETS` and `CMS_PREVIEW_BASE_URL`. A site holds no Supabase credential (§8.1).

**Other rules of the contract:**

- The site's base URL is an `https` origin: no port, path or trailing slash (`tools/cli/src/provision.ts`, `BASE_URL_RE`). The revalidate URL is that origin plus a path.
- **Redirects are never followed**, by the webhook or the live check (`notify.ts:14-15`; `live-check.ts`, `fetchCapped`). Register the host that answers directly.
- The module's `site.checks` sees each entry's `id`, `type`, `slug` and `sortAt` and nothing else (`deliver.ts:127-138`). **A check cannot depend on a field's value**, such as a category page.
- A type with a site integration must give every entry an own path, and an `absent` check on that path passes only on **404** (`live-check.ts:147`). A type shown only on a shared page has no clean fit: either it declares no checks and is "confirmed with nothing to check" apart from its media (§7.4), or its `path` needs thought.
- Bundle order is not a display order. The module's "latest N on the home page" check must sort exactly as the site does (`modules/labak/src/index.ts:44-52`). Ties on the same date are undefined (Inferred).
- No raw author markup around entry markers (§7.3 step 3).

### 3.3 Images

- A published image is the **original file**, copied at publish from the private bucket to `media-public` and served at `{supabase}/storage/v1/object/public/media-public/{tenant}/{asset id}/{filename}` (`projection-context.ts:106-110`; `build-release.ts:247-253`).
- **The Hub makes no sizes, crops or formats.** No transformation runs anywhere in the pipeline. The bundle gives width, height, MIME type, alt and focal point; the site resizes, in practice with `next/image`.
- Originals go out as uploaded, EXIF and GPS included, with no pixel-size cap (`m5-review.md`, Minor findings).
- Public files never change: a replaced image is a new asset with a new URL (§5.6).

### 3.4 Distribution

- Decision 42.4: sites get the two packages as **vendored `npm pack` tarballs** committed in the site's repository, "until a second site arrives"; then a private registry (GitHub Packages, which needs a `litljomi` organisation). The steps are in Prod G2.5, a history section written for the LABAK branch.
- **A first site in its own repository other than LABAK's is that second site.** Which way it gets the SDK is an open decision, not a settled one (Inferred from §9.1).
- **OPEN-ISSUES R1:** the version is still `0.1.0` after preview, focal-point helpers, the Next.js 16 `revalidateTag` profile and the open-redirect fix were added (`git log -- packages/sdk`). LABAK's vendored `0.1.0` is older code under the same number. A new site must pack from current `main` and record the source commit, because the version says nothing.
- Types: `pnpm --filter @litljomi/cli cli gen-types --module <tenant> --out <file>` writes the delivery types; the site commits them (§9.1; `tools/cli/src/cli.ts:82-105`). `--out` resolves from `tools/cli`.

### 3.5 Can a static export meet the contract?

**No, not as written.** For a site built with `output: "export"` and rebuilt by a deploy hook:

| Part of the contract | Outcome |
|---|---|
| Reading the release at build | **Works.** The client is a plain `fetch`; other runtimes ignore the `next` options (`client.ts:21-24`). `generateStaticParams` from the published release is the demo's own pattern |
| Entry and release markers | **Work.** They are plain elements |
| Revalidation route | **Fails.** It is a POST handler that reads headers and a body. A static export has no request-time handlers (External: Next.js static-export rules). With nothing answering 2xx at the revalidate URL, the delivery is `notify_failed`, retried for 24 hours, then alerts `delivery.retries_exhausted`, and the editor sees "Birting á vef mistókst" (`deliver.ts:1-10`) |
| `revalidateTag` | **Nothing to expire.** The handler accepts a custom `revalidate` function instead, which could call a deploy hook, but the handler still needs somewhere to run and the contract says the tag "must expire at once" (`revalidate-handler.ts:66-74`) |
| Live confirmation | **Misses its window.** The worker polls for 60 seconds and re-sends the webhook once, about 31 seconds after the pointer was written (`live-check.ts:9-10,155`). A rebuild is slower than that (Inferred). The first result is "Ekki enn staðfest á vef, reynt aftur…"; the sweep then notifies again and re-checks after 1, 2, 4, 8… minutes. **Each retry is another webhook, so another build** (Inferred). It would reach "Birt á vef ✓" minutes late, after several redundant builds |
| Withdrawal | **Late.** The unpublished page keeps being served until a rebuild lands. Public media is still removed after one to two hours whatever the site does (§7.2), so a failed rebuild leaves a page pointing at deleted images (Inferred) |
| Preview | **Fails**, cleanly. It needs a route handler, draft mode, a cookie and per-request rendering. A site may have no preview URL; the editor then shows "Forskoðun er ekki í boði fyrir þennan vef" (`provision preview-url … none`) |
| `remotePatterns` | **Moot** if `next/image` does not optimise (External). Images are then the originals, straight from Supabase |
| Site with no `cms.sites` row | Publishing works and the pointer moves, but the editor ends at "Enginn vefur tengdur" (Ops §2 step 9) and **nothing tells the site to rebuild**. The Hub's only outbound signal is the signed webhook to a registered site |

What the contract needs is a place to run two small handlers and a cache to expire. It does not need server-rendered pages. The demo site's public pages are all statically generated and regenerate on demand; that is the smallest conforming site. A deploy-hook delivery mode would be a change to the platform (section 8), not a tenant setting.

## 4. Onboarding as documented today

### 4.1 The steps, in order

The order is §9.2 and decision 45.1: module first, then provision, **publish once, then deploy the site**. A site's build fails on purpose while its tenant has no release (Prod §11).

| # | Step | Who | Where it is written | State |
|---|---|---|---|---|
| 0 | Design the content types, overrides, site paths, checks and fixtures | A session, with Einar | §9.2 step 1, one sentence. Ops §2 says it is "separate work" | **No procedure, no template** |
| 1 | Copy `modules/demo` to `modules/<tenant>`, rename | Einar or a session | Ops §2 step 1 | Runbook, Hosted (C6) |
| 2 | Register the module in six files by hand | Einar or a session | Ops §2 step 2 | Runbook |
| 3 | `pnpm install`, `pnpm check:schema --update` (writes `schema.snapshot.json`) | Einar or a session | Ops §2 step 3 | Runbook |
| 4 | `pnpm lint && pnpm typecheck && pnpm check:slugs && pnpm check:schema && pnpm test` | Einar or a session | Ops §2 step 4 | Runbook |
| 5 | One PR: separate review PASS on the head, up to date, CI green, merge commit | A session; the KING merges | Ops §2 step 5; `CLAUDE.md` | Runbook |
| 6 | `supabase db push` if there are migrations, then advance `production` | **Einar** | Ops §8 | Runbook. Deploys the CMS for every tenant |
| 7 | `provision tenant <slug> --name …` | **Einar** (the CLI reads the secret key) | Ops §2 step 7 | Runbook, Hosted. The slug can never change (§4.1 rule 7) |
| 8 | `provision editor --email … --tenant-id …` (sends the invitation) | **Einar** | Ops §2 step 8 | Runbook, Hosted |
| 9 | Sign in, create an entry, publish once | The editor | Ops §2 step 9 | Runbook, Hosted. Its text still says "Vista slóð"; that button is gone (section 9) |
| 10 | Check release 1 and the public `current.json` | Einar (console at `aal2`) | Ops §2 step 10 | Runbook, Hosted |
| 11 | Integrate the site: vendor the SDK and renderer, generate types, add the two routes, the markers, the media host | A session, in the site's repository | §9.2 step 3; Ops §2 step 11, one paragraph; Prod G2.5 (LABAK history) | **LABAK- and demo-specific knowledge** |
| 11a | Vercel project: Node 22, `fra1`, `noindex`, Standard Protection, domain and CNAME | **Einar** (DNS and Vercel) | Ops §2 step 11a | Runbook for a site in this repository. For another repository it points at `labak-hub` |
| 11b | `CMS_TENANT`, `CMS_DELIVERY_BASE_URL`, `CMS_MEDIA_HOST` | **Einar** | Ops 11b | Runbook |
| 11c | `provision site` with a fresh webhook secret piped in; the same value to `CMS_WEBHOOK_SECRETS` | **Einar** | Ops 11c | Runbook, Hosted for the demo site |
| 11d | `provision preview-url`, `provision preview-secret`, `CMS_PREVIEW_SECRETS`, `CMS_PREVIEW_BASE_URL` | **Einar** | Ops 11d | Runbook. "Only the demo site reads `CMS_PREVIEW_SECRETS` today" (Ops §4) |
| 11e | Deploy the site, after step 9 | Einar | Ops 11e | Runbook |
| 12 | Import existing content; check it word for word | – | §9.2 step 4, one sentence | **Nothing exists** (section 5) |
| 13 | Smoke test: publish to Live, edit and reach Live again, preview, unpublish to "Tekið af vef" | The editor and Einar | §9.2 step 5; Ops 11e | One sentence. Leaves a permanent test entry (2.4) |
| 14 | Hand over: a short guide in Icelandic | – | §9.2 step 6 | **No guide, no template.** It is an M6 deliverable |

M4's acceptance timed steps 1 to 10 at 26 min 36 s for a copy of `demo` with no site (`docs/execution/checkpoints/C6.md`).

**Einar enters every key** (decisions 43 and 47; `CLAUDE.md`, "Autonomy"). Agents cannot read the env file, so every `provision` command, every secret and every Vercel variable is his, in his own terminal.

### 4.2 Gaps that stop it being repeatable

1. **No module template.** §9.2 says "scaffold from the template". The runbook copies `modules/demo`, which brings English labels, a schema-evolution test type and a demo singleton to strip by hand.
2. **Six hand-edited files** to register a module (Ops §2 step 2). Miss `vitest.workspace.ts` and the module's tests silently never run.
3. **No procedure for a site in its own repository.** The vendoring steps live in a history section, with LABAK's branch names (Prod G2.5). `gen-types` is not in the operations runbook.
4. **The SDK's distribution is undecided** for a second site, and its version is stale (3.4).
5. **No fixture bundle for the site's CI.** §9.1 says each site's CI parses its tenant's fixture bundle. The only generator is `apps/demo-site/e2e/fixtures/generate.ts`, written for `demo`.
6. **No import adapter** (section 5).
7. **No editor guide** and no starting text for one.
8. **No local rehearsal with the same commands.** `provision` accepts only `https://<ref>.supabase.co` and refuses loopback (Ops §1). The local stack is seeded by scripts that know `labak` and `demo` (`tests/integration/src/seed.ts`).
9. **No staging.** The module PR goes to the production CMS, for every tenant, as its first real run (OPEN-ISSUES R2).
10. **No command changes or retires a site.** `provision` can create a site and set its secrets and preview URL (`provision.ts:52-65`). Site deactivation was left out with offboarding (decision 53, item 4). A site that moves from a preview host to its real domain needs a second site record, and the old one then stays active and must keep confirming, or owner SQL. The one earlier deactivation was a direct update through a connector (decision 52).
11. **No way to clear onboarding leftovers.** Test entries and images stay (2.4).
12. **Preview has only ever been integrated inside this repository.** The LABAK branch has no preview route (Ops §4; Reported).

## 5. Importing existing content

**There is no generic import path.** Checked:

- The CLI has `gen-types`, `provision`, `boundary-check`, `migrate-drafts` and `check-schema`, and nothing else (`tools/cli/src/cli.ts:11-17`).
- `migrate-drafts` upgrades existing drafts after a schema change. It creates nothing.
- The `admin_*` functions cover tenants, sites, memberships, secrets, status and draft migration. None creates an entry or an asset (§4.6).
- `tests/integration/scripts/seed-*.ts` are local-only seeds for `labak` and `demo`.
- One LABAK article is published on the hosted project, entered at M1 (`docs/verification/m1-report.md:57`; decision 45, item 2). How it was entered is not recorded in what I read, and no tool came of it.

**How LABAK's import was meant to work:** M6 is "Import of the 21 articles (Markdown → ProseMirror JSON)", with the criterion "every imported article matches its source word for word" (§13.2). §9.2 step 4 calls the tool "an import adapter". M6 is parked (decision 74). **No adapter, converter or word-for-word checker exists in the repository.**

**What an import can lean on today** (Code; none of it has been used this way):

- Every write an import needs is an existing `api` function an editor may call: `create_entry(tenant, type, slug)`, `save_draft`, `register_asset`, `request_publish` (§4.6). An editor account can sign in with a password, so a script can act as a member through the public API, under the same RLS as a person.
- `create_entry` accepts an explicit slug, so old URLs' slugs can be kept if they fit the slug rule.
- The schema package has what a script needs to check itself before saving: `draftValidator`, `publishValidator`, `queryColumns` for `title` and `sort_at`, `richTextDocSchema`, `slugify`.

**What a bulk import of about 60 entries and several hundred images needs that does not exist:**

| Need | Why |
|---|---|
| The importer itself: source → field data, per tenant | Nothing exists. The source-specific part belongs with the tenant (section 6); the generic part (sign in, upload, register, create, save, publish, report) belongs in `tools/cli` |
| HTML or Markdown → the v1 rich-text format | No converter. Anything outside the node set has to be mapped or dropped by rule: tables, embeds, H4, underline, relative links, inline images |
| Image upload outside the browser | Upload to `media-private/{tenant id}/{asset id}/{filename}`, then register with the true MIME type, byte count, width, height and SHA-256. The CMS derives these in a server action (`asset-actions.ts:43-70`); a script must derive them itself, and **at publish the worker downloads each new original and refuses the entry on any mismatch** (`asset_mismatch`, `process-request.ts:397-420`) |
| A way to attach alt text, caption, credit | Alt per use is in the image value. Caption and credit need fields in the model (2.2) |
| Dependency order | A reference's target must be published first (§6.2 step 5). Mutual references need two passes (Inferred) |
| Legacy dates | `firstPublishedAt` and `lastPublishedAt` are set by the database at commit and cannot be back-dated. The editorial date must be a field (Code: `worker_commit_publish`, §6.2 step 7) |
| Slug protection | Until first publish, any save from the editor re-derives the slug from the title (`auto-slug.ts:32-34`). An imported slug that differs from the title's is safe only once the entry is published (Inferred) |
| A publishing plan | Requests filed outside the CMS wait for the sweep, which claims **10 a minute** (`process-request.ts:121`). Each publish re-reads its new originals, four at a time, up to 20 MB each in memory, inside a 300-second function (`process-request.ts:143-144`). The release build copies new media **one file after another** inside a 270-second deadline (`build-release.ts:63,247-253`). Several hundred images in one release has never been tried |
| Publishing before the site is registered | With no site there are no live checks. With a site, every imported entry is checked page by page in a 60-second window (Inferred). Decision 45.1's order already puts the first publish before the site |
| Idempotent re-runs and a dry run | A failed run must be resumable without duplicates. Entries cannot be deleted, so every mistake is permanent (2.4) |
| Verification | A word-for-word comparison of the delivered bundle against the source, as M6 requires |
| A rehearsal target | There is no staging and the CLI refuses the local stack (4.2, gaps 8 and 9) |

## 6. Where client-specific things live

**Enforced, not just agreed:**

- **Lint:** core never imports a module except through `apps/cms/src/modules/registry.ts`; a module imports only `@litljomi/cms-schema`, never another module, the rich-text package, Tiptap, Supabase or an app; a site imports only the SDK, the rich-text main entry and its own types; the secret-key client only under `apps/cms/src/privileged/` (`eslint.config.mjs:41-115`; §3.1). No comment can switch a rule off (`eslint.config.mjs:223`).
- **`pnpm check:slugs`:** no string literal equal to a tenant slug anywhere in `apps/cms/src` or `packages`, apart from tests and the registry. Slugs are the folder names under `modules/` (`tools/checks/no-tenant-slugs.ts:11-16,58-68`).
- **`pnpm check:schema`:** a breaking change to a module's types fails without a version bump and a transform (`packages/schema/src/snapshot.ts:233-239`).
- All three run in CI (`.github/workflows/ci.yml`).

| Client-specific need | Where the architecture puts it | Today |
|---|---|---|
| Content types and fields | `modules/<tenant>/src/index.ts`: `defineType`, or `extendType` over a library type (§3.2) | Works |
| A type a second tenant also needs | Promoted into `packages/schema/src/library/` (§3.3, the promotion rule) | The library has `news` only |
| Validation | Field options in the module. No cross-field or custom rule (2.1) | Limited |
| Site paths and live checks | `site` in the module manifest: `path(entry)` and `checks(entry, release, previous)` | Works, within 3.2's limits |
| Labels shown to that tenant's editors | Type, field and `structure` labels in the module | Works |
| Other copy shown to editors | Core, `apps/cms/src/i18n/is.ts`, the same for everyone, approved by Einar in a batch (`CLAUDE.md`) | No per-tenant strings, no help text |
| Tenant name in the editor | The database: `cms.tenants.name`, set by `provision tenant --name` | Works. No logo |
| Editors, site URLs, secrets, status | The database and Vault, through the CLI (§3.2, last line) | Works |
| Fixtures | `modules/<tenant>/fixtures/*.json`, validated by the module's own test | Works |
| Import script | Not said in so many words. §9.1 gives `tools/cli` "provisioning, migrations of content"; §9.2 says "an import adapter" | **Nothing exists.** A source-specific adapter must not sit in core or in `packages/`. A generic `import` command in `tools/cli` taking a tenant's mapping is the shape that fits (Inferred) |
| Editor guide | §9.2 step 6: "a short guide in Icelandic". No location given | **Nothing exists.** `docs/` is public, and a client's guide is client-facing copy (Inferred: Einar's call) |
| The site's code and design | The site's own repository (§9.1) | – |
| Custom editor behaviour | Field kinds and document actions through `extensions` (§3.3) | **Not built** |
| Custom pages, hooks, tables | Nowhere: excluded from v1 (§3.3) | – |
| Application data: forms, bookings, members | Nowhere in the Hub: out of scope on principle (§1.3) | – |

## 7. Operational readiness for real content

### 7.1 Backups and recovery

- **No backups** (OPEN-ISSUES R2; decision 74; §8.4). The production project is on Supabase Free, and none are made. Decision 75 records backups as on hold by Einar's word.
- **No per-tenant export** and no single-tenant restore (decisions 55 and 56). No copy of a tenant's content exists outside the live database and buckets.
- With Pro backups, a restore would be whole-project and would roll back every tenant (Ops §7). It has never been run.
- **What does exist:** per-entry history. An editor can restore any published revision and publish it (§5.5). That protects against a bad edit, not against a lost database.
- A site keeps its last built pages, so a lost database does not take a site down at once; it takes away the ability to change it, and the originals.

### 7.2 The Free plan

**What the repository records:** the plan, the region (`eu-west-1`), "no backups", and "the Free plan's limits apply (and Free projects may pause when idle; check Supabase's current terms)" (OPEN-ISSUES R2). **It records no figure** for database size, storage, egress or pausing.

**Could not be confirmed from the repository; verify against Supabase's current terms:**

| Limit | My recollection (External, unverified) | Why it matters here |
|---|---|---|
| File storage | About 1 GB per project | **Every published image is stored twice**: the private original and its public copy (§5.6; Code). Unused and replaced images are never removed (2.4). No per-tenant quota |
| Egress | About 5 GB a month | Each publish downloads its new originals to the worker (`process-request.ts:397-420`). A site that serves originals straight from the bucket sends every image view through Supabase |
| Database size | About 500 MB | Revisions and the audit log only grow |
| Pausing | Free projects pause after a period without activity | The sweep calls the project every minute, which probably counts as activity (Inferred). A paused project stops publishing, sign-in and new site builds |
| Image transformations | Not on Free | The Hub uses none (3.3) |

### 7.3 Open items that touch a real tenant

From `docs/king/OPEN-ISSUES.md`. P1 means "before real editors or content".

| ID | P | In plain terms |
|---|---|---|
| S19 | P1 | Cloud agent threads hold Supabase, Vercel and mail connectors, held back only by a rule. Matters only if cloud threads are used again |
| S20 | P1 | M2 and M3 were merged with one security review and no spec or quality review. M5 was to cover them as a whole; M5 is accepted, and the row is still listed open |
| S21 | P2 | Sign-out cannot revoke a pending sign-in session; it lives until its tokens expire |
| S25 | P2 | A failed build's error text can quote a fragment of entry content into `releases.error`, the audit log and possibly an alert mail |
| S26 | P2 | TOTP guesses on the console have no lockout, only Auth's rate limit, whose hosted value is not shown |
| S28 | P2 | Password guessing is limited per IP only; minimum length 6; no CAPTCHA. Accepted. The editors' passwords are the only thing between the internet and a tenant's content |
| B3 | P2 | Supabase's security advisor has not been run since the project became production |
| B4 | P2 | "The site keeps serving with the CMS down" passed once on hosted, at M1, for 38 seconds. Not repeated since |
| B6 | P2 | The go-live checks are not done: phone sign-in, email change by both addresses, the inverted sign-in check, image 404 → 200, pointer overwrite, DMARC, `*.vercel.app` domains, key check |
| R1 | P2 | The SDK's version is stale and LABAK vendors older code under the same number (3.4) |
| R10 | P2 | No hosted browser suite exists any more, so a hosted acceptance has no browser coverage. The hosted Auth audit log returned no rows during the password rollout |

Also open and relevant: the SDK has no way out of draft mode (Minor 16); the demo site's `remotePatterns` has no `pathname` (Minor 7); `main` has no required review, only a rule and an alert (S24).

### 7.4 Alerts

- The worker mails the platform admin through SendGrid (`CMS_ALERT_*` on the CMS project; BRIEF §8). Events in the code: `publish_request.failed`, `publish_request.asset_mismatch`, `publish_request.asset_missing`, `release.failed`, `release.entry_omitted`, `release.entry_fallback`, `release.finish_refused`, `release.stale_failed`, `release.retries_exhausted`, `delivery.retries_exhausted`, `delivery.withdrawal_unconfirmed`, `worker.step_failed`, `sweep.failed`.
- The email path ran on hosted through one alert; `worker.step_failed` was never forced there (OPEN-ISSUES S9, CI).
- **Nothing alerts when the sweep itself stops** (`m5-review.md`: "no heartbeat for a dead sweep"). Vercel Cron is best effort (Prod §15).
- **Alerts go to Einar only.** An editor sees a status in the form; nobody mails the client.
- The console is read-only and needs TOTP.

### 7.5 If the CMS or Supabase is down

For a site that follows the contract (3.2):

| What is down | The live site | Editors |
|---|---|---|
| The CMS app | Unaffected: sites read public storage, never the CMS (§7.3). Hosted once (B4) | Cannot edit, publish or preview |
| Supabase database or Auth | Pages already generated keep being served. A failed regeneration keeps the last good page (§7.3, citing Next.js) | Cannot sign in or publish |
| Supabase Storage | Generated pages stay. A page not yet generated, and any image size the optimiser has not cached, fails (Inferred). **A new deployment of the site fails at build**, on purpose (§7.3) | Cannot upload or publish |
| The project is paused | As Storage down, until someone restores it | As above |

For a site that rebuilds on every publish, each publish is a deployment, so each one needs storage reachable at build time (Inferred).

Suspending a tenant stops publishing and nothing else; the site keeps its last release (Ops §5).

## 8. The platform's integrity

### 8.1 Requests to refuse as tenant-specific hacks

| Request | Why it is wrong |
|---|---|
| A branch on a tenant in core, the worker or the SDK | §3.1, §13.1 rule 3. `check:slugs` and lint fail it anyway |
| A table, column or index for one tenant's fields | §4.1 rule 1: the database never knows a client's fields |
| A custom editor page, lifecycle hook or runtime-loaded code | §3.3, §10.2 |
| Changing the shared `news` library type to suit one tenant | It is LABAK's type too. Use `extendType`, or a tenant type in the module |
| An import that writes `cms` tables with owner SQL or the secret key | §4.1 rule 4. It would put unvalidated data into `revisions`, which nobody can then correct |
| Image or file URLs typed into text fields to get round the media pipeline | §4.1 rule 2: content stores references by id. Such files get no alt text, no dimensions, no withdrawal and no live check |
| HTML in a text field, rendered raw by the site | §5.4: no raw HTML. It also breaks the marker scanner's assumptions (§7.3 step 3) |
| A revalidate endpoint that answers 2xx without the site changing, or a marker placed in a layout | It makes "Birt á vef ✓" false or unreachable (§7.4, objective 8) |
| Skipping live checks or retention "for this tenant" | The worker has no per-tenant switches, by design |
| A site that reads Supabase directly or holds the secret key | §8.1 |
| Form submissions, bookings or any application data in entries | §1.3 |
| Nested paths or special characters forced into slugs | The slug rule is a database constraint, and the slug is part of a public URL |
| Renaming a tenant slug or a published entry's slug "just once" | Both are immutable by trigger (§4.1 rule 7; §4.3) |
| Sharing one account between a client's staff | The audit trail and "who published" lose their meaning (§4.7) |

A second language held as extra fields (`titleEn`) is legal in a module and breaks nothing in core. It is not localisation, and the editor will show both languages as one long form.

### 8.2 Legitimate generic additions, and their review tier

Tiers are `CLAUDE.md`, "How work runs": **boundary** (implementer, then spec and security review in parallel, then quality review), **app logic** (implementer, then one combined review), **presentation** (screenshots). Every one of these is also editor-visible copy or a spec change, which is Einar's.

| Addition | Touches | Tier |
|---|---|---|
| Insert an image in rich text; link to an entry from rich text and from a link field | Editor only. The format already has both | App logic |
| Media library and picker over `api.asset_list`; several files at once | Editor only, under existing RLS | App logic |
| Archive button for unpublished entries and unused images | Editor only. `api.archive_entry` and `api.archive_asset` exist | App logic |
| Help text on fields; a logo in `branding` | Schema package and editor | App logic, mostly presentation |
| A year or partial-date kind; a video-link kind (provider and id) | A new field kind: schema, editor component, snapshot, type generation. One sweep through every place kinds are listed | App logic |
| Manual ordering of a type's entries | A new generic column or a new field convention, plus list UI. If it adds a column: a migration | Boundary if a migration, else app logic |
| Entry data in `site.checks` | The module manifest (the docking interface) and the worker under `privileged/` | Boundary |
| A generic `import` command acting as an editor | `tools/cli`, signing in with a password. No new privileged surface | App logic, with a security read because it handles a credential |
| An import through new `admin_*` functions | Migration, grants, the secret key | Boundary. Prefer the row above |
| A command to move or retire a site | A new `admin_*` function and CLI command (decision 53 left it out) | Boundary |
| Delivery to a static site by deploy hook, with a longer confirmation window | `cms.sites`, Vault (a deploy-hook URL is a secret), the worker, §7.3 and §7.4 | Boundary, **and a spec amendment Einar must rule on first** |
| Documents or video as assets | Bucket MIME types, storage policies, the worker's metadata re-check, §10.2 | Boundary, and a spec change |
| Hard delete | Grants on append-only tables, retention, the audit trail | Boundary, and an architecture decision |
| Publishing or re-packing the SDK with a real version (R1) | `packages/sdk`, which M5 reviewed as a security surface | App logic; boundary if its verification code changes |
| Onboarding scaffold (module template, registration) | `tools/cli`, docs | App logic |

The promotion rule cuts both ways: "A custom need that appears in a second tenant is promoted into the shared library" (§3.3). A first real tenant's needs are the first evidence of what is generic. The test for each is whether LABAK or `demo` could use it unchanged.

### 8.3 Hard-to-reverse choices an onboarding can trip over

From §11.3, with what each means on the day:

| Choice | The trap |
|---|---|
| **JSONB documents with code-defined schemas** | Type and field names are close to permanent once content exists. A type cannot be removed, a field name can never come back with another kind, and a rename needs a version bump, a transform and `migrate-drafts` (`snapshot.ts:233-246`; §5.3). Settle the model before the import, not after |
| **ProseMirror JSON** | Imported text is converted once, into the v1 node set. What the set lacks is lost at import. Widening the node set later changes the format for every tenant |
| **References by id** | In-text links between imported pages must become entry references or absolute URLs; relative links are invalid |
| **`tenant_id` and composite keys** | Nothing can be shared between tenants, not even an image. Asset ids are global (decision 30) |
| **One shared identity pool** | A client's staff are accounts in Litljómi's pool. Moving a tenant out later means new accounts (§4.1 rule 6) |
| **Compiled-in modules** | Every change to a tenant's model is a PR and a CMS deployment for all tenants. A client cannot change a field themselves |
| **Bundle format v1** | One file with everything, read whole by the site on every regeneration. A large bundle may pass Next.js's data-cache item limit on Vercel, which I recall as 2 MB (External, unverified; nothing in the repository measures bundle size) |

Not in §11.3, but just as permanent: the **tenant slug** (it is in every public media URL); an **entry's slug after first publish**, with no redirects; **everything ever published**, since revisions are append-only and nothing can be deleted, an import's mistakes included; and **production itself**, where there is no backup to return to.

## 9. Discrepancies noticed

Left as found. They are the KING's to correct.

| Record | Reality |
|---|---|
| Ops §2 step 9: press "Vista slóð" to save the suggested slug | No such control. The slug follows the title on save (`auto-slug.ts:24-27`; `i18n/is.ts:292-295`) |
| §3.2 and §3.3: `branding` with a logo, help-text overrides, an `extensions` field, custom field kinds, document actions | The manifest has `tenant`, `locale`, `branding.name`, `types`, `structure`, `site` (`module.ts:28-37`). None of the rest is built, and `branding` is unread |
| §10.1 "Media: private originals, focal point, alt text" reads as a media feature set | True as far as it goes. There is no library, picker, archive or delete in the editor |
| §9.2 step 1: "scaffold `modules/<tenant>` from the template" | No template; the runbook copies `modules/demo` |
| `modules/m4-probe` described as the smallest example | It is a full copy of `modules/demo`, and is still registered in the CMS (`apps/cms/src/modules/registry.ts`) though its hosted tenant was deleted |
| Spec header: "Not yet implemented" | Stale (already OPEN-ISSUES D8) |
| OPEN-ISSUES S20 still P1 | M5 is accepted (decision 69); the row was not closed |
| OPEN-ISSUES Minor 17: "No CSP, `frame-ancestors`, `nosniff` or HSTS on the CMS", open | The CMS sends all four (`apps/cms/src/lib/security-headers.ts`, M5 finding 8). Code only: the hosted response headers were not read here |
