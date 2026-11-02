# Phase 1 workflow update: scoped security review, round 1

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02; scoped to the `.claude/agents` changes (b65d615) and the harness changes (71e727c)
- The reviewer's report, verbatim:

---

FAIL

This was a scoped security review of commits b65d615 (`.claude/agents/**`) and 71e727c (`tools/harness/state.mjs`, `plan-index.json`, `docs/execution/state.schema.json`, tests). It fails on one Major finding (F1): fix rounds leave a path where a security-relevant change on a security-sensitive task can be marked done without a security reviewer seeing it. Everything else checks out.

Commands run: `git show --stat b65d615 71e727c`, `git show b65d615`, `git show 71e727c -- <harness files>`, `git diff --stat b65d615^ HEAD -- .claude`, a node script over `plan-index.json` (tier against sensitive, dependsOn order), and `node --test "tools/harness/__tests__/*.test.mjs"` (23 tests, 23 pass, 0 fail). I modified nothing. `git status --porcelain` now shows `?? docs/execution/reviews/workflow-update-r1-spec-quality.md` (dated Nov 2 03:37). I did not create it; it looks like the controller saving the parallel review. Please confirm it is yours, so this review isn't voided by the clean-status rule.

Checklist
1–13. not applicable: no migrations, SQL, app code, secrets, markers or editor text in either commit.
14. pass: the only `.claude` changes in either commit are in b65d615 (`git diff --stat b65d615^ HEAD -- .claude`): `cms-quality-reviewer.md` (+15/−1), `cms-security-reviewer.md` (+6/−2), `cms-spec-reviewer.md` (+4). 71e727c touches no `.claude` path. No settings, hooks, skills or sandbox file changed. The `tools:` and `model:` lines are unchanged (Read, Grep, Glob, Bash; security on opus, the other two on sonnet). Only the descriptions and body text changed. Einar's approval is recorded in `/Users/einarzoega/litljomi-cms/docs/execution/environment.md` ("Approve exact diff", 2026-11-02).
   - [Minor] The recorded sha256 `f9cdce7b…` does not match `git diff b65d615^ b65d615 -- .claude/agents | shasum -a 256` (`c2f57c11…`). The hashed patch format isn't recorded, so I could not check byte-identity. The diff content matches the described change. Suggestion: record the exact command used to compute the hash.

Your questions

A. The `.claude` diff
- Only the three reviewer definitions changed. No permission, tool, sandbox or setting was widened.
- All three files still say they are read-only (the "Limits" sections are unchanged).
- The security reviewer stays independent: `/Users/einarzoega/litljomi-cms/.claude/agents/cms-security-reviewer.md:42` ("you do not receive the other reviews or the implementer's summary"). In fix rounds it gets only its own earlier findings, the fix diff and the task text (line 50).
- It can still demand a full re-review (line 50: "Ask for a full re-review … the controller then runs one"). That matches plan line 98.
- The fix-diff rule does leave an escape path (F1).

B. `state.mjs`
- No security-sensitive task has a tier that skips security review. The plan's sensitive list (0, 4–12, 17–22, 24–28) is all high or medium in `plan-index.json`. My script printed no "SENSITIVE LOW" line. Low is only 1, 2, 3, 13–16 and 23, none of them sensitive. Task 29 (not sensitive) is medium, so it is stricter than before.
- `done` (`state.mjs:319-333`) needs a passing review of every kind the tier requires (`:327`). Any other recorded review that is not `pass` also blocks (`:331`).
- A recorded failure cannot be bypassed: it is cleared only by recording a pass of the same kind (`:286` overwrites). An unknown or missing tier makes `TIER_REVIEWS[undefined]` throw, which exits 70 without saving, so it fails closed.
- `start` still refuses when any task has an open blocker (`:254`) and when a required gate is not `approved` in `gates.json` (`:263`). It now also refuses unmet `dependsOn` (`:257`; an unknown id counts as not done) and a busy lane (`:259`; `blocked` counts as active).
- Task status values are limited by the schema enum (`state.schema.json:42`, `additionalProperties: false`), so lane and dependsOn checks cannot be dodged with an invented status.

C. Gates and controller-only writes
- G0–G7 handling is unchanged. Both commits are controller commits.
- The only file under `docs/execution/` that changed is `environment.md` (approval record), plus state and progress written through the harness. Nothing gives subagents write access to `docs/execution/`.

Findings

[Major] F1. Fix rounds can carry security-relevant changes past the security reviewer.
- `/Users/einarzoega/litljomi-cms/.claude/agents/cms-quality-reviewer.md:14`, `:24`, `:42`
- `/Users/einarzoega/litljomi-cms/tools/harness/state.mjs:286`, `:327`
- `/Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md:98`

How it happens:
- On a high-tier task, quality runs after spec and security pass. A quality fix round re-runs only "the reviews of that round" (plan:98), so only quality checks the fix diff.
- The quality reviewer must flag its own *suggestions* that touch security code (line 14). Its fix-round and combined-mode text (lines 24, 42) does not tell it to flag a fix diff, or a low-tier diff, that touches the security boundary. Combined mode explicitly says "Security stays the security reviewer's scope."
- The harness does not tie a review to a commit. `cmdReview` stores only status, round, report and timestamp; commits have no timestamp. So `done` accepts a security pass recorded before later fix commits.
- Plan:132 ("every round") does not settle whether a quality-only round counts as a round for security. That is a plan ambiguity, not something I can resolve.

Why Major: I was unsure between Minor and Major and picked the higher, as the rules require. It is a concrete path by which a change on a security-sensitive task reaches `done` with no security reviewer having seen it, and neither the agent text nor `state.mjs` closes it. It existed before this change, but the narrower fix-diff reviews keep it open.

Suggested direction, for the controller and Einar (not done by me; any agent-text change needs Einar's approval of the exact diff):
- The quality reviewer, in both fix-round and combined mode, flags any diff that touches anything on the checklist, and that triggers a security round.
- `cmdReview` records the reviewed HEAD commit, and `done` refuses when a commit was recorded after the latest security pass of a tier that requires one.

[Minor] F2. The harness lets Task 17 start before C1 is reported or approved.
- `/Users/einarzoega/litljomi-cms/tools/harness/plan-index.json`: Task 17 has `dependsOn: [12, 16]`. C1 is after Task 18 (lane B).
- The test at `/Users/einarzoega/litljomi-cms/tools/harness/__tests__/state.test.mjs:204` asserts that `start 17` succeeds while 18 is pending.
- Plan line 1603 puts C1 ("both lanes done") before Phase 3, the checkpoint rule says the controller "waits for his go-ahead before continuing", and Einar's authorization runs "through C1". `state.mjs` never checks checkpoint status in `start`, so staying within that is left entirely to the controller.
- The gap is not new: before, Task 13 could also start after 12 with no C1 check. It is not a G0–G7 gate, hence Minor.
- Suggestion: `start` refuses a task placed after a checkpoint whose `approvedByEinar` is false. Separately, the plan's "Task 17 waits for both 12 and 16" against "C1 before Phase 3" should be stated unambiguously.

[Minor] F3. Nothing enforces that a security-sensitive task has a high or medium tier.
- `/Users/einarzoega/litljomi-cms/tools/harness/state.mjs:319-333`: `sensitive` no longer affects `done`.
- The only guard is the hard-coded tier list in `state.test.mjs`.
- `plan-index.json` sits outside `docs/execution/`, so the controller's diff check for `docs/execution/` would not catch a task diff that lowers a tier. The same was true of `sensitive` before this change.
- Suggestion: `load()` refuses `sensitive: true` with `tier: "low"`, and the per-task diff check also covers `tools/harness/plan-index.json`.

---

## Controller ruling

FAIL accepted, on F1 (Major). The untracked file the reviewer saw is the controller's saved spec-and-quality report, so this review stands.

Round 2 fix, without a `.claude` change:
- **F1, plan:** every fix commit on a task whose tier requires a security review gets a security re-review of its diff, whichever review found the issue. For a low-tier task, the controller checks each diff against the checklist subjects and adds a security review when one is touched.
- **F1, `state.mjs`:** each review records how many of the task's commits it covered. `done` refuses when a security review is older than the latest commit.
- **F2:** `start` refuses a task placed after a checkpoint Einar has not approved.
- **F3:** `load()` refuses a security-sensitive task with tier `low`, and the controller's per-task diff check covers `tools/harness/plan-index.json`.
- **Hash Minor:** the command that produced the hash is recorded in `environment.md`.
