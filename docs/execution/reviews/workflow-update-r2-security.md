# Phase 1 workflow update: scoped security review, round 2 (fix diff)

- Reviewer: fresh `cms-security-reviewer` (Opus), fix round, 2026-11-02
- Fix diff: f302679
- The reviewer's report, verbatim:

---

PASS
No full re-review needed. The fix is small, and I read all of the current `state.mjs`, not just the hunks.

This is the fix round 2 security review of commit f302679. All of my round 1 findings are resolved: the Major F1 and the three Minors. The fix adds nothing Critical or Major. I have three new Minors below.

**What I ran** (all read-only on the repository):
- `git show f302679`, and a full read of `tools/harness/state.mjs`.
- A node dump of `plan-index.json` (tier, lane, `sensitive`, `dependsOn`, `checkpointAfter`) and of `state.json` checkpoints.
- `node --test "tools/harness/__tests__/*.test.mjs"`: 26 tests, 26 pass, 0 fail.
- `node tools/harness/state.mjs show`: loads fine, C0 reported.
- A run of `state.mjs` against a copy of the real `state.json`, `gates.json`, `state.schema.json` and `plan-index.json` (`HARNESS_ROOT=<scratchpad>/h`).

**Clean-status rule:** `git status --porcelain` shows three untracked files under `docs/execution/reviews/`: `workflow-update-r1-security.md`, `workflow-update-r1-spec-quality.md` and a new `workflow-update-r2-spec-quality.md`. I created none of them. The new one looks like the controller's saved parallel review; please confirm, so this review isn't void.

## Your specific questions

**Can `atCommits` be bypassed?** Not through the harness.
- `cmdReview` records `atCommits: commits.length` (`state.mjs:298`). `cmdDone` refuses when `security.atCommits ?? -1` is less than `commits.length` (`:345-348`).
- A review recorded before `atCommits` existed counts as -1, so it is refused (fails closed).
- Recording the same hash again does not change the count (`:286`). Recording one commit under both a short and a long hash adds to the count, which is stricter, not looser.
- The check runs whenever any security review exists, whatever the tier, so a low-tier task that had a security review added is covered too.
- Scratch run on the real state:
  - commit `aaaaaaa`, security pass, then commit `bbbbbbb`, spec pass and quality pass.
  - `done 5` was refused: "needs: a security review of the latest commit (the security review is older than the latest commit)".
  - After a new security pass (round 2), `done 5` succeeded.
- What is left (Minor M1 below): the guarantee holds only if the controller records every fix commit with `state.mjs commit`. The harness never looks at git.

**Does the checkpoint check fail closed?** Yes (`state.mjs:268-272`).
- It looks at every earlier entry in `plan-index` that has a `checkpointAfter` whose `approvedByEinar` is not true.
- The schema makes `approvedByEinar` a required boolean. A `checkpointAfter` naming a checkpoint that is not in `state.checkpoints` throws a TypeError: exit 70, nothing saved.
- Running `checkpoint C<n>` again resets `approvedByEinar` to false.
- It does not require `status: "reported"` alongside `approvedByEinar: true`. Approval is a hand edit by the controller anyway, so this is only a cosmetic gap (part of M2).

**Does it break legitimate starts of Task 5 and Task 13?** No. On the copy of the real state (C0 `approvedByEinar: true`, C1 pending):

| Command | Result |
|---|---|
| `start 5` | "Task 5 started" |
| `start 13` | "Task 13 started" |
| `start 18` | refused only on its dependency 16 |
| `start 17` | refused on 12 and 16 |

The order in `plan-index` is …16, 18 (C1), 17…. So 17 and later are held by C1, while 13–16 and 18 come only after C0. The new test `start refuses a task placed after a checkpoint Einar has not approved` covers 17 being refused until C1 is approved.

## Round 1 findings

- **F1 [Major]: resolved.**
  - Plan line 98 now says "Every fix commit on a task whose tier requires a security review gets a security re-review of its diff, whichever review found the issue (a quality fix included)".
  - Step 3 (line 97) now has the controller check each low-tier diff and each fix diff against the checklist subjects.
  - The harness enforces the high and medium cases through `atCommits` (above). The test `done refuses when a security review is older than the latest commit` can fail, and it asserts `atCommits` = 2.
  - Done without a `.claude` change. The low-tier part rests on the controller's diff check, which the plan now states. See M2.
- **F2 [Minor]: resolved.** See the checkpoint check above. Plan line 108 now says Task 17 comes after C1.
- **F3 [Minor]: resolved.**
  - `load()` refuses `sensitive` with tier `low` and refuses an unknown tier (`state.mjs:141-144`). It runs on every command, including `show`, and a test covers it.
  - The controller's per-task diff check now covers `tools/harness/plan-index.json` (plan line 76), which catches a task diff that changes `sensitive` and `tier` together.
- **Hash Minor: resolved as documentation.** `docs/execution/environment.md:121` now records the format (`shasum -a 256` of a `diff -u --label …` patch, files in the order spec, security, quality) and says byte-identity was checked with `cmp`. I cannot rebuild the patch: the controller's scratchpad is not available to me.

## Checklist

1. not applicable: no SQL or functions in the diff.
2. not applicable: no schemas or exposure changes.
3. not applicable: no grants.
4. not applicable: no tables or policies.
5. not applicable: no tenant tables.
6. not applicable: no functions.
7. not applicable: no `worker_*` or `admin_*` functions.
8. not applicable: no commit path.
9. not applicable: no withdrawal logic.
10. not applicable: no secrets. The diff contains a sha256 of a patch and no keys.
11. not applicable: no markers.
12. not applicable: no editor text.
13. pass: I found no contradiction with the spec. The plan edits (Phase 2 header, Projects wording, lanes and C1) agree with Einar's 2026-11-02 authorization recorded in `gates.json` ("Phase 1 through checkpoint C1 … Lane B Tasks 13–16 and 18 … Stop at C1 and wait").
14. pass: `git show --stat f302679` lists no `.claude/**` path. The five changed files are `docs/execution/environment.md`, `docs/execution/state.schema.json`, `docs/plans/2026-11-01-m0-m1.md`, `tools/harness/__tests__/state.test.mjs` and `tools/harness/state.mjs`. No permission or sandbox setting changed.

## Further findings

- **[Minor] M1, `/Users/einarzoega/litljomi-cms/tools/harness/state.mjs:298`, `:345-348`:** `atCommits` is a count of the commits the controller has recorded, not the hash of the reviewed commit.
  - A fix commit the controller never records, or a security review recorded after a later commit without covering it, still passes `done`.
  - This is defence in depth on top of the controller's own diligence, and there is no exposure today.
  - Suggestion: record the HEAD hash the reviewer saw and compare it with the last entry of `commits`, or have `done` compare against `git rev-list`.
- **[Minor] M2, `/Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md:97`:** the list of security-checklist subjects for low-tier diffs reads as complete, but it is narrower than the 14 items.
  - It does not name editor text about removal or caches (item 12), or tenant derivation in TypeScript or server code that calls `api` (item 6).
  - Task 23 (low tier: autosave and the generated form) is the one most likely to touch these.
  - Suggestion: say "anything the 14-item security checklist covers, including …" to match the wording of step 5.
  - Also, defence in depth: `start` could require `status === 'reported'` together with `approvedByEinar`.
- **[Minor] M3, `/Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md:108`:** the controller merges each Lane B task into `m1/phase-1` after its reviews, and may regenerate the lockfile.
  - No rule says a merge-conflict resolution, or a lockfile change beyond the reviewed `package.json`, goes back to review.
  - Task 18 (webhook signing and markers, security-sensitive) goes through this merge.
  - This comes from the round 1 lane design, not this fix, and there is no exposure today.
  - Suggestion: a merge with manual conflict resolution in security-relevant files gets the same fix-diff security re-review.

**Files relevant to this review:**
- `/Users/einarzoega/litljomi-cms/tools/harness/state.mjs`
- `/Users/einarzoega/litljomi-cms/tools/harness/__tests__/state.test.mjs`
- `/Users/einarzoega/litljomi-cms/tools/harness/plan-index.json`
- `/Users/einarzoega/litljomi-cms/docs/execution/state.schema.json`
- `/Users/einarzoega/litljomi-cms/docs/execution/state.json`
- `/Users/einarzoega/litljomi-cms/docs/execution/environment.md`
- `/Users/einarzoega/litljomi-cms/docs/plans/2026-11-01-m0-m1.md`

I modified nothing in the repository. The only files I wrote were the scratch copies in `/private/tmp/claude-501/-Users-einarzoega-litljomi-cms/ddfa5d15-9ae2-4f7b-af8c-c003ef820ac4/scratchpad/h`.

---

## Controller ruling

PASS accepted. The untracked report files the reviewer saw are the controller's saved reports.

M1, M2 and M3 are deferred to checkpoint C1 in `deferred-minors.md`. Until the plan wording changes, the controller follows M2 and M3 in practice:
- it checks every low-tier diff and every fix diff against all 14 checklist items;
- it sends a Lane B merge with manual conflict resolution in security-relevant files, or a lockfile change beyond the reviewed `package.json` files, to a security review of that diff;
- it records every fix commit with `state.mjs commit`, which M1 relies on.
