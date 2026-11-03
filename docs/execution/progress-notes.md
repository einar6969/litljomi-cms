### First Lane B merge (Task 13, 2026-11-02)

- Setup: the sandbox refused to create the worktree (it may not write `.claude/` files there, nor `.git/config` for a sparse checkout). Einar created `.worktrees/lane-b` himself; sandboxed commits inside it work.
- Task 13 (`a411e47`) passed its combined review in round 1 and was merged into `m1/phase-1` as `436854d` (`--no-ff`). No conflicts; the lockfile change was only the reviewed `zod` addition, so no merge security review was needed. `pnpm install --frozen-lockfile` was clean.
- After the merge: harness 27/27; lint, typecheck and check:slugs exit 0; Vitest 7 files, 145 tests. Database, run after Task 5's security review had finished probing the live stack: `pnpm db:reset && pnpm db:test` Files=5, Tests=183, PASS.
- Lint in the main checkout now ignores `.worktrees/**` (`153eda0`): it had been linting the worktree's copy of `eslint.config.mjs`. `m1/lane-b` was fast-forwarded to the merge so Lane B continues from the phase branch.

### Lane B merge 2 (Task 14, 2026-11-02)

- Task 14 (`8452545`, fixes `82d08f5`, `e6dbcd8`) was merged into `m1/phase-1` as `3810375` (`--no-ff`). The merge waited until Lane A's Task 6 implementer was idle, so files did not change under it. No conflicts; the lockfile was the reviewed one; `pnpm install --frozen-lockfile` was clean.
- After the merge: harness 27/27; lint, typecheck and check:slugs exit 0; Vitest 13 files, 175 tests; `pnpm db:reset && pnpm db:test` Files=6, Tests=282, PASS (Task 6 included).

### Interface note for Task 16 and the sites (Task 15, 2026-11-02)

- A `link` field that references an entry projects to `{ entry: EntrySummary | null }`; `{ entry: null }` means the referenced entry is not published (spec §6.2). External links project to `{ href }` with a canonical URL. The plan's Task 15 test text (`related: EntrySummary | null`) assumed a bare reference field, which the slice does not have; the controller ratified the adaptation (`task-15-r1-spec-quality.md`).

### Lane B merges 3 and 4 (Tasks 15, 16 and 18, 2026-11-02)

- Tasks 15 (`e97329c`) and 16 (`11b7c93`) were merged as `324ec13`, after Lane A's Task 7 implementer had committed (`0f7ca02`). Task 18 (`5313a5b`, `41515f0`) was merged as `2ade8f2`. Both merges were clean; `pnpm install --frozen-lockfile` was clean each time. The lockfile changes were reviewed in the tasks themselves: Task 16 pruned a stale optional `happy-dom` branch (no `package.json` ever named it); Task 18 added `next@16.4.3` and its tree as the SDK's peer, with no install or build scripts.
- Before the merges, `m1/phase-1` was merged into `m1/lane-b` (`ec7f204`) so the worktree carried decisions 23–24.
- After the last merge: harness 27/27; lint, typecheck and check:slugs (2 slugs) exit 0; Vitest 25 files, 327 tests; `pnpm db:reset && pnpm db:test` Files=7, Tests=406, PASS. Lane B (Tasks 13–16, 18) is complete.

### Handoff after C1 approval (2026-11-02, second controller session)

- **C1 approved** by Einar on 2026-11-02 (recorded in `state.json`, commit `f918d59`); `main` was fast-forwarded to `m1/phase-1` at that commit (local only). Later commits on `m1/phase-1` are the C1 follow-ups below; `main` stays where it is until the next checkpoint.
- **Decision 32** records Einar's C1 rulings: worker statement timeout per statement on the worker's own connection in Task 19 (row moved to Task 19); spec §4.2 (Vault outside the no-definer rule) and §6.2 step 5 (refs checked from the copied data) amended; Auth-user deletion keeps failing closed and offboarding removes memberships first; links with credentials rejected (`feb827c`); plan wording updated in one change (`e0fc0b6`, `10dbbb5`) with one combined review (pass).
- **Deferred Minors:** the four stale "Task 15" rows were cleared by `e97329c`; every C1 row was triaged once: cheap fixes in `7caffe3` (cleanup), the rest accepted with a one-line reason. Reviews of the cleanup: security r1 pass, combined spec-and-quality r1 pass (`docs/execution/reviews/c1-*`). Suite after the cleanup (implementer, confirmed by the security reviewer): harness 32/32; lint, typecheck, slugs clean; Vitest 25 files 342; pgTAP 13 files 1252; integration 6 files 67.
- **Decision 33** (Einar, 2026-11-02): narrow `service_role` UPDATE on `cms.tenants` to `(name, status)`, and lock the tenant row `FOR SHARE` in both worker commit functions; no membership lock and no `cms.memberships` grant (the millisecond revocation race is accepted and documented). Implement both as one small change in Task 19 (the next phase's first worker task), with tests and a security review; the two rows in `deferred-minors.md` are owned by Task 19.
- Einar removes the three worktrees himself. The next phase (Task 17 onward) starts in a fresh controller session.

### Handoff at checkpoint C1 (2026-11-02, second controller session)

- Phase 1 and Lane B are complete: Tasks 4–16 and 18 are done and merged into `m1/phase-1` (head `e0482f2` before the C1 commit). C1 is reported in `docs/execution/checkpoints/C1.md` and recorded with `state.mjs checkpoint C1`; **waiting for Einar's go-ahead**. Task 17 is not started.
- Validation gates passed: A1–A5, A9, A13, A14 (A1–A4 on the local stack; Task 29 re-runs them on staging).
- New decisions 28–31, the resource-exhaustion threat model, and the overlapping Lane A rule (two worktrees, both now reset to `m1/phase-1`) are in the plan and `gates.json`.
- Open questions for Einar are in C1's "Unresolved issues" (statement timeout, §4.2 Vault wording, §6.2 step 5 wording, Auth-user deletion with memberships, credentials in hrefs, plan wording). Four deferred-Minor rows name Task 15 as owner but are still open; review them against Task 15's commits before Phase 3.
- `pnpm db:test` needs a fresh `pnpm db:reset` after `pnpm test:integration` (shared personas).

### Handoff at checkpoint C2 (2026-11-02, third controller session)

- Phase 3 is complete: Tasks 17, 19, 20, 21 (Lane A) and 26 (Lane B) are done and merged into `m1/phase-1` (last merge `99433dd`, state commit `35107ac`). C2 is reported in `docs/execution/checkpoints/C2.md` and recorded with `state.mjs checkpoint C2`; **waiting for Einar's go-ahead** and his answers to the report's nine unresolved issues. Task 22 is not started.
- New decisions 34 (Einar's rulings on the Phase 3 pre-check) and 35 (settled pre-check points) are in the plan; Task 26 moved to Lane B (dependsOn 16, 18) and Task 21 depends on 26; C2 now follows Task 21.
- All three Lane A worktrees and lane-b exist; `lane-a-alt` is at `b7adb2f` (Task 20 done), `lane-a-next` at Task 21's head `c337b48` (merged), `lane-b` at `aa33a4e`. Bring each up to `m1/phase-1` before reuse.
- Local stack notes: `supabase db reset` reports a blocked call to `api.github.com` (CLI version check; harmless). The local end to end is `pnpm db:reset && pnpm test:e2e-local`; run `pnpm db:reset` after `pnpm test:integration` before `pnpm db:test`. Labak builds after the integration suite leave out Task 12's partial-data entries (correct fail-closed behaviour).
- Phase 4 needs a decision on Playwright (decision 34.6): its browser download host is outside the npm-only allowlist.

### Phase 3 closed after C2 approval (2026-11-02, third controller session)

- **C2 approved** by Einar on 2026-11-02 (recorded in `state.json`). His rulings are decision 36: spec §7.4 amended to the M1 fixed retry interval (alert and "delivery failed" when the 10 attempts run out), §7.4 "Limits" and §7.3 document the accepted live-check limits, failed-build objects deferred to M3 retention, the local end-to-end script's secret-key read accepted for local tests only, and Task 28 verifies the role timeout on hosted Supabase first (stop and ask if refused).
- **New Task 30** (Phase 4, Lane B, high tier, after Task 21, before Task 25): the sweep fails stale `building` releases; `worker_finish_release` succeeds only while `building`; a missing private original fails the publish request before commit (`asset_missing`, alert), with no projection fallback (M3). Task 25 depends on 24 and 30. The harness now has 31 tasks.
- Documentation change reviewed: combined r1 FAIL (Task 30 had implied a projection fallback), fixed, r2 pass (`docs/execution/reviews/c2-rulings-*`).
- `main` fast-forwarded to `m1/phase-1` (local only, no push). Phase 4 starts in a fresh controller session with Task 22 (Lane A) and Task 30 (Lane B); bring each worktree up to `m1/phase-1` first. Phase 4 needs a decision on Playwright (its browser host is outside the npm-only allowlist).

### Phase 4 paused after Task 24 (2026-11-02, fourth controller session)

- **Paused at Einar's request** ("please pause after task 24, do not start task 25"). Done and merged into `m1/phase-1`, in order: Task 30 (`fd8edcd`), Task 22 (`1dd6428`), Lane B C2 cleanup (`0985f3a`, hand-resolved `cms-next.sh`, merge-resolution security review pass), Task 23 (`1de81a0`), Task 24 (`4797ae5`). `main` unchanged at `9f15275`. Task 25 not started; Task 27 not started.
- **Suite after the last merge** (controller): harness 32/32; lint, typecheck, slugs clean; Vitest 58 files 1062; pgTAP 17 files 1374; integration 70 + 35; demo-site e2e 5; `test:e2e-local` 1/1; `pnpm --filter cms e2e` 11/11 (auth, editing, media and rich text, probe).
- **Fix rounds:** Task 22 security r1 FAIL (Major: the unsandboxed e2e run let the Supabase CLI check `api.github.com`); fixed in `6c368c2`, r2 pass. Every other review passed in round 1.
- **Decisions this session:** 37 (pre-check rulings), 38 (Task 22 security rulings; 38.1 amended twice: `updateNotifier: false` and `verifyDepsBeforeRun: error` in `pnpm-workspace.yaml`). `.claude/settings.json`: `allowMachLookup` tried and removed; `sandbox.excludedCommands = ["pnpm --filter cms e2e *"]` (Einar-approved; remove before G2). Details in `environment.md`.
- **Resuming at Task 25:** run it in `.worktrees/lane-a-next` (already at the phase head); migration `20261102001500_publication_status.sql` (decision 37.8); its deferred rows include the Task 24 quality row. Run e2e only as the bare `pnpm --filter cms e2e <filter>` from the worktree as working directory (a pipe, `cd &&` or redirect makes it sandboxed and Chromium fails); never let parallel reviewers stop or reset the stack; `pnpm install --frozen-lockfile --offline` in a worktree after a lockfile change (with `verifyDepsBeforeRun: error`, an out-of-sync `node_modules` now fails `pnpm run`).
- **For Einar at C3:** Task 24 security Minors (`register_asset` callable directly with editor-declared metadata; no `tenant_inactive` check in `register_asset`/`update_asset`; orphan originals) and the open deferred rows.

### Phase 4 complete through Task 25 (2026-11-02, fourth controller session)

- **Tasks and merges into `m1/phase-1`, in order:** Task 30 `fd8edcd`; Task 22 `1dd6428`; Lane B C2 cleanup `0985f3a` (hand-resolved `cms-next.sh`, merge-resolution security review pass); Task 23 `1de81a0`; Task 24 `4797ae5`; Task 25 `9a7e03c` (state commit `3e76968`). `main` unchanged at `9f15275`; no push; nothing in the LABAK repository. Next task in the harness: 27 (needs G7; not started).
- **Suite after the last merge (controller):** harness 32/32; lint, typecheck, slugs clean; Vitest 61 files 1112; pgTAP 18 files 1388; integration 70 + 35; demo-site e2e 5; `test:e2e-local` 1/1; `pnpm --filter cms e2e` 13/13 (auth 3, editing 4, media and rich text 2, probe 1, publish 1, two session setups).
- **Fix rounds:** one. Task 22 security r1 FAIL (Major: the unsandboxed e2e run let the Supabase CLI check `api.github.com`), fixed in `6c368c2`, r2 pass. Every other review passed in round 1. No escalation.
- **Decisions:** 37 (pre-check), 38 (Task 22 security rulings; 38.1 amended: `updateNotifier: false`, `verifyDepsBeforeRun: error` in `pnpm-workspace.yaml`). `.claude/settings.json`: `sandbox.excludedCommands = ["pnpm --filter cms e2e *"]` (Einar-approved; **remove before G2**). Controller ratifications: `prepareUpload(file, tenantId)`; `displayState(row, { fieldLabels }?)`; the demo site as a second Playwright `webServer`.
- **Process issues:** a parallel reviewer ran `pnpm db:stop` while another used the stack (stack rebuilt with Einar's yes; reviewers now never stop or reset it); e2e runs in non-approved forms (one chained `cd`, one wrong working directory, two piped by the controller) all ran sandboxed and failed safe; OrbStack stopped once during Task 25 (Einar restarted it); worktrees need `pnpm install --frozen-lockfile --offline` after a lockfile change, or `verifyDepsBeforeRun: error` fails every `pnpm run`.
- **Controller walkthrough (2026-11-02, after the last merge):** the commands below, then in the desktop app's browser pane on localhost only: sign in as `editor-demo@test.local` through the Mailpit link (landed on `/t/demo`), Events → "Ný færsla", title "Haustmarkaður bakara", start date, "Vistað", slug saved, "Birta" → "Bíður eftir vefnum" → "Birt á vef ✓" in about 10 s; the demo site served the event page (200, entry marker with the new hash); "Taka af vef" → "Tekið af vef" with the cache-safe detail; the page then 404 and absent from `/events`. (The controller typed the slug into the prefilled field and saved a doubled slug; just click "Vista slóð".)
- **Open for Einar (C3):** deferred rows for C3 in `deferred-minors.md`, notably Task 24's security Minors (`register_asset` callable directly with editor-declared metadata; no `tenant_inactive` check in `register_asset`/`update_asset`; orphan originals) and Task 25's (a tenant with no active site polls forever; superseded releases can leave an entry at "Í birtingu…"; the demo-site e2e server inherits the parent environment).

### Phase 4 accepted; follow-up merged (2026-11-02, fourth controller session)

- **Phase 4 accepted** by Einar; his rulings are decision 39. Follow-up (decision 39.3) merged as `e6ca992` (commit `df055f4`): `api.register_asset`/`api.update_asset` refuse a non-active tenant with `tenant_inactive` (migration `20261102001600_asset_tenant_active.sql`, pgTAP `101`; membership is checked first, so a non-member learns nothing about the status); "Enginn vefur tengdur" (final, polling stops) for a tenant with no active site; the slug suggestion is a placeholder (an empty field saves it), so typing cannot double a slug; the rich-text editor has `aria-label` as well as `aria-labelledby`. Reviews: spec, security, quality r1 pass; Minors in `deferred-minors.md` (C3).
- **Keyboard date entry, finding:** not a bug. In the e2e's headless Chromium the date input uses day-month-year for both `is-IS` and `en-US` (whatever Playwright's locale), and typing `14112026` gives `2026-11-14` in a plain `<input type="date">` and in our field alike; it is saved and survives a reload. `DateField` is unchanged. The walkthrough browser probably uses another segment order (e.g. month-day-year), so the same keys did not fill it.
- **Suite after the merge (controller):** harness 32/32; lint, typecheck, slugs clean; Vitest 61 files 1120; pgTAP 19 files 1405; integration 70 + 35; demo-site e2e 5; `test:e2e-local` 1/1; `pnpm --filter cms e2e` 19/19.
- **Gap recorded for the editor design task (Einar's brief to come):** the CMS has no visual design: no stylesheet, no classes, no layout in `apps/cms`; pages render as unstyled HTML. No plan task covers it; nothing was styled in Phase 4.
- **Before any G2 work:** remove `sandbox.excludedCommands` (`pnpm --filter cms e2e *`) from `.claude/settings.json` (decision 39.1), shown to Einar as a diff.
- **State:** `m1/phase-1` at the follow-up's state commit; `main` unchanged at `9f15275`; nothing pushed; nothing in the LABAK repository. Next task: 27 (G7), not started.

### Task 31 started: editor design (2026-11-02, fifth controller session)

- **Authorised** by Einar (decision 40; G0 extension in `gates.json`): Task 31, editor design, Phase 4, Lane A, low tier, after Task 25; Task 29 depends on it, Task 27 does not. Two steps with Einar's screenshot approval between them.
- **Open issue for Einar's decision (recorded, not fixed):** sign-in fails when the magic link is opened in a different browser or device from the one that requested it (`pkce_code_verifier_not_found`; Einar hit this). The PKCE code verifier lives in the requesting browser's cookie, so the callback in another browser cannot exchange the code. Not part of Task 31.
- **Step 1, round 1:** combined review FAIL (Major: the proxy redirected signed-out `/fonts/*` to `/login`, so the sign-in page used fallback fonts); security PASS (Minor: `route.continue()` bypassed the loopback guard). Fixed in `4bd7eb4` (matcher excludes `/fonts/` only, matcher unit test, font-load assertions, `route.fallback()`, panel top-aligned, visible toolbar groups); round 2 combined and security PASS.
- **e2e working-directory incident (round 2):** a subagent's Bash cwd resets between calls, so the round-2 implementer's separate `cd` did not hold and its two bare `pnpm --filter cms e2e` runs ran in the main checkout (reviewed `m1/phase-1` code: 19 passed, then "No tests found" for `design`). Approved form, reviewed code, nothing written. The controller (whose cwd persists) ran the worktree's e2e itself: 23/23. From now on the controller runs e2e for worktree tasks.
- **Step 1 approved** by Einar in chat, 2026-11-02: "Approve step 1". The "Tekið af vef" tone question was not answered; it stays as is (`ok` tone) and remains open in `deferred-minors.md`. Step 2 started.
- **Step 2, round 3:** security PASS (Minor: spec header wording); combined FAIL on one Major (suspended notice not screenshotted; reaching it needs a seeded suspended tenant or an e2e database write). Escalated (third round). Einar in chat, 2026-11-02: "Waive the screenshot". Recorded in `task-31-r3-spec-quality-waiver.md`; the round passes with Minors only (decision 40).
- **Harness record note:** `state.json` lists Task 31's combined reviews as rounds 1–4 because the harness counts rounds across both steps; round 4 is the controller's record of Einar's waiver (`task-31-r3-spec-quality-waiver.md`), not a fourth review.

### Task 31 done and merged (2026-11-02, fifth controller session)

- **Merged** `m1/lane-a-next` into `m1/phase-1` as `abd46f9` (`--no-ff`; commits `3a3eada`, `4bd7eb4`, `602195e`, `f664a22`). The lockfile change (Tailwind 4.3.3 and its tree) was reviewed in step 1's security review; `pnpm install --frozen-lockfile --offline` clean. `main` unchanged at `9f15275`; nothing pushed; Task 27 not started.
- **Suite after the merge (controller):** harness 32/32; lint, typecheck, slugs clean; Vitest 62 files 1122; integration 70 + 35; pgTAP 19 files 1405; `test:e2e-local` 1/1; demo-site e2e 5; `pnpm --filter cms e2e` 27/27 (design spec 8 incl. setup-dependent tests). Database reset afterwards.
- **New ordering constraint:** the design spec publishes a LABAK entry (to reach "Enginn vefur tengdur"), so the worker writes `delivery/labak/current.json`. `storage-boundary.test.ts` (A4) then fails its "object does not exist" check (the editor's write is still refused). Run `pnpm db:reset` before `pnpm test:integration` after any CMS e2e run.
- **Screenshots:** `apps/cms/e2e-screenshots/` (gitignored), `step1-*` and `step2-*` at 375, 768 and 1440 px, regenerated by every `pnpm --filter cms e2e` run.
- **Open for Einar (no change made):** "Tekið af vef" shows the `ok` tone (green) and "Enginn vefur tengdur" the `error` tone (red), both from `status.ts`; the suspended-notice screenshot was waived; the `pkce_code_verifier_not_found` sign-in issue (magic link opened in another browser or device).
- **Before any G2 work:** remove `sandbox.excludedCommands` (`pnpm --filter cms e2e *`) from `.claude/settings.json` (decision 39.1), shown to Einar as a diff.

### Finish line to C3 started (2026-11-02, sixth controller session)

- **Authorised** by Einar (decision 41; G0 extension and G7 in `gates.json`): Task 32 (cross-device sign-in, status tones; Lane B, high tier) in parallel with Task 27 (G7, `branch=hub-integration`, `push=false`, base `aec9f95`); C3 after both; Task 29 depends on 32. Lighter review rules: site-author threat model, Minor-only rounds pass, non-blocking questions collected for C3. Task 28 is not started in this session.
- Pre-check sent to Einar as information (plan, Task 32 and Task 27 "Pre-check amendments"). C3 questions so far: the magic-link email's 6-digit code has no entry field in the CMS; a `sourceLabel` field for news sources.
- **Task 27 escalation (2026-11-02):** security round 3 FAIL with two Majors, both in the planned unsandboxed `npm run test:visual` run (Google Fonts preconnect sockets not caught by route abort; npm's update notifier fetching from the registry). Escalated under the three-round rule; Einar in chat: "Approve round 4". The `excludedCommands` diff is still waiting for his separate approval.
- **Task 27 round 5 and the visual exclusion (2026-11-02):** combined round 4 FAIL (Critical: the visual webServer ran from `e2e/visual`); Einar in chat: "Approve both" (round 5 and the `excludedCommands` diff, applied; see `environment.md`).

### Checkpoint C3 reported (2026-11-02, sixth controller session)

- Tasks 32 and 27 done. Task 27 follow-ups for the walkthrough, reviewed (security + combined, pass): LABAK `42ed226` (an article without a public image uses the crest fallback), CMS `3695e23` (`pnpm seed:labak-site`, merged `8b2c547`). Reviews: `reviews/task-27-followup-*`.
- Suite after the last merge (`8b2c547`): harness 32/32; lint, typecheck, slugs clean; Vitest 65 files 1169; pgTAP 19 files 1405; integration 74 + 35; `test:e2e-local` 1/1; demo-site e2e 5/5; `pnpm --filter cms e2e` 30/30 from a reset database. Database reset afterwards.
- Controller walkthrough on localhost: cross-browser sign-in (pane requests, a separate Playwright browser confirms), two LABAK articles published to "Birt á vef ✓" on the branch site at 3200. Details and the commands for Einar in `checkpoints/C3.md`.
- **Waiting for Einar:** C3 go-ahead, the seven C3 questions, and approval of the diff removing `npm run test:visual` from `sandbox.excludedCommands` (sha256 `9d62ac1e…b8ed`). LABAK `hub-integration` is at `42ed226`, local only. Next session: remove the e2e exclusion before G2, then G2–G6 and Task 28.

### C3 approved (2026-11-02, sixth controller session)

- **C3 approved** by Einar; rulings are decision 42 (plan). The visual exclusion is removed (`fb43e8c`); `main` fast-forwarded to `m1/phase-1` at `fb43e8c` (local only).
- **Spec amended:** §9.1 (vendored `npm pack` files until a second site; GitHub Packages then) and §2.2 (staging on Supabase Free until production).
- **Hosted plan decided** (each gate still approved separately when reached, next session): G2 private `einar6969/litljomi-cms` with Actions; SDK via vendored tarballs on `hub-integration`; G3 Supabase Free staging; G4 Resend Free from a litljomi.is subdomain; G5 only the C3 records; G6 Vercel Pro (Einar upgrades); before any push of `hub-integration`, Einar turns off branch previews on `landssamband-bakarameistara`.
- **For the next session, before G2:** remove `pnpm --filter cms e2e *` from `sandbox.excludedCommands` (diff to Einar); revise the runbook's GitHub Packages steps (G2.5, G6.2, section 12 token rows, section 14 open item) to decision 42.4; generate fresh staging secrets. G7 currently has `push=false`; Task 28 needs a push, so G7 needs a new approval.
- **C3 follow-up** (decision 42.3) in progress in this session: Q1, Q2, Q3, Q5, Q7.
- **C3 follow-up done** (2026-11-03): CMS `d87cc4f` (merged `a1b5f23`), LABAK `240b3fb` on `hub-integration`; all reviews pass; full suite green (Vitest 1188, integration 75 + 35, cms e2e 33/33). C3 addendum written. Open for Einar: `kill 87420` (stray server on 3157), and whether spec §4.4 should drop "one-time code". Stop here; the hosted work starts in a fresh session.

### Sitting 1 started: decision 43, local preparation (2026-11-03, seventh controller session)

- **Decision 43** recorded (`aa6e91b`), with G0 (local preparation) and G7 (vendoring, local commits) extensions. Task 28 stays `pending` in `state.json` until G2–G6 are all approved (`state.mjs start` requires them); its Step 0 is done.
- **Settings:** diffs A (e2e exclusion removed) and B (`.env` Edit/Write deny, three Supabase ask rules) applied after Einar's approval and the security review (`0bfb23f`, byte-identical). From now on Einar runs every browser test. npm uses `$TMPDIR/npm-cache` (Einar: "Yes, temp cache"). The LABAK folder was added to the session by Einar.
- **Local preparation merged** (`a23f0d4`): runbook rewritten to decisions 42.4/43, spec §4.4 magic link only, `fra1` + `X-Robots-Tag: noindex` in both `vercel.json`, `otp_expiry` pinned, `SITE_NOINDEX` in `.env.example`, undo table in `docs/verification/m1-gates.md`. Reviews r1 (combined FAIL, one Major; security PASS) and r2 (both PASS). SDK 0.1.0 (`15fc6c9`); LABAK `hub-integration` at `56bb9dd` (vendored tarballs, noindex switch, `.env.example`), reviews PASS; fresh clone `npm ci` + `npm run build` pass. Suite: harness 32, lint/typecheck/slugs clean, Vitest 67 files 1190, pgTAP 1405. `main` fast-forwarded to `m1/phase-1` (local).
- **History scan** before G2: only test values (see the G2 request in chat). Binary files ever committed: one test JPEG and two fonts.
- **Open for Einar:** preview secret (no M1 consumer; recommend M3); `git -C … push` ask rules with the G2 diff; `settings.local.json` `git apply *` allow.

### Sitting 1 ended: G2 done, G3 mostly done (2026-11-03, seventh controller session)

- **G2 done:** private `einar6969/litljomi-cms`, `main` and `m1/phase-1` pushed by Einar at `ddb67c8` (actions pinned to SHAs, `ddb67c8`), Actions read-only, no secrets, CI `success`. GitHub hosts removed. Later local commits on `m1/phase-1`/`main` are not pushed yet (Einar pushes when needed, in his terminal).
- **G3 (staging `rwpgpfsmhhtimauvpoyt`, Frankfurt, Free):** Auth settings, 36.7 (role and REST: 57014 at 10.57 s), 17 migrations, `api` only, hook enabled and verified (7.2 run 1 pass), Site URL and the one redirect URL. Details: `docs/verification/m1-report.md`. Undo: `docs/verification/m1-gates.md`.
- **Left for sitting 2:** Icelandic templates (the dashboard unlocks them only after custom SMTP, so with G4), the email rate limit (G3.6), the SendGrid SMTP (G4), DNS (G5), Vercel (G6). Then the provisioning gap: `cms provision` does not exist (`tools/cli` has only `gen-types`); a proposal goes to Einar before P-1–P-3. Then Vault site secrets (P-2).
- **Process notes:** the SQL editor does not run a second tab's query in the same page while another runs (G3.2c needed two browser tabs); unsaved SQL tabs are lost when leaving the editor; the pane's size changes under coordinate clicks, so the controller clicked by element reference and checked the editor text before every run. Staging keys: `.env.staging.local` (Einar's file, read-denied to agents, diff D).
- **Open for Einar:** the Data API's "Automatically expose new tables" is on (it grants privileges on new tables; the migrations' default revokes should neutralise it; Einar's call); preview secret (recommend M3); `settings.local.json` `git apply *` allow; sign out of supabase.com in the pane.

### Einar's answers before sitting 2 (2026-11-03)

Einar in chat: "1. Turn off “Automatically expose new tables” in sitting 2, while I’m signed in for the templates. Afterwards, check that only `api` is still exposed. 2. Bring the `cms provision` proposal before any site is created. 3. The preview secret waits until M3. 4. Show me a diff for .claude/settings.local.json that removes `Bash(git apply *)`, `Bash(git branch *)` and the stale one-off allow entries. I’ll approve it before sitting 2 starts." and "Ready for sitting 2 once that’s done. Start with G4."

- Diff for `.claude/settings.local.json` (empties `allow`; all 16 entries were one-off or stale, two of them `git commit` messages approved earlier this session): sha256 `08f849b7b55c53b78720ba654ece2e518b87a9a8f11ba3d104a3ebe24af00bde`, shown to Einar.

### Sitting 2 paused: waiting for Vercel Pro (2026-11-03, seventh controller session)

- **Done:** G4 (SendGrid SMTP, four Icelandic templates byte-identical, 100 emails/hour, hook run 2 pass); decision 44 (auto-expose left, `provision` built, reviewed and merged `4d25371`, G6 limits); G5 approved (three CNAMEs, Einar adds them); G6 through the Vercel connector (Einar: "use the mcp connectors"): three projects with Node 22, fra1, Standard Protection, domains, non-secret variables; Einar entered the four CMS secrets; Build Command `next build` on both CMS-repo projects (Turborepo strict env). `main`/`m1/phase-1` pushed to GitHub at `4d25371`.
- **Blocked:** the team is still on Hobby (`cron_jobs_limits_reached` on the CMS deployment); Einar upgrades later. The sites cannot build before a first release (`current.json` 400), so provisioning and a first publish come before the sites deploy.
- **Open for Einar:** the order above or an SDK change for a missing pointer; the staging secret key was pasted in chat (kept by Einar; rotation on the C4 list); remove the unused `api.vercel.com` host at the end of G6; sign-out of supabase.com in the pane.
