# Open issues

What's outstanding after M3, as of 2026-11-05 (`origin/main` at `eb4e85c`, staging at `b73582e`). The KING owns this list and prioritizes it with Einar. It sits beside `docs/execution/deferred-minors.md` and doesn't replace it.

**Evidence words:** **Hosted** ran on staging, and the record says so. **CI** has tests that pass on the local stack, never asserted on staging. **Code** exists, with no specific check behind this statement. **Reported** was said by someone and not re-checked.

**Priority:** **P1** before real editors or content. **P2** before finishing the platform. **P3** when convenient.

**IDs:** S, B, R, D, E and M are this file's. "A1–A15" always means the spec's assumptions (§11.1).

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
| S16 | Closed | Minors triaged in `docs/verification/m5-review.md` | None |
| S17 | P1 | The staging Supabase secret key was pasted into a chat (C4). Rotation is deferred to before go-live (decision 47.2). It also sits in local transcripts | Rotate before go-live. Production gets fresh keys entered only by Einar |
| S18 | Closed | The repository is public, by Einar's choice. M5's history scan found no real secret: 587 commits, regex and entropy (`m5-review.md`) | None |
| S19 | P1 | Cloud threads have Supabase, Vercel and Zoho Mail connectors, gated only by asking first (Reported by the coordinator). "No hosted systems" is a behavioural rule there | Einar decides whether to remove them from the Project |
| S20 | P1 | M2 and M3 had one security review of `61f6011` and no spec or quality review. Fix rounds and W1 were each reviewed alone | M5 must cover M2, M3 and the fixes as a whole |
| S21 | P2 | Sign-out can't revoke a pending sign-in session; it stays valid until its tokens expire (`deferred-minors.md`, M5). Since PW-02, a password sign-in clears the pending cookie the same way, without revoking the session at Auth (PW-02 security review, Minor) | Revoke it at Auth when either path discards it |
| S22 | Closed | A repeat unpublish cancelled an unconfirmed withdrawal. M5 finding 1, fixed in PR #58, refusal confirmed on hosted (C7) | None |
| S23 | P2 | W1 limit: replaced images aren't re-checked after a newer release | Decide in M5 |
| S25 | P2 | A failed build's `releases.error` message can quote a fragment of published entry text, through `JSON.parse` errors. The same text reaches `audit_log.details` and possibly the alert email. `omitted[].error` is free text too. Schema validation can echo a crafted key (`packages/schema/src/fields/list.ts:46`) into `publish_requests.error`. `site_deliveries.last_error` holds site paths and media URLs. The console shows only codes, steps and statuses | Fix in M5: `message` should never quote a payload |
| S28 | P2 | **Password sign-in (decision 72), live on staging since 2026-11-12 (`docs/verification/pw-staging.md`).** Guessing is limited only per IP address: about 150 attempts per 5 minutes, shared with session refresh (decision 72.4). Guesses spread over many addresses are unlimited, and there is no CAPTCHA and no password rule beyond length 6. All accepted by Einar (decisions 72, 72.4). Supabase's Team plan has a per-account lockout hook (decision 73, suggestion 15, a cost decision). M5 finding 7 is closed by signing in from the browser, so the limit counts the editor's own address | Prove the per-address limit on staging during the password rollout (`docs/plans/passwords.md`, Hosted) |
| S29 | Closed | No sign-out on the set-password page (PW-03 security review). Fixed in PR #66 (`a772423`, on staging): `/auth/password` has the sign-out, which also clears the set-password step | None |
| S30 | P3 | An oversized `next` (about 4 KB) in a link makes the browser drop the set-password step cookie, so the step is skipped silently. Only the link’s holder can do it, to their own session (PW-03 security review, Minor) | Cap `next` at, say, 2,000 characters in `safeRedirectPath` |
| S31 | P3 | After R7, a confirm-link POST that still carries an expired (but refreshable) session signs in without the M3-14 question, and "Skipta um aðgang" then doesn’t revoke the replaced session at Auth: the server can’t load an expired session any more. The window is narrow (the GET goes through `/auth/refresh` first; `KeepSessionFresh` refreshes before expiry). Also: if `/auth/refresh` hangs, its history entry keeps the confirm link’s token hash (sent nowhere; `no-referrer`) (S29/R7 security review, Minors). And a sign-out from a browser whose clock is well behind the server’s may not revoke the session at Auth (auth-js decides expiry by the browser clock); the device is still signed out (S29/R7 security re-review, Minor) | Revoke from the browser on the confirm page too, if it matters before real editors |
| S26 | P2 | TOTP guesses have no account lockout, only Auth's rate limit (default 15 a minute). Accepted for now (decision 62). The dashboard doesn't show the hosted value (C7) | Measure it or accept it before real clients |
| S27 | Closed | M5's other Major findings: fixed, reduced or accepted (C7, decision 69). Finding 10 is accepted (decision 65). Finding 7 is parked until a password system (decision 66) | None |
| S24 | P2 | `main` has no branch protection. The merge rule and `main-guard` are behavioural and alert-only | Accept knowingly. While the repo is public, protection should need no GitHub Pro (not tested) |

## B. Verification gaps

| # | P | Gap | What would close it |
|---|---|---|---|
| B1 | Closed | W1 has never run on staging, and `demo` release 17 won't clear by itself. Einar ruled out a dedicated staging run (decision 54). W1 reached staging with M4's acceptance (C6) | None, by ruling. It gets no test of its own |
| B2 | Closed | A1–A4 reran on staging: 71 passed, 0 failed (C6) | None |
| B3 | P2 | Security advisor ran on staging: one warning, leaked password protection, not applicable (C6) | Run on production |
| B4 | P2 | Serving with the CMS down passed on staging once, at M1 (paused 38 s, `m1-report.md` criterion 8). Not rerun since, and not in §8.5's E2E form | Repeat before go-live |
| B5 | P2 | Four §8.5 fallback cases are CI only, by ruling (decision 52). Two more are partial on staging (C5's table). An image replacement with a missed check is CI only (decision 51.1) | None needed unless M5 asks |
| B6 | P2 | Go-live items not yet done: Einar's phone check; the email change confirmed by both addresses; the inverted sign-in check of runbook section 7.2 (decision 72; replaces the password-403 re-run); image 404 to 200; `current.json` overwrite; DMARC; `*.vercel.app` domains; key check after entry. The full list is in C4 | Before LABAK's go-live |
| B7 | P2 | The production path has never run: fresh Pro project, migrations, Auth, SMTP, cron, secrets | Part of creating production |
| B8 | P2 | The staging E2E suite is only on local branch `acceptance/m2-m3`, on no remote. `apps/cms/test-results-staging/` is untracked beside it. Decision 51.2 keeps it off `main` because of its key handling | Open item, left as it is. Moving it to `main` needs key handling through `tools/cli`. C5 lists its Minors |
| B9 | P3 | `demo-next15-staging` is inactive and won't update when `staging` advances | Re-check spec A12 if the SDK's site contract changes |

## R. Risks

| # | P | Risk | Note |
|---|---|---|---|
| R1 | P2 | SDK version is still 0.1.0 after 8 commits since M1 (2 of them merges), and LABAK vendors the older 0.1.0. Same version, different code | Bump it, and refresh or publish it before M6 (decision 42.4) |
| R2 | P2 | Production has no owner in any milestone: Supabase Pro, `cms.litljomi.is`, region, Auth, SMTP. Staging has no backups on Free | Einar decides where it belongs |
| R3 | Closed | GitHub Actions billing. The repo is public for free CI. Einar dropped this as a concern (decision 54), and CI passed on `eb4e85c`. If `ci` jobs fail within seconds, read the annotations | None |
| R4 | P2 | Rulings in the coordinator's chat may exist nowhere else. It has no known export | Record them the same day from now on |
| R5 | P3 | One maintainer, one model at every level, one laptop holding local transcripts and the staging env file | Known and accepted so far |
| R7 | Closed | The CMS proxy refreshed expired sessions from the server’s address, so forged expired cookies could use up the shared refresh limit for every editor. Fixed on `fix/S29-R7-sessions` (PR #66, `a772423`, on staging since 2026-11-12): server-side clients refuse `grant_type=refresh_token`; the browser keeps sessions fresh on every signed-in page; an expired page navigation refreshes in the browser through `/auth/refresh`. A test proves a forged expired cookie makes no server refresh; sign-out signs out in the browser first so it still revokes after expiry | None |
| R8 | P3 | Local stack: Kong serves the email templates through per-file mounts, so after a branch switch that rewrites `supabase/templates/` it serves deleted files and Auth silently sends its English defaults (found in PW-02). `CLAUDE.md` now says to restart the stack | None beyond the rule; hosted templates live in the dashboard |
| R9 | P3 | Test isolation: `console-views.test.ts` (audit window) and `storage-boundary.test.ts` (`delivery/labak/current.json`) fail after the browser suite has run on the same local database; both pass after `pnpm db:reset` (PW-03). `design.spec.ts` "publishing for real" is flaky (failed twice, passed on rerun) | Make the two tests independent of leftover data; find the flake |
| R10 | P2 | No staging browser suite exists any more (`apps/cms/e2e-staging` is gone), so runbook 7.3 step 10 and future hosted acceptance have no browser coverage. Staging's Auth audit log returned no rows during the rollout | Decide whether to restore a staging suite; check the hosted Auth audit-log setting |
| R6 | P3 | The `deliver.test.ts` flake (`BRIEF.md`, Traps). The `ci` failures with no logs on first runs of `938128a` were GitHub refusing the jobs | Fix the flake |

## D. Record discrepancies

Left unchanged on purpose. The KING proposes corrections and Einar agrees them.

| # | Record | Reality |
|---|---|---|
| D1 | `CLAUDE.md`: `state.json` is authoritative. `RESUME.md`: continue from `state.mjs` | `state.json` covers M1 tasks only, with `branch: m1/phase-1`. M2 and M3 live in PRs and C5 |
| D2 | `CLAUDE.md` sources of truth list the spec and the M0–M1 plan | M2 and M3 plans aren't listed. The M0–M1 plan also holds every numbered decision |
| D3 | Project instructions: only the coordinator merges, PASS for `security` PRs | The coordinator reports having no merge tool. `environment.md` requires a PASS for every PR |
| D4 | #48 merged with no PASS. #46's PASS described only its last commit. #49 and #50 merged with no PASS and with CI refused | #46, #48 and #49 are docs, apart from #49's small edit to `CLAUDE.md`. #50 changed `.claude/settings.json`, on Einar's instruction. Confirmed on GitHub 2026-11-05 |
| D5 | Decision 50 says Einar merges and the advisor checks each PR | The Nov 3 waiver, then the Nov 4 rule, replaced it. The waiver is in no repo doc |
| D6 | The `UPDATE (preview_url)` grant for `service_role` | The migration exists. The approval is Reported, with no numbered decision |
| D7 | `deferred-minors.md`: over 50 open rows, 19 owned by C3, others by finished tasks | Many are done: C4 said to clear several, S10–S14 are open there, and its Task 29 section is fixed by #32 |
| D8 | Spec header: "Not yet implemented". M0: production projects | Stale, and deferred by decision 42 |
| D9 | `CLAUDE.md`: the controller is the only writer of `docs/execution/`, the main session | Cloud threads have edited it under explicit briefs. `CLAUDE.md` mentions a KING in one line and doesn't define the role |
| D10 | `gates.json`: `demo-next15-staging` Production Branch `staging` | C5 records `main`, because the connector couldn't set it |
| D11 | `reviews/` looks like the review record | It stops at M1. M2 and M3 reviews are PR comments |
| D12 | Plan line 527 describes the old `einar6969` guard exemption | The exemption is gone |
| D13 | The `staging` deploy switch | Not in the runbook |
| D14 | The Hub's running log is in the LABAK workspace `CLAUDE.md` | A session opened in this repo doesn't load it. This folder replaces that role |
| D15 | `gates.json`: G3 and G6 show top-level `status: approved` | Their closure sits in `extensions` rows, so the top-level status overstates them. G3's scope also still says Frankfurt (Reported by the onboarding session) |

## E. Waiting on Einar

| # | Decision | Note |
|---|---|---|
| E1 | Starting M5 | M4 is accepted (decision 64). The proposal is in the KING's report |
| E4 | Production: when, which region, and the Pro cost | See R2 |
| E5 | The definition of finished | Proposed in `BRIEF.md`, section 7 |
| E6 | Target month for LABAK's launch | No urgency. A date sets M6's pace |
| E7 | Whether the `crs` log-mode rules on `demo-staging` cost anything | Blocks nothing. Vercel bills "Firewall OWASP Requests" as its own line. The data seen stopped before the rules appeared |
| E8 | Corrections to the records in section D | None made so far |
| E9 | Cloud connectors (S19) | Only matters if cloud threads are used again |

## M. M4 findings, 2026-11-05

From a read-only investigation. Decisions 53, 55 and 56 hold the scope. `docs/plans/m4.md` turns this into tasks.

| Area | Code supports | Missing | Undecided |
|---|---|---|---|
| Webhook rotation | The SDK and demo site accept two comma-separated secrets, with a test. The worker reads Vault for each delivery | `admin_set_webhook_secret`, a CLI command (copy `provision preview-secret`), a runbook. No SDK change | How to prove no failed deliveries; whether a redeploy passes the Ignored Build Step |
| Suspend, revoke | Suspension is enforced. `service_role` has the grants | `admin_set_tenant_status`, `admin_remove_membership`, CLI commands | None |
| Console | RLS covers every console table at `aal2` | Routes, TOTP enrolment, MFA code, and a way to add a `platform_admins` row other than owner SQL | None |
| Offboarding | Removing memberships before the Auth user is decided (decision 32) | Parked (decision 53). When it returns: the owner SQL, Vault cleanup, the storage delete, and what happens to audit rows | Audit rows |
| Provisioning | `provision` refuses safely on a rerun (`slug_taken`, duplicate site) | Spec §9.2 says idempotent; reruns must finish the job (M4-02) | Settled: reruns succeed (decision 58) |

Local verification: `pnpm lint`, `typecheck`, `test`, `check:slugs`, `check:schema` and `harness:test` run on the laptop. `pnpm db:test` and `pnpm test:integration` need `pnpm db:reset` first when the stack is behind on migrations. CI has no browser tests.

**Outside the Hub, but dated:** labak.is expires on 2026-11-18. Renewal is tracked in the LABAK workspace, not here, and at last check it had no answer.
