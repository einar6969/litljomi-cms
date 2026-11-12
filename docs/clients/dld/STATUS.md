# DLD onto the Hub: status

The living record of onboarding DLD (Dagný Land Design) as a tenant. A later session should be able to continue from this file alone. Update it at every ruling and every stage change.

| | |
|---|---|
| Last updated | 2026-11-12, after Einar's rulings |
| **Current stage** | **3, platform work, and 4, tenant and site, side by side.** Five PRs are merged; the rest of Track A is being built by a second workflow |
| Next action | When workflow `wf_cbbad69a-75a` reports: check each PR at the source, merge in the order below, then advance `production` once (migrations first). Then finish `modules/dld` and connect the site |
| How agents run | Models sized to the task. Briefs point at `docs/agents/CONTEXT.md` and `AGENT-CONTEXT.md` here. Parallel lanes run as workflow scripts. **Every pass on a final head is posted by a reviewer agent, never by the coordinator**; the coordinator merges |

## Where every piece stands (2026-11-12, 21:20)

**Merged to `main`** (none of it is on production yet; `production` is still at `a772423`):

| PR | What |
|---|---|
| #69 | A3: SDK 0.2.0, `pnpm pack:sdk`, the procedure for a site in its own repository |
| #74 | Library L1: data and API (one additive migration) |
| #72 | A second local stack (`CMS_STACK_SLOT=2`) |
| #75 | A2: the generic `import` command, with its plan `docs/plans/import.md` |
| #70 | A11: the `video` field kind; SDK 0.2.1 |

**Being built by workflow `wf_cbbad69a-75a`** (each slice: build, separate reviews on the final head, fix rounds; nothing merges itself):

| Lane | Slices, in order | Branch |
|---|---|---|
| Slot 1 | Editor fixes brought up to date with their browser specs run (PR #73); library L2 thumbnails; L4 + L5 library page and multi-upload; L6 picker in forms | `fix/editor-probe-findings`; `feat/media-library-l2`; `…-l4-l5` (stacked on L2); `…-l6` (stacked on L4 + L5) |
| Slot 2 | Library L3 caption and credit on the site; A7 live confirmation without an own page; A4 local rehearsal with images | `feat/media-library-l3`; `feat/a7-live-checks-without-own-path`; `feat/a4-local-rehearsal` |
| CI only | A12 manual ordering | `feat/a12-manual-ordering` |

**Merge order when they pass:** #73; L2, then L4 + L5, then L6 (stacked, in that order); L3; A7; A12; A4. Bring each up to date with `main` first if `main` moved outside `docs/`; a reviewer agent passes the final head.

**Waiting on those:** `modules/dld` (PR #71, draft, review passed) needs the site entries for person, home and contact (A7) and the ordering opt-in (A12), then a merge of `main`.

**Done in DLD's repository, not merged anywhere:** `cms/integration` at `d604687` (the site without the static export, and one async data layer; all 64 pages unchanged) and `cms/converter` at `aef0cd1` (the content converter; fidelity check passed).

**Not started:** A5 (move or retire a site, needed by go-live), A8 (verify the outage finding on Vercel), the site's switch from its own content to the CMS bundle, provisioning the tenant, the import rehearsal, the copy batch and handbook.

**Debts**
- #69 and #75 carry a final-head pass posted by the coordinator after changes that were docs-only (#69) or one test-only commit (#75). Einar was told; a reviewer can re-read #75's test commit if he wants.
- CI has no browser tests. New browser specs run only when an agent holds a stack.
- `deliver.test.ts` flaked once more in CI (OPEN-ISSUES R6).

## Disk and stacks

The Mac's disk filled at 19:25 and stopped Docker. Einar allowed the npm cache to be cleared ("Yes, clear it") and Docker's unused images to be pruned ("Yes, prune them"). About 10 GB is free; both stacks can run. Agents stop and report if less than 3 GB is free.

- The main checkout needs `CI=true pnpm install` after merges that change the workspace (pnpm refuses to purge `node_modules` without a terminal).
- The DLD site worktrees are in the session scratchpad (temporary) without `node_modules`; their work is on the pushed branches.

## Probe results, 2026-11-12

| Probe | Result | Report |
|---|---|---|
| The site without the static export | **Passed.** All 64 pages stay static and match today's output; the signed webhook refreshes content; preview works. Risks for stage 4 are listed in ENHANCEMENTS.md, last section | [probes/site-without-export.md](probes/site-without-export.md). Clone kept in the session scratchpad (temporary) |
| The editor with portfolio-shaped content | **Works, with blockers** an editor cannot get past: no way to remove a draft or an image, singletons and shared-page types cannot be confirmed live, nothing orders projects, no images in rich text. 13 Hub bugs with steps | [probes/editor.md](probes/editor.md). Code on local branch `probe/dld-shape` (`80080c5`) in `.claude/worktrees/agent-a402a992b16ee4985`; never pushed |
| A release of DLD's size | **No obstacle found locally.** 230 image copies in 2 s; bundle about 275 KB. Hosted storage is unmeasured: the import publishes in batches and measures the first | In the editor report |

Each probe's blockers became a row in ENHANCEMENTS.md (A6, A7, A10, B9, B10).

## How to continue

A new session starts from [START.md](START.md): it holds a paste-ready prompt and the things that are easy to miss. Einar asked for a handover to a fresh session once the second workflow reports ("Yes, hand over", 2026-11-12).

1. Read `CLAUDE.md`, then this file from the top, then [ROADMAP.md](ROADMAP.md), [ENHANCEMENTS.md](ENHANCEMENTS.md) and [content-model.md](content-model.md).
2. Check the state at the source (`gh pr list`, CI, `git log`, the DLD site's branches) before relying on the tables below.
3. The client's workspace is `/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/DLD`. Its `CLAUDE.md` holds DLD's current state and the site's invariants. The site repository is `dld-is/` inside it (remote `einar6969/dld`). The task texts for work in it are in its `metaprompts/active/`.
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

### 2026-11-12: the enhancement list

Asked: "Approve Track A and the five library decisions as recommended?" Einar: "**Approve as recommended**".

- **Track A goes in:** A1–A8 and A10. A8 is verified on Vercel before any fix. A9 (a second admin language) only if DLD asks.
- **The five library decisions, as recommended:** no video files; no copyable file URLs; one web-sized published copy instead of several sizes (B3, later); PDF only for documents; a changed caption waits for the next publish in the first version.
- **Track B is not approved.** Nothing in it is built until Einar says so.

### 2026-11-12: two rows moved to Track A

Einar: "**add B7 and B10 to track A**".

- The `video` field kind is now A11 and manual ordering of entries is A12. Both are approved and are built before DLD's module, because a field's kind cannot change later.
- The content model uses them: a video is a `video` field, and project order is set by dragging, not by a number field.

### 2026-11-12: the content model

Asked: "Approve the content model with my five recommended answers?" Einar: "**Approve as recommended**".

- [content-model.md](content-model.md) is approved as written: five types (`project`, `news`, `person`, `home`, `contact`), tenant slug `dld`.
- The five answers: the slogans go in the CMS; the footer text field stays; DLD is told the logo is changed on request; the 24 alt texts Litljómi drafted are imported and DLD is told they are drafts; a new project appears first until dragged.
- Four things are Einar's to tell DLD (section 8 of the model). Nothing has been sent.

### 2026-11-12: how the work runs

Asked how to make the workflow more efficient, the coordinator proposed seven changes. Einar: "**apply all of it, use a workflow**".

- **Lanes off the stack start now:** `modules/dld`, the content converter and the site integration in `dld-is`, the import command, the editor fixes. Only work that needs the database queues for the local stack.
- **A second local stack** is being built so two agents can run database and browser tests at once.
- **Fewer, larger PRs:** slices are merged where they touch the same files (L4 with L5, A6 with A10).
- **Merge rule relaxed:** a branch need not be updated when `main` moved only under `docs/` (now in `CLAUDE.md`).
- **Tighter briefs:** agents read `docs/agents/CONTEXT.md` and `AGENT-CONTEXT.md` here, with exact files, and leave full suites to CI.
- **Workflow scripts** run build, review and fix for each slice. The coordinator merges.

### Gates still ahead, each needing Einar

- Track B rows, whenever he wants them ([ENHANCEMENTS.md](ENHANCEMENTS.md)).
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

**Technical, still open:**

- How fast hosted storage copies images at publish. Measured only locally.
- Whether a site on Vercel really answers 500 when storage is unreachable right after a publish (ENHANCEMENTS.md A8). Seen on a local server only.
- Whether the local stack can deliver images in a bundle at all (A4): today every image arrives as `null` there.
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

- Fixed in PR #69: the runbook's stale "Vista slóð" step.
- OPEN-ISSUES S20 is still listed P1 though M5 is accepted. Minor 17 (security headers) is listed open; the code sends them.
- `modules/m4-probe` is still registered in the CMS though its tenant was deleted.
- The spec describes module features that are not built: a logo in `branding`, help text, `extensions`, document actions.
