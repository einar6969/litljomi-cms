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
