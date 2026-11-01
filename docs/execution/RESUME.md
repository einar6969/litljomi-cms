# Resuming execution

A new controller session does the following, in order, and relies on nothing from earlier conversations.

1. Read `CLAUDE.md`, `docs/architecture.md` and `docs/plans/2026-11-01-m0-m1.md`.
2. Permission mode: Auto, Accept edits or Manual are permitted; bypass-permissions mode is disabled for this project. No mode authorizes a G1–G7 action: provisioning, pushing, deploying, DNS changes and the LABAK repository each wait for Einar's explicit approval, recorded in `docs/execution/gates.json`.
3. Run `node tools/harness/state.mjs show`.
4. Read the latest file in `docs/execution/checkpoints/` and any open blockers.
5. Continue with the first task in execution order that is not `done`, or report the blocker. A task whose gates are not recorded in `docs/execution/gates.json` waits for Einar.

Connectors and browser tools may be available in the session. That is expected and grants nothing (`CLAUDE.md`, "Approval gates").
