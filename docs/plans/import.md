# Import: design (enhancement A2)

| | |
|---|---|
| Written | 2026-11-12 |
| State | Design for Einar's approval. No code yet |
| Builds on | `recon/platform-offer.md` §5, `probes/editor.md` §7 and §11, `plans/media-library.md` §3–5 |
| Depends on | L1 on the target (`update_asset_text`, `set_asset_thumbnail`); L2's thumbnail maker; A7 for a singleton type with a page of its own; A12 only for `order` |

**What it is.** `import` in `tools/cli` takes a tenant-neutral manifest and a media folder and writes them into one tenant through the same `api` functions an editor calls, signed in as an editor. It validates everything offline first, can be run again without duplicates, publishes in batches the sweep can drain, and ends with a report that compares the public bundle with the manifest word for word and file by hash. Turning a client's old site into a manifest is the client's own script, outside core (platform-offer §5, §6).

## 1. The manifest

One JSON file, `format: 1`. It names no tenant, no id and no host, so the same file can go to the local stack and to production.

| Part | Holds | Rules |
|---|---|---|
| `files[]` | `path` (relative to the media folder), `sha256`, `bytes`, `alt` (the file's default alt), `caption`, `credit` | Path: no leading `/`, no `.` or `..` segment, no backslash, no symlink on disk. JPEG, PNG or WebP, at most 20 MB. Limits: alt and caption 1,000, credit 300. Two paths with the same `sha256` are refused (they would be one library file) |
| `entries.<type>[]` | `key`, optional `slug`, `data` | `key` is stable and unique across the whole manifest. `slug` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 200. `data` is the type's stored shape at its current schema version |
| `singletons.<type>` | `key`, `data` | Only for types the module's structure marks `singleton` |
| `order.<type>` | Keys in the wanted order | Optional. Applied only once manual ordering (A12) exists |

**References inside `data`.** Everything is the module's stored shape except that a reference names a manifest key, never an id. The importer replaces them before validating:

| Written | Becomes | Where it may appear |
|---|---|---|
| `{"$entry": "<key>"}` | `{"_ref": "<entry id>", "_kind": "entry"}` | Reference fields, and inside lists, groups and the video kind |
| `{"$file": "<path>", ...rest}` | `{"_ref": "<asset id>", "_kind": "asset", ...rest}` | Image fields (`rest` is `alt`), the video kind's still image, rich text |
| Rich text: `{"type": "image", "attrs": {"asset": {"$file": "<path>"}, "alt": "…"}}` | The v1 image node | Rich-text fields |
| Rich text: link mark `{"attrs": {"entry": {"$entry": "<key>"}}}` | The v1 entry link | Rich-text fields |

- **An image value may leave out `alt`.** The importer fills in the file's default alt, the same value the editor's image field starts from. An empty string stays empty (decorative, §5.2).
- **List items** are `{ "_key", "value" }` as stored. `_key` may be left out; the importer derives `i0`, `i1`, … from the item's position, so a re-run produces the same data.
- **Rich text** is the v1 node set only: paragraph, heading 2 and 3, bullet and ordered lists, blockquote, image, text with bold, italic and link, hard break (`packages/rich-text/src/doc-schema.ts`). Hrefs must already be in canonical form (`new URL(s).href`); the dry run names the canonical form of any that is not, so the report never meets a changed link.
- **Publication order is derived, not written.** A target is published before anything that refers to it. Entries without references go first; each later wave holds what refers only to earlier waves. A cycle is broken at an optional reference: the first pass publishes without it, the last pass saves the full data and publishes again. A cycle of required references is refused by the dry run.
- **Dates.** `firstPublishedAt` is set by the database at publish and cannot be back-dated. An old site's dates go in a date field of the type.

### Example

```json
{
  "format": 1,
  "files": [
    { "path": "projects/harbour/01.jpg", "sha256": "3f1c…64 hex…", "bytes": 482113,
      "alt": "The harbour path at dusk", "caption": "The new path", "credit": "Photo: A. Person" },
    { "path": "news/opening.jpg", "sha256": "9ab0…64 hex…", "bytes": 210554, "alt": "" }
  ],
  "entries": {
    "project": [
      { "key": "project/harbour", "slug": "harbour-path",
        "data": { "title": "Harbour path", "cover": { "$file": "projects/harbour/01.jpg" },
          "body": { "type": "doc", "content": [ { "type": "paragraph", "content": [ { "type": "text", "text": "A path along the harbour." } ] } ] } } }
    ],
    "news": [
      { "key": "news/opening",
        "data": { "title": "The path opens", "date": "2019-06-01", "image": { "$file": "news/opening.jpg", "alt": "Opening day" },
          "project": { "$entry": "project/harbour" },
          "body": { "type": "doc", "content": [ { "type": "paragraph", "content": [
            { "type": "text", "text": "Read about " },
            { "type": "text", "text": "the project", "marks": [ { "type": "link", "attrs": { "entry": { "$entry": "project/harbour" } } } ] } ] } ] } } }
    ]
  },
  "singletons": { "home": { "key": "home", "data": { "featured": [ { "_key": "a", "value": { "$entry": "project/harbour" } } ] } } },
  "order": { "project": [ "project/harbour" ] }
}
```

Waves here: `project/harbour`, then `news/opening`, then `home`.

### JSON Schema

The schema checks the frame; the module's validators check `data`.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:litljomi:cms-import:1",
  "type": "object", "additionalProperties": false, "required": ["format", "files", "entries"],
  "properties": {
    "format": { "const": 1 },
    "files": { "type": "array", "items": { "$ref": "#/$defs/file" } },
    "entries": { "type": "object", "propertyNames": { "$ref": "#/$defs/typeName" },
      "additionalProperties": { "type": "array", "items": { "$ref": "#/$defs/entry" } } },
    "singletons": { "type": "object", "propertyNames": { "$ref": "#/$defs/typeName" },
      "additionalProperties": { "$ref": "#/$defs/singleton" } },
    "order": { "type": "object", "propertyNames": { "$ref": "#/$defs/typeName" },
      "additionalProperties": { "type": "array", "uniqueItems": true, "items": { "$ref": "#/$defs/key" } } }
  },
  "$defs": {
    "typeName": { "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$" },
    "key": { "type": "string", "pattern": "^[A-Za-z0-9][A-Za-z0-9_./:-]{0,99}$" },
    "text": { "type": ["string", "null"] },
    "file": { "type": "object", "additionalProperties": false, "required": ["path", "sha256", "bytes"],
      "properties": {
        "path": { "type": "string", "minLength": 1, "maxLength": 500, "pattern": "^(?!/)(?!.*\\\\)(?!(.*/)?\\.{1,2}(/|$)).+$" },
        "sha256": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
        "bytes": { "type": "integer", "minimum": 1, "maximum": 20971520 },
        "alt": { "$ref": "#/$defs/text", "maxLength": 1000 },
        "caption": { "$ref": "#/$defs/text", "maxLength": 1000 },
        "credit": { "$ref": "#/$defs/text", "maxLength": 300 } } },
    "entry": { "type": "object", "additionalProperties": false, "required": ["key", "data"],
      "properties": { "key": { "$ref": "#/$defs/key" }, "data": { "type": "object" },
        "slug": { "type": "string", "maxLength": 200, "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$" } } },
    "singleton": { "type": "object", "additionalProperties": false, "required": ["key", "data"],
      "properties": { "key": { "$ref": "#/$defs/key" }, "data": { "type": "object" } } },
    "entryRef": { "type": "object", "additionalProperties": false, "required": ["$entry"],
      "properties": { "$entry": { "$ref": "#/$defs/key" } } },
    "fileRef": { "type": "object", "required": ["$file"], "properties": { "$file": { "type": "string" } } }
  }
}
```

## 2. The command

```
import --tenant <slug> --manifest <abs path> --media <abs dir> --dry-run
import --tenant <slug> --manifest <abs path> --media <abs dir> --email <editor> --expect-ref <ref>
       [--env-file=<abs path>] [--batch-size <1-9>] [--first-batch-only] [--report <abs path>]
```

`--tenant` names both the module (`@litljomi/module-<slug>`, loaded as `cli.ts` does) and the tenant, found after sign-in in `api.my_tenants` by slug. The password is read from standard input only, as `provision` reads secrets. Exit codes as the other commands: 0 ok, 1 failure or any difference in the report, 2 usage.

### 2.1 Dry run (offline)

No network, no env file, no password. It checks, and lists every problem rather than the first:

| Check | Against |
|---|---|
| The frame | The JSON Schema above |
| Every file | Exists under `--media`, is not a symlink, its `bytes` and `sha256` match, and the image inspection the CMS uses (`inspectImage`) accepts it |
| Every key and path | Unique; every `$entry` and `$file` resolves; `$entry` targets a type the reference field's `to` allows |
| Every type | Is in the module; singletons only in `singletons`, other types only in `entries` |
| Every `data` | After replacing references with placeholder ids: `draftValidator`, then `publishValidator`. **Anything the validators would strip is an error**, not a silent loss: the parsed value must equal the input |
| Rich text | `richTextDocSchema`; hrefs already canonical |
| Order | Waves derive; no cycle of required references; `order` names only keys of its type |
| Slugs | Each entry's slug (explicit, else `slugBase(title)` as the editor makes it, else the key slugified). Duplicates per type are errors. **An explicit slug that `slugFits` does not accept for the title is listed as at risk** (2.4) |
| Size | Each draft under 1 MiB and 1,000 references |

It prints counts (files, bytes, entries per type, waves, slugs at risk) and ends with the same text it would compare in the report, so the source can be checked against it before anything is written.

### 2.2 Signing in

- Reads the env file as `provision` does (`hosted.ts`), but **only** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; `readTarget` gains an option that never reads `SUPABASE_SECRET_KEY`. The URL must be `https://<--expect-ref>.supabase.co`.
- Password sign-in at `/auth/v1/token?grant_type=password` with the publishable key. Token and refresh token in memory only; refreshed before expiry, since a run outlasts an hour's token. An account that needs a TOTP step-up stops the command.
- Every call after that is the editor's: PostgREST `rpc/*` and views, and Storage with the editor's token. RLS, column grants and storage policies decide, exactly as for a person.
- The tenant must be in `my_tenants` and `active`. `asset_summary` is called once as a read-only probe: if L1 is not on the target the command stops before writing anything.

### 2.3 The run, and how a re-run recognises what exists

The server is the truth; a **ledger** file is the memory. It sits beside the manifest as `<manifest>.<ref>.<tenant>.ledger.json`, written atomically (temporary file, then rename) after every step.

| Step | Calls | Recognised on a re-run by |
|---|---|---|
| 1. Files | Upload to `media-private/{tenant id}/{asset id}/{safeFilename}` (`x-upsert: false`), `register_asset` with the metadata `inspectImage` derives, `update_asset_text`, then the L2 thumbnail at `…/thumb/480.webp` and `set_asset_thumbnail` | **The asset id is derived, not random:** UUID v5 of `tenant id + "/" + sha256`. `register_asset` lets the client choose the id (§4.3), so `asset_list` by id answers "already there", with no ledger and no schema change. An upload answered "exists" is downloaded and hashed before it is registered |
| 2. Entries | `create_entry(tenant, type, slug)`; singletons `create_singleton_entry(tenant, type, version)`, **never `create_entry`** | The ledger's `key → entry id`. Without it: singletons by type (the function returns the live one); others by `(type, slug)` in `entry_list`. A `slug_taken` is adopted only if that entry is in the ledger or its draft is still empty; otherwise the command stops |
| 3. Drafts | `save_draft` with every reference resolved (a draft may point at unpublished entries) and `title`/`sort_at` from `queryColumns`, as autosave does | The ledger's saved draft version and a hash of the data. Equal data: skipped. **A draft whose version moved past the importer's own is someone else's edit: not touched, reported** |
| 4. Publish | `request_publish(entry, version)` in waves (2.5) | `publication_status`. An entry already published with this data is not requested again |
| 5. Order | A12's function, once it exists | Compared before writing |
| 6. Report | Reads the public bundle (2.6) | Always runs |

**Where the key is remembered, honestly.** Files need no memory: the id is the key. Entries cannot choose their id (`create_entry` generates it), so the key lives in the ledger, with the slug as the fallback. The fallback fails in one case: the ledger is lost **and** an editor's save changed a slug before that entry was published. Then the run stops for that type rather than create a duplicate. Once every entry is published, slugs are locked and the fallback is exact. If that is not enough, the smallest change is additive: a nullable `cms.entries.import_key text`, a partial unique index on `(tenant_id, type, import_key)`, and a new `api.create_entry_keyed(tenant, type, slug, key, version)` that returns the existing id for a known key. No existing signature changes. Not recommended now (decision 1).

### 2.4 Slugs

`create_entry` takes the slug, but until first publish every editor save re-derives it from the title (`auto-slug.ts:32-34`) unless the slug already fits the title (`slugFits`). So an imported slug holds only if the entry is published before any editor saves it.

- Each entry is published in the same run that creates it, and no editor of the tenant should exist yet (decision 4).
- Before `request_publish`, `entry_detail` is read again: slug and draft version must still be the importer's. If not, that entry is not published and is reported.
- The report lists every published slug that differs from the manifest. A published slug cannot be changed afterwards.

### 2.5 Batches and waits

The CLI cannot start the worker (that needs the secret), so its requests wait for the sweep: at most 10 claims a minute, **3 per tenant per run**, one release per run (probe §11). A request older than an hour when claimed fails `deadline_exceeded`.

- **Never more than one batch in the queue.** A batch is at most `--batch-size` requests (default 9, three sweeps), all from one wave. The next batch is filed when every request of this one has a release that is `delivered`, or has failed.
- **Never a referrer before its target is published.** A wave starts only when the previous wave is fully published. A failure in a wave stops the run before the next wave.
- **Polling** `publication_status` every 10 seconds. No progress for 10 minutes stops the run with "the sweep may have stopped" (B11).
- **The first batch is measured** and printed: requested, committed, release built, delivered, per request, with the number and bytes of new images. `--first-batch-only` stops there, so production's first batch can be looked at before the rest. Hosted copies are unmeasured (the probe guesses 10 to 50 times local).
- Expected on production: 60 entries ≈ 20 sweeps ≈ 20–25 minutes, plus 35–54 s of pointer lag per release.
- Import before the tenant's site is registered (decision 45.1): with no site there are no live checks, so a release counts as published when it is delivered to storage.

### 2.6 Resume after a failure

A re-run with the same arguments is the resume. Each step asks the server first (2.3), so a run killed between any two calls continues without duplicates: an uploaded but unregistered file is registered, a created entry with an empty draft is filled, a filed request is waited for rather than filed again. A request that failed validation is reported with its field and not retried until the manifest changes. Nothing is ever undone: a half-imported tenant is finished, never rolled back.

### 2.7 The comparison report

After the last batch it waits until the public pointer (`{tenant}/current.json`, read as the SDK reads it, `packages/sdk/src/client.ts:70-81`) names a release at least as new as the import's last, then reads that bundle.

| Compared | How |
|---|---|
| Every entry present | By the ledger's id, under its type; slug equals the manifest's |
| Every text | Each string in `data` exactly, no normalising. Rich text: the sequence of blocks, heading levels, list nesting, text nodes, marks and hrefs. A difference shows the first differing word with five words either side |
| Every reference | Resolves to the expected key's id (an `EntrySummary`, or the rich-text link's id) |
| Every file | Each delivered image's public `url` is downloaded: sha256 and bytes must equal the manifest's; `alt`, and `caption` and `credit` once L3 delivers them |
| Nothing extra | Entries in the bundle for the imported types that the manifest does not name are listed, not judged |

Output: a JSON report (`--report`, default beside the ledger) and a short summary on screen. Any difference is exit 1. **Anything that could not be checked is counted as unchecked, never as passed.** If B3's web-sized copies ever replace originals on the public side, the file comparison must move to the stored original's hash.

## 3. What it must never do

| Never | Because |
|---|---|
| Read or use the secret key, call a worker route or `admin_*` | It is an editor, and is reviewed as one |
| Print a password, token, signed URL or draft data | Output is keys, ids, statuses, counts |
| Write to a host other than `https://<--expect-ref>.supabase.co` | As `provision` |
| Create a singleton with `create_entry` | It would make the type mixed for good (`singleton_mismatch`) |
| Archive, unpublish or delete anything, or call `set_slug` on an entry it did not create | A mistake must stay visible, and nothing published can be deleted |
| Overwrite a draft or published entry an editor changed after the importer's save | It reports it instead |
| Request a referrer before its targets are published, or queue more than one batch | Refused publishes; the one-hour deadline |
| Find an entry by title or any fuzzy match | Only ledger id, singleton type, or exact `(type, slug)` |
| Let a validator strip a field, or fill a missing required one | Silent loss is what the report exists to catch |
| Read outside `--media`, follow a symlink, or change the manifest | |
| Report a check as passed that it did not make | |
| Name a tenant in generic code | `pnpm check:slugs` |

## 4. Testing without a hosted project

| Level | What | Where |
|---|---|---|
| Unit | Schema and dry run (each row of 2.1 failing on its own); reference replacement in lists, groups, video and rich text; wave derivation and cycle breaking; asset id derivation; ledger writes and a simulated kill after every call; batch waits on a fake clock; report diffs, including one changed word and one changed byte | `tools/cli/src/__tests__/`, with injected `fetch`, files and stdin as the other commands |
| Integration, local stack (holder only) | A small fixture manifest into the `demo` tenant with its module: a full run; a second run that creates nothing; a run killed mid-wave and resumed; an editor save that moves a slug before publish (reported, not published); a singleton; a cycle | `tests/integration/` |
| Production rehearsal | None exists (no staging). The first hosted run is DLD's, with `--first-batch-only` |

**The local stack's limits.** The CLI refuses loopback today, so the integration test needs a `--local` switch that accepts only the stack's own fixed URL (decision 3). And **a local bundle delivers every image as `null`**: the projection keeps only `https` URLs and local storage is `http` (A4). Until A4, the report's file half is "unchecked" on the local stack, and the test asserts exactly that count rather than a pass.

## 5. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Where an entry's manifest key is remembered | **The ledger, with `(type, slug)` as fallback; no schema change.** Add `import_key` only if a lost ledger mid-run turns out to matter |
| 2 | Where `inspectImage`, `safeFilename` and L2's thumbnail maker live, so the CLI derives exactly what the worker re-checks (`asset_mismatch`) | **One small workspace package both `apps/cms` and `tools/cli` import**, created in L2, rather than a copy that can drift |
| 3 | The local target before A4 lands | **A `--local` flag in A2 that accepts only the local stack's fixed URL**, which A4 then reuses |
| 4 | Which account imports | **Einar's own editor membership of the tenant; DLD's editors provisioned after the last publish**, so no editor save can move a slug |
| 5 | Mutual references | **Two passes automatically when a cycle has an optional reference**; refuse a cycle of required ones |
| 6 | A re-run whose manifest changed for an already published entry | **Report it, do not republish**; a later `--update-published` only if asked |
| 7 | Batch size | **Default 9, cap 9**: one batch in the queue at a time; raise only after production's first batch is measured |
| 8 | Two files with the same bytes | **Refused in the dry run**: one library file has one caption and credit |
| 9 | `order` before A12 exists | **Validated, then reported as "not applied"**; the run otherwise succeeds |
