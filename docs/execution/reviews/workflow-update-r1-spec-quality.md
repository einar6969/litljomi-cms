# Phase 1 workflow update: combined spec-and-quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet) in combined mode, 2026-11-02
- Change: `cf8ecc3..b65d615` (9bf5b62, 71e727c, fc90c1e, b65d615)
- The reviewer's report, verbatim:

---

PASS

I ran `node --test "tools/harness/__tests__/*.test.mjs"` (23 pass, 0 fail) and `node tools/harness/state.mjs show`. State validates, and `git status --porcelain` is empty. The task order in `state.json` matches `plan-index.json`: 0–16, 18, 17, 19–21, 26, 22–25, 27–29.

Every item of the approved update is implemented. No item is missing, and the one extra is the Minor under `spec:` below.

- **Tiers:** The plan table and `plan-index.json` agree. High is 0, 4–12, 17, 19–22, 24, 25, 28. Medium is 18, 26, 27, 29. Low is 1–3, 13–16, 23. The test asserts every tier and lane.
- **Lanes and `dependsOn`:** Lane B is 13–16 and 18, with 13 depending on 3, 18 on 16, 17 on [12, 16] and 19 on [17, 18]. `start` checks `dependsOn` and allows one active task per lane. A test covers each rule.
- **C1:** It now sits after Task 18. The `checkpoint` command requires every task up to that index to be done, so C1 needs Lane A (5–12) and Lane B (13–16, 18) both finished.
- **Review kinds:** `specQuality` is added in `state.mjs`, the schema, the usage text and the progress rendering. `done` requires the tier's reviews and also refuses any recorded review that failed. The tests would fail if any of these rules regressed.
- **Agents, `.gitignore`, `gates.json`:** All three are done.
  - The agents have the fix-diff re-review, the combined mode, and "decisions 1–15" replaced.
  - `.worktrees/` is ignored.
  - `gates.json` has the G0 extension with Einar's words and the date.
- **Plan:** The execution protocol, the lanes and tiers section, the checkpoint report ("Lanes and merges") and the execution-order diagram are updated.

Findings:

1. **[Major] spec: `docs/plans/2026-11-01-m0-m1.md:1043`**
   - Under Phase 2 the plan still says "Runs after Phase 1, not alongside it (execution is sequential; see "Execution order")".
   - This contradicts the new Lane B, where 13–16 start with Task 5 and run alongside Phase 1. The implementer reads exactly this line in Task 13's phase header.
   - Suggested change: "Runs in Lane B, alongside Phase 1 from Task 5 on (see "Execution order")".

2. **[Minor] spec: `docs/plans/2026-11-01-m0-m1.md:1616`**
   - The Claude Code Projects paragraph still says "M0–M1's sequential order".
   - Suggested change: say "ordered, gated" or "lane-ordered".

3. **[Minor] spec: `docs/execution/environment.md`, `docs/execution/state.json`, `docs/execution/progress.md`**
   - Three extras beyond the listed deliverables: the environment.md section on the agent-diff approval, the Task 4 acceptance note in `state.json`, and the regenerated `progress.md`.
   - All three are consistent and harmless, but they are not in the task list.

4. **[Minor] quality: `tools/harness/plan-index.json`, `tools/harness/__tests__/state.test.mjs:73-77`**
   - The `sensitive` field is no longer read by `state.mjs`, because the tier replaces it. The test still asserts it, and it duplicates the tier.
   - Suggested change: drop it, or derive and assert it from the tier, so the two cannot drift.

5. **[Minor] quality: `tools/harness/__tests__/state.test.mjs`, test "start refuses while any dependency is not done"**
   - It proves only that an unfinished Task 16 blocks Task 17, with 12 done.
   - It never shows that an unfinished 12 blocks 17, which is the other half of "waits for both".
   - Suggested change: add the mirror case with 16 done and 12 not done.

6. **[Minor] quality: `tools/harness/state.mjs` (`cmdStart`)**
   - An open blocker on any task stops every start, including one in the other lane. This is safe, and arguably intended, because the controller stops anyway.
   - If it is intended, say so in a comment, so a future reader does not take it for a lane bug.

7. **[Minor] quality: `tools/harness/state.mjs` (`cmdDone`)**
   - The refusal for a non-tier review that failed reads "the failed security review to pass". That is understandable but awkward.
   - Suggested change: "a passing security review (recorded as failed)".

None of the suggestions touches security-relevant code. The agent files are `.claude/**` and need Einar's approval of an exact diff, but I suggest no change there.

Commands run: `node --test "tools/harness/__tests__/*.test.mjs"`, `node tools/harness/state.mjs show`, a node one-liner comparing the `plan-index.json` and `state.json` task order, `git diff cf8ecc3..b65d615`, `grep`, `git status --porcelain`.

---

## Controller ruling

**Recorded as FAIL.** The first line says PASS, but finding 1 is rated Major, and under the plan's rules a review passes only when it has no open Critical or Major finding. The controller does not lower a rating.

The round 2 fix covers the Major (1) and Minors 2, 5, 6 and 7, which are in the same files. Minor 3 is accepted: these are the controller's own records of the approvals. Minor 4 is accepted: `sensitive` mirrors the plan's "Security-sensitive tasks" list, which the security look checks against the tiers.
