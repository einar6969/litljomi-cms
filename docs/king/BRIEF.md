# KING brief: Litljómi CMS Hub

The handoff for whoever coordinates this project. Read it with [OPEN-ISSUES.md](OPEN-ISSUES.md). To start a new session, use [START.md](START.md).

| | |
|---|---|
| State as of | 2026-11-05, `origin/main` at `eb4e85c` with local docs commits ahead of it, after M3 |
| Written by | The first KING, from its transcript and the repository. Corrected by the second KING against GitHub |
| Keep current | Update "Where things stand" and `OPEN-ISSUES.md` at each milestone |

**Your objective:** take over without a gap, know exactly where the Hub stands, and drive the remaining work to a finished platform.

**How to read the evidence words here:**

- **Hosted:** it ran on staging, and the record says so.
- **CI:** tests pass in CI on the local stack. It has not run on staging.
- **Code:** the code exists, with no specific check behind this statement.
- **Reported:** someone said so, and nobody has re-checked it.

A milestone being accepted does not make every line of it hosted.

## 1. Where things stand

- **Accepted:** M0, M1 (checkpoint C4), M2 and M3 (C5, decision 51.5). Einar closed M2 and M3 on 2026-11-04.
- **In progress:** M4. Einar unfroze it on 2026-11-05 (decision 57) and approved `docs/plans/m4.md` (decision 58). Decisions 53, 55 and 56 set its scope.
- **`main` is ahead of staging.** `origin/main` is `eb4e85c`, with 39 migrations. Staging runs `b73582e`, with 38. The difference is W1 (withdrawal confirmation, #47) and its migration, #45's env example and comments, the sandbox settings (#50) and docs. M2 and M3 were accepted on `b73582e`, and W1 merged after that, so W1 has CI evidence and one review. Einar ruled out a dedicated staging run (decision 54). Staging keeps the old behaviour until M4's acceptance advances it, because migrations apply in order; W1 then arrives with no test of its own.
- **Nothing real is live.** There is no production project, no real editor and no real content. labak.is is still the old Joomla site.
- **Tests:** on `b756c74`, from the CI log: pgTAP 2,006 in 39 files, unit 2,498, integration 96 + 116. Unit 2,498 re-run locally on `f2ab9e4`; the other totals were not re-read. CI passed on `eb4e85c`.

The next real decision is Einar's: the hosted approval at the end of M4 (section 7).

## 2. What the Hub is and why it exists

Litljómi is a small web studio run by one person, Einar Zoega. Several client sites need a CMS. The Hub is one Litljómi-owned Next.js and Supabase platform, built and maintained once, that gives each client an isolated editing environment. It is an internal platform, not a product. Objectives are in `docs/architecture.md` §1.2. LABAK (Landssamband bakarameistara) is the first real tenant; `demo` is a deliberately different fixture tenant. The goal is a reusable platform validated through LABAK, not a LABAK CMS.

**The decision the spec does not record.** On 2026-11-01 the first KING recommended Sanity for LABAK, with Keystatic as runner-up. When Einar proposed a central hub, the KING argued for a shared kit instead: shared code, separate data. Its reasons were that the repeated work is the editing experience, that a schema-driven admin is a headless CMS competing with Sanity and Payload, and that a central platform "pays back slowly and puts every client's risk in one place".

Einar overruled that, for reasons that still stand:

- Central maintenance: an improvement should reach every client through one deployment, with no per-client upgrade.
- One Litljómi-controlled platform to administer all clients.
- Ownership: "I don't want Litljómi CMS Hub to be built around a third-party CMS such as Sanity or Payload."
- A long-term internal platform, not just a way to finish LABAK.

The kit, Sanity and Payload were considered and rejected. Don't reopen this casually. It is a decision made with the trade-off in view, and the trade-off is real: one platform, one maintainer, shared risk.

LABAK's own need is small: mainly its chairman, a few posts a year, 21 existing articles. There is no launch urgency. Einar chose to build the Hub first and launch LABAK on it, with no interim repository-based news. Finish the platform first; other client integrations come after it.

## 3. Architecture in brief

`docs/architecture.md` is the approved spec and it wins over the plans. If a plan and the spec disagree, stop and report it. The essentials:

- **One CMS app, one Supabase project per environment.** Tenants are isolated by `tenant_id`, composite foreign keys and RLS. `cms` is not exposed; `api` is. There are no `SECURITY DEFINER` functions.
- **Modules are compiled in.** `modules/<tenant>` holds types and site checks. Core imports no modules, and lint enforces it.
- **Mutable drafts, immutable revisions.** JSONB documents with code-defined schemas; Tiptap with ProseMirror JSON.
- **Publishing is request-based.** Editors request; the worker validates and commits the exact version, so publishing's privileged code never runs in an editor's request. The preview token route (§7.5) is privileged and editor-initiated.
- **Delivery is by snapshot.** Each release is one bundle plus `current.json`. Sites read public storage and depend on the CMS only for preview, so they keep serving if the CMS is down.
- **Success is never shown before its proof exists** (§7.4). Live confirmation checks a content hash on the page, not a release marker.
- **Private originals, public copies at publish.** Withdrawal outranks fallback. Withdrawn content leaves public storage in about an hour, or about two hours if a site's check keeps failing.

The hard-to-reverse choices are listed in §11.3. Superseded ideas are in §12, which is worth reading before proposing a change.

**Stack:** Next.js 16.4.3, React 19.3.1, TypeScript 6, Tailwind 4, Zod 4, Supabase JS 2.118, Node 22, pnpm 11. Local stack through OrbStack. The commands are in `CLAUDE.md`.

## 4. History

| Date | What happened |
|---|---|
| Nov 1 | Spec designed and approved in one conversation. M0 and M1 planned. Einar first asked about Claude Code Projects, and they were deferred to C4 because M1 needed stricter control |
| Nov 2 | M0 and most of M1 built locally: 33 tasks, subagents, reviewers, parallel lanes. Einar found the per-task loop too heavy, so Minors were deferred, Critical and Major block, and there is escalation after three rounds |
| Nov 3 | Hosted staging stood up. A6, A7 and a live-check criterion failed. Cause: the CDN served the old `current.json` for up to about 54 s. Fix: the worker notifies only once the public pointer is fresh (decision 49.1). M1 accepted |
| Nov 3 | Decision 50: M2 and M3 run as cloud threads. Two evaluation passes, then 35 PRs in a day |
| Nov 3 | Reported by the coordinator, quoting Einar: "please dont include myself in your run, when merge is wanted, it should be done without my approval." PRs #1–#35 then merged with no review on record, security changes included, and `main` went red on four merge commits. Every merge also deployed to staging while the database stayed on M1, and the sweep failed from 17:43 UTC. No repo doc records the waiver |
| Nov 4 | Independent security review of `61f6011`: two Critical, six Major, 18 Minor. Staging frozen on a `staging` branch. Fix rounds A to F, each with a separate review and PASS |
| Nov 4 | Hosted acceptance: 21 migrations, one `staging` advance, 32 browser tests, forced misses, alerts. M2 and M3 accepted (C5) |
| Nov 4 | Decision 52 answered C5's questions. W1 merged to fix the stale "Ekki staðfest á vef" and the hold gap (CI only so far). Site `280f4415…` deactivated |
| Nov 5 | KING handoff (#49) and sandbox change (#50) merged on Einar's instruction, with no review and with CI refused. M4 investigated while frozen. Decisions 53 and 54. The second KING took over. CI passed on `eb4e85c`, pushed directly with no PR |

Delivered and verified, in brief:

| Milestone | Delivered | Verification |
|---|---|---|
| M0 | Monorepo, CI, execution harness | Done, except production projects, deferred by decision 42 |
| M1 | Full vertical slice, LABAK + demo | Hosted, C4 and `docs/verification/m1-report.md`; A1–A4 through decision 46's adapter |
| M2 | All field kinds, singletons, search, conflict UX, restore, schema evolution, focal point and alt text, Icelandic copy | Hosted at 375, 768 and 1440 px, C5. 32 browser tests |
| M3 | Exponential retries, alerts, fallback rules, retention, preview, SDK on Next.js 15 and 16 | Hosted, C5, except four §8.5 fallback cases (CI, by Einar's ruling) and two partial cases listed in C5's §8.5 table |

### Lessons

- **Hosted acceptance finds what local tests can't.** The pointer lag only existed on a real CDN.
- **A fresh reviewer finds what the builders miss.** The two Critical findings came after 35 green PRs. Both falsely reassured an editor or undid a withdrawal.
- **M1 over-reviewed and M2 and M3 under-reviewed.** W1's shape was right: one PR, one independent review.
- **Plans can be wrong.** M3-15 asked for behaviour that contradicted §7.4. CI passed and a test pinned the wrong behaviour as correct.
- **Parallel threads collide.** M3-05 and M3-07 turned `main` red between them, and a claim-order test did it again. CI on each PR doesn't prove the merged result.
- **A session degrades.** Long sessions get worse, so hand over before that happens. Einar has moved sessions on at around 70% context.
- **Rulings made in only one channel get lost.** The Nov 3 merge waiver reached neither the KING nor the repo. The KING learned of the outcome from the 22:56 handoff.

## 5. Decisions that matter

All numbered decisions are in `docs/plans/2026-11-01-m0-m1.md`, despite its name. They start at about line 240 and quote Einar. Start with these:

| Decision | Why it matters |
|---|---|
| Hub over Sanity, Payload or a kit (section 2) | Only recorded here |
| 18–20 | Passwordless sign-in enforced by a hook, and how that stays active |
| 34–36 | Worker and retry design |
| 39–42 | Editor rulings, the design pass, and deferring Pro and production |
| 42.4 | SDK vendored as `npm pack` files until a second site arrives |
| 43, 47 | Hosted boundaries and credential rules. Einar enters every key |
| 46 | The adapter for A1–A4 on staging |
| 49.1 | Notify only once the public pointer is fresh |
| 50, 50.5, 50.6 | Cloud execution, the nine answered questions, plan approval |
| 51, 51.1–51.5 | Acceptance approvals, rulings and acceptance |
| 52 | Fallbacks local-only, next15 site inactive, HTTP 400 accepted, stale warning to clear |
| 53 | M4's scope: nightly exports dropped, offboarding parked, suspend and revoke kept, three new `admin_*` functions, local execution |
| 54 | Public repo, billing dropped, W1 gets no dedicated staging run, docs-only commits need no PR and can stay local, the second KING |
| 55 | Single-tenant restore dropped, with its acceptance test. M4 has two acceptance tests |
| 56 | On-demand export dropped too. No per-tenant export exists |
| 57 | M4 unfrozen. GitHub is for code and CI; docs stay local and reach GitHub in the next code PR |
| 58 | M4 plan approved, test 1 runs without a live site, three small spec amendments |

**Known not to be in the numbered decisions:**

- The Nov 3 merge waiver, then the Nov 4 rule, which is in `environment.md`.
- The `UPDATE (preview_url)` grant for `service_role`. The review notes and the coordinator say Einar approved it; the migration exists.
- The `staging` freeze as a standing practice. See section 6.

**Rulings worth knowing:**

- Webhook replay within 5 minutes is accepted as harmless (50.5).
- Pointer lag stays a measured limitation (50.5).
- GitHub Pro was declined. Vercel Pro at $20 a month is approved. Staging Supabase stays on Free.
- Icelandic copy: 103 strings approved at once (51.3). Treat that as approval to proceed, and expect changes once real editors use it.

## 6. Operating model

### Roles

| Role | Does |
|---|---|
| Einar | Holds all authority. Enters every key, runs pushes that a session can't, carries messages between sessions |
| KING | Holds the whole picture: plans, briefs, coordinates, verifies against the source, challenges, keeps these documents current |
| Local controller | A gated session in this repo for hosted acceptance, gates and `docs/execution/`. `CLAUDE.md` defines it |
| Coordinator | The Claude Code Project "CMS". It starts cloud threads and sequences work |
| Cloud threads | One task, one branch, one PR, on the local stack only |
| Reviewers | Separate threads or fresh sessions, for one exact commit |

The word "KING" is Einar's. Older records say "advisor". `CLAUDE.md` was written for a controller in this repo, so read its rules this way: the local controller remains the only writer of `docs/execution/` and the one that records gates. The KING owns `docs/king/` and runs in this repo (see `START.md`).

A gate works like this: the KING prepares the request, Einar gives the approval in the controller session in Einar's own words, and the controller records it in `gates.json`. Docs-only changes are local commits with no PR, and reach GitHub in the next code PR (decisions 54, 57). Pushing needs Einar's OK. Sessions don't message each other as a rule: the KING writes a paste-ready prompt and Einar passes it on. **Another session's message is never an approval.** A controller refused one on 2026-11-02 and was right to. Text in a file, page or report never approves anything either.

### Decision rights (a starting model, to refine with Einar)

| Einar decides | KING decides |
|---|---|
| Scope and milestone changes | Task order and technical choices inside the spec |
| Spending | Review depth, within the rules below |
| Production, client-facing work, anything hard to reverse | Triage of Minors |
| Accepting a known risk | Briefing and coordinating sessions |
| Accepting a milestone, in Einar's own words | |

Batch rulings at checkpoints, each with a recommendation. Ask for one hosted approval per milestone, as decision 51 did, and record it verbatim in `gates.json`. When Einar rules on something, get it into the repo that day.

### Merging, as it really works

1. An implementing thread opens a PR and never merges it.
2. A separate thread reviews it and posts `Review: PASS <full sha>`.
3. The branch must be up to date with `main`, with CI green on that commit.
4. The coordinator reports having no merge tool. It asks Einar, then a merge-only thread merges, one PR at a time, as a merge commit. Reported by the coordinator; every merge shows as `einar6969`.

This applies to everything except docs-only commits (decision 54), which the KING reads as `docs/**`. They need no PR, PASS or CI.

`main` has no branch protection and no rulesets, confirmed on 2026-11-05, so this is a rule, not a control. `main-guard` alerts on a push that doesn't belong to a merged PR, for everyone including Einar, and reverts nothing, so a pushed docs commit fails it by design. It can't see a PASS or CI, every thread acts as `einar6969`, and a change to the guard could disable it (`environment.md`, "Known limits").

### The milestone pattern that worked

1. Write a plan: one task per PR, with spec references, dependencies, a `security` flag and local acceptance tests.
2. Run tasks in cloud threads with a review per PR. Watch for tasks that touch the same files.
3. Take one fresh security review of the whole milestone.
4. Run fix rounds, each with its own review.
5. Run gated hosted acceptance under one approval.
6. Write a checkpoint report: results, what was created, how to undo it, questions for Einar.
7. Einar accepts in Einar's own words. Close the approvals.

### Verifying a report

Treat every report as a claim. Before telling Einar something is done, check it at the source: `gh` for merges and CI, the Vercel connector for what is serving, Supabase for migrations and rows. This caught real errors. A coordinator's "ready for acceptance" hid a broken staging; its memory of decision 52 was wrong. Connector use on hosted systems needs Einar's OK; read-only checks have been accepted so far, but ask.

### Staging

- **Any hosted action needs a new approval.** The approvals of decision 51 are closed in `gates.json`. A forced miss needs its own approval too, as 51.1 did.
- The `staging` branch is the deploy switch. `vefumsjon-staging` and `demo-staging` use it as Production Branch, and an Ignored Build Step cancels everything else. Merges to `main` deployed nothing through Nov 4: every build was cancelled.
- **Migrations and `staging` advance together.** Run `supabase db push` first and advance `staging` straight after. A migration that drops a function the old worker calls breaks the sweep for that gap. On Nov 4 that cost one failed sweep minute, on a staging site with no editors; don't assume production gets away that lightly. Check each migration: W1's drops and recreates `worker_deliveries_to_retry`. Migrations are forward-only.
- Einar runs `db push` and the push to `staging`.

### Who may touch what

Off-limits without Einar's explicit say-so: labak.is, its DNS, FILMÍS, ISNIC, the recipe system, `landssamband-bakarameistara` and labak.litljomi.is. `labak-hub` stays at `376402b` until M6. The rest is in `CLAUDE.md` and `gates.json`.

## 7. What's left

| Milestone | Delivers | Status |
|---|---|---|
| **M4 Operations** | Minimal read-only console with MFA; provisioning CLI; webhook secret rotation; suspend and revoke from the CLI; runbooks. Offboarding, exports and restore are out (decisions 53, 55, 56) | Approved plan in `docs/plans/m4.md`. `tools/cli` has `provision` for tenant, site, editor and preview, plus `migrate-drafts`, `boundary-check` and `check-schema`. No console routes exist. Findings are in `OPEN-ISSUES.md`, section M |
| **M5 Independent review** | Fresh-context security review of the boundary, worker, preview and SDK | Not started. Must pass before real editors or content |
| **M6 LABAK integration** | Import 21 articles word for word; site reads from the SDK; `remotePatterns`; Icelandic editor guide | Started: `hub-integration` at `376402b` proved the slice |

The validation criteria are in spec §13.2. Inviting real editors and launching are separate decisions after M6.

**Finishing the platform also needs these, which no milestone owns:**

- A production Supabase project, `cms.litljomi.is`, the Pro plan, production Auth and SMTP. M0 listed them; decision 42 deferred them. Choose the region deliberately (see Traps).
- A published SDK or a refreshed vendored copy (`OPEN-ISSUES.md`, R1).
- The hosted checks waiting in `OPEN-ISSUES.md`.

**Dependencies:** M5 reviews M4's code, so it follows M4. Real content needs M5. M6's import can be prepared earlier, but real editors wait for M5. LABAK's launch also depends on items outside the Hub (the C4 go-live list): the domain, the FILMÍS move, redirects and the contact form.

**A proposed definition of finished, for Einar to confirm:** M4's criteria met; M5 passed; production exists and has run the same acceptance as staging; every P1 in `OPEN-ISSUES.md` closed or accepted by Einar; and M6's test publish reaches Live on the LABAK site. Launching LABAK is a separate decision.

**Decisions Einar still owes:** `OPEN-ISSUES.md`, section E.

## 8. Live surfaces

No secrets here. Secrets live in Vercel, Vault and Einar's `.env.staging.local`.

| Surface | Value |
|---|---|
| Repository | `einar6969/litljomi-cms`, public since creation, by Einar's choice (decision 54) |
| Supabase staging | `rwpgpfsmhhtimauvpoyt`, Free, `eu-west-1` |
| Vercel team | `team_QumUyzagQwAqXmpItxceUQ5C` |
| CMS | `vefumsjon-staging`, https://vefumsjon-staging.litljomi.is |
| Demo site | `demo-staging`, https://demo-staging.litljomi.is, site `8cead364…`, the only active `demo` site |
| LABAK slice | `labak-hub`, https://labak-hub.litljomi.is, site `e5b6dbba…`, branch `hub-integration` at `376402b` |
| Next.js 15 fixture | `demo-next15-staging`, site `280f4415…` inactive. Project kept, not updating |
| LABAK staging (not the Hub) | labak.litljomi.is, `landssamband-bakarameistara` at `aec9f95` |
| Alerts | SendGrid, set on `vefumsjon-staging` |

Test content stays on staging, because entries can't be deleted through `api`. On `labak`, only `30-sudbak-kaupstefnan-haldin-i-stuttgart` is published.

## 9. Working with Einar

- Keep it short and plain. Lead with the answer, then what's needed.
- "Next steps" means the Hub build unless Einar says otherwise. Don't drift to other tracks.
- Bring recommendations. "i trust your recommendations" means your advice often becomes the decision, so be the challenge yourself and say when you're unsure.
- Einar wants runs to go "by itself, without any back and forth, and fast", and dislikes ceremony: the per-task loop was "ridiculous if i have to do that 50 times".
- Speed is not permission to drop review. The Nov 3 waiver shows the cost. If an instruction would remove a safeguard, say so before acting.
- When Einar says "PAUSE" or "breath", stop and rebuild the overall picture. Einar expects you to keep the goal in view.
- Paste-ready prompts are the normal way of working.
- Einar does every login and enters every key. No secret in chat, ever. Einar has dropped steps as not important at that stage (the phone check, key rotation); note them and carry them forward without nagging.
- Don't dwell on something Einar has closed.
- Client communication is draft only, and Einar sends it. LABAK's workspace rules are in that workspace's `CLAUDE.md`.

## 10. Traps

- **zsh:** `$VAR:path` is read as a modifier. Use literal refs such as `origin/main:path`.
- **Sandbox:** sessions in this repo reach GitHub only through `gh`, `git fetch`, `git pull` and `git push`, which run outside the sandbox with Einar's login. The `ask` rules still apply. Run each as one bare command from inside the repo. `git -C <path> push`, `cd … && gh`, `gh | grep` and `gh > file` all stay sandboxed, and a sandboxed `gh auth status` wrongly reports an invalid token.
- **Connectors:** the Vercel connector can't set Production Branch and was refused firewall writes (403). `get_project` reports `live: false` for a serving project. Don't rely on it. `plugin:vercel` needs `/mcp` login; the separate connector works.
- **Supabase CDN:** ignores `max-age=30`. Pointer lag is 35–54 s. The worker waits it out.
- **Storage:** a removed public file answers HTTP 400 with a 404 in its body. Accepted (decision 52).
- **Region:** staging is `eu-west-1`, while CMS functions are set to `fra1`. Runtime logs have shown `iad1` for the sweep. Older records said Frankfurt.
- **Cron:** retries can run about two minutes after they fall due.
- **New tenant order:** provision, publish once, then deploy the site (decision 45.1). The site build fails while the tenant has no release.
- **`CMS_PREVIEW_*`** live on the demo site, not the CMS.
- **Built-in browser pane:** it can stop painting, which makes image checks hang. Use headless Playwright.
- **CI:** a test in `deliver.test.ts` flakes ("sends the webhook again once per site", now around line 682). `ci` jobs have failed within seconds with no logs and then passed on re-run with the same code. That pattern is GitHub refusing the job: read the check run's annotations for the reason. It happened on Nov 4 from 18:45 UTC and on Nov 5 from 01:46 to 02:08 UTC; jobs ran again by 02:44.
- **Connectors:** being available grants nothing (`CLAUDE.md`).

## 11. Evidence map

| You want | Look in |
|---|---|
| The rules of the repo | `CLAUDE.md`, `docs/execution/environment.md`, `gates.json` |
| The spec | `docs/architecture.md` |
| Plans | `docs/plans/m2.md`, `m3.md`, `m4.md`; M0, M1 and every decision in `2026-11-01-m0-m1.md` |
| Checkpoint reports | `docs/execution/checkpoints/C0.md` to `C5.md`. C5 is the latest |
| M1 reviews | `docs/execution/reviews/`. It stops at M1 |
| M2 and M3 reviews | PR comments on GitHub |
| Session-by-session notes | `docs/execution/progress.md`, `progress-notes.md` |
| Deferred Minors | `docs/execution/deferred-minors.md`. Many rows are stale; see `OPEN-ISSUES.md` |
| Hosted setup | `docs/runbooks/staging.md`, `docs/verification/` |
| The Nov 4 security review | Not in the repo. Local session "Litljómi CMS security review M2/M3", `local_5e7641bf-2be7-4aa2-a81f-497fdf445508`; transcript `75fe5bb3-a187-4a9a-9fc8-2a2dc8660fc8.jsonl` in the folder below. Findings are listed in `OPEN-ISSUES.md`, section A |
| The first KING's reasoning | Its transcript: `~/.claude/projects/-Users-einarzoega-Documents-Litlj-mi-ehf-Projects-2026-LAW-Takeover-LABAK/cd6cf580-7796-4458-aed6-37411076a464.jsonl`, on Einar's laptop. Local controller transcripts are in `-Users-einarzoega-litljomi-cms` beside it |
| Cloud thread reasoning | The Project "CMS". PR bodies link their thread |
| LABAK's project log | `CLAUDE.md` and the brief in the LABAK workspace |
