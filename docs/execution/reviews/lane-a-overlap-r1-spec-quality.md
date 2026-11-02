PASS

I found no guard weakened beyond what Einar's ruling allows. I ran `node --test "tools/harness/__tests__/*.test.mjs"` (30 pass, 0 fail) and read `git show a7a4502`. `git status --porcelain` is unchanged.

The change does what the ruling says.
- **Lane A overlap:** `ready()` in `tools/harness/state.mjs` accepts an `in_review` dependency only when the starting task is Lane A and the dependency is Lane A too.
- **Task 17 on 16:** a Lane A task with a Lane B dependency in review is still refused. The existing test "Task 17 waits for both 12 and 16" covers it (16 `in_review` gives a refusal naming Task 16).
- **Lane B start:** it still uses the full `ACTIVE` set (`in_progress`, `in_review`, `blocked`), so `in_review` counts as busy there.
- **Lane A busy:** only `in_progress` and `blocked` count. A Lane A start after an `in_review` Lane A task works.
- **Unchanged guards:** an open blocker anywhere still refuses every start, and the checkpoint check is untouched. The "already <status>" check also stays. An unknown dependency id can't crash `ready()`, because the `&&` short-circuits before `planIndex[-1]` is read.
- **`done`:** it now requires every `dependsOn` task to be `done`. This is stricter than before. Existing `done` tests that lacked done dependencies were correctly given `markDone` setup, and the security-review-older-than-commit test still holds.
- **Fail check:** the new tests fail against the old `state.mjs` (the controller reported 2 failing).

Findings:
- [Minor] quality: `tools/harness/__tests__/state.test.mjs:213-233`: the "at most one Lane A task in_progress" assertions cannot isolate the busy rule. Task 7 or Task 8 is also the unfinished dependency of the task being started, so the dependency check refuses it too and `/Task 7/` or `/Task 8/` matches either way. Deleting the Lane A busy check wouldn't fail these tests. The lane-busy rule is probably redundant for sequential Lane A tasks, so this is robustness only. Suggested change: use a `planIndex` fixture (like `twoLaneIndex`) with two independent Lane A tasks, and assert that starting the second is refused while the first is `in_progress` or `blocked` and allowed when it is `in_review`.
- [Minor] quality: `tools/harness/state.mjs:8-11`: the header comment still says "start: every task in dependsOn done" on line 8, which now contradicts the Lane A overlap note below it. Suggested change: reword line 8 to "start (Lane B): …".
- [Minor] quality: `tools/harness/state.mjs:283`: the refusal text for Lane A reads "not done or in review", but the actual rule is "not done, and not a Lane A task in review". It's harmless. Optionally say "(Lane A in_review allowed)".
- [Minor] quality: `tools/harness/__tests__/state.test.mjs:213`: no test starts two Lane A tasks in a row with both predecessors `in_review` (7 and 8 `in_review`, then start 9). The code allows it, and nothing says whether the ruling means that. Add an assertion that documents the intended behaviour.

Nothing is Major or Critical. No spec findings: no missing or extra files, and the change is confined to `state.mjs` and its tests.
