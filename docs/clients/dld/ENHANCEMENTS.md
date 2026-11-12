# Enhancements to the Hub, from DLD's onboarding

| | |
|---|---|
| Written | 2026-11-12 |
| State | **Track A approved by Einar on 2026-11-12** ("Approve as recommended"), with the five library decisions as recommended. **Track B is proposed, not approved** |
| Rule | "Improve the platform, don't work around it." Every row is generic, for all tenants. Nothing DLD-shaped in core |
| Evidence | [recon/](recon/), [probes/](probes/), `docs/plans/media-library.md` |

**Two tracks.** Track A is what DLD needs before the Christmas card; since the launch waits for the CMS, Track A is also the launch path. Track B makes the platform better and never delays Track A.

**Sizes.** S is one PR of app logic. M is two or three PRs, or one PR at the security boundary. L is a migration plus API plus editor plus SDK.

**Tiers** are `CLAUDE.md`'s: boundary work gets spec, security and quality reviews; app logic gets one combined review. Everything that touches the database, sign-in or publishing is rehearsed on the local stack as an upgrade of a database with real rows in it, because production has no backups.

## Track A: DLD needs this before the Christmas card

| # | Enhancement | Why DLD needs it | Size | Tier | State |
|---|---|---|---|---|---|
| A1 | **Image library, first version** (slices L1–L6): the library page, thumbnails, several files in one upload, caption and credit per file and delivered to the site, usage, the unused filter, and picking one or many files from the library inside a form | The core task is a project with about twelve images. Today that is twelve separate uploads, each loading a full-size original | L (3 boundary PRs, about 5 app PRs) | Boundary and app logic | **Ordered** |
| A2 | **An `import` command**: a neutral manifest and a media folder in, entries and files out, through the same functions an editor uses. Dry run, re-runnable, and a word-for-word comparison report | 58 entries and 228 images cannot be retyped, and nothing published can be deleted, so it has to be right the first time | M | App logic, with a security review (it signs in) | Proposed |
| A3 | **A site in its own repository**: the SDK and renderer with a real version, one command that packs them, the type generator and a fixture bundle for the site's own checks, all in the runbook | DLD's site is the first that does not live in this repository. Ruling D6 | S–M | App logic | Proposed |
| A4 | **Rehearse a new tenant on the local stack** with the real commands, images included | The import and the site integration are rehearsed locally before production. Today the local stack only knows the two fixture tenants, `provision` refuses a local address, and a local bundle delivers every image as `null` (the projection keeps only `https` addresses; local storage is `http`) | M | Boundary for the image part (the projection) | Proposed |
| A5 | **Move or retire a site** | A site starts on a preview host and ends on its real domain. Today the old record can only be switched off with direct SQL on production | M | Boundary | Proposed |
| A6 | **Archive an unpublished entry** | Editors learning the system will create entries by mistake. Today these stay in the list for good. The database function exists; the editor has no button | S | App logic | Proposed |
| A7 | **Live confirmation for content with no page of its own** | Staff, contact details and the home page's settings show on shared pages. The probe found three failures: a singleton with a declared page cannot be published at all ("Ekki hægt að birta: Slóð", and there is no slug field); a type on a shared page is never confirmed as withdrawn; a type with no checks shows "Birt á vef ✓" with nothing checked | M | Boundary (the module manifest and the worker) | Proposed |
| A8 | **The site keeps serving when storage is unreachable right after a publish** | The site probe got a bare 500 on every page in that window, on a local server. The spec promises the last good page. First step: reproduce on Vercel. Fix only if it is real there | S to verify; M if real (SDK, spec §7.3) | Boundary | Proposed |
| A9 | **The admin in a second language** | One of DLD's two editors writes English. Only if DLD asks for it | M–L | App logic, and a copy batch | Waiting for DLD's answer |
| A10 | **Editor fixes from the probe** ([probes/editor.md](probes/editor.md), section 14) | Faults a first real editor will hit. The ones that mislead: the panel stays "Birt á vef ✓" while the draft has unpublished changes; replacing an image empties its alt text; "Fjarlægja mynd" leaves an empty item that then blocks publishing without saying which; pasted lists arrive as paragraphs with typed bullets, and pasted images and tables vanish silently; a save conflict appears out of view | M (2–3 PRs) | App logic | Proposed |

**Order.** A1's first slice starts now. A2, A3 and A4 can run beside it; A2 finishes after the library's thumbnails, because imported files should arrive with them. A5 is needed by go-live, not before.

**What the probe measured for the import (A2).** The sweep takes three publish requests per tenant per run, so 60 entries need about 20 runs. Locally a release with 12 new images builds in under half a second; hosted storage is perhaps 10 to 50 times slower and has not been measured. The import therefore publishes in batches and measures the first one on production. DLD's whole bundle comes to about 275 KB, far below the 1.5 MB at which Next.js stops caching it.

## Track B: makes the platform better

None of these is on DLD's path. Each can be approved, deferred or dropped separately.

| # | Enhancement | What it gives | Size | Tier | Note |
|---|---|---|---|---|---|
| B1 | **Take a file out of the library, and put it back** (L7) | Unused files leave the list, singly or many at once | M | Boundary | The second half of "archive unused images" |
| B2 | **File changes go live without a publish** (L8) | A corrected caption or credit reaches the site in minutes. Without it, it waits for the tenant's next publish of anything | M | Boundary, in the most delicate part of publishing | The first version says so in the panel |
| B3 | **A web-sized published copy** (L12) | The public file is at most 2,560 px with no EXIF or GPS. Today the original is published as uploaded, up to 20 MB | L | Boundary | Your "several sizes per image", as one size. DLD asked for its drawings to be protected; this is what does it. Until then imports use web-sized files |
| B4 | **Documents (PDF)** (L11) | PDFs in the library, a file field, links to a document from text | L | Boundary | DLD's site has one PDF and a few document links today; they stay in the site until this exists |
| B5 | **Tags** (L9) | Tags per file and a tag filter | M | Boundary and app logic | |
| B6 | **Folders** (L10) | Folders and moving files | L | Boundary and app logic | A new tenant table: the heaviest kind of change |
| B7 | **A `video` field kind** | A pasted YouTube or Vimeo link is checked when saved, with a still image from the library | M | App logic | **Decide before the content model:** a field's kind cannot change later. Without it, a video is a link field and an image field side by side, which works today |
| B8 | **Help text under a field** | A module can explain a field where the editor fills it in | S | App logic | Cheap, and it serves "without help" directly |
| B9 | **Images and entry links in rich text** | An image between paragraphs; a link to another entry that survives a title change | M | App logic | The format already has both; the editor has no buttons |
| B10 | **Manual ordering of entries** | Drag a type's entries into order | M | Boundary if it needs a column | The probe rated the lack of it a blocker for a portfolio: nothing sets the order of projects. Until then, order comes from a date or a number field the editor types. **Decide before the content model**, for the same reason as B7 |
| B11 | **An alert when the worker's sweep stops** | Today nothing tells anyone that publishing has silently stopped | S | App logic | Worth having before any real editor |
| B12 | **A per-tenant export** | A complete copy of a tenant's content and files in a folder | M | App logic | With no backups this would be the only copy outside production. It reopens decisions 55 and 56 |
| B13 | **The onboarding kit**: a runbook, a module template, a client-folder template | The next client is onboarded from the runbook alone | M | App logic and docs | Not optional: it is the brief's third goal. Built after go-live, from what DLD's onboarding taught |
| B14 | **Record corrections** | The runbook's stale step, two stale rows in OPEN-ISSUES, a leftover module registration | S | Docs | |

## Not proposed

| Idea | Why not |
|---|---|
| Video files in the library | The spec excludes them, the bucket takes 20 MB, and there is no transcoding. It needs a video host and a budget. A video on a site stays a link to a provider |
| Copyable file URLs in the library (the reference's "Slóðir") | Content refers to files by id. A pasted URL gets no alt text, no usage and no live check, and breaks when the file is withdrawn |
| A full set of image sizes | It repeats what each site's own image optimiser does, at about five times the stored files. Decide after B3, on numbers from a live site |
| A year-only date kind | The site can show the year alone for one kind of post. No stored data needs it |
| Deleting files or entries for good | Destructive work on a production with no backups, and the spec refuses it for anything ever published |
| Changing a published entry's address, with redirects | Excluded from v1. An entry's address not changing when its title does is what DLD needs |

## Library decisions for Einar

The plan settles the rest. These five are yours.

| # | Decision | Recommended |
|---|---|---|
| 1 | Video in the library | **None.** The "Myndbönd" filter is left out. See B7 |
| 2 | The reference's copyable URLs | **Left out,** for the reason above |
| 3 | "Several sizes per image" | **One web-sized published copy (B3),** after the first version |
| 4 | Which documents (B4) | **PDF only,** at most 20 MB |
| 5 | A changed caption waits for the next publish in the first version | **Accept for the first version;** B2 removes the wait |

Settled without asking, because your ruling or the spec already decides them: caption and credit are stored per file; alt text stays per use, with a default per file; "unused" means no current draft and no currently published version uses the file; thumbnails are made on the server when a file is registered.

## Found by the probes, for the site rather than the Hub

These belong to stage 4, the work in `dld-is`. They are not enhancements.

- Leaving the static export changes nothing for visitors: all 64 pages stay static and match today's output.
- Upgrade Next.js from 16.2.4 to the current 16.4 release when the server arrives; the older version has open advisories that matter once a server runs.
- Turn image optimisation on. The projects page drops from 20 MB of images to under 2 MB.
- A new entry's page must appear without a rebuild, and an unknown address must still get the site's real 404 page. The probe shows these pull against each other in Next.js 16; the integration has to solve it.
- Keep `public/` out of the server functions (125 MB today) until the images have moved to the CMS.
