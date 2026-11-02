# Task 25, quality review, round 1 (cms-quality-reviewer)

Diff `eeaf219..f84b096` in `.worktrees/lane-a-next`. Report as returned by the reviewer:

PASS. No Critical or Major findings, two Minors. `pnpm lint` 0; `pnpm typecheck` 0; `pnpm test` 61 files 1112 passed; no database, stack or e2e (099 and `publish.spec.ts` read, not run).

- [Minor] `status.ts:~72-77`: `default:` repeats `case 'failed'`; fold them, keep the fail-closed comment. Presentation only.
- [Minor] `PublishPanel.tsx:~140`, `status.ts:~47`: the "in progress" state built twice; export the constant or a helper.

No action: `loadPublicationStatus` casts the row to `PublicationStatusRow` (columns next to the type; pgTAP covers the view); "Unpublish" ignores `disabled` (deliberate; needs no draft version).

Design notes: `status.ts` a pure function with explicit check order, thorough tests; `PublishPanel` tests (fake timers) check it keeps "Í birtingu…" until the view shows the new request, stops polling once final, and the failure paths; `request()` shared by both actions; `authOrError` removes duplication; `MAX_NOTIFY_ATTEMPTS` move keeps importers working; e2e code readable, every URL through `requireLoopback`. No suggestion touches the view, the actions, the labels' security meaning or the unsandboxed e2e code.
