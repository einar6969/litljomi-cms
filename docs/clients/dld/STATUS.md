# DLD onto the Hub: status

The living record of onboarding DLD (Dagný Land Design) as a tenant. A later session should be able to continue from this file alone. Update it at every ruling and every stage change.

| | |
|---|---|
| Last updated | 2026-11-12, after Einar's rulings |
| **Current stage** | **1, probes.** The roadmap is approved with adjustments and D1–D6 are ruled |
| Next action | Finish the probes and the library design, then bring Einar the enhancement list ([ENHANCEMENTS.md](ENHANCEMENTS.md)) for approval. After that: the content model (stage 2) |
| Nothing has changed in | The Hub's code, production, `dld-is`, the DLD workspace, Vercel, DNS |

## How to continue

1. Read `CLAUDE.md`, `docs/king/BRIEF.md` section 1 and `docs/king/OPEN-ISSUES.md` in this repository.
2. Read [ROADMAP.md](ROADMAP.md), then this file's rulings and open questions.
3. The client's workspace is `/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/DLD`. Its `CLAUDE.md` holds DLD's current state and the site's invariants. The site repository is `dld-is/` inside it (remote `einar6969/dld`).
4. Do nothing past the current stage without the approval the roadmap names for it.

## Standing instructions

From Einar's brief of 2026-11-12, in his words:

- "Your roadmap: I approve it before you execute it."
- "At minimum also: the content model you settle on, editor-facing copy (in one batch), and go-live."
- "Plus everything on CLAUDE.md's ask-first list: DNS, money, inviting editors or writing to the client, deleting production data, secrets."
- "A known risk to raise with me before real client content enters production: backups are on hold (decision 74)."
- "The platform stays generic. Nothing DLD-specific goes into the Hub's core code; client-specific things live where the architecture puts them."
- "The client's interests are represented independently of the CMS's interests. […] some part of your process must speak for DLD without being shaped by what is easy for the CMS, and some part must speak for the platform's integrity. Your job is to reconcile them."
- "Code changes follow CLAUDE.md "How work runs" (review by risk, PR, Review: PASS on the exact head, CI green)."
- "Changes to the DLD site belong in its own repository."

## Rulings

Each with the date and Einar's own words.

### 2026-11-12: the roadmap and D1–D6

"Thanks, the roadmap is good. Approved, with the adjustments below. Record my rulings in STATUS.md with my words."

| # | Decision | Einar's words | What it means |
|---|---|---|---|
| D1 | Remove the static export from `dld-is` | "remove the static export: yes." | Settles the second half of DLD's open item ED-1 |
| D2 | Does the dld.is launch wait for the CMS? | "lets aim for cms completion before launch..." | **The recommendation was not taken.** The launch waits for the CMS. The CMS is on the launch's critical path |
| D3 | Backups (decision 74) | "backups: no" | No Pro plan. Production stays without backups, also with DLD's content in it. The backups gate in stage 5 is closed |
| D4 | How changes to `dld-is` run | "the coordinator dispatches agents on a branch with a preview host: yes." | For this onboarding. The preview host needs one DNS record from Einar |
| D5 | Client notes kept out of the public repository | "no. the cms platform is public for now, but it wont be in the future." | **The recommendation was not taken.** `docs/clients/` is committed like other docs. The local exclude is removed |
| D6 | SDK distribution for DLD | "vendored SDK with a real version: yes. A package registry isn’t worth it for one more site." | Replaces decision 42.4's registry at the second site |

### 2026-11-12: a principle for the whole project

"**A principle for the whole project: improve the platform, don't work around it.** When DLD's needs reveal something the Hub lacks, and it would be genuinely good for the platform, build it into the Hub instead of working around it. DLD is the first client to use it, not the only one. Guardrails:

1. Every enhancement is generic, designed for all tenants. Nothing DLD-shaped in core.
2. Implement directly, as a normal developer would. Keep the existing tests passing (CI runs them on every push anyway) and add tests where they help. Where a change touches the database, sign-in or publishing, try it on the local stack before production: production has no backups.
3. Two tracks. Keep "DLD needs this before the Christmas card" separate from "this makes the platform better", and never let the second put the first at risk. Bring me the list of enhancements you propose, with a rough size for each; I approve which go in."

The coordinator's reading of guardrail 2: write the code without extra planning ceremony. The merge rule in `CLAUDE.md` ("How work runs") still holds, as the brief's non-negotiables say.

### 2026-11-12: the first enhancement, an image and document library

"I want a library page in the CMS where all of a site's images and documents live in one place. From the reference:

- grid and list views, search, filters (images, documents, video), newest first;
- upload several files at once;
- per file: alt text, caption, photographer/credit, tags, folder;
- "missing alt text" and "unused" filters;
- where each file is used ("Notkun"); the Hub already tracks which entries reference each image;
- several sizes per image, and documents (PDF), not only images.

Split it as you see fit. My expectation: a first version before DLD's editors start (the library screen, multi-upload, caption and credit, usage, unused), and the heavier parts (documents, image sizes, folders) after. Treat it as boundary work wherever it touches the database, storage, publishing or the SDK. It replaces "several images in one upload" and "archive unused images" in your candidate list; v1 of the spec excluded a media library, and my ruling overrides that."

The reference is a screenshot of another admin's "Myndasafn" page, described in `docs/plans/media-library.md`. The spec is to be amended to match this ruling.

### Gates still ahead, each needing Einar

- Which enhancements go in ([ENHANCEMENTS.md](ENHANCEMENTS.md)).
- The content model (stage 2).
- The copy batch (stage 6).
- Go-live (stage 7).

## Open questions

**For DLD, through Einar** (a meeting is proposed for 2026-11-13; no reply was logged as of 2026-11-12):

1. Who edits, and in which language should the admin and handbook be?
2. How large is the backlog, and who enters the first batch?
3. May the site open before the vefstjórn, if the vefstjórn is ready before the Christmas card?
4. Where does a new project appear in the list?
5. Captions and photographer credits: shown, and where?

**For Einar, at the content model:**

- The logo cannot be self-service on the Hub (SVG is not an accepted image type), though the offer lists it. Who tells DLD?
- Footer text and the home page's slogans: in the CMS or in code?
- "Tengd verk" on the service pages and the six projects on the home page: who maintains them after launch?
- Which of the candidate platform additions are needed before DLD's editors start.

**Technical, to settle in stage 1:**

- Does a list of images inside a group work acceptably in the editor? Never tried in a browser.
- Does a release with about 230 images build inside the worker's 270-second limit?
- How large is DLD's bundle against Next.js's cache item limit?
- Which preview host the integration branch gets. Vercel's protection on `dld` covers everything but custom domains, and the worker follows no redirects and cannot pass protection, so it needs a custom domain (one DNS record, Einar's).

## Verified by the coordinator

Checked at the source on 2026-11-12, not taken from a report.

| Fact | Where |
|---|---|
| `dld-is` is Next.js 16.2.4 with `output: "export"` and `images.unoptimized`; `main` = `13f1df0`, clean, in sync | `dld-is/next.config.ts`, `package.json`, `git status` |
| Vercel project `dld` serves `dld.litljomi.is`; protection is on for everything except custom domains | Vercel connector |
| Production holds two tenants (`demo`, `labak`), a 13 MB database, about 5 MB of media | Supabase connector, read-only query |
| The SDK needs a POST route on the site; the live check polls for 60 seconds | `packages/sdk/src/revalidate-handler.ts`, `apps/cms/src/privileged/worker/live-check.ts` |
| An `absent` check on a shared page needs the marker gone and a 200; on the entry's own path it needs a 404 | `live-check.ts`, `evaluateCheck` |
| The CLI has no import command | `tools/cli/src/cli.ts` |
| The image field takes one file; nothing in the editor calls `archive_entry` or `archive_asset` | `apps/cms/src/editor/form/fields/ImageField.tsx`; grep of `apps/cms/src` |
| Slugs are derived with Icelandic letters mapped (þ, ð, æ, ö and accents) | `packages/schema/src/slugify.ts` |
| Supabase Free: 500 MB database before read-only, pause after 7 days of low activity, no backups. Pro: daily backups for 7 days, database only | Supabase documentation |
| The client report's key quotes match the email history and the meeting notes | DLD workspace, `notes/` |

Not verified, carried as open: the Free plan's 1 GB storage figure; Vercel's image-optimisation allowance on Pro; Next.js's 2 MB cache item limit.

## Where things are

| Thing | Place |
|---|---|
| Roadmap | [ROADMAP.md](ROADMAP.md) |
| Recon: what DLD needs, argued for the client only | [recon/client-needs.md](recon/client-needs.md) |
| Recon: the site's code, content model and data seam | [recon/site-map.md](recon/site-map.md) |
| Recon: what the Hub offers, argued for the platform only | [recon/platform-offer.md](recon/platform-offer.md) |
| Prices, payment terms, emails, contact details | The DLD workspace only. Never in this repository |
| Client-facing drafts (handbook, messages) | The DLD workspace, `drafts/`. Einar sends |
| Prompts for agents working in `dld-is` | The DLD workspace, `metaprompts/` |

This folder is committed like any other docs (ruling D5). The repository is public for now, so prices, payment terms, emails and contact details still stay out of it.

## Found along the way

Not acted on. Each is somebody else's record to correct.

**The DLD workspace's `CLAUDE.md` against its own sources** (from the client pass; the first two are checked):

- "DLD chose to add content themselves": the meeting record says "Both", and that they could do it through the CMS to learn it. Who enters the backlog is unsettled.
- News editing is missing from the offer's CMS line items as listed (D4–D8), though it is the first item on the offer's vefstjórn page.
- Open item ED-20 cites only the offer's page 2. Page 3 is equally broad, and the later narrowing dropped logo and footer text without anyone telling DLD.
- "The week of 2026-11-02" for Dagný's review is stale; a later email moved it.
- "8 posts full-bleed, 6 S1" counts 14 posts; 18 are built.
- Open item LB-1's list lacks the later promises: Christmas cards with a year-only date, staff image swaps.

**The Hub's records** (from the platform pass):

- `docs/runbooks/operations.md` section 2, step 9, tells the editor to press "Vista slóð". The button no longer exists.
- OPEN-ISSUES S20 is still listed P1 though M5 is accepted. Minor 17 (security headers) is listed open; the code sends them.
- `modules/m4-probe` is still registered in the CMS though its tenant was deleted.
- The spec describes module features that are not built: a logo in `branding`, help text, `extensions`, document actions.
