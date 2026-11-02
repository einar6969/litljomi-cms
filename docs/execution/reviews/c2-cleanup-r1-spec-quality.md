# Lane B C2 cleanup, combined spec-and-quality review, round 1 (cms-quality-reviewer)

Diff `d578ef4..6057d03` in `.worktrees/lane-b`. Report as returned by the reviewer:

PASS

Commands: `git diff d578ef4..6057d03`; reads of the cited reports; `pnpm lint` 0; `pnpm typecheck` 0; `pnpm test` 43 files, 843 passed; `git status --porcelain` empty. No database, stack or e2e command; integration and pgTAP results are the implementer's.

Spec: every "Lane B C2 cleanup" row resolved as stated; no interface changed. C1 row (single-row check, entry-points comment); Task 19 `as never` replaced by a typed `projectionIssue`; Task 21 quality row (`assertPortFree`, `killStarted` on SIGINT/SIGTERM/exit, `once` comment, `cms-next.sh` stderr through and exit 1 with a hint); Task 26 row (`--out` documented not changed, revalidate-handler comment shortened, fixture-server resolves `root`, `stop()` awaits exit, duplicated test replaced by a guard); Task 30 security row (comment correction in the pgTAP header, `missingOriginals` bounded-parallel at 8, reference order kept); Task 30 quality row (retitled test asserts the log and restores the spy; `MEDIA_PRIVATE` shared; tests use `STALE_RELEASE_SECONDS`; `exists()` throws on a non-boolean answer, tested; `pointer_deadline` comment; `forbidden` classification unchanged). Behaviour beyond the rows unchanged; the new unit tests can fail.

Findings (all Minor):
- `tests/integration/src/end-to-end-local.test.ts:40-51`: `process.once('SIGINT'/'SIGTERM')` handlers call `process.exit` at module scope in a Vitest worker; fine with the forks pool (default), not under threads.
- `apps/cms/src/privileged/worker/__tests__/build-release.test.ts:~669`: `logged.mockRestore()` skipped when an earlier assertion fails; redundant with a global `restoreAllMocks`, else move to `afterEach`.
- `apps/demo-site/e2e/site.spec.ts:10-11`: module-level `throw` for a missing `x` is a load error, not a test failure (covered by `fixtures.test.ts`); `events.length > 1` no longer asserted here.
- `apps/cms/src/privileged/worker/__tests__/pipeline.integration.test.ts`: `assertPortFree` probes the same address `startFakeSite` binds; a probe/bind race is negligible.
