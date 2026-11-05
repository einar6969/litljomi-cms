# Open issues

What's outstanding after M3, as of 2026-11-05 (`origin/main` at `ed91e16`, staging at `b73582e`). The KING owns this list and prioritizes it with Einar. It sits beside `docs/execution/deferred-minors.md` and doesn't replace it.

**Evidence words:** **Hosted** ran on staging, and the record says so. **CI** has tests that pass on the local stack, never asserted on staging. **Code** exists, with no specific check behind this statement. **Reported** was said by someone and not re-checked.

**Priority:** **P1** before real editors or content. **P2** before finishing the platform. **P3** when convenient.

**IDs:** S, B, R, D and E are this file's. "A1–A15" always means the spec's assumptions (§11.1).

## S. Security: implemented versus verified

### Review findings

From the independent review of `61f6011` on 2026-11-04. Its full text isn't in the repo; `BRIEF.md`, section 11, says where it is.

| # | Finding | Fix | Implemented | Verified |
|---|---|---|---|---|
| S1 | Critical: a failed live check showed as success | #39 (Thread A) | Yes | Hosted on `b73582e`: forced miss and hold (C5) |
| S2 | The same area: an unpublish's stale warning and dropped retry | W1, #47 | Yes | CI only. See B1 |
| S3 | Critical: an older publish could overwrite a newer withdrawal | #39: superseded on lock | Yes | CI, with a concurrency test |
| S4 | Major: open redirect in the SDK preview route | #37 (Thread B) | Yes | CI. The staging suite has no redirect case |
| S5 | Major: grants beyond §4.5 with no decision | Spec §4.5 and §4.6 amended | Yes | Spec text matches. See D6 |
| S6 | Major: unsaved work crossed users on a shared browser | #38 (Thread C) | Yes | CI. Hosted session expiry passed, but not the shared-browser case |
| S7 | Major: unlimited attempts when a run is killed | `20261104150000_publish_state.sql` | Yes | CI |
| S8 | Major: withdrawn content had no time limit | #36 (Thread D), #41 (Thread E) | Yes | **Hosted:** 1 h 2 min, 1 h 3 min, and 2 h 2 min when the check kept failing |
| S9 | Major: worker step failures reached no alert | `worker.step_failed` | Yes | CI. The email path is Hosted through another alert; this one wasn't forced |

### Carried from M1

| # | Item | Implemented | Verified |
|---|---|---|---|
| S10 | "Halda áfram" session swap | Yes, M3-14: the page names the account and asks | CI. The hosted sign-in passes through this page, but the replace-session question never ran there |
| S11 | Token hash in the confirm URL | Yes, `DropLinkQuery` | CI. It ran during hosted sign-in, unasserted |
| S12 | Orphan originals in `media-private` | Yes, `media-orphans.ts` | CI |
| S13 | `register_asset` metadata trusted | Yes, re-derived at publish, M3-07 | CI |
| S14 | `FOR SHARE` race | Yes, M3-07 and Thread A | CI |
| S15 | Webhook replay within 5 minutes | No: accepted as harmless (decision 50.5) | Accepted |

### The review's 18 Minors

These aren't in `deferred-minors.md`. "Open" was checked in code on 2026-11-05. "Not checked" means nobody has looked since the review.

| Minor | Status |
|---|---|
| 1 Dot segments in sign-in and link paths; 2 media URL lifetime; 3 `http:` preview URLs; 4 short preview secrets; 5 RPCs before token shape | Fixed by #37 (CI) |
| 6 Preview token in the query string | Required by §7.5; a POST hand-off needs a spec change |
| 7 Demo site `remotePatterns` has no pathname | Open |
| 15 A copy reappearing after sign-out; pending cookie survives sign-out | Partly fixed by #38. See S21 |
| 16 No way out of draft mode in the SDK | Open |
| 17 No CSP, `frame-ancestors`, `nosniff` or HSTS on the CMS | Open |
| 8 Singleton known only from an existing row; 9 `FOR SHARE` before validation; 10 retention recomputes all releases; 11 unlocked release during claim; 12 stuck delivery with no alert; 13 partial Storage deletes; 14 no global mail cap; 18 unqualified `bool_or` | Not checked |

### Still open

| # | P | Item | Suggested next step |
|---|---|---|---|
| S16 | P1 | Triage the Minors marked Open or Not checked | Give M5 the result |
| S17 | P1 | The staging Supabase secret key was pasted into a chat (C4). Rotation is deferred to before go-live (decision 47.2). It also sits in local transcripts | Rotate before go-live. Production gets fresh keys entered only by Einar |
| S18 | P1 | The repository was public for a period, apparently from its creation on 2026-11-03, and is private now. No doc records it. Its history hasn't been fully scanned for secrets | Include a history scan in M5 |
| S19 | P1 | Cloud threads have Supabase, Vercel and Zoho Mail connectors, gated only by asking first (Reported by the coordinator). "No hosted systems" is a behavioural rule there | Einar decides whether to remove them from the Project |
| S20 | P1 | M2 and M3 had one security review of `61f6011` and no spec or quality review. Fix rounds and W1 were each reviewed alone | M5 must cover M2, M3 and the fixes as a whole |
| S21 | P2 | Sign-out can't revoke a pending sign-in session; it stays valid until its tokens expire (`deferred-minors.md`, M5) | M5 |
| S22 | P2 | W1 limit: any newer request for the entry stops the checks, even one that failed. A withdrawal still on the site then gets no alert | Decide in M5 |
| S23 | P2 | W1 limit: replaced images aren't re-checked after a newer release | Decide in M5 |
| S24 | P2 | `main` has no branch protection. The merge rule and `main-guard` are behavioural and alert-only | Accept knowingly, or revisit GitHub Pro |

## B. Verification gaps

| # | P | Gap | What would close it |
|---|---|---|---|
| B1 | P1 | W1 has never run on staging. `demo` release 17 won't clear by itself, because it predates W1 | At the next gated advance: a fresh unpublish with a forced miss, then wait past the hour. Needs new approvals, including the forced miss |
| B2 | P1 | Spec A1–A4 last ran on staging at M1, through `boundary-check`. 22 migrations have landed since, and C5 didn't rerun it | Rerun in M4 or M5. Needs Einar's terminal and approval |
| B3 | P1 | No record that Supabase's security advisor was run, though §8.5 expects it | Run on staging, then production |
| B4 | P2 | Serving with the CMS down passed on staging once, at M1 (paused 38 s, `m1-report.md` criterion 8). Not rerun since, and not in §8.5's E2E form | Repeat before go-live |
| B5 | P2 | Four §8.5 fallback cases are CI only, by ruling (decision 52). Two more are partial on staging (C5's table). An image replacement with a missed check is CI only (decision 51.1) | None needed unless M5 asks |
| B6 | P2 | Go-live items not yet done: Einar's phone check; the email change confirmed by both addresses; the password-403 re-run; image 404 to 200; `current.json` overwrite; DMARC; `*.vercel.app` domains; key check after entry. The full list is in C4 | Before LABAK's go-live |
| B7 | P2 | The production path has never run: fresh Pro project, migrations, Auth, SMTP, cron, secrets | Part of creating production |
| B8 | P2 | The staging E2E suite is only on local branch `acceptance/m2-m3`, on no remote. `apps/cms/test-results-staging/` is untracked beside it. Decision 51.2 keeps it off `main` because of its key handling | Open item, left as it is. Moving it to `main` needs key handling through `tools/cli`. C5 lists its Minors |
| B9 | P3 | `demo-next15-staging` is inactive and won't update when `staging` advances | Re-check spec A12 if the SDK's site contract changes |

## R. Risks

| # | P | Risk | Note |
|---|---|---|---|
| R1 | P2 | SDK version is still 0.1.0 after 8 commits since M1 (2 of them merges), and LABAK vendors the older 0.1.0. Same version, different code | Bump it, and refresh or publish it before M6 (decision 42.4) |
| R2 | P2 | Production has no owner in any milestone: Supabase Pro, `cms.litljomi.is`, region, Auth, SMTP. Staging has no backups on Free | Einar decides where it belongs |
| R3 | P2 | GitHub Actions minutes. By estimate, each CI run bills about 10 minutes and a PR push runs it twice. The repo was made public for free minutes (Reported), it's private now, and GitHub Pro was declined | Check the balance before M4 starts |
| R4 | P2 | Rulings in the coordinator's chat may exist nowhere else. It has no known export | Record them the same day from now on |
| R5 | P3 | One maintainer, one model at every level, one laptop holding local transcripts and the staging env file | Known and accepted so far |
| R6 | P3 | The `deliver.test.ts` flake (`BRIEF.md`, Traps). Unexplained `ci` failures with no logs on first runs of `938128a` | Fix the flake; check Actions limits if the failures recur |

## D. Record discrepancies

Left unchanged on purpose. The KING proposes corrections and Einar agrees them.

| # | Record | Reality |
|---|---|---|
| D1 | `CLAUDE.md`: `state.json` is authoritative. `RESUME.md`: continue from `state.mjs` | `state.json` covers M1 tasks only, with `branch: m1/phase-1`. M2 and M3 live in PRs and C5 |
| D2 | `CLAUDE.md` sources of truth list the spec and the M0–M1 plan | M2 and M3 plans aren't listed. The M0–M1 plan also holds every decision to 52 |
| D3 | Project instructions: only the coordinator merges, PASS for `security` PRs | The coordinator reports having no merge tool. `environment.md` requires a PASS for every PR |
| D4 | #48 merged with no PASS. #46's PASS described only its last commit | Both docs only. The first KING read #46's other changes and found nothing wrong |
| D5 | Decision 50 says Einar merges and the advisor checks each PR | The Nov 3 waiver, then the Nov 4 rule, replaced it. The waiver is in no repo doc |
| D6 | The `UPDATE (preview_url)` grant for `service_role` | The migration exists. The approval is Reported, with no numbered decision |
| D7 | `deferred-minors.md`: over 50 open rows, 19 owned by C3, others by finished tasks | Many are done: C4 said to clear several, S10–S14 are open there, and its Task 29 section is fixed by #32 |
| D8 | Spec header: "Not yet implemented". M0: production projects | Stale, and deferred by decision 42 |
| D9 | `CLAUDE.md`: the controller is the only writer of `docs/execution/`, the main session | Cloud threads have edited it under explicit briefs. `CLAUDE.md` doesn't mention a KING |
| D10 | `gates.json`: `demo-next15-staging` Production Branch `staging` | C5 records `main`, because the connector couldn't set it |
| D11 | `reviews/` looks like the review record | It stops at M1. M2 and M3 reviews are PR comments |
| D12 | Plan line 527 describes the old `einar6969` guard exemption | The exemption is gone |
| D13 | The `staging` deploy switch | Not in the runbook |
| D14 | The Hub's running log is in the LABAK workspace `CLAUDE.md` | A session opened in this repo doesn't load it. This folder replaces that role |

## E. Waiting on Einar

| # | Decision | Note |
|---|---|---|
| E1 | When M4 resumes, and on what terms | Frozen until then. Consider recording the freeze and its end as a decision |
| E2 | Where M4's code runs | Decision 50 keeps M4 local. The first KING recommended cloud threads for code, local for hosted |
| E3 | Export provider and its cost | Spec §8.4 leaves it to M4 |
| E4 | Production: when, which region, and the Pro cost | See R2 |
| E5 | The definition of finished | Proposed in `BRIEF.md`, section 7 |
| E6 | Target month for LABAK's launch | No urgency. A date sets M6's pace |
| E7 | Whether the `crs` log-mode rules on `demo-staging` cost anything | Blocks nothing. Vercel bills "Firewall OWASP Requests" as its own line. The data seen stopped before the rules appeared |
| E8 | Corrections to the records in section D | None made so far |
| E9 | Cloud connectors (S19) and Actions minutes (R3) | Best settled before M4's first thread |

**Outside the Hub, but dated:** labak.is expires on 2026-11-18. Renewal is tracked in the LABAK workspace, not here, and at last check it had no answer.
