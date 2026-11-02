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

### Handoff at checkpoint C1 (2026-11-02, second controller session)

- Phase 1 and Lane B are complete: Tasks 4–16 and 18 are done and merged into `m1/phase-1` (head `e0482f2` before the C1 commit). C1 is reported in `docs/execution/checkpoints/C1.md` and recorded with `state.mjs checkpoint C1`; **waiting for Einar's go-ahead**. Task 17 is not started.
- Validation gates passed: A1–A5, A9, A13, A14 (A1–A4 on the local stack; Task 29 re-runs them on staging).
- New decisions 28–31, the resource-exhaustion threat model, and the overlapping Lane A rule (two worktrees, both now reset to `m1/phase-1`) are in the plan and `gates.json`.
- Open questions for Einar are in C1's "Unresolved issues" (statement timeout, §4.2 Vault wording, §6.2 step 5 wording, Auth-user deletion with memberships, credentials in hrefs, plan wording). Four deferred-Minor rows name Task 15 as owner but are still open; review them against Task 15's commits before Phase 3.
- `pnpm db:test` needs a fresh `pnpm db:reset` after `pnpm test:integration` (shared personas).
