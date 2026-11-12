# Litljómi CMS Hub v1: Architecture Specification

| | |
|---|---|
| Status | **Approved** by Einar on 2026-11-01 as the implementation baseline, subject to validating the assumptions in §11 and the security boundaries during development. Not yet implemented |
| Date | 2026-11-01 |
| Revisions | 2026-11-02 (Einar): passwordless sign-in is enforced by an Auth hook, and email changes need confirmation from both addresses (§4.2, §4.4, §4.5, §11.2; plan decisions 18 and 19); 2026-11-02 (Einar): `packages/rich-text` may depend on Zod and the MIT Tiptap core packages, with the editor configuration on a separate entry point that sites do not import (§3.1; plan decision 23); 2026-11-02 (Einar): `packages/schema` may also depend on `@litljomi/rich-text`'s main entry point, never its editor entry (§3.1; plan decision 24); 2026-11-02 (Einar): references are extracted by a recursive walk with jsonpath locations, cross-checked against `strict $.**._ref`, and `_ref` must be a canonical lowercase UUID in every layer (§4.3; plan decision 25); 2026-11-02 (Einar): `authenticated` and `service_role` may use `private` only to execute `private.extract_refs(jsonb)` (§4.5; plan decision 26); 2026-11-02 (Einar): document data is limited to 128 JSON nesting levels, and the reference walk skips reference-free subtrees (§4.3; plan decision 27); 2026-11-02 (Einar, C3): sites get the SDK and renderer as vendored `npm pack` files until a second site arrives (§9.1), and the staging project runs on Supabase Free until the production project is created (§2.2; plan decision 42); 2026-11-03 (Einar): sign-in is by email magic link only (§4.4; plan decision 43); 2026-11-05 (Einar): per-tenant exports run on demand from the CLI instead of nightly to an external provider, offboarding is parked, and three `admin_*` functions are added for webhook secret rotation, tenant suspension and editor revocation (§4.6, §8.3, §8.4, §10.1, §12, §13.2; plan decision 53); 2026-11-05 (Einar): single-tenant restore is dropped, with its acceptance test (§8.4, §12, §13.2; plan decision 55); 2026-11-05 (Einar): the on-demand export is dropped too (§2.1, §8.4, §9.1, §10.1, §11.2, §12, §13.2; plan decision 56); 2026-11-05 (Einar): the console reads through `console_*` views, tenant status changes are audited, and `admin_create_tenant` is idempotent (§4.5, §4.6, §4.7; plan decision 58); 2026-11-05 (Einar): the repository is public (§9.1; plan decision 54); 2026-11-05 (Einar): the operator may read a webhook secret for rotation (§8.2; plan decision 63); 2026-11-05 (Einar): withdrawal checks follow the latest committed request (§7.4; plan decision 65); 2026-11-05 (Einar): `request_unpublish` refuses an entry with nothing to withdraw, and a repeat unpublish ends `superseded` (§4.6, §6.2; plan decision 65); 2026-11-05 (Einar): no view carries `data`, editors read it one row at a time through `entry_detail_by_id` and `revision_detail_by_id`, and length limits bound the text editors write (§4.3, §4.5, §4.6; plan decision 65); 2026-11-12 (Einar): editors sign in with email and password instead of a magic link, the sign-in email carries no link and no code, the Auth hook allows passwords and refuses every method but password, email links, TOTP and refresh, and there is no CAPTCHA and no password rule beyond Auth's minimum, and password sign-in runs in the browser (§4.4, §4.5, §10.1, §11.1, §11.2; plan decision 72); 2026-11-12 (Einar): production is the existing Supabase project on the Free plan, with no backups and no separate staging project for now, and the CMS's domain is `vefstjorn.is` (§1.4, §2, §2.2, §4.4, §8.4; plan decisions 74 and 76); 2026-11-12 (Einar): the staging-era names are renamed: the Supabase project "vefstjorn", the CMS's Vercel project `vefstjorn`, and the deploy branch `production` (§2.2); 2026-11-12 (Einar): a media library per tenant, with a caption and a credit per file and a thumbnail per file, overriding v1's exclusion of a media library; the spec is amended slice by slice as `docs/plans/media-library.md` is built, first the library's data and API (§4.3, §4.5, §4.6, §4.7, §5.6; the ruling is recorded in `docs/clients/dld/STATUS.md`), then the delivery of caption and credit with every image (§5.2, §7.1, §7.2) |
| Owner | Einar Zoega, Litljómi ehf. |
| Audience | Einar, and any future implementation session (human or Claude Code) |
| Location | Written in the LABAK workspace (`project/`). Moves to `docs/architecture.md` in the CMS monorepo at milestone M0 and is maintained there |

This document is self-contained. It records the decisions made in the design discussion of 2026-11-01 and supersedes everything said there. Where an earlier idea was dropped, §12 says so explicitly. Terms in **bold** at first use are defined in §1.4.

---

## 1. Purpose, objectives and scope

### 1.1 Purpose

Litljómi is a small independent web studio (Next.js, React, TypeScript, Tailwind, Vercel, Supabase). Several client websites need a CMS. The Hub is a single **Litljómi-owned CMS platform** that is built and maintained once, and gives each client an isolated, configurable editing environment. It is an internal platform, not a product sold to third parties.

The first client environment will be **LABAK** (Landssamband bakarameistara, labak.is): a small number of editors, mainly the chairman, publishing news. LABAK is the platform's **first real tenant and its first practical validation**. Its new website launches on the Hub, with no interim period of news kept in the site's repository. (Renewal of the labak.is domain is handled separately from the launch.)

LABAK's simplicity must not limit the platform's design. The goal is a reusable Litljómi platform validated through LABAK, not a LABAK CMS to be generalised later. Everything LABAK uses is built as shared platform functionality, with LABAK's specifics confined to `modules/labak` (§13.1).

### 1.2 Objectives

1. Remove repeated CMS work: authentication, editing, media, publishing and delivery are built once.
2. Improvements to the editor, media handling or publishing reach every client through one deployment.
3. Per-client customisation through configuration and registered extensions, without client-specific exceptions in shared code.
4. A simple, polished editing experience in Icelandic for non-technical editors.
5. Strong, database-enforced isolation between clients.
6. Client websites stay up, and keep serving their last published content, when the CMS is unavailable.
7. Predictable operating cost, and infrastructure a single maintainer can run.
8. Publishing status that is never reported as successful before it has been verified.

### 1.3 Scope of v1

In scope: editorial content (news, pages, people, events, galleries, documents and similar) for Litljómi client websites built with Next.js. The full v1 feature list and exclusions are in §10.

Out of scope as a principle: **application data**. Bookings, member portals, form submissions, e-commerce and LABAK's recipe and nutrition system are not CMS content. They belong in per-client applications with their own data model, not in the Hub's document store.

### 1.4 Terminology

| Term | Meaning |
|---|---|
| **Platform** | The Hub as a whole: CMS app, database, storage, worker, shared packages |
| **CMS app** | The one Next.js application at `vefstjorn.is` (editor, platform console, worker routes, preview endpoint) |
| **Tenant** | One client environment (e.g. `labak`). All tenant data carries a `tenant_id` |
| **Module** | The compiled-in TypeScript package describing one tenant: content types, editor configuration, site integration |
| **Content type** | A schema, defined in TypeScript, for one kind of document (e.g. `news`) |
| **Field kind** | A reusable field implementation (text, date, rich text, image, reference…) with editor component, validator and serialiser |
| **Entry** | One document's identity: tenant, type, slug, publication pointer |
| **Draft** | The single mutable working copy of an entry |
| **Revision** | An immutable snapshot of a draft, created only when it is published |
| **Publish request** | An editor's request to publish (or unpublish) a specific draft version |
| **Worker** | Trusted server code in the CMS app that validates, commits and delivers. The only code that holds the Supabase secret key (with the preview endpoint, §7.5) |
| **Release** | One complete, immutable bundle of a tenant's published content, numbered monotonically per tenant |
| **Bundle** | The JSON file containing a release |
| **Pointer** | `current.json`, the small mutable file naming a tenant's current release |
| **Site** | A client website, deployed independently, that reads releases through the SDK |
| **SDK** | `@litljomi/cms-sdk`, the package sites use to read releases, handle webhooks, render markers and support preview |
| **Content hash** | A hash of an entry's complete projected record in a release, computed by the worker (§7.2) |
| **Entry marker** | A hidden element rendered by the SDK next to an entry's content, carrying the entry's `id` and `contentHash`. The proof used for live confirmation (§7.4) |
| **Release marker** | `<meta name="cms-release" content="N">` in the site's layout, naming the release the page was rendered from. Diagnostic only |
| **Platform admin** | A Litljómi operator (Einar). Has console access, never implicit content access |
| **Editor** | A tenant member who edits and publishes that tenant's content |

---

## 2. High-level architecture

```
                  vefstjorn.is · one Next.js app · one Vercel deployment
┌──────────────────────────────────────────────────────────────────────────┐
│ Editor (per tenant)           │ Platform console (platform admins only)   │
│ lists · forms · media ·       │ tenants · editors · publish status ·      │
│ drafts · preview · publish    │ releases · deliveries · audit             │
├──────────────────────────────────────────────────────────────────────────┤
│ Core: schema engine · field registry · editor shell · permissions UX     │
├───────────────────────────────┬──────────────────────────────────────────┤
│ Dock: module registry         │ Privileged zone (secret key)             │
│ modules/labak · modules/…     │ worker: validate · commit · build ·      │
│ (compiled in, typed)          │ publish media · notify · confirm live    │
│                               │ preview endpoint                         │
└───────────────┬───────────────┴──────────────────┬───────────────────────┘
                │ editor's JWT → api.* (RLS applies)│ secret key → api.worker_*
                ▼                                   ▼
   Supabase (EU) · Postgres: schemas api (exposed) / cms (not exposed)
                 · Auth · Storage: media-private · media-public · delivery
                                                    │
                     releases/{N}.json + current.json, public media
                                                    ▼
   Client sites (separate Vercel projects, separate repos)
     read pointer + bundle at build/ISR ◄── signed revalidation webhook
     render entry markers               ──► worker confirms "live"
```

### 2.1 Component responsibilities

| Component | Responsibility | Holds privileged credentials? |
|---|---|---|
| Editor | Authenticated editing of one tenant at a time; lenient draft validation for UX; publish requests; status display | No. Uses the editor's session only |
| Platform console | Read-only operational view across tenants; requires MFA | No. Uses the platform admin's session |
| Core | Schema engine, field registry, form generation, editor shell. Never imports a module | No |
| Modules | Declare a tenant's content types, editor layout, site integration (URLs, paths) | No |
| Worker | Strict validation, commit, release build, media publication, webhook delivery, live confirmation, retries | Yes (Supabase secret key) |
| Preview endpoint | Serves draft content to a site in draft mode, against a signed token | Yes (Supabase secret key) |
| Provisioning CLI | Creates tenants, sites, secrets, memberships. Run by a platform admin locally | Yes (Supabase secret key), never deployed |
| Supabase Postgres | Source of truth; enforces isolation, integrity and privileges | n/a |
| Supabase Storage | Private originals, public published media, releases | n/a |
| Sites | Render published content from releases; never call the CMS or Supabase API except preview | No Supabase credentials. Hold a webhook secret and a preview secret |

### 2.2 Hosting and environments

- **CMS app:** Vercel, on a **Pro** team (the Hub is commercial use; Vercel Cron at the needed frequency is required, §8.4). Domain **`vefstjorn.is`** (DNS at ISNIC; `www.vefstjorn.is` redirects to it). The Vercel project is `vefstjorn`, and its `production` branch is the production switch (until 2026-11-12, `vefumsjon-staging` and `staging`).
- **Supabase:** **one project, `rwpgpfsmhhtimauvpoyt`, is production** (plan decision 74), in the Litljómi organisation on the **Free** plan, region `eu-west-1`. It is the project that served as staging through M5, named "vefstjorn" since 2026-11-12. *Accepted risks (Einar, 2026-11-12):* **no backups** (the Free plan has none, and none are made) and **no separate staging project** until one is created later; the Free plan's limits apply. The earlier design (a Pro organisation with one production and one staging project) is deferred, not dropped.
- **Sites:** each in its own Vercel project and repository, owned per client arrangement. A site's own hosting plan is a separate decision per client (note: Vercel Hobby is for non-commercial use).

---

## 3. Core and modules

### 3.1 Packages and dependency rules

| Package | Contains | May depend on |
|---|---|---|
| `packages/schema` | Schema DSL (`defineType`, field kinds' definitions), the shared content-type library, Zod generation, projection rules | Zod; `@litljomi/rich-text`'s main entry point (document schema and rich-text projection), never `@litljomi/rich-text/editor` |
| `apps/cms` (core) | Editor shell, field components, form generation, console, worker, preview endpoint | `schema`, `rich-text`, module registry |
| `modules/<tenant>` | One tenant's manifest, content types, fixtures | `schema`, core extension-point types only |
| `packages/rich-text` | ProseMirror node schema for v1, React renderer, plain-text extraction; the Tiptap editor configuration on its own entry point (`@litljomi/rich-text/editor`), used only by the CMS app | Zod; the MIT Tiptap core packages, used only by the editor entry point (React as peer). Sites import only the main entry point |
| `packages/sdk` | Release reading, webhook handler, entry and release markers, preview helpers | none (Next.js as peer) |

Enforced in CI:

- Core never imports from `modules/**` except through the generated module registry.
- No tenant slug literal appears in core code.
- The Supabase secret-key client may be imported only under `apps/cms/src/privileged/**` (worker and preview).
- Sites depend only on `sdk`, `rich-text` and their generated tenant types (§9.1).

### 3.2 The module manifest (the docking interface)

A module exports one typed manifest. v1 fields:

| Field | Purpose |
|---|---|
| `tenant` | Slug matching `cms.tenants.slug` |
| `locale` | Content locale (`is` for LABAK). One locale per tenant in v1. The editor's own interface is Icelandic for every tenant in v1; it does not follow this setting |
| `branding` | Display name and logo for the editor header |
| `types` | Content types: library types (with overrides of labels, help text, required flags, extra fields) and tenant-specific types |
| `structure` | Editor navigation: groups, order, singletons |
| `site` | For each type: `path(entry)`, the entry's own site path (used for preview), and `checks(entry, release, previousRelease)`, the pages where the entry must be `present` or `absent` in a given release (used for live confirmation, §7.4) |
| `extensions` | Registered custom field kinds and document actions (v1 extension points, §3.3) |

Non-structural, per-tenant operational settings (editor emails, site URLs, secrets, status) live in the database, not the manifest.

### 3.3 Extension points in v1

Modules may extend the platform only through:

1. **Custom field kinds**: editor component, Zod validator, projection.
2. **Document actions**: extra buttons on an entry (e.g. "duplicate"), running through the same `api.*` functions as everything else.

Not available in v1: custom pages, custom lifecycle hooks, custom database tables, runtime-loaded code. A custom need that appears in a second tenant is promoted into the shared library.

---

## 4. Data model, isolation and access

### 4.1 Governing rules

1. **The database knows tenants, entries, drafts, revisions, references, assets and publishing. It never knows a client's fields.** Field data is JSONB; field structure lives in TypeScript.
2. **Content stores references by ID, never URLs.** Delivery resolves IDs to URLs.
3. **Every tenant-scoped row has `tenant_id NOT NULL`,** and every foreign key between tenant-scoped tables is composite with `tenant_id`, so cross-tenant references are impossible (this also closes the covert channel that foreign-key checks create, since they bypass RLS).
4. **Every write by an editor goes through an `api.*` function.** Editors have no path to the tables except those functions.
5. **Integrity that matters is enforced by Postgres**, regardless of which code writes.
6. **Tenant data stays movable.** The CMS app obtains its database and storage clients through a *tenant connection resolver*. In v1 every tenant resolves to the shared project, but no code may assume that: core never joins across tenants (except the console's read-only views), and every storage path starts with the tenant. This is a coding rule for data and storage only. Moving a tenant's **identities** to another project (editors would need new accounts or cross-project auth) is out of scope for v1, and movability is not tested in v1.
7. **Tenant slugs are immutable** once provisioned, because they appear in public storage paths and site configuration.

### 4.2 Schemas

| Schema | Exposed through the Data API? | Contains |
|---|---|---|
| `api` | Yes (the only exposed schema besides Supabase's own) | `SECURITY INVOKER` functions and `security_invoker` views only |
| `cms` | **No** | All platform tables |
| `private` | No | Trigger functions, internal helpers and the Auth hook (§4.4) |

**v1 contains no `SECURITY DEFINER` functions.** The rule covers functions v1 creates; Supabase's own Vault functions (`vault.create_secret`, `vault.decrypted_secrets`), used as §8.2 decides, are outside it (plan decision 32). Supabase's guidance is never to create one in an exposed schema; with invoker-only functions and the RLS patterns below, none are needed. Adding one later requires an explicit architecture decision, placement outside exposed schemas, a pinned `search_path = ''`, and catalog-test coverage.

Supabase's custom-schema setup recipe grants `ALL` to `anon` and `authenticated`. **It must not be applied to `cms`.** Grants on `cms` are exactly those in §4.5.

### 4.3 Tables (`cms` schema)

Column lists are the v1 minimum; implementation may add timestamps and indexes.

| Table | Key columns | Database guarantees |
|---|---|---|
| `tenants` | `id`, `slug` (unique), `name`, `status` (`active`, `suspended`) | — |
| `memberships` | `(tenant_id, user_id)` PK, `role`, `created_at`, `created_by` | `role` is an enum with the single v1 value `editor` |
| `platform_admins` | `user_id` PK | — |
| `entries` | `id`, `tenant_id`, `type`, `slug` (nullable), `singleton`, `published_rev_id` (nullable), `published_draft_version` (nullable), `first_published_at`, `last_published_at`, `created_at/by`, `archived_at` | Partial unique `(tenant_id, type, slug)` where `slug IS NOT NULL AND archived_at IS NULL`. Slug is immutable once `first_published_at` is set (trigger). `published_rev_id` must reference a revision of the same entry and tenant (composite FK). `type` is at most 100 characters and `slug` at most 200 |
| `drafts` | `entry_id` PK, `tenant_id`, `schema_version`, `data` jsonb, `title`, `sort_at`, `version` int, `updated_at/by` | `data` is a JSON object under a size limit (1 MB). `title` is at most 500 characters. `version` increments by exactly 1 on every update, and `data` cannot change without it (trigger) |
| `revisions` | `id`, `tenant_id`, `entry_id`, `draft_version`, `schema_version`, `data`, `title`, `sort_at`, `requested_by`, `committed_at` | **Append-only**: `anon`, `authenticated` and `service_role` have no `UPDATE` or `DELETE`. Only the table owner (migrations) retains them. `title` is at most 500 characters |
| `draft_refs` | `tenant_id`, `entry_id`, `path`, `target_entry_id` or `target_asset_id` (exactly one) | Rebuilt by trigger on every draft write. Same-tenant FKs |
| `revision_refs` | `tenant_id`, `revision_id`, `path`, `target_entry_id` or `target_asset_id` | Written by trigger on revision insert. Same-tenant FKs, `ON DELETE RESTRICT` |
| `assets` | `id` (UUID generated by the uploading client, also used in the storage path), `tenant_id`, `original_path`, `filename`, `mime`, `bytes`, `width`, `height`, `sha256`, `focal_x`, `focal_y`, `default_alt`, `caption`, `credit`, `thumb_path` (nullable), `public_path` (nullable), `created_at/by`, `archived_at` | Same-tenant FKs from refs. Not hard-deleted in v1. `filename` is at most 255 characters, `original_path` at most 400, `default_alt` and `caption` at most 1,000 and `credit` at most 300. `thumb_path` is null or exactly `{tenant_id}/{asset_id}/thumb/{n}.webp`, `{n}` being one to four digits, so a file's thumbnail can only be in its own folder |
| `publish_requests` | `id`, `tenant_id`, `entry_id`, `action` (`publish`, `unpublish`), `draft_version`, `requested_by`, `requested_at`, `status`, `error` jsonb, `revision_id`, `release_id` | Editors may insert and read; only the worker updates. An `error` over 64 KB is cut to its code before it is stored or audited (trigger) |
| `releases` | `id`, `tenant_id`, `number` (unique per tenant), `status` (`building`, `delivered`, `failed`), `bundle_path`, `created_at`, `delivered_at`, `error` | At most one `building` release per tenant (partial unique index) |
| `sites` | `id`, `tenant_id`, `base_url`, `revalidate_url`, `preview_url`, `webhook_secret_ref`, `preview_secret_ref`, `active` | Secrets are stored outside the table (§8.2); the table holds references |
| `site_deliveries` | `(release_id, site_id)` PK, `tenant_id`, `notify_status`, `notify_attempts`, `notified_at`, `live_status`, `live_confirmed_at`, `last_error` | — |
| `audit_log` | `id`, `tenant_id` (nullable, null for platform events), `actor_id`, `action`, `target_type`, `target_id`, `at`, `details` | Append-only. `actor_id` and `at` are set by the database (§4.7), never by the caller |

**Tenant tables** (the definitive list for rule 3 and the catalog tests): `memberships`, `entries`, `drafts`, `revisions`, `draft_refs`, `revision_refs`, `assets`, `publish_requests`, `releases`, `sites`, `site_deliveries`. Not tenant tables: `tenants`, `platform_admins`, and `audit_log` (which carries a nullable `tenant_id` and has its own policies).

**References inside JSON.** Every reference in a document, at any depth, has the fixed shape `{ "_ref": "<uuid>", "_kind": "entry" | "asset", ... }` plus usage properties (e.g. `alt`). A trigger extracts all of them with a recursive walk of the document into `draft_refs` or `revision_refs`, recording each one's location as a jsonpath (for example `$."body"."content"[0]."attrs"."entry"`); tests cross-check that the walk finds exactly what the recursive JSON path `strict $.**._ref` finds. A malformed `_ref` (not a canonical lowercase UUID, `8-4-4-4-12`) or a target outside the tenant fails the write; the schema and rich-text validators require the same canonical form. "At any depth" means the extractor misses no nested reference, not unlimited nesting: draft and revision data nested deeper than 128 JSON levels, containing any JSON object key that does not match `^[A-Za-z0-9_-]{1,64}$`, or containing more than 1,000 references is rejected (SQLSTATE `54000`), each checked in linear time before the walk, so extraction cost and the stored paths stay bounded: about 10 MB of temp space per statement in the worst case (plan decisions 27–29). Keys come from schema field names and the fixed rich-text format, so no stored path contains an escaped character.

**Status is derived, never stored on the entry:**

| Condition | Status |
|---|---|
| `archived_at IS NOT NULL` | archived |
| `published_rev_id IS NULL` | draft |
| `drafts.version = entries.published_draft_version` | published |
| `drafts.version > entries.published_draft_version` | published, with unpublished changes |

**Query columns.** `title` and `sort_at` are promoted from the document using the type's `preview.title` and `orderBy` mapping, written on drafts by the save path and on revisions by the worker. A title past the column's limit is cut to it, so a long heading is never refused on save or at publish. They are generic platform columns, never per-tenant. Everything else is filtered inside the JSON, scoped by `(tenant_id, type)`. No GIN indexes and no full-text search in v1.

### 4.4 Authentication

- **Supabase Auth**, one user pool, editors and platform admins alike.
- Editors sign in at `vefstjorn.is` with **email and password** (Einar, 2026-11-12). Magic links and email OTP codes are not offered.
- **First password and forgotten password.** The invite email (§9.2) and the password-reset email each lead to the confirm page, which verifies the link by POST with its token hash. The CMS then takes the editor straight to a page that sets the password, before anything else. These links and the email-change links are the only emails that sign anyone in.
- **No sign-in by magic link or email code** (Einar, 2026-11-12, plan decision 72.1). Supabase Auth serves magic links and codes whenever the email provider is on, with no separate switch, and it reports every link verified by token hash, whatever its type, as `otp`, so no hook can tell a magic link from an invite. The refusal is therefore in the email: the magic-link template, which Auth also sends for sign-in codes, carries no link, no token hash and no code (`{{ .ConfirmationURL }}`, `{{ .TokenHash }}`, `{{ .Token }}`), and tells the editor to sign in with a password at the CMS. So does the sign-up confirmation template, which Auth sends to a pending invitee on request. Auth still creates a code for each such request and accepts it, and every token-hash link is built from such a code, so codes are 10 digits, the longest Auth allows (plan decision 72.3): a code can't be guessed within its hour, even across many addresses. The hosted templates and code length are part of the Auth configuration and are verified on every hosted project (§11.2).
- **The Auth hook allows only what the CMS uses.** A Custom Access Token hook, `private.sign_in_access_token(jsonb)`, issues tokens only for `password`, `otp` (the invite, reset and email-change links), TOTP step-up and refresh. A refresh or step-up is allowed only if every method in the session's `amr` is `password`, `otp` or `totp`. Anything else (sign-up, anonymous, phone, OAuth, SSO, web3, a PKCE exchange) is refused (fail closed). It must be enabled on every hosted project and verified there (§11.2).
- **No password rules beyond Auth's minimum** (Einar, 2026-11-12): minimum length 6, Auth's lowest setting, no character requirements, and the leaked-password check off. Changing a password needs a recent sign-in (`secure_password_change`).
- **Guessing is limited only per IP address.** There is no CAPTCHA (Einar, 2026-11-12), and the Pro plan has no per-account lockout. Password sign-in runs in the browser, straight to Auth with the publishable key (plan decision 72.4), so Auth's per-IP limit counts the editor's own address, never the CMS server's, and one visitor cannot use up the limit for every editor (M5 finding 7). The password never passes through the CMS server. On GoTrue v2.197.0 that limit is about 150 password attempts per 5 minutes per address, shared with session refresh (`token_refresh`). Guesses spread over many addresses are not limited: an accepted risk (§11.2). A failed sign-in gives the same answer whether or not the account exists.
- **Email changes need confirmation from both the old and the new address** (`enable_confirmations` and `double_confirm_changes` on), so a stolen session cannot move an account to another mailbox.
- **Custom SMTP is required** (Supabase's built-in sender is rate-limited to a few emails per hour and unsuitable for production). Email templates in Icelandic, Litljómi-branded. No per-tenant email branding in v1.
- Platform admins must enrol **TOTP MFA**; console access requires `aal2`.
- Editors are invited by the provisioning CLI (§9.2). Self sign-up is disabled.
- A session that expires mid-edit must not lose work: drafts autosave, and a failed save keeps local state until re-authentication.

### 4.5 Authorization: who checks what

| Layer | Responsibility | Security boundary? |
|---|---|---|
| CMS app (editor routes) | Session handling, tenant resolved from URL, UI permissions, lenient Zod on save. Calls `api.*` with the editor's JWT. Never uses the secret key | No (convenience and quality) |
| `api.*` functions (invoker) | Perform the operation; derive the tenant from the data (never trust a tenant parameter where an entry ID determines it); check expected versions | Yes, together with RLS |
| RLS | Every row read or written belongs to a tenant where `auth.uid()` holds a membership | **Yes** |
| Grants and column privileges | Which tables and columns `authenticated` may touch at all; immutability of revisions and audit log | **Yes** |
| Constraints and triggers | Integrity regardless of writer, including the worker and migrations; length limits on the text editors write, refused before any audit copy (§4.3; plan decision 65) | **Yes** |
| Worker | Strict validation, re-checked authorization at commit, all privileged writes | Yes (trusted server code) |

**RLS patterns (no definer helpers needed):**

- `memberships`: a user may `SELECT` only rows where `user_id = (select auth.uid())`. No other access for `authenticated`.
- Tenant tables: access requires `EXISTS (SELECT 1 FROM cms.memberships m WHERE m.tenant_id = <row>.tenant_id AND m.user_id = (select auth.uid()))`. This subquery runs under the memberships policy above, which permits the user's own rows, so no recursion and no definer function.
- Membership is checked against the table on every request, never cached in token claims, so revocation is immediate.
- Platform admins have **no implicit content access**. To work on a tenant's content they hold an explicit, audited membership in it.
- Editors read the operational data of **their own tenants**: `tenants` (rows they are members of), `publish_requests`, `releases`, `site_deliveries`, and `sites` limited by column grant to non-secret columns. The editor needs these to resolve the tenant, check that it is active, find the preview route and show publication status.
- **`data` is read one row at a time** (plan decision 65). No view in `api` carries `drafts.data` or `revisions.data`, so the Data API can neither return it in bulk nor filter it across rows. An editor reads one entry's or one revision's data through the by-id functions in §4.6, under the same RLS. A request can still run a filter, such as a regex, over the one document it reads: PostgREST can't turn that off per function. `authenticated` runs with a 3 s statement timeout, which bounds it.
- Console reads: additional `SELECT`-only policies on `tenants`, `publish_requests`, `releases`, `sites` (non-secret columns), `site_deliveries` and `audit_log` across **all** tenants, requiring `platform_admins` membership **and** `auth.jwt()->>'aal' = 'aal2'`. No platform-admin clause appears on content tables (`entries`, `drafts`, `revisions`, `*_refs`, `assets`). Because `cms` is not exposed, the console reads through `security_invoker` views in `api` (§4.6).

**Grants for `authenticated` on `cms`.** `INSERT` and `UPDATE` are granted **per column**, so editors can never set worker-owned columns (`published_rev_id`, `published_draft_version`, publish timestamps, `public_path`, request `status`, `revision_id`, `release_id`).

| Table | Grant |
|---|---|
| `entries` | `SELECT`; `INSERT (tenant_id, type, slug, singleton, created_by)`; `UPDATE (slug, archived_at)` |
| `drafts` | `SELECT`; `INSERT (entry_id, tenant_id, schema_version, data, title, sort_at, updated_by)`; `UPDATE (data, schema_version, title, sort_at, updated_at, updated_by)`. `version` is set by trigger only |
| `draft_refs` | `SELECT`, `INSERT`, `DELETE`, with the same tenant policies as `drafts`. The ref-extraction trigger runs as the invoking role and needs them; `cms` is not exposed, so the only route is through `api` functions |
| `revision_refs`, `revisions` | `SELECT` (written only by the worker) |
| `assets` | `SELECT`; `INSERT (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, default_alt, created_by)`; `UPDATE (focal_x, focal_y, default_alt, archived_at, caption, credit, thumb_path)` |
| `publish_requests` | `SELECT`; `INSERT (tenant_id, entry_id, action, draft_version, requested_by)`. `status` defaults to `pending` |
| `memberships`, `platform_admins` | `SELECT` (policies restrict to own rows) |
| `tenants` | `SELECT` (own tenants; console policies for platform admins); `UPDATE (name)` as a **lock-only** grant: the `tenants_lock_member` policy admits the editor's own tenants with `WITH CHECK (false)`, so every update an editor attempts fails and the grant only lets `register_asset`, `update_asset`, `update_asset_text` and `set_asset_thumbnail` lock the tenant row `FOR SHARE` while they read its status (M3-07) |
| `releases`, `site_deliveries` | `SELECT` (own tenants; console policies for platform admins) |
| `sites` | `SELECT (id, tenant_id, base_url, preview_url, active)` only. Secret references are never readable by `authenticated` |
| `audit_log` | `INSERT` only, through the audit triggers (§4.7); `SELECT` for platform admins with `aal2` |
| everything else | none |

`anon` has no privileges on `cms`. `service_role` is granted what the worker and CLI need, **except** `UPDATE`/`DELETE` on `revisions` and `audit_log`. Operations that must remove history (tenant offboarding, §8.3) run as an owner-run SQL procedure through a direct migration connection, never through the API. `EXECUTE` is revoked from `PUBLIC` globally (default privileges, not per schema) and granted per function.

**Auth hook grant.** `supabase_auth_admin` (Supabase's Auth role) has `USAGE` on `private` and `EXECUTE` on `private.sign_in_access_token(jsonb)`, and nothing else in `api`, `cms` or `private`. `EXECUTE` on the hook is revoked from `PUBLIC`, `anon` and `authenticated`. The hook is `SECURITY INVOKER` with `search_path = ''` and reads no tables (§4.4).

**Reference-extraction grant.** The reference triggers run as the invoking role (§4.3), so `authenticated` and `service_role` have `USAGE` on `private` and `EXECUTE` on `private.extract_refs(jsonb)` only, and nothing else in `private`. `anon` has nothing. `extract_refs` is `SECURITY INVOKER`, reads no tables, and is not reachable through the Data API (plan decision 26).

### 4.6 Functions in `api`

| Function | Callable by | Does |
|---|---|---|
| `create_entry(tenant_id, type, slug?)` | `authenticated` | Inserts entry and empty draft |
| `entry_detail_by_id(entry_id)` | `authenticated` | One entry's columns and draft `data` as a single JSON value, or null when it is not visible (§4.5; plan decision 65) |
| `revision_detail_by_id(revision_id)` | `authenticated` | One revision's columns and `data` as a single JSON value, or null when it is not visible (§4.5; plan decision 65) |
| `create_singleton_entry(tenant_id, type, schema_version?)` | `authenticated` | Opens a singleton type (§3.2 `structure`): returns the type's one live entry, creating it and its empty draft on first open |
| `save_draft(entry_id, expected_version, data, schema_version, title, sort_at)` | `authenticated` | Updates the draft only if `version = expected_version`; otherwise returns a conflict |
| `set_slug(entry_id, slug)` | `authenticated` | Changes the slug before first publish |
| `archive_entry(entry_id)` | `authenticated` | Allowed only when not published |
| `register_asset(asset_id, tenant_id, original_path, metadata)` | `authenticated` | Records an uploaded original (§5.6). Rejects a path that is not `{tenant_id}/{asset_id}/…` |
| `update_asset(asset_id, focal_x, focal_y, default_alt)` | `authenticated` | Edits asset metadata |
| `update_asset_text(asset_id, default_alt, caption, credit)` | `authenticated` | Edits a file's three texts (§5.6) |
| `set_asset_thumbnail(asset_id, thumb_path)` | `authenticated` | Records a file's thumbnail. Refuses any path but the file's own (§4.3), and a path with no object in `media-private` |
| `asset_summary(tenant_id)` | `authenticated` | A tenant's library counts as one JSON value: files, bytes, images, documents, missing alt, unused, archived. `not_found` for a non-member |
| `archive_asset(asset_id)` | `authenticated` | Refused while any currently published revision references the asset |
| `request_publish(entry_id, expected_draft_version)` | `authenticated` | Inserts a publish request |
| `request_unpublish(entry_id)` | `authenticated` | Inserts an unpublish request; refused with `not_published` when the entry is not published and has no publish in flight |
| `worker_*` (claim, commit, release, delivery functions) | `service_role` only | Privileged worker operations (§6) |
| `admin_*`: `admin_create_tenant`, `admin_create_site`, `admin_add_membership`, `admin_remove_membership(tenant_id, user_id)`, `admin_set_tenant_status(tenant_id, status)`, `admin_set_webhook_secret(site_id, secret)`, `admin_set_preview_secret`, `admin_set_preview_url(site_id, url)`, `admin_outdated_drafts`, `admin_migrate_draft` | `service_role` only | Provisioning, incident operations and content migration by the CLI (§8.2, §8.4, §9.2). `admin_create_tenant` returns the existing tenant's id on a rerun with the same slug and name, and raises `slug_taken` when the name differs. `admin_set_preview_url` sets or replaces a site's preview URL, or clears it with null; the URL must be https, or plain http only to a loopback host (`localhost`, `127.0.0.0/8`, `[::1]`), the token route's rule (§7.5). `admin_create_site` applies the same rule to its preview URL, which may also be null |

The console reads through `security_invoker` views in `api`, `SELECT` for `authenticated` only: `console_admin` (the caller's own `platform_admins` row), and `console_tenants`, `console_requests`, `console_releases`, `console_sites` (non-secret columns), `console_deliveries` and `console_audit`, which return rows only to a platform admin at `aal2`.

The by-id reads take one id and return one JSON value, so a request sees at most one document. PostgREST can still filter that document (§4.5), but can't read or filter across rows. The editor's other reads are `security_invoker` views in `api`, `SELECT` for `authenticated` only, and none of them carries `drafts.data` or `revisions.data` (§4.5). For the library (§5.6), `asset_list` carries each file's size, upload time, caption, credit, thumbnail path and kind, whether its default alt is missing, whether it is in use, and one text column to search; `asset_usage` has one row per file and entry that uses it, saying whether the use is in the draft, in the published revision, or both.

This list is complete for v1 editor writes. All are `SECURITY INVOKER` with `search_path = ''` and schema-qualified names. `worker_*` and `admin_*` functions are not executable by `anon` or `authenticated`. Because the secret key bypasses RLS, `worker_*` functions perform their authorization checks explicitly (§6.2).

### 4.7 Audit

Audit events are written by **triggers**, not by callers, so an editor cannot choose what is recorded. The trigger sets `actor_id` from `auth.uid()` (or the worker's recorded requester) and `at` from the database clock.

Audited in v1: entry creation, slug change, archive; asset registration, metadata change (focal point, default alt, caption and credit; recording a thumbnail is not audited), archive; publish and unpublish requests; commits, rejections and supersessions; release delivery and failure; membership changes and tenant status changes (made by the CLI). Draft autosaves are **not** audited; `drafts.updated_by` and `updated_at` record the last editor.

`authenticated` holds `INSERT` on `audit_log` only so the triggers can run. Since `cms` is not exposed, the only route is through `api` functions, none of which writes to `audit_log` directly. The persona tests assert that `actor_id` cannot be set to another user.

---

## 5. Content, editing, drafts and media

### 5.1 Content types

A content type is defined once in TypeScript:

```
defineType({
  name: 'news',
  version: 3,
  label: 'Frétt',
  fields: { title: text({ required: true, max: 200 }), date: date({ required: true }),
            image: image({ required: true }), excerpt: text({ max: 400 }),
            body: richText(), source: link() },
  preview: { title: 'title', media: 'image' },
  orderBy: 'date',
  transforms: { 2: v2to3 },
})
```

(Illustrative, not an API commitment.) From one definition the schema package derives:

| Output | Used by |
|---|---|
| Draft validator (lenient: types checked, required fields may be empty) | Editor save path |
| Publish validator (strict, full Zod including refinements) | Worker |
| Editor form (via the field registry and layout hints) | Editor |
| Output projection and its Zod schema | Release build |
| TypeScript delivery types | Sites, via generated tenant types |
| `title` / `sort_at` mapping | Save path and worker |

**Adding a field needs no database migration**: change the module, deploy. Old documents lack the field; it must be optional or have a default.

### 5.2 v1 field kinds

`text` (single and multi-line), `slug` (entry-level column, see §4.3), `number`, `boolean`, `date` / `datetime` (stored as ISO strings), `select`, `link` (external URL or entry reference), `image` (asset reference with per-use `alt`; the file's caption and credit are delivered with it), `video` (a provider link with a still image, below), `reference` (to entries of given types), `list` (of any field kind, reorderable), `group`, `richText`.

**`video`** is a link to a video hosted on YouTube or Vimeo, never an uploaded file (§10.2). Stored as `{ url, title, still }`: the address (the editor normalises a pasted one: `https://` added, `http:` raised, canonical form), a title, and a still image stored exactly as an `image` value (`{ _ref, _kind: 'asset', alt }`) or `null`. The provider and the video's id are not stored; they are derived from `url`, so better parsing later needs no data change. Options: `label`, `required`, and `still: 'required' | 'optional'` (default `'optional'`). Drafts check the shape only. Publishing requires an `https:` address that parses to a known provider and id (YouTube: `youtube.com` with or without `www.` or `m.` at `/watch?v=`, `/embed/`, `/shorts/` or `/live/`, or `youtu.be/`, with an 11-character id of letters, digits, `_` and `-`; Vimeo: `vimeo.com/<digits>`, with or without `www.`, or `player.vimeo.com/video/<digits>`; other query parameters and the fragment are ignored), a title of 1 to 200 characters, and the still when the option requires it. Delivered as `{ provider: 'youtube' | 'vimeo', id, url, title, still }`, with `url` in canonical form and `still` resolved exactly as an `image` field is (`null` when there is none or it cannot resolve). The still is an asset reference inside the value, so it is extracted, validated and copied to `media-public` like any other (§4.3, §5.6). Making the still required is a breaking change (§5.3).

### 5.3 Schema evolution

- Every draft and revision records the `schema_version` it was written with.
- **Additive** change (new optional field, new type): no transform.
- **Breaking** change (rename, restructure, new required field without default): ships a transform `n → n+1`.
- On deploy, a migration script applies transforms to all **drafts** of that type (each as a normal versioned draft update). **Revisions are never rewritten**; the release build upcasts them when reading.
- **A draft can only be published at the current schema version.** The worker rejects an outdated draft with a clear error.
- A field name is never reused with a different meaning. Unknown keys are stripped on save and tolerated on read.
- CI compares each module's schema snapshot with the previous one and fails on a breaking change without a transform.

### 5.4 Rich text

- **Format:** ProseMirror JSON produced by **Tiptap** (MIT-licensed core only, no paid extensions).
- **v1 node set:** paragraph; heading (levels 2–3); bold; italic; link (external URL, or entry reference with `_ref`); bullet list; ordered list; blockquote; hard break; image (asset `_ref`, `alt`, optional caption).
- The ProseMirror schema rejects any other node, which also cleans content pasted from Word.
- References inside rich text use the standard `_ref` shape and are extracted like any other.
- The release build resolves references inside rich text (asset → URL and dimensions, entry → site path), so the site renderer is a pure node-to-component mapping with no raw HTML. `packages/rich-text` also produces plain text for excerpts and metadata.

### 5.5 Drafts, autosave and concurrency

- One mutable **draft** per entry. Autosave calls `save_draft` with the version the editor last saw.
- A stale save is rejected (`version` mismatch). The editor shows that someone else changed the entry and offers reload; local changes are kept until resolved.
- No history inside a draft in v1. History consists of published revisions.
- **Restore** from a revision copies its data into the draft (a normal versioned save). Revisions are never modified.

### 5.6 Media

| Bucket | Visibility | Path | Written by |
|---|---|---|---|
| `media-private` | Private (Storage RLS by tenant prefix and membership) | `{tenant_id}/{asset_id}/{filename}` | Editors (upload) |
| `media-public` | Public read | `{tenant_slug}/{asset_id}/{filename}` | Worker only |
| `delivery` | Public read | `{tenant_slug}/releases/{N}.json`, `{tenant_slug}/current.json` | Worker only |

- **Upload:** editor uploads the original to `media-private` with their session (RLS: path prefix is a tenant the editor belongs to). A server action reads it, derives `width`, `height`, `mime`, `bytes`, `sha256`, and calls `register_asset`.
- **Accepted formats v1:** JPEG, PNG, WebP; maximum 20 MB. HEIC is expected to arrive as JPEG from iOS file inputs (assumption, §11).
- **Editing:** focal point, default alt text, caption and credit per asset; alt text per use. No per-use cropping.
- **In the editor and in preview,** originals are shown through short-lived signed URLs.
- **Publication:** when building a release, the worker copies every asset referenced by that release from `media-private` to `media-public` (server-side copy, no download) and sets `public_path`. Public files never change: replacing an image creates a new asset.
- **Withdrawal:** a public file is deleted once neither the current nor the previous release references it (§7.2). A release that withdraws something (an unpublished entry, or media the release before it referenced) is followed at once by a **housekeeping release** (§7.2), so media that leaves the site is removed from public storage within about an hour of the release that removes it, or about two hours when a site's live check of that release keeps failing (§7.2), even if the tenant never publishes again. Content that was public may persist in third-party caches; this cannot be prevented.
- Assets referenced by a currently published revision cannot be archived (`archive_asset` refuses).
- **The library** (Einar, 2026-11-12) lists all of a tenant's files in one place. A file is **in use** when the current draft of an entry that is not archived refers to it, or the revision an entry's `published_rev_id` points to does; the second is the test `archive_asset` applies. A file is **unused** when it is not in use and not archived. Older published revisions do not count: history is append-only and never shrinks, so counting it would leave every file ever published in use for good.

---

## 6. Publishing

### 6.1 Flow

```
Editor            CMS app (editor route)        Worker (privileged)                 Postgres
  │ Publish  ───►  api.request_publish(entry, V)  ────────────────────────────────►  insert request (RLS)
  │                trigger worker (internal call, request id only)
  │                                      claim request ───────────────────────────►  status = validating
  │                                      read draft; require version = V,
  │                                      schema_version = current; strict Zod;
  │                                      project the draft (must succeed)
  │                                      api.worker_commit_publish(request) ──────►  one transaction (§6.2)
  │                                      build release (§7) · copy media · pointer
  │                                      notify sites · confirm live
  │ ◄── polls request / delivery status
```

The editor route never runs privileged code. It triggers the worker through an internal route authenticated with an internal secret, passing only the request ID; the worker trusts nothing but the database. A Vercel Cron sweeper (every minute) picks up anything the fast path missed.

### 6.2 `worker_commit_publish`: the exactness guarantee

One transaction. The function:

1. Locks the request (`status = validating`), the entry and its draft.
2. Checks `drafts.version = request.draft_version`. If not, marks the request `superseded` ("the entry changed after you pressed publish"). **The committed content is copied from the `drafts` row inside this transaction, never taken from a parameter**; with the version check, this guarantees that the validated version is exactly the committed one.
3. Checks `drafts.schema_version` is the version the worker validated against.
4. Re-checks authorization at commit time: the tenant is `active`, and `requested_by` still holds a membership.
5. Checks every reference in the draft data copied in step 2 (extracted as the refs trigger does; the commit never trusts `draft_refs`, which editors can write): entries in the same tenant that are published (or the entry itself), assets in the same tenant that are not archived, each locked `FOR SHARE`. Otherwise `failed_validation` with the offending references (plan decision 32).
6. Inserts the revision (data, `schema_version`, `draft_version`, `title`, `sort_at`, `requested_by`).
7. Sets `entries.published_rev_id`, `published_draft_version`, `first_published_at` (if null; this locks the slug), `last_published_at`.
8. Sets the request to `committed` with `revision_id`; writes the audit event.

The `title` and `sort_at` values are computed by the worker from the validated data using the schema mapping.

Before calling `worker_commit_publish`, the worker also **projects the draft** exactly as the release build would, resolving references against the current published state. A draft whose projection fails is not committed (`failed_validation`). Content is therefore known to be deliverable when it is committed.

**Unpublish** (`worker_commit_unpublish`): same locking and authorization checks; sets `published_rev_id` to null. A request for an entry that is already unpublished, with no publish in flight, ends `superseded` and is linked to no release. Unpublishing is **never refused** because other entries reference the entry, since withdrawal takes precedence. In releases, a reference to an entry that is no longer published resolves to `null`, and delivery types mark entry references as nullable so sites render without it. (Publishing *new* content that references an unpublished entry is still refused, step 5 above.)

### 6.3 Publish request states

`pending` → `validating` → one of `committed`, `failed_validation` (with field errors), `superseded`, `rejected` (authorization failed at commit), `failed` (unexpected error, retried by the sweeper up to a limit).

---

## 7. Delivery and site integration

### 7.1 Releases

- **One bundle per release, per tenant.** It contains **all** currently published content of the tenant, read in one consistent database snapshot. A release is built from committed state, not from a single request, so a later release always supersedes an earlier one, and requests committed close together are coalesced into one build.
- **Serialized per tenant:** at most one `building` release per tenant (database constraint). Release numbers increase monotonically.
- **Atomic switch:** the worker writes `releases/{N}.json`, then reads it back, then writes `current.json`. Sites never observe a partial release.
- **The pointer never moves backwards.** There is no tenant-wide rollback in v1. Content is rolled back **per entry**: restore an older revision into the draft (§5.5), then publish it normally.
- **Build steps:** read published revisions → upcast to current schema versions → strict Zod on the projection input → project (resolve assets to public URLs with their caption and credit, entry references to `{id, type, slug, title, path}` or `null` if the target is no longer published, rich-text references; strip internal fields) → copy newly referenced media to `media-public` → write bundle → verify → write pointer → mark release `delivered` → notify sites. This projection validation is a second gate after the commit.
- **Withdrawal always wins.** Which entries a release contains is decided **only** by the database's published state at build time: an entry is included if and only if `published_rev_id IS NOT NULL` and `archived_at IS NULL`. Entries that are unpublished, archived or never published are absent, whatever earlier releases contained. No fallback can add an entry to a release.
- **One failing entry does not block the tenant, and fallback fails closed.** If projecting an included entry fails, the build may reuse that entry's projection from the previous release only if **both** of these hold:
  1. The previous projection was built from the **same `revision_id`** that is published now. That is, unchanged content failed to re-project, for example after a faulty code or transform deploy. A newer revision never falls back to older content, because that would bring back something the editor deliberately changed or removed.
  2. Everything the previous projection references is still allowed now: its assets are not archived, and its referenced entries are still published.

  Otherwise the entry is **left out** of the release, and its page returns 404 until it is fixed. In either case the release proceeds, records the entry in `releases.error` and alerts the platform admin, and the editor sees the entry as **delivery failed** (§7.4), never as live. Because the worker projects every draft before committing it (§6.2), a newly committed revision does not normally reach this path. It covers later regressions.

### 7.2 Bundle format v1

```
releases/{N}.json
{ "format": 1, "tenant": "labak", "release": 42, "generatedAt": "…",
  "entries": { "news": [ { "id", "revisionId", "contentHash", "slug", "title", "sortAt",
                           "firstPublishedAt", "lastPublishedAt",
                           "schemaVersion", "data": { …projected… } } ] } }

current.json
{ "format": 1, "tenant": "labak", "release": 42, "bundle": "releases/42.json", "generatedAt": "…" }
```

- `revisionId` is the revision the projection was built from, which the fallback rule in §7.1 depends on.
- `contentHash` is a SHA-256 over a canonical serialisation of the entry's complete projected record, including resolved asset URLs and referenced entries' summaries. The worker computes it at build time. Sites never compute it; they only echo it in entry markers (§7.3). Any change that alters what a site receives for the entry changes the hash.
- Bundles: `cache-control: public, max-age=31536000, immutable`.
- Pointer: `cache-control: public, max-age=30` (CDN freshness is an assumption to test, §11).
- **Format evolution:** additive changes within `format: 1`. A breaking change writes `format: 2` in parallel (separate path) until every site has moved. The image value has gained three fields this way: `focal` (the file's focal point), then `caption` and `credit` (the file's own, the same with every use; the alt text stays the use's). Each is null when the file has none and absent from a bundle written before it was delivered, so sites read them as optional. A change to a file's focal point, caption or credit reaches a site with the tenant's next release.
- **Retention:** only the **current and previous** release stay in the public `delivery` bucket (the previous one serves sites still regenerating from it). An hour after a release is delivered, the release before the previous one is deleted, along with public media referenced only by deleted releases. Release history is kept in the database (`releases`, `revisions`), not as public files.
- **Housekeeping release:** when the tenant's latest delivered release withdrew something from the delivered release before it (an unpublish request is linked to it, or the earlier release referenced media it does not), the sweep builds the next release at once, from the published state like any other release (§7.1), with no linked requests unless something else was committed meanwhile. It withdraws nothing itself, so there is one. The housekeeping release waits while a site's delivery of the withdrawing release is unsettled (its first live check not finished, or a retry scheduled, §7.4), so that release's retries run while it is still the latest; it waits at most one hour after that release's delivery, and a newly committed request is still built at once. When the hour ends with a site still unconfirmed, the housekeeping release is built and the platform admin is alerted once for that release and site. The release before the withdrawal is then older than the previous release, and is deleted an hour after the housekeeping release is delivered. Withdrawn content therefore leaves public storage within about an hour of the release that withdraws it, or about two hours when a site's live check keeps failing, whether or not the tenant publishes again.
- One bundle per tenant is adequate while a tenant has up to a few hundred entries. Splitting by type is a future format version.

### 7.3 Site integration (SDK)

A site:

1. Reads content through the SDK: fetch `current.json` with the Next.js fetch cache, tag `cms`, `revalidate: 3600`; then fetch the bundle URL it names (immutable, cached indefinitely). **Never `no-store`**, which would make routes dynamic.
2. Exposes a revalidation route using the SDK handler: verifies the HMAC signature and a timestamp within 5 minutes, then calls `revalidateTag('cms')` and returns 2xx.
3. Renders an **entry marker** wherever it renders an entry. The SDK component `CmsEntryMarker` is given the same entry object the page renders and outputs a hidden element carrying the entry's `id` and `contentHash`. It must sit inside the component that renders the entry's content, not in a layout, so the marker can only come from the same data the visible content came from. The site must not render raw, author-written markup (inline scripts with comment-like text, hand-written HTML with unusual end tags) around entry markers: the live check reads markers with a linear HTML scanner, which treats a page it cannot scan to the end as inconclusive but can be misled by such markup (plan decision 36). The site also renders the **release marker** in its root layout. That marker is diagnostic only and is never proof of a live change.
4. Allows `media-public`'s host in `next/image` `remotePatterns`.
5. Implements preview (§7.5).

With a single bundle per release, one tag per tenant is sufficient in v1; per-entry tags would add nothing.

The SDK must support the Next.js major versions Litljómi sites use (currently 15 and 16; `revalidateTag`'s signature differs between them).

**Independence from the CMS.** Next.js documents that if revalidation fails, the last successfully generated page keeps being served. When the CMS, the database or storage is unavailable, sites keep serving their last good pages; only publishing waits. A site's own new deployment needs storage to be reachable at build time; it fails rather than deploying empty content.

### 7.4 Publication states and what proves them

| State | Proven by | Shown to editor |
|---|---|---|
| **Requested** | `publish_requests` row committed (authorization passed RLS) | "Í birtingu…" |
| **Committed** | `worker_commit_publish` committed: validated and recorded as the CMS's published version | "Í birtingu…" |
| **Delivered** | Release N containing the commit was written, read back, and `current.json` read back shows N | "Í birtingu…" |
| **Revalidated** | Each active site's revalidation route verified the signature, called `revalidateTag`, and returned 2xx (`site_deliveries.notify_status = ok`) | "Bíður eftir vefnum" |
| **Live** | Every check the module declares for the entry passed (below), and every public media URL in the entry's new projection returns 200 | "Birt á vef ✓" |

Rules:

- Success is never shown before its proof exists. "Revalidated" is not "live": Next.js regenerates on the next request after invalidation, and the first response may still be the stale page.
- **Live checks are content-specific.** The module's `site.checks(entry, release, previousRelease)` returns the pages where this entry must appear or must not appear, given the new release's content. The previous release lets it name the pages an unpublished entry must disappear from. For example, a news item's own page; the news listing, if the item is within its first page; the home page, if it shows the item among the latest news. Each check is one of:
  - `present`: the page returns 200 and contains an entry marker with the entry's `id` **and the new `contentHash`**.
  - `absent`: the page contains no entry marker for the entry's `id`. For the entry's own path, the page must also return 404.
- An entry marker can only show the new hash if the component rendering the entry was rendered from the new data. A newer release marker in the layout, or a page partly served from cache, cannot satisfy a `present` check.
- The live check polls each check (about every 3 seconds, up to 60 seconds). The first request also triggers regeneration.
- If a page regenerates but still shows the old hash (for example because the CDN served an old `current.json`), the worker sends the webhook again within the same 60-second window. Only then does it report **live not confirmed**.
- **Unpublish** is live when all of the entry's checks are `absent` and pass.
- **An unconfirmed withdrawal is checked until it is confirmed, even after a newer release supersedes its release.** Each site's delivery keeps the withdrawal checks that site has not confirmed, computed when its release was delivered, so a later check needs neither that release's bundle nor the one before it. While the entry's latest committed request is still that unpublish, the sweep keeps running those checks against that site on the delivery's retry schedule, notifying the site of the tenant's latest release, until they pass or the retries run out. Publishing the entry again stops them at once, with no alert. A site that already confirmed is not checked again. When every active site has confirmed, the editor sees "Tekið af vef". If the hour after the withdrawing release ends with a site still unconfirmed, or that site's retries run out, the platform admin is alerted once for that release and site, also when a newly committed request superseded the release during the hold (§7.2). From the end of that hour the editor sees **live not confirmed**, and **delivery failed** once the retries run out, until the site confirms. These checks never hold back the housekeeping release or retention (§5.6, §7.2).
- **Limits, stated plainly:** live proves that the declared pages render exactly this version of the entry's data, and that its media is reachable. It does not prove visual correctness. It does not verify pages of *other* entries whose projections changed as a side effect (for example a related-article card showing this entry's new title); those update on their next regeneration. An entry for which the module declares no checks and that has no public media (a type without site pages, or an unpublish of an entry no delivered release contained) is confirmed with nothing to check. The live check is also stricter than the rules above in two ways, both failing closed: an `absent` check on a page other than the entry's own path requires that page to answer 200, and a page that cannot be scanned to its end never passes an `absent` check (plan decision 36).
- Failure states shown plainly: validation failed; delivery retrying; **delivery failed for this entry** (§7.1); revalidation retrying; **live not confirmed** (delivered and revalidated, but the checks did not pass in time). In M1, a delivery is retried at a fixed interval: one retry per sweep (every minute), up to 10 attempts; exponential backoff for up to 24 hours comes later (plan decision 36). When the attempts run out, the platform admin is alerted (in M1 through the audit log and the server log; by email from M3) and the editor sees **delivery failed**. A newer release supersedes pending work for older ones, except an unconfirmed withdrawal (above).
- The live check needs read access to the site's public pages. A site behind deployment protection cannot be confirmed (relevant to staging sites).

### 7.5 Preview

- In the editor, **Preview** calls the privileged token route (`/api/preview-token`, in `privileged/`). That route verifies the editor's session and, using the editor's own JWT, confirms they can read the entry (RLS), so the membership check is the database's. Only then does it mint a token: HMAC with the site's preview secret over `{tenant, entry_id, draft_version, exp}`, valid 10 minutes. Editor routes never see preview secrets. The editor is redirected to the site's preview route with the token.
- The site verifies the token, enables Next.js draft mode, and redirects to the entry's path.
- In draft mode the SDK fetches from the CMS preview endpoint (`/api/preview/{tenant}`) with the token. The endpoint verifies it and returns published content overlaid with that draft, projected like a release, with media as short-lived signed URLs. Responses are never cached.
- Preview is the only live dependency of a site on the CMS, and only in draft mode.
- The token route and the preview endpoint are both in the privileged zone. The preview endpoint reads drafts with the secret key and returns only data scoped by the verified token, so **token minting is the authorization check for preview**, and it is covered by the persona tests (an editor of tenant B cannot obtain a token for tenant A).

---

## 8. Security, operations and testing

### 8.1 Security boundaries (summary)

1. **Editors → database:** only `api.*` invoker functions, `cms` not exposed, narrow grants, RLS on every table, immutability by privileges.
2. **Privileged code → database:** only the worker, preview endpoint and provisioning CLI hold the secret key; enforced by an import rule (§3.1). `worker_*` functions are executable only by `service_role`.
3. **Sites:** hold no Supabase credentials. They receive public files and signed webhooks; they hold a webhook secret and a preview secret, per site.
4. **Public data:** only published projections and published media are ever public.
5. **Platform admins:** MFA for the console; content access only through explicit, audited memberships.

### 8.2 Secrets

| Secret | Where |
|---|---|
| Supabase secret key | CMS app server environment (Vercel), local CLI environment. Never in client bundles, sites or module code |
| Internal worker-trigger secret, cron secret | CMS app server environment |
| Per-site webhook and preview secrets | Supabase Vault, readable only by the privileged zone (worker, preview-token route, preview endpoint). Fallback if Vault access by `service_role` proves unsuitable (§11): app-level encryption with a key in the CMS environment. Also set in the site's environment |
| SMTP credentials | Supabase Auth settings and CMS environment |

Secrets are rotatable: the SDK accepts two webhook secrets during rotation. To put the old and new secrets on a site together, the platform admin reads the site's current webhook secret into a shell variable in their own terminal, using the secret key, through `api.worker_sites` (plan decision 63).

### 8.3 Data protection

- Supabase projects in an EU region; data processing agreements with Supabase and Vercel.
- Personal data held: editors' emails and names, audit history. Litljómi acts as processor for each client.
- Offboarding a tenant (parked, not in any milestone; plan decision 53; its export would be built then, plan decision 56): export (content JSON and media), hand over, then delete the tenant's storage prefixes with the CLI and its rows with an owner-run SQL procedure (history tables are not deletable through the API).

### 8.4 Operations

- **Cron:** Vercel Cron every minute for the worker sweeper (requires Vercel Pro).
- **Backups:** **none, an accepted risk** (Einar, 2026-11-12; plan decision 74). The production project is on the Free plan, which has no backups, and none are made. There is no per-tenant export either, so no copy of any tenant exists outside the live database (plan decisions 53, 55 and 56). Supabase daily backups (Pro) are the intended remedy when the organisation moves to Pro.
- **Restore:** not possible while there are no backups. With Pro backups, whole-project restore uses them; restoring one tenant is not supported (plan decision 55).
- **Monitoring and alerts:** worker failures and exhausted retries alert the platform admin (in M1 through the audit log and the server log; by email from M3). The console shows per-tenant request, release and delivery status.
- **Incidents:** suspend a tenant (`status = suspended` stops publishing); revoke an editor (delete membership; immediate); roll back an entry (restore an older revision and publish); remove content urgently (unpublish; the sweep follows the withdrawing release with a housekeeping release, and the content leaves public storage within about an hour, or about two hours when a site's live check keeps failing, §7.2); rotate secrets.
- **Upgrades:** dependency updates monthly; database migrations applied to staging first, with the full test suite, then production.
- **Expected platform cost** (indicative): today Supabase Free (one project); later a Supabase Pro organisation with a production and a staging project, roughly $35 a month; Vercel Pro per seat; SMTP on a low tier.

### 8.5 Testing strategy

The database is the main security boundary, so most security tests run there: pgTAP via `supabase test db` against a local stack in CI, impersonating users by setting role and JWT claims inside a transaction.

| Suite | Covers |
|---|---|
| **Catalog tests** | Every `cms` table has RLS enabled. `anon` has no privileges on `cms`. `authenticated` has exactly the grants in §4.5. No `SECURITY DEFINER` functions exist. Every `api` function is invoker with `search_path` pinned and no `EXECUTE` for `PUBLIC`/`anon`; `worker_*` executable only by `service_role`. Every tenant table (the list in §4.3) has `tenant_id NOT NULL` and composite FKs. No `UPDATE`/`DELETE` grants on `revisions`, `audit_log`. `authenticated` cannot read secret columns of `sites` |
| **Persona matrix** | Personas: anonymous; editor of tenant A; editor of B; authenticated user with no membership; revoked member; platform admin with and without `aal2`. Operations: every `api` function; direct `SELECT/INSERT/UPDATE/DELETE` on every table; storage reads and writes in all three buckets. Each cell asserted allowed or denied |
| **Integrity** | Non-object or oversized data; malformed `_ref`; reference to another tenant's asset or entry, to a missing target, or to an unpublished entry at publish; slug change after publish; update of a revision; draft `data` change without version bump |
| **Concurrency** | Two saves with the same expected version (second fails); draft changed between request and commit (`superseded`); membership revoked between request and commit (`rejected`); concurrent release builds for one tenant (one waits); pointer monotonicity |
| **Escalation** | Editor inserting a membership, changing a role, calling `worker_*`, moving an entry to another tenant, mismatched tenant and entry parameters, forging `audit_log.actor_id`, obtaining a preview token for another tenant's entry |
| **Delivery** | Fallback never includes an unpublished, archived or never-published entry; fallback refused when the published `revision_id` differs from the previous projection's; fallback refused when a referenced asset is archived or a referenced entry unpublished; an omitted entry's page returns 404; a `present` check fails while the page shows the old hash, even when the layout's release marker is newer; `absent` checks after unpublish; media URLs return 200 only after publish; unpublishing an entry that another published entry references succeeds, and the reference resolves to `null` |
| **Worker unit tests** | Strict validation, upcasting, projection, rich-text reference resolution, bundle format |
| **Schema tests** | Per-module fixtures validate; schema-snapshot breaking-change check |
| **Lint rules** | Core imports no modules; no tenant slugs in core; secret-key client only under `privileged/` |
| **End-to-end** (staging) | Editor flows at 375, 768 and 1440 px; publish reaching **Live** on a fixture site; preview; CMS app stopped while the fixture site keeps serving |
| **Integration tests** | The assumptions in §11, run against the staging project and a fixture site |

The database suite gates every migration and every deploy. Supabase's security advisor is run alongside it.

---

## 9. Repository and onboarding

### 9.1 Repositories

**`litljomi-cms`** (new, public by Einar's choice; plan decision 54), pnpm workspaces and Turborepo:

```
apps/cms/                 Next.js: editor, console, worker, preview endpoint
  src/privileged/         the only place the secret-key client may be imported
packages/schema/          DSL, field kind definitions, content-type library
packages/rich-text/       ProseMirror schema v1, React renderer, plain text
packages/sdk/             site SDK
modules/<tenant>/         manifest, types, fixtures, generated delivery types
tools/cli/                provisioning, migrations of content
supabase/                 migrations, pgTAP tests, seed for fixture tenants
docs/                     this document, runbooks
```

**Client sites** stay in their own repositories (e.g. the LABAK site). They depend on `@litljomi/cms-sdk` and `@litljomi/rich-text` and on their tenant's delivery types, generated from the module by the CLI and committed in the site repository. Each site's CI parses the fixture bundle of its tenant with its SDK version. The two packages reach a site as vendored `npm pack` files committed in the site repository (`file:vendor/…`), each with a real version, packed by `pnpm pack:sdk` and refreshed with each SDK release (`docs/runbooks/operations.md` §2, step 11). A private package registry was planned for the second site (plan decision 42) and is not adopted: "vendored SDK with a real version: yes. A package registry isn’t worth it for one more site." (Einar, 2026-11-12).

### 9.2 Onboarding a new client

1. **Module:** scaffold `modules/<tenant>` from the template; choose library types; add overrides and site paths; add fixtures. Pull request, CI green, deploy.
2. **Provision** (CLI, idempotent): create the tenant row, storage prefixes, site record, webhook and preview secrets; invite editors and create memberships.
3. **Integrate the site:** install the SDK and renderer, generate types, set the site environment (pointer URL, tenant, webhook secret, preview secret), add the revalidation and preview routes, render entry markers in every component that renders an entry and the release marker in the layout, allow the media host. The site must be reachable by the live check without deployment protection (§7.4).
4. **Import** existing content with an import adapter. Verify imported text word for word against the source.
5. **Smoke test:** publish a test entry and observe all five publication states through **Live**; edit it and confirm that **Live** follows the new content hash; preview a draft; unpublish and confirm every check is `absent`.
6. **Hand over** to the editors: a short guide in Icelandic.

---

## 10. v1 features and exclusions

### 10.1 Included in v1

- Central CMS app with Icelandic editor interface; one locale per tenant.
- Email-and-password sign-in, invited editors, password reset by email, single `editor` role; platform admins with MFA.
- Content types from a shared library plus tenant types; v1 field kinds (§5.2); singletons.
- Schema-generated forms, list views by type with title search and status filter.
- Drafts with autosave and optimistic locking; immutable revision history; restore.
- Rich text with the v1 node set.
- Media: private originals, focal point, alt text, public copies on publish.
- Request-based publishing with worker validation and exact-version commit; unpublish; archive.
- Snapshot delivery, signed revalidation webhooks, live confirmation, retries, per-entry rollback (restore and publish).
- Preview through draft mode.
- Platform console (read-only operational view) and provisioning CLI.
- Alerts by email.

### 10.2 Excluded from v1

Scheduled publishing · approval workflows and multiple roles · multiple locales per tenant · real-time collaborative editing · history inside drafts · slug changes after publish (and redirect management) · per-use image cropping · video and document uploads beyond images (a video is a `video` field: a YouTube or Vimeo link with a still image, §5.2; no video file is stored or served) · full-text search and GIN indexes · `pg_jsonschema` validation · custom editor pages, lifecycle hooks or tenant tables · runtime-loaded modules · per-tenant email branding · more than one bundle file per release · a separate artifact host outside Supabase · a dedicated worker database role · tenant self-service (inviting editors, managing sites) · web-based provisioning · application data of any kind.

---

## 11. Assumptions, risks and required integration tests

### 11.1 Assumptions requiring integration tests

| # | Assumption | Test |
|---|---|---|
| A1 | `cms` is unreachable by `anon` and `authenticated` through REST **and** GraphQL | HTTP requests against staging expect errors |
| A2 | Invoker `api` functions can write `cms` tables via PostgREST under RLS and column grants, including trigger writes to `*_refs` | Persona tests through the HTTP API, not only SQL |
| A3 | `worker_*` functions are callable with the secret key and refused for `authenticated` | HTTP test |
| A4 | Storage RLS on `media-private` by tenant prefix works; `media-public` and `delivery` refuse writes from editors | Storage API tests per persona |
| A5 | Server-side copy from `media-private` to `media-public` works across buckets | Storage API test |
| A6 | `current.json` with `max-age=30` is fresh at the CDN within about a minute after overwrite | Overwrite and poll |
| A7 | On Vercel, after `revalidateTag`, a `present` check shows the new content hash within 60 seconds on polling | Fixture site on Vercel |
| A15 | The live check can read the LABAK slice site and fixture sites (Vercel deployment protection does not apply to them, or a protection-bypass token for automation works) | HTTP test from the worker |
| A8 | Vercel Cron runs every minute on Pro | Observe in staging |
| A9 | Vault secrets are readable by the worker path via `service_role` | SQL test; otherwise use the fallback in §8.2 |
| A10 | iOS uploads arrive as JPEG through file inputs | Manual test on iPhone |
| A11 | Custom SMTP with Icelandic invite, password-reset and email-change templates delivers reliably | Staging |
| A12 | The SDK works on Next.js 15 and 16 | Fixture sites on both |
| A13 | The recursive JSON path in the ref-extraction trigger finds `_ref` at any depth, including inside arrays and rich text | pgTAP |
| A14 | pgTAP impersonation (role plus JWT claims) reproduces PostgREST behaviour closely enough | Cross-check A2 results with SQL results |

### 11.2 Architectural risks

| Risk | Mitigation |
|---|---|
| Rich text and media are the most expensive components to build and maintain | Narrow node set; Tiptap core; images only; no per-use cropping |
| One shared Supabase project: an RLS or grant mistake can expose other tenants | Catalog tests, persona matrix, no definer functions, composite FKs; the tenant connection resolver keeps the code ready to move a tenant to its own project, though no export tool exists yet |
| Sign-in depends on Auth configuration: the hook can be switched off, and the sign-in email template could regain a link or code, which would bring magic-link or code sign-in back. Auth reports every email link as `otp`, so the hook cannot refuse magic links itself. Guessing is limited only per IP address | The hook is enabled by the hosted runbook and verified on every hosted project (a password sign-in succeeds; a sign-up, anonymous or phone sign-in gets no token); the hosted magic-link and confirmation templates are checked to carry no link, token hash or code, and the code length to be 10; all hosted sessions are signed out when passwords are switched on; password sign-in goes from the browser straight to Auth, so its limits key on the editor's address (checked on the hosted project, 2026-11-12); guesses spread over many addresses are accepted (Einar, 2026-11-12) |
| The secret key is a master key for all tenants | Held only by the CMS server environment and the CLI; import rule; rotatable; sites never hold it |
| One deployment updates all tenants at once, including regressions | Staging first; fixture tenants; full test suite gates deploys; feature flags per tenant where useful |
| Single maintainer | This document, runbooks, tests as specification |
| CDN or ISR caching delays | Live confirmation measures actual visibility rather than assuming it |
| Scope creep into client-specific code | Extension points limited to field kinds and document actions; promotion rule |
| Supabase or Vercel pricing or behaviour changes | Postgres-standard design; snapshot format independent of Supabase |
| LABAK's requirements shaping the platform (a LABAK CMS by accident) | The vertical slice includes a second, deliberately different fixture tenant; LABAK's news type is a shared library type with overrides in `modules/labak`; core lint rules from day one; the promotion rule (§3.3) |
| LABAK's launch depends on the Hub | Accepted: there is no urgency to launch. The site's existing `src/core/data/news` module is the seam where the SDK replaces repository content |

### 11.3 Hard-to-reverse decisions (recorded deliberately)

JSONB documents with code-defined schemas · ProseMirror JSON for rich text · references by ID · `tenant_id` and composite FKs everywhere · one shared identity pool · compiled-in modules · bundle format v1.

---

## 12. Resolved contradictions with earlier proposals

The design discussion went through several revisions. These earlier ideas are **superseded** and must not be implemented:

| Earlier idea | Resolution |
|---|---|
| All writes as `SECURITY DEFINER` functions in the exposed `api` schema, owned by `cms_api` | Conflicts with Supabase's guidance. Replaced by invoker functions in `api` over the unexposed `cms` schema. v1 has no definer functions |
| A `cms_publisher` definer function running on the editor's JWT, with HMAC attestation from the Next.js server and a Vault key | Replaced by request-based publishing: the worker validates and commits. No attestation |
| Editing the head revision in place, frozen on publish | Replaced by a mutable `drafts` table plus append-only `revisions` |
| A delivery API in the CMS with per-tenant read tokens | Replaced by snapshot delivery. Sites hold no read tokens; `sites` holds webhook and preview secret references |
| Per-entry content-addressed files and a multi-file manifest; per-entry cache tags | One bundle per release and one `cms` tag per tenant |
| A single public media bucket with unguessable paths | Private originals and public copies made at publish |
| Retaining the last 20 releases publicly, with rollback by switching to an older release | Only the current and previous release stay public; rollback is per entry (restore and publish). Keeps unpublished content from staying reachable for months |
| A release marker of N or higher in the page as proof that a change is live | Content-specific checks: entry markers carrying the new content hash, rendered by the component that renders the entry. The release marker is diagnostic only |
| Unpublish refused while another published entry references the entry | Unpublish always succeeds; the reference resolves to `null` in releases |
| Failed entries keep their projection from the previous release | Fallback only for the same `revision_id` with still-valid references; otherwise the entry is left out. Withdrawal always wins |
| Component-by-component milestones, with LABAK at the end; LABAK possibly launching first with repository-based news | A vertical slice through every boundary first, with LABAK as the first real tenant and a fixture tenant beside it; LABAK launches on the Hub |
| Separate `events` outbox table | Committed `publish_requests` without a `release_id` are the build queue; `site_deliveries` tracks notifications |
| `tenant_admin` and `editor` roles | Single `editor` role in v1; enum kept for later |
| "The server action runs the worker inline" | The editor route only triggers the worker by internal call with a request ID; privileged code never runs in an editor's request |
| A delivery path that might depend on CMS uptime at request time | Sites depend on the CMS only for preview |
| Platform admins with policy-level access to all tenants | Explicit memberships for content; MFA-gated read-only policies for console tables only |
| Per-tenant branded auth emails via the Send Email hook | Out of v1; editors sign in at one Litljómi domain |
| Nightly per-tenant exports to an external provider, chosen at M4 | Dropped (§8.4; plan decisions 53 and 56) |
| On-demand per-tenant exports from the CLI | Dropped; built if a client leaves (§8.3, §8.4; plan decision 56) |
| Single-tenant restore from an export | Dropped (§8.4; plan decision 55) |

---

## 13. Implementation sequence

The full architecture in this document is the target. Development is ordered so that every boundary is proven together, early, in one thin **vertical slice**: authentication, tenant isolation, editing, secure publishing, delivery and website revalidation. The breadth of the editor and the operational features come after.

Each milestone ends with its validation criteria met on CI and, where stated, on staging. Pushes, deploys and anything touching a client's repository, site or accounts follow Litljómi's working agreement (an explicit authority envelope from Einar).

### 13.1 Rules that keep the slice generic

1. **The security boundary is not sliced.** The complete v1 schema, grants, RLS, triggers and `api`/`worker_*` functions are built in the slice, with the full catalog and persona suites. Only editor and operational breadth is deferred.
2. **Two tenants from the start.** Next to LABAK, a fixture tenant `demo` with a deliberately different content type and its own fixture site. Every slice test runs for both, and isolation is tested in both directions.
3. **LABAK's news type is a shared library type.** It lives in `packages/schema`; `modules/labak` only adds overrides and site checks. Nothing in core, the worker or the SDK refers to LABAK.
4. **Final interfaces, few implementations.** The slice builds the manifest, field registry, bundle format, marker contract and worker pipeline at their final interfaces, with only the field kinds the two slice types need.
5. The core lint rules (§3.1) are active from the first commit.

### 13.2 Milestones

| Milestone | Delivers | Validation criteria |
|---|---|---|
| **M0 Foundations** | `litljomi-cms` monorepo; CI (types, lint, tests); Supabase staging and production projects (EU); Vercel Pro project for the CMS; custom SMTP; this document moved to `docs/` | CI green on an empty skeleton; migrations apply to a local stack and staging |
| **M1 Vertical slice (LABAK + demo)** | **Database:** the complete boundary (rule 1). **Auth:** magic link, invited editors. **Schema:** DSL, field registry, field kinds `text`, `date`, `image`, `link`, `richText` (v1 node set); draft and publish validators; projection; content hash. **Editor:** tenant routing, entry list per type, generated form, autosave with version check (basic conflict message), image upload to `media-private`, publish and unpublish, publication status. **Worker:** request → claim → validate and project → commit; full-bundle release with `revisionId` and `contentHash`; media copy to `media-public`; pointer; signed webhook; content-specific live check; fast-path trigger and per-minute sweeper with simple fixed retries; an entry whose projection fails is left out of the release (fail closed; the fallback rule comes in M3). **SDK:** release reading, revalidation handler, entry and release markers, rich-text renderer. **Sites:** a staging deployment of the LABAK site, from a branch, whose news pages read from the Hub's staging project (not production labak.is); the `demo` fixture site | Catalog, persona, integrity, concurrency and escalation suites pass for all tables. On staging, a LABAK test editor creates a news item with image and rich text, publishes, and sees all five states reach **Live** on the LABAK staging site within 60 s; editing it moves **Live** to the new hash; the image is public only after publish; unpublishing passes every `absent` check. Isolation in both directions, through the API and storage. A direct RPC with malformed content is never committed; a stale save is rejected; a draft changed after the request is `superseded`. With the CMS app stopped, both sites keep serving. A1–A5, A7, A11, A13–A15 pass. Lint rules pass |
| **M2 Editor breadth** | All v1 field kinds; singletons and editor structure; list search and status filter; conflict-resolution UX; restore from revision; schema evolution (transforms, outdated-draft handling, snapshot check); focal point and alt-text editing; Icelandic copy throughout | E2E on staging at 375, 768 and 1440 px; a deliberate breaking schema change fails CI; restore and transforms tested; session expiry loses no work; A10 |
| **M3 Publishing and delivery hardening** | Exponential retries for 24 hours and alerts; failed-entry fallback rules (§7.1); retention and public-media cleanup (§7.2); webhook re-send on stale hash; preview (token route, endpoint, draft mode); SDK support for Next.js 15 and 16 | The **Delivery** test suite (§8.5); preview cannot be obtained across tenants and is never cached; A6, A8, A9, A12 |
| **M4 Operations** | Read-only platform console; idempotent provisioning CLI; secret rotation; tenant suspension and editor revocation from the CLI; runbooks | A fresh tenant provisioned from the runbook in under an hour; a webhook secret rotated without failed deliveries |
| **M5 Independent review** | Fresh-context security review of the database boundary, worker, preview and SDK | Findings resolved or explicitly accepted before real editors or real content go in |
| **M6 LABAK integration complete** | Import of the 21 articles (Markdown → ProseMirror JSON); every LABAK site page that shows news reads from the SDK; `remotePatterns` allows exactly the `media-public` host (the site currently allows no remote images); editor guide in Icelandic | Every imported article matches its source word for word; the site renders the same pages as before; a test publish reaches **Live** on the LABAK staging site. Inviting real LABAK editors and launching the LABAK site are separate decisions by Einar, outside this milestone |

M2 and M3 can proceed in parallel once M1 is complete. A separate, executable implementation plan will break these milestones into tasks after this document has been approved.
