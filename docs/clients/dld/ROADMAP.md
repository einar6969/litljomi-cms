# DLD onto the Hub: roadmap

| | |
|---|---|
| Written | 2026-11-12, after the reconnaissance pass |
| State | **Approved by Einar on 2026-11-12, with adjustments.** His words are in [STATUS.md](STATUS.md) |
| Status file | [STATUS.md](STATUS.md) (current stage, rulings, open questions) |
| Evidence | [recon/client-needs.md](recon/client-needs.md), [recon/site-map.md](recon/site-map.md), [recon/platform-offer.md](recon/platform-offer.md) |

**2026-11-13: stages 3–8 below are replaced by [PLAN.md](PLAN.md).** Einar restated the destination (the CMS connects to `dld.litljomi.is`, editors sign in at vefstjorn.is, no date for `dld.is`) and chose a faster way of working. This file stays as the record of how the plan was reached.

**What the approval changed** (sections 5 and 6 show the outcome):

- **The launch waits for the CMS** (D2). The CMS is now on the launch's critical path.
- **No backups** (D3). Production stays as it is, also with DLD's content in it.
- **These notes are committed** like other docs (D5). The repository is public for now.
- **Improve the platform, don't work around it.** Where DLD's needs show a gap that is good for every tenant, it is built into the Hub. Two tracks: what DLD needs before the Christmas card, and what makes the platform better. The second never puts the first at risk. Einar approves which enhancements go in: [ENHANCEMENTS.md](ENHANCEMENTS.md).
- **The first enhancement is an image and document library**, a first version before DLD's editors start. It replaces "several images in one upload" and "archive unused images" below. Plan: `docs/plans/media-library.md`.

## 1. The destination

1. DLD's live website gets its content from the CMS.
2. DLD's own editors change that content without help, and their changes reach the live site.
3. The next client can be onboarded from what this leaves behind, in docs and code.

## 2. What the reconnaissance found

**The site fits the SDK's target, but not as it is built today.**

- `dld-is` is Next.js 16.2.4 (App Router) on Vercel, project `dld`, serving `dld.litljomi.is`. The SDK supports Next.js 15 and 16.
- It is a **static export** (`output: "export"`). The Hub confirms a publish by calling a route on the site and then reading the page within 60 seconds. A static export has no routes to call, so publishing would end in "Birting á vef mistókst" after a day of retries. Checked in the SDK and the worker.
- All content is TypeScript in `src/content/`: 40 projects, 18 news posts (4 of them Christmas cards), 2 staff, 9 services, site settings and page copy. 228 content images, 125 MB.
- There is no single data layer. About 100 import statements in 54 files read content directly and synchronously.

**DLD's need is small in volume and specific in shape.**

- Two editors. History: under two news posts and about five projects a year, entered in batches, nothing since 2019. They say a backlog is waiting.
- The core task is "add a project with about twelve images, pick the cover and the order, publish". The first dated task is the December 2026 Christmas card.
- Promised editable: projects, news, staff, contact details, the home slideshow photos, images with captions, video by link, drafts and publishing. The offer also names logo and footer text. Page texts were later told fixed, and DLD works on that basis.

**The Hub gives a tenant a real editor, with gaps that matter for exactly this client.**

- Works today, on the hosted project: typed forms, autosave, drafts, publish and unpublish with proof of what is live, history and restore, preview, password sign-in. The admin is Icelandic for everyone.
- **No import path.** None was ever built.
- **One image per upload**, no media library. A gallery can be modelled, but a list of images inside a group has never been tried in a browser.
- **Nothing can be deleted or archived** in the editor. A mistaken or test entry stays in the list for good.
- No video field, no year-only date, no manual ordering, slugs fixed at first publish, images delivered as originals only.
- Onboarding is a tested runbook only for a copy of the `demo` tenant with no real site. A site in its own repository has no procedure.
- Production has no backups, no export and no staging (decision 74).

## 3. Client needs against the platform

Each row was argued from both sides: what DLD needs, what the Hub can take without becoming DLD-shaped.

| DLD needs | Hub today | Resolution | Where it lives |
|---|---|---|---|
| Projects: title, categories, text, cover, gallery, facts | All modellable | A `project` type | `modules/dld` |
| A twelve-image gallery filled in one go | One file at a time | **Generic addition:** several files into an image list | Core, app logic |
| News, project updates, Christmas cards | Modellable. No year-only date | One type with a kind; the site shows the year for cards | `modules/dld`, site |
| Staff with portrait and career lists | Modellable (nested lists) | A `person` type, checked on `/um-okkur` | `modules/dld` |
| Contact details, footer text | Singleton | A settings singleton | `modules/dld` |
| Logo | Images are JPEG, PNG or WebP. The logo is an SVG | **Stays in code.** DLD must be told: the offer says otherwise | Einar's call |
| Home slideshow photos, the six home projects | Singleton with lists and references | A home-page singleton | `modules/dld` |
| Video by link | No video kind | A link and a still image at a fixed place on the page; the site reads the provider | `modules/dld`, site |
| Remove a mistake | Unpublish only | **Generic addition:** archive for unpublished entries | Core, app logic |
| Existing content moved, word for word | Nothing | **Generic addition:** an `import` command that acts as an editor. The DLD-specific converter stays in DLD's repository | `tools/cli`; `dld-is` |
| Old and new addresses keep working | Slugs settable at import, fixed after publish | Import keeps today's slugs. The redirect map stays in the site | `dld-is` |
| Visitors get web-sized images, not originals | Originals only, in a public bucket | The site resizes through `next/image`. Import uses today's web-sized files. Candidate generic addition: shrink on upload | Site; core |
| Their content can't be lost | No backups | Ruling D3 | Einar |
| Admin in a language both editors read | Icelandic only | Ask DLD first. A second admin language would be a platform feature, not a tenant setting | Question for DLD |
| Page texts, services, slogans | Would be modellable | **Out of scope**, as already told to DLD. Stays in code | Settled by Einar, 2026-11-01 |
| A site that updates on publish | Needs a server route | Remove the static export (D1). Pages stay statically generated | `dld-is` |

Refused on the platform's side, whatever the pressure: a DLD branch anywhere in core, an import that writes tables directly, image URLs typed into text fields, skipping live checks for this tenant.

## 4. Stages

Each stage ends in something checkable. I verify every agent report at the source before calling a stage done.

| # | Stage | Done means | Needs Einar |
|---|---|---|---|
| 0 | Reconnaissance | This roadmap and the three reports | Approval of the roadmap |
| 1 | Rulings and probes | D1–D6 ruled. Three probes run on the local stack and a throwaway branch, each with a written result | The rulings |
| 2 | Content model | `content-model.md`: types, fields, labels, ordering, what stays in code, live checks per type. Reviewed separately for DLD and for the platform | **Approval of the model.** A few answers from DLD |
| 3 | Platform work | The generic additions, each merged under "How work runs" and deployed | Keys where needed |
| 4 | Tenant and site | `modules/dld` merged; tenant provisioned; `dld-is` reads the CMS on a branch with its own preview host; a publish reaches Live there for every type | Keys and one DNS record for the preview host |
| 5 | Import | Rehearsed in full on the local stack, then run once on production. Production matches the source word for word and image for image | Einar runs the import (it signs in). Backups are ruled: none (D3) |
| 6 | Editor copy and guide | One batch: field labels, new interface strings, help texts, the handbook draft, the invitation wording | **Approval of the batch** |
| 7 | Go-live | The live site serves CMS content, and a DLD editor has published a real change that reached it without help | **Go-live approval.** Inviting editors, the walkthrough, any DNS |
| 8 | Leave-behind | An onboarding runbook, a module template, a client-folder template, corrected records. A fresh agent onboards a fixture tenant from the runbook alone | Nothing, unless it finds a decision |

### Stage 1: the three probes

Nothing is merged and nothing hosted is touched.

1. **The editor with DLD-shaped content.** A throwaway module: a project with a twelve-image gallery, a person with nested lists, two singletons. Used in the real editor at phone and desktop width. It decides which additions in stage 3 are needed and which are comfort.
2. **The site without the export.** A scratch branch of `dld-is` with the SDK, reading the `demo` tenant's public bundle: it builds on 16.2.4, all 64 pages are still generated statically, and the revalidation route answers.
3. **A release of DLD's size.** About 230 images in one release on the local stack: build time against the worker's 270-second limit, and the bundle's size against Next.js's cache limit.

If a probe fails, the roadmap changes and comes back to Einar.

### Stage 3: platform work

**Needed to reach the destination:**

- An `import` command in `tools/cli`: a neutral manifest and a media folder in, entries and images out, through the same functions an editor uses. Re-runnable, with a dry run and a comparison report.
- A way to rehearse a new tenant on the local stack with the real commands.
- The SDK with a real version, and a written procedure for a site in its own repository.
- A command to move or retire a site, for the day a preview host becomes the real domain. Boundary work.

**Ordered by Einar on 2026-11-12:** the image and document library, a first version before DLD's editors start (the library screen, several files in one upload, caption and credit, usage, unused). Documents, image sizes and folders follow later. Plan: `docs/plans/media-library.md`.

**Every other enhancement** is proposed in [ENHANCEMENTS.md](ENHANCEMENTS.md), in two tracks with a rough size each. Einar approves which go in.

### Stage 4: the site

- The static export is removed first, as its own small change. It is useful by itself: it also makes a working contact form possible.
- The CMS integration is built on a branch, not on `main`. Every push to `main` shows in DLD's review frame at once.
- The site must tolerate a missing reference. An editor who unpublishes a project that a service page or the slideshow points at must not break the page.

### Stage 5: the import

- The converter reads `dld-is` at one frozen commit and writes the manifest. It lives in DLD's repository.
- The rehearsal on the local stack is the real test. On production nothing can be deleted, so the production run happens once, after a dry run.
- If project or news text changes after the freeze, the import runs again and updates only what changed.

### Stage 7: go-live

Before asking for approval: the open go-live checks that apply to a real tenant (OPEN-ISSUES B3, B4, B6), the backups ruling in effect, the site record on the right host, and a smoke test on production (publish, edit, preview, unpublish, restore).

Until the integration branch is merged, the site keeps running from the repository's content. That is the fallback at every earlier stage.

## 5. Decisions, as ruled on 2026-11-12

| # | Decision | Recommended | Ruled |
|---|---|---|---|
| D1 | Remove the static export from `dld-is` (open item ED-1) | Yes | **Yes** |
| D2 | Does the dld.is launch wait for the CMS? | No; the CMS follows before the December card | **Yes, it waits:** aim for CMS completion before launch |
| D3 | Backups (decision 74) | Supabase Pro before DLD's editors are invited | **No backups** |
| D4 | How changes to `dld-is` run | The coordinator dispatches the agent, on a branch with a preview host | **Yes** |
| D5 | These notes and the public repository | Keep `docs/clients/` out of git | **No: they are committed.** The platform will not stay public |
| D6 | SDK distribution for DLD (decision 42.4) | Vendored packages with a real version number | **Yes** |

What follows from D2 and D3:

- Every stage up to go-live is now on DLD's launch path. The launch window (to 2026-11-22) will pass before the CMS is done; the December card is the date that holds.
- With no backups, the rehearsal on the local stack carries more weight. The imported content can be rebuilt from `dld-is` at its frozen commit. What DLD's editors enter afterwards exists only in production.

## 6. What I recommended deciding differently

Einar ruled on the first of these (D2): the launch waits. The reasoning is kept as the record of the trade-off.

**Do not make the launch wait for the CMS (D2).** *Not taken.*

- The launch window is 2026-11-08 to 2026-11-22. The CMS path has five things that have never been done once: an import, a site in its own repository, a gallery in the editor, a release of this size, a real editor.
- The site is finished without the CMS: its content is already in the repository. Only the contact form blocks it, and D1 unblocks that.
- DLD's first dated need for the editor is the December card. That is the CMS deadline that matters to them.
- It keeps the risk off the launch. The switch to CMS content is then rehearsed on a preview host and compared page by page before it replaces anything.
- The cost is yours to weigh: the vefstjórn is a sold line, and payment and the warranty both count from launch. DLD would need to hear that it follows within weeks. Read the offer's page 7 before ruling.

**Raise three promise gaps with DLD before the content model is fixed**, rather than after:

- The logo is not self-service, though the offer lists it.
- A video sits at a fixed place on the page, not anywhere in the text.
- New projects do not appear under a service's "Tengd verk" by themselves.

## 7. Risks

| Risk | Handling |
|---|---|
| **First real tenant.** Import, own-repository site, go-live and a real editor all happen for the first time on a paying client | Probes first. Full rehearsal on the local stack. The site stays on repository content until stage 7 |
| **No backups, no staging** (OPEN-ISSUES R2) | Accepted by Einar (D3). Every change that touches the database, sign-in or publishing is tried on the local stack first. Migrations stay additive |
| **Permanent choices.** The tenant slug, type and field names, slugs after first publish. Nothing can be deleted, so an import mistake stays | The model is approved before any code. The production import runs once, after a dry run |
| **The dates.** The launch now waits for the CMS (D2), and the December card follows close behind | Two tracks: only what DLD needs is on the launch path. If the CMS is late for the card, Einar posts it from the repository as today |
| **Admin language.** One editor writes English; the admin is Icelandic | Ask DLD. The handbook can carry both languages |
| **Leaving the export** changes how the site is served: 404s, headers, the two noindex switches | Its own change, checked against the DLD workspace's invariants before anything else builds on it |
| **Free-plan limits.** Storage about 1 GB, and every published image is stored twice: about 250 MB after import. Egress about 10 GB a month | The site serves resized images through Vercel, not originals from Supabase. Re-check at D3 |
| **An editor's edit breaks a page** | The site tolerates missing references. The handbook says what unpublish does |
| **Editor sign-in is password only**, six characters, no lockout (S28, accepted) | Nothing new. The handbook asks for a long password |
| **Alerts reach Einar only**, and nothing alerts if the sweep stops | The heartbeat candidate in stage 3 |

## 8. How the two sides stay independent

- **For DLD:** a fresh agent that reads only DLD's record and the thing under review. It never reads the Hub's code and is told to ignore what is easy to build. It reviews the content model, walks the editing scenarios before go-live, and reads the copy batch as an editor would.
- **For the platform:** the Hub's own reviewers on every code change, and one integrity read of the content model against the spec's rules for what may be tenant-specific.
- **I reconcile.** Where the two disagree and I can't settle it inside your intent, it comes to you with both positions stated.

## 9. Questions for DLD

A meeting is proposed for 2026-11-13. These are for Einar to ask; I write to nobody.

1. Who will edit, and should the admin and the handbook be in Icelandic, English or both?
2. How much is waiting to go in: how many projects, roughly how many images each, how large? Who enters the first batch?
3. May the site open before the vefstjórn is ready, if the vefstjórn is there before the Christmas card?
4. Where should a new project appear in the list: first, or placed by hand?
5. Captions and photographer credits: should they show, and where?
