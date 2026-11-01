# Resuming execution

A new controller session does the following, in order, and relies on nothing from earlier conversations.

1. Read `CLAUDE.md`, `docs/architecture.md` and `docs/plans/2026-11-01-m0-m1.md`.
2. Run `node tools/harness/integrity.mjs`. On a mismatch, stop and tell Einar.
3. Run `node tools/harness/state.mjs show`.
4. Read the latest file in `docs/execution/checkpoints/` and any open blockers.
5. Confirm the connector audit is still clean.
6. Continue with the first task in execution order that is not `done`, or report the blocker.
