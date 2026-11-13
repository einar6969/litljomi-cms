# DLD onto the Hub: status

The living record of onboarding DLD (Dagný Land Design) as a tenant. A later session should be able to continue from this file alone. Update it at every ruling and every stage change.

| | |
|---|---|
| Last updated | 2026-11-13, after Einar chose the fast lane and restated the destination |
| **Current stage** | **Platform work and site work, side by side** (PLAN.md has replaced the roadmap's stages 3–8). Five PRs are merged. Eight more are built, reviewed and green, and none is merged |
| Next action | **[PLAN.md](PLAN.md), work package WP1**, with WP3, WP4 and the first copy batch alongside. PLAN.md says what to do; this file says what is true |
| How agents run | Models sized to the task. Briefs point at `docs/agents/CONTEXT.md` and `AGENT-CONTEXT.md` here. Parallel lanes run as workflow scripts. **Every pass on a final head is posted by a reviewer agent, never by the coordinator**; the coordinator merges |

## Where every piece stands (2026-11-12, 23:45)

**Merged to `main`** (none of it is on production yet; `production` is at `b8c702c`):

| PR | What |
|---|---|
| #69 | A3: SDK 0.2.0, `pnpm pack:sdk`, the procedure for a site in its own repository |
| #74 | Library L1: data and API (one additive migration) |
| #72 | A second local stack (`CMS_STACK_SLOT=2`) |
| #75 | A2: the generic `import` command, with its plan `docs/plans/import.md` |
| #70 | A11: the `video` field kind; SDK 0.2.1 |

**Built, reviewed and green, not merged** (workflow `wf_cbbad69a-75a`, finished 23:30). Checked at the source by the coordinator: each has `Review: PASS` on its exact head from a reviewer agent, CI green, and GitHub reports it mergeable.

| PR | What | Head | Migration |
|---|---|---|---|
| #73 | A6 + A10: archive an entry, and the editor fixes from the probe | `7bff99a` | none |
| #78 | Library L2: thumbnails | `9163224` | none |
| #81 | Library L4 + L5: the library page, several files per upload (stacked on #78) | `8c38170` | none |
| #82 | Library L6: choose from the library, pick many into a list (stacked on #81) | `922ef79` | none |
| #76 | Library L3: caption and credit reach the site; SDK 0.2.2 | `4ff5d03` | `20261112210000_media_library_delivery.sql` |
| #79 | A7: live confirmation for content with no page of its own | `474dc48` | `20261112210000_nothing_checked.sql` |
| #77 | A12: manual ordering of entries | `78b7ccb` | `20261112230000_manual_order.sql` |
| #80 | A4: rehearse a tenant on a local stack, images included; rich-text 0.2.1 | `411ef5d` | none |

**Waiting on those:** `modules/dld` (PR #71, draft, review passed at `33ed9aa`, now conflicting with `main`) needs the site entries for person, home and contact (A7) and the ordering opt-in (A12), then a merge of `main`.

## What the second workflow left

**The plan for landing these eight PRs is [PLAN.md](PLAN.md), WP1.** It lands them as one integration PR. Facts it rests on, checked on 2026-11-13:

- **Same migration number:** #76 and #79 both add `20261112210000`.
- **Same function replaced twice:** #76 and #77 both replace `api.worker_release_snapshot` from `main`'s body; A12's would remove L3's `caption` and `credit`.
- **The branches conflict textually** when merged together (an earlier "no conflicts" here came from a check that never ran). The files are listed in PLAN.md.
- **Four migrations** are waiting for production, not three: L1's is on `main` and not on production.
- #77 and #79 change no file under `packages/sdk`.

**Owed on a stack, never run** (WP1 runs the first two; WP5 runs the trials):
- A12's browser spec `manual-order.spec.ts` (built without a stack; only parsed).
- `design.spec.ts:383` fails on `main` since A11 (#70): its "Bæta við" locator now matches two lists. Test-only fix.
- The plan's local trials: L2 with a 20 MB image (time, memory, the sweep), L5 with twelve real 5–10 MB photographs on a slow connection, L6 at phone and desktop width.
- L2's memory was measured on macOS only. Vercel runs Linux.

**Choices the agents made that Einar may want to see** (none blocks a merge; reviewers passed them):
- **L2:** an image whose decoding would need more than about 320 MB (a progressive JPEG above about 55 megapixels, for one) gets no thumbnail and shows the original. One image is decoded at a time per server instance; when eight are waiting, a further file gets its thumbnail on a later view.
- **L4 + L5:** the library lists at most 960 files and says so (the database interface returns 1,000 rows). A file's use is labelled "Á vefnum" as soon as the publish is committed, before it is confirmed live: the plan says so, spec §7.4 says success is never shown before its proof. A reviewer flagged the contradiction for Einar.
- **L6:** one PR, not the plan's two. Replacing an image keeps the alt text it had. The approved "Velja mynd" became "Hlaða upp mynd" (DRAFT), as the plan says. "Velja 21 myndir" is ungrammatical; the plan gives no other form.
- **L3:** a saved caption or credit reaches the site with the tenant's next release of anything (library decision 5). The import report now compares captions and credits.
- **A7:** a new final state, "Birt, ekki staðfest á vef" (DRAFT), for content no page is checked for; the same for unpublishing. It is recorded on the release.
- **A12:** `api.move_entry` accepts entries of any type; on a type that isn't ordered by hand the keys are stored and unused.
- **A4:** `--local` accepts only the two slots' `127.0.0.1` addresses. Images on `http` are delivered only when the worker's own Supabase address is a loopback address.
- **#73:** a paragraph pasted from Word into a list item merges into that item.

**The copy batches** (two, by Einar's ruling of 2026-11-13; PLAN.md WP7). Every new editor string is DRAFT. Don't collect them from agent reports: take them from the diff of `apps/cms/src/i18n/is.ts` against `origin/production`, and the labels from `modules/dld`.

**Done in DLD's repository, not merged anywhere:** `cms/integration` at `d604687` (the site without the static export, and one async data layer; all 64 pages unchanged) and `cms/converter` at `aef0cd1` (the content converter; fidelity check passed).

**Not started:** the site's switch from its own content to the CMS bundle (WP4), the import rehearsal (WP5), provisioning the tenant (WP6), the copy batches and handbook (WP7), A8 (verify the outage finding, on the demo site). **Off the path:** A5 (move or retire a site) waits for the switch to `dld.is`.

**Debts**
- #69 and #75 carry a final-head pass posted by the coordinator after changes that were docs-only (#69) or one test-only commit (#75). Einar was told; a reviewer can re-read #75's test commit if he wants.
- CI has no browser tests. New browser specs run only when an agent holds a stack; what is still owed is listed under "Merge phase".
- `deliver.test.ts` flaked once more in CI (OPEN-ISSUES R6).

## Disk and stacks

The Mac's disk filled at 19:25 on 2026-11-12 and stopped Docker. Einar allowed the npm cache to be cleared ("Yes, clear it") and Docker's unused images to be pruned ("Yes, prune them"). Since 2026-11-13 the coordinator may repeat both without asking when less than 5 GB is free (part of the fast lane). Agents stop and report if less than 3 GB is free.

**At 23:45:** about 6.5 GB free. Both stacks are stopped and their data removed (`pnpm db:stop --no-backup`, both slots); start with `pnpm db:start` and `pnpm db:reset`. Every finished agent worktree is removed (all were clean and pushed); one locked worktree remains (`agent-a49e502da79bcd0cd`, the merged A3 branch).

- The main checkout needs `CI=true pnpm install` after merges that change the workspace (pnpm refuses to purge `node_modules` without a terminal).
- The DLD site worktrees are in the session scratchpad (temporary) without `node_modules`; their work is on the pushed branches.

## Probe results, 2026-11-12

| Probe | Result | Report |
|---|---|---|
| The site without the static export | **Passed.** All 64 pages stay static and match today's output; the signed webhook refreshes content; preview works. Risks for stage 4 are listed in ENHANCEMENTS.md, last section | [probes/site-without-export.md](probes/site-without-export.md). Clone kept in the session scratchpad (temporary) |
| The editor with portfolio-shaped content | **Works, with blockers** an editor cannot get past: no way to remove a draft or an image, singletons and shared-page types cannot be confirmed live, nothing orders projects, no images in rich text. 13 Hub bugs with steps | [probes/editor.md](probes/editor.md). Code on local branch `probe/dld-shape` (`80080c5`); never pushed, its worktree is gone |
| A release of DLD's size | **No obstacle found locally.** 230 image copies in 2 s; bundle about 275 KB. Hosted storage is unmeasured: the import publishes in batches and measures the first | In the editor report |

Each probe's blockers became a row in ENHANCEMENTS.md (A6, A7, A10, B9, B10).

## How to continue

A new session starts from [START.md](START.md): it holds a paste-ready prompt and the things that are easy to miss. Einar asked for a handover to a fresh session once the second workflow reports ("Yes, hand over", 2026-11-12).

1. Read `CLAUDE.md`, then this file from the top, then [PLAN.md](PLAN.md), then [ENHANCEMENTS.md](ENHANCEMENTS.md) and [content-model.md](content-model.md). [ROADMAP.md](ROADMAP.md) is the record of how the plan was reached; its stages 3–8 are replaced.
2. Check the state at the source (`gh pr list`, CI, `git log`, the DLD site's branches) before relying on the tables below.
3. The client's workspace is `/Users/einarzoega/Documents/Litljómi ehf/Projects/2026/LAW Takeover/DLD`. Its `CLAUDE.md` holds DLD's current state and the site's invariants. The site repository is `dld-is/` inside it (remote `einar6969/dld`). The task texts for work in it are in its `metaprompts/active/`.
4. Do nothing that PLAN.md marks as Einar's step without his word.

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

### 2026-11-13: the destination, and no date

Asked for a target date, Einar: "**i do not want to have any target date for the dld.is prod deploy. I only care about completing the DLD onto the CMS quickly, where: editor can access vefstjorn.is (no demo subdomain); CMS connects to dld.litljomi.is. the client site domain will then be switched eventually...**"

- Done is: DLD's content in tenant `dld` on production, `dld.litljomi.is` rendering from the CMS with publishes confirmed live, DLD's editors able to sign in at vefstjorn.is. The switch to `dld.is` is outside this work.
- No separate preview host and no DNS record. The site branch therefore has to merge into `dld-is` `main`, which the client's review frame shows; the pages are the same. The coordinator reads his words as covering that merge and still asks for his yes at the moment (PLAN.md, E5).
- A5 (move or retire a site) leaves the path. D2 ("lets aim for cms completion before launch...") is untouched; the launch simply has no date.

### 2026-11-13: the fast lane

After an adversarial review of how the work runs (by the coordinator and by an independent reviewer), offered three packages, Einar: "**your recommendation of '2. Fast lane' looks sound.**"

What that package said, and so what now holds:

- **One integration PR** lands the eight open PRs: all merged into one branch, collisions and conflicts fixed once, then one CI run, one browser run, one upgrade rehearsal, a boundary review of the overlapping files, one merge. Now also in `CLAUDE.md`, "How work runs".
- **Parallel lanes start from that branch at once:** DLD's module, the site's switch to the CMS, the import rehearsal.
- **Copy in two batches:** the platform's strings now, DLD's labels and the handbook later. This replaces "one batch" for this onboarding.
- **Standing permission** to clear the npm cache and prune Docker's unused images when disk runs low.

Not ruled on, and settled by the coordinator: the library's "Á vefnum" label follows spec §7.4 (shown only once a publish is confirmed live), as a small PR after the integration PR.

### 2026-11-13: who deploys

Asked "Do production deploys stay with you, as the plan has it?", Einar: "**Coordinator deploys**".

- The coordinator runs `supabase db push` and the push to `production`, by PLAN.md WP2's steps. This replaces "Owner: Einar" in runbook §8 for this onboarding.
- Checked the same day: `supabase db push --dry-run` runs from the Hub checkout without a typed password, and lists one pending migration (L1's, on `main` since #74).
- Unchanged: the three destructive Supabase commands, and every key and secret, stay Einar's.

### Gates still ahead, each needing Einar

- Track B rows, whenever he wants them ([ENHANCEMENTS.md](ENHANCEMENTS.md)).
- His steps in [PLAN.md](PLAN.md): copy batch 1 (E1), the tenant (E3), the import (E4), connecting the site (E5), copy batch 2 and the handbook (E6), inviting editors (E7).
- The switch to `dld.is`, whenever he wants it.

## Open questions

**For DLD, through Einar** (a meeting is proposed for 2026-11-13; no reply was logged as of 2026-11-12):

1. Who edits, and in which language should the admin and handbook be?
2. How large is the backlog, and who enters the first batch?
3. (Withdrawn 2026-11-13: no date is attached to the site's opening on `dld.is`.)
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
- Answered by A4 (#80, not merged): a local stack delivers images; a full rehearsal ran on slot 2.
- Settled on 2026-11-13: the CMS connects to `dld.litljomi.is` itself, a custom domain, which Vercel's protection does not cover. No extra host and no DNS record are needed.

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
| **The plan: work packages, Einar's steps, traps** | [PLAN.md](PLAN.md) |
| The ready script for WP1 | [workflows/land-track-a.js](workflows/land-track-a.js) |
| Roadmap (the record; stages 3–8 replaced by the plan) | [ROADMAP.md](ROADMAP.md) |
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
