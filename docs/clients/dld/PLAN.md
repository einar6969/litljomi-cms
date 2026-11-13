# DLD onto the Hub: the plan

| | |
|---|---|
| Written | 2026-11-13, after Einar chose the fast lane |
| Replaces | The "Merge phase" notes in [STATUS.md](STATUS.md) and stages 3–8 of [ROADMAP.md](ROADMAP.md) |
| State of things | [STATUS.md](STATUS.md). This file says what to do; that one says what is true |
| Approval | Einar chose the fast lane and restated the destination on 2026-11-13 (his words are in STATUS.md). This file is the coordinator's write-up of both |
| Rule for this file | When a work package finishes, tick it in the map and write the result in STATUS.md. Change a step here only with a line saying why |

## 1. Destination

Einar, 2026-11-13: "i do not want to have any target date for the dld.is prod deploy. I only care about completing the DLD onto the CMS quickly, where: editor can access vefstjorn.is (no demo subdomain); CMS connects to dld.litljomi.is. the client site domain will then be switched eventually..."

**Done means all four:**

1. Tenant `dld` exists on production and holds DLD's content, published: 40 projects, 18 news posts, 2 people, the home and contact singletons, 228 images.
2. `https://dld.litljomi.is` renders from the CMS. A change published at `https://vefstjorn.is/t/dld` shows there and reaches "Birt á vef ✓".
3. DLD's editors can sign in at vefstjorn.is and have a handbook. Inviting them is Einar's step.
4. The next client can be onboarded from the docs and code left behind.

**Not in this plan:** the switch from `dld.litljomi.is` to `dld.is`, and with it A5 (move or retire a site). No date is attached to anything here.

## 2. How the work runs

Einar approved the fast lane on 2026-11-13 ("your recommendation of '2. Fast lane' looks sound"). These hold for the rest of the onboarding:

- **Parallel work lands as one integration PR.** All heads are merged into one branch, collisions are fixed there once, and that branch is what gets tested and reviewed. The pass on its exact head is still a reviewer agent's.
- **Verify before merging, not after:** CI, the full browser suite on a stack, an upgrade rehearsal of the migrations on a database with rows, and the boundary reviewers on every file more than one PR changed.
- **Lanes that don't wait for each other start together**, from the integration branch where they need its code.
- **A re-review is done by the reviewer that failed the PR**, on the fix alone. The security reviewer reads again whenever a fix touches a migration, `privileged/` or sign-in.
- **Builders push and return.** A cheap agent watches CI; builders don't sit in `gh pr checks --watch`.
- **The coordinator settles technical choices** agents leave open, at once, and records them. Only product, copy and the ask-first list go to Einar.
- **The coordinator deploys to production** (Einar, 2026-11-13: "Coordinator deploys"), by WP2's steps and no others. `supabase db push` works from this checkout without a typed password (dry-run checked on 2026-11-13). The three destructive Supabase commands still need Einar.
- **Copy in two batches:** the platform's strings first, DLD's labels and the handbook second.
- **Disk:** the coordinator may run `npm cache clean --force` and `docker image prune -a -f` without asking when less than 5 GB is free.
- **Models:** the large model for boundary building and for the spec and security reviews of boundary code; the middle one for app logic, quality reviews and compiling; the small one for watching CI and mechanical checks.

## 3. Map

| | Work package | Starts | Needs | Einar |
|---|---|---|---|---|
| ☑ | **WP1** Land Track A as one integration PR | Now | Both stacks | none |
| ☑ | **WP2** Deploy to production | WP1 merged | none | none |
| ☐ | **WP3** Finish DLD's module | Now, from WP1's branch | CI only | none |
| ☐ | **WP4** The site reads from the CMS | Now, from WP1's branch | A stack, once WP5 has data | none |
| ☐ | **WP5** Rehearse the import locally | WP1's branch builds, WP3 has a head | Slot 2 | none |
| ☐ | **WP6** Production: tenant, import, connect the site | WP2, WP3 deployed, WP4 and WP5 passed | none | **E3, E4, E5** |
| ☐ | **WP7** Copy and handbook | Now | none | **E1, E6** approves |
| ☐ | **WP8** Editors | WP6 done, E6 given | none | **E7** invites |
| ☐ | **WP9** Leave-behind | WP6 done | none | none |

**Running now, side by side:** WP1 (both stacks), WP3 and WP4's code (no stack), WP7's first batch (no code). WP5 takes slot 2 as soon as WP1's rehearsal releases it.

## 4. Einar's steps, in order

| | What he does | When | About |
|---|---|---|---|
| E1 | Reads and approves copy batch 1 (the platform's new strings) | Any time after WP7 hands it over | 20 min |
| E2 | Nothing: the coordinator deploys ("Coordinator deploys", 2026-11-13). The number is kept so the others don't move | | |
| E3 | Provisions tenant `dld`, and an editor address he controls for the import (runbook §2, steps 7 and 8) | After the deploy that carries the module | 5 min |
| E4 | Runs the production import, signed in as that editor: the first batch, a look, then the rest | After E3 and a clean rehearsal | Measured in WP5 |
| E5 | Sets the site's variables on Vercel project `dld`, provisions the site at `https://dld.litljomi.is` and its preview (runbook §2, 11b–11d), and says yes to merging the site branch into `dld-is` `main` | After E4 | 15 min |
| E6 | Approves copy batch 2 (DLD's labels) and the handbook | After WP3 and WP7 | 20 min |
| E7 | Invites DLD's editors, sends the four messages to DLD, holds the walkthrough | After WP6 and E6 | his call |

The coordinator prepares every command for these with its values filled in, and never reads or prints a secret.

## 5. Work packages

### WP1. Land Track A as one integration PR

**Goal.** `main` holds all eight reviewed PRs, tested together.

**Start from.** `origin/main`, branch `integration/track-a`. Run it with the ready script: `Workflow({ scriptPath: "/Users/einarzoega/litljomi-cms/docs/clients/dld/workflows/land-track-a.js" })`. Read the script first; it carries the briefs.

**Merge order,** each with `git merge --no-ff`, so the PRs show as merged:

| # | Branch | Head |
|---|---|---|
| #73 | `fix/editor-probe-findings` | `7bff99a` |
| #82 | `feat/media-library-l6` (carries #78 and #81) | `922ef79` |
| #76 | `feat/media-library-l3` | `4ff5d03` |
| #79 | `feat/a7-live-checks-without-own-path` | `474dc48` |
| #77 | `feat/a12-manual-ordering` | `78b7ccb` |
| #80 | `feat/a4-local-rehearsal` | `411ef5d` |

**Conflicts to expect** (from a test merge in this order):

- #76: `docs/architecture.md`.
- #79: `packages/schema/src/__tests__/module.test.ts`.
- #77: `apps/cms/src/app/globals.css`, `apps/cms/src/privileged/worker/deliver.ts`, `…/worker/__tests__/build-release.test.ts`, `modules/demo/src/index.ts` and its test, `apps/demo-site/src/types/cms.ts`.
- #80: `apps/cms/src/privileged/worker/build-release.ts`, `…/worker/projection-context.ts`, `…/worker/__tests__/build-release.integration.test.ts`, `tools/cli/src/import/report.ts`.

Keep both sides' behaviour. Regenerate `modules/demo/schema.snapshot.json` (`pnpm check:schema --update`) and the demo site's types (`gen-types`); never hand-merge them.

**Fixes on the branch,** one commit each:

1. **Migration number.** Rename A7's `20261112210000_nothing_checked.sql` to `20261112220000_nothing_checked.sql`. L3 keeps `…210000`, A12 keeps `…230000`.
2. **Function replaced twice.** A12's migration replaces `api.worker_release_snapshot` from the old body and would remove L3's `caption` and `credit`. Rebuild A12's version on L3's body. Both `118_media_library_delivery.test.sql` and `118_manual_order.test.sql` must pass. Then list every object two of the new migrations both replace; today it is only this one.
3. **Broken spec on `main`:** `apps/cms/e2e/design.spec.ts:383`, where "Bæta við" now matches two lists. Test only.
4. **CI runs twice per push:** in `.github/workflows/ci.yml`, limit `push` to `main` and `production`.
5. **Versions.** The SDK ends at 0.2.2 (L3) and rich-text at 0.2.1 (A4). #79 and #77 change no file under `packages/sdk`. If the integration makes `bundle.ts` type an entry reference's `path` as nullable, raise the SDK to 0.2.3 (runbook §2, the version rule).

Nothing else changes behaviour on this branch.

**Verify, in parallel, on the pushed head:**

| Check | Who | Where |
|---|---|---|
| CI | a small agent watching `gh pr checks` | GitHub |
| The full browser suite, with A12's `manual-order.spec.ts`, which has never run | a middle agent, reporting only | slot 1 |
| Upgrade rehearsal: a database at `origin/production`'s migrations with seeded rows and a published release; apply the four pending migrations without a reset; the old worker builds a release from the new functions; then the new code publishes | a large agent, reporting only | slot 2 |
| Spec and security review of the overlap: the three new migrations, `build-release.ts`, `projection-context.ts`, `deliver.ts`, `process-request.ts`, `live-targets.ts`, `privileged/preview/`, `packages/schema/src/module.ts` and `projection.ts` | the boundary reviewers | read only |
| Quality review of the integration-only commits | the quality reviewer | read only |

The eight PRs' own content is already passed. Reviewers read the integration-only commits and the combined behaviour of the overlapping files.

**Done when.** One `Review: PASS <sha>` from a reviewer agent on the final head; CI green; the browser suite's counts recorded; the rehearsal passed. The coordinator merges with a merge commit, then checks that #73 and #76–#82 show as merged (close any that don't, with a comment naming the integration PR).

**Then,** one small follow-up PR, app logic tier: the library labels a file's use "Á vefnum" before the publish is confirmed live. Spec §7.4 says success is never shown before its proof. Follow the spec. This is the coordinator's call; Einar was asked on 2026-11-13 and did not rule.

### WP2. Deploy to production

**Goal.** `production` equals `main`, with the four migrations applied.

**Steps.**
1. Read what goes out, as runbook §8 says: `git diff --name-only origin/production origin/main -- supabase/migrations`, and the grep for drops. Four files are expected: `20261112200000`, `…210000`, `…220000`, `…230000`. No drops.
2. Only if WP1's upgrade rehearsal passed on the merged head: confirm `cat supabase/.temp/project-ref` prints `rwpgpfsmhhtimauvpoyt`, then run `supabase db push --dry-run` and check it lists exactly the files from step 1. Then, with nothing in between: `supabase db push`, `supabase migration list`, `git push origin origin/main:refs/heads/production` (a fast-forward; never forced).
3. If `db push` fails, stop: don't push `production`, and tell Einar. The one exception is a lock timeout, which changed nothing: run it once more. Never `db reset --linked`, `config push` or `migration repair`.
4. Check: `supabase migration list` shows no local-only version; `vefstjorn` has a Ready deployment of the merged commit; a publish on `demo` reaches Live; LABAK's site still renders; the Supabase advisors show nothing new.

**Done when** all of step 4 holds; say so to Einar in one line. A deploy that carries only WP3's module has no migration: `db push` has nothing to do, and steps 2 and 4 are repeated.

### WP3. Finish DLD's module

**Goal.** `modules/dld` is merged and deployed, matching [content-model.md](content-model.md) exactly (names are final).

**Start from.** PR #71 (`feat/module-dld`, passed at `33ed9aa`, now conflicting). Rebase its work onto `integration/track-a` while WP1 verifies, then onto `main`.

**Steps.** Bring it up to date. Add what it was waiting for: the site entries and live checks for `person`, `home` and `contact` (A7: no path of their own; the pages they show on), manual ordering for `project` (A12), the `video` lists (A11). Write `schema.snapshot.json`. Labels in Icelandic, listed as DRAFT for batch 2.

**Review.** App logic: one combined review. Nothing in it touches core beyond the registry line.

**Done when** merged under the merge rule and on production (WP2 again if it already ran).

### WP4. The site reads from the CMS

**Goal.** On branch `cms/integration` of the site repository (`dld-is`, at `d604687`), every page renders from the CMS's bundle and matches today's pages.

**Rules.** Work in a worktree of `dld-is`, never its main checkout, and never push its `main`: every push there shows in the client's review frame. Read the DLD workspace's `CLAUDE.md` for the site's invariants (the Next.js 16 rule, one `<h1>`, all copy in `src/content/`, the noindex switches untouched). The brief goes in the DLD workspace's `metaprompts/active/`, like the three there.

**Steps,** following runbook §2 "The site's code" (Site 1 to Site 9):
1. Vendor the SDK and renderer with `pnpm pack:sdk` from the Hub's merged `main`; generate the types from `modules/dld` with `gen-types`.
2. Swap the inside of the site's data layer (`src/data/`, already async) from its own content files to the SDK. Fixed text stays in `src/content/`. `legacyPath` stays in the site (content model §"not imported").
3. Add the revalidation and preview routes, the entry and release markers, and `notFound()` for a removed entry.
4. Allow the CMS's media host in `next.config`.
5. Remove the content files the CMS now owns, once step 6 passes.
6. Compare: against WP5's local tenant, all 64 pages and the 404 match today's output, apart from a written list of expected differences (image addresses, markers).

**Review.** A parity reviewer on the page comparison; a quality reviewer on the code.

**Done when** step 6 passes and a publish on the local stack shows on the local site and is confirmed live.

### WP5. Rehearse the import locally

**Goal.** The whole of WP6 has been done once on a local stack, and its numbers are known.

**Where.** Slot 2, with A4's commands (`provision --local`, `import --local`), from `main` after WP1 or from `integration/track-a` before.

**Steps.**
1. Provision tenant `dld`, a site and an editor locally.
2. Regenerate the manifest from the site's branch `cms/converter` (`aef0cd1`).
3. `import --dry-run`, then the import. Record the time per batch and in all.
4. Read the comparison report. It must show no difference that isn't explained.
5. Run WP4's site against it and do WP4's step 6.
6. Rehearse WP6's order exactly: tenant, import and publish with no site connected, then the site, then one publish that must reach Live.
7. With DLD's real images in the library, do the trials still owed: thumbnails for the largest files, twelve files in one upload on a slowed connection, the picker at 375 px and at desktop width.

**Done when** steps 4, 5 and 6 pass and the timings are written in STATUS.md.

### WP6. Production: tenant, import, connect the site

**Order,** as rehearsed. The runbook says a site's build fails while its tenant has no release, so content comes first.

1. **E3.** Einar provisions the tenant and the import's editor.
2. **E4.** Einar runs the import with `--first-batch-only`. The coordinator reads the result and measures how long hosted storage takes to copy the images (unmeasured until now). Then the rest.
3. The comparison report is clean. Entries end at "Enginn vefur tengdur", which is right at this point.
4. **E5.** Einar sets the three plain variables on Vercel project `dld`, provisions the site at `https://dld.litljomi.is` with its webhook secret, and sets up preview.
5. **E5.** On Einar's yes, `cms/integration` merges into `dld-is` `main`. Vercel builds from the bundle.
6. Check every page of `dld.litljomi.is` against the page list from WP4. Publish one small change at vefstjorn.is: it shows on the site and reaches "Birt á vef ✓". Preview works.
7. Keep the import's ledger and report in the DLD workspace (`reports/`), not in this repository.

**If step 6 fails,** the site's previous deployment is one click away in Vercel (Einar), and `dld-is` `main` can be reverted with a new commit. Nothing in the CMS needs undoing.

**A8 belongs here in time, not in place.** Whether a site answers 500 when storage is unreachable right after a publish is a platform question. Test it on the demo site on Vercel, never on `dld.litljomi.is`. Aim to know the answer before step 5; if the test would hold step 5 up, tell Einar and let him choose.

**Done when** step 6 holds. Destination points 1 and 2 are then met.

### WP7. Copy and handbook

**Batch 1, now.** Every new editor string in the platform: `git diff origin/production..origin/integration/track-a -- apps/cms/src/i18n/is.ts` (or `..origin/main` once merged). Hand Einar one list: the string, where it appears, and the few that change an approved string ("Velja mynd" became "Hlaða upp mynd"; "Velja 21 myndir" needs a form). His corrections go in one small PR.

**Batch 2, after WP3.** The labels and help texts in `modules/dld`, and the handbook draft, written in the DLD workspace's `drafts/`. Icelandic, DRAFT until Einar approves. The admin's language for DLD's second editor is DLD's answer to give; a second language (A9) is built only if they ask.

**Done when** E1 and E6 are given and the corrections are merged and deployed.

### WP8. Editors

Einar's step (E7): invitations, the four messages to DLD (content model §8), the walkthrough. The coordinator prepares the invitation commands and checks the first sign-in worked. Destination point 3.

### WP9. Leave-behind

- `docs/runbooks/`: what onboarding a client with an existing site and content adds to "New tenant in under an hour": the converter, the import, the rehearsal, connecting a site that is already live.
- A module template, if `modules/dld` shows what one should hold.
- [ENHANCEMENTS.md](ENHANCEMENTS.md) and `docs/king/OPEN-ISSUES.md` brought up to date; the spec amended where rulings overrode it.

Destination point 4.

## 6. Later, outside this plan

- The switch to `dld.is`: A5, the site's own go-live checklist in the DLD workspace, DNS at Sýn.
- A9, a second admin language, if DLD asks.
- Track B, the library's later slices (L7–L12), and browser tests in CI.

## 7. Traps

- **`main-guard` is red on `main` after every direct docs push.** That is its design (it fails for any commit not from a merged PR). Don't investigate it.
- **`CI=true pnpm install`** in the main checkout after a merge changes the workspace.
- **zsh:** it doesn't split an unquoted variable into words, and `"$1:something"` is read as a modifier. Write `${1}` and loop over arrays. A check that prints nothing may not have run.
- **Slot 2** runs from its own worktree with `CMS_STACK_SLOT=2` on every command. Restart a stack after a branch switch that changes `supabase/templates/` or `config.toml`.
- **Disk:** about 6.5 GB free on 2026-11-13. Remove finished worktrees and `.next` folders as you go.
- **A report is not proof.** Check each PR's head, pass and CI on GitHub before merging.
