# Task 21, spec review, round 3 (fix diff, Sonnet)

Verbatim report.

PASS

No findings. Commands run: `git diff 78bed55..c337b48` (and `--stat`), `pnpm test`, `pnpm lint`, `pnpm typecheck`, `git status --porcelain`.

Results:
- `pnpm test`: 42 files and 805 tests passed, with no scaling-test failure, so no rerun was needed. `pnpm lint` and `pnpm typecheck` both exit 0. I ran no database command. The status check before the checks showed no tracked-file changes from me.
- Scope: the diff touches only `packages/sdk/src/parse-markers.ts` and `packages/sdk/src/__tests__/parse-markers.test.ts`.
- Interfaces: no exported signature changed. The new `NextAt` type and `nextAt` helper are module-private, and `commentEnd` is internal. `scan` still has the same shape.
- Behaviour: `nextAt` re-searches only when the remembered hit lies before `from`, or when none is remembered yet. The `from` passed in is `lt+4`, which never decreases. A remembered hit at or after `from` is therefore still the first occurrence at or after `from`, so results are identical to a fresh `indexOf`. The `<!-->` and `<!--->` special cases, the earlier-of-`-->`/`--!>` choice and the return of -1 are unchanged. Only the `-->` search is newly cached; the `--!>` cache already existed.
- Deferred Minors and Task 21 text: I saw nothing else in the diff, so both are untouched. The decision 34–35 behaviour (inconclusive when the scan is incomplete) is unchanged.
- New tests: 14 cases at four sizes up to 2 MB, each timed as best of three runs. Each size must finish under 1.5 s, and 4× the input must take under 10× the time, with a 20 ms floor. The cases include the exact round-2 pattern (`<!--x--!>` with no `-->`, and the mirror case). By reasoning, the old code would fail them. It rescans the whole page for `-->` once per comment, so the ratio check or the absolute bound trips at the 125 KB to 500 KB sizes. I did not run the old code, because the tree is read-only.
- Weakness (not rated as a finding): the other constructs (doctypes, end tags and so on) probably did not fail before the fix. They are regression guards for linearity, which is what the task asked for.
