# Task 32, round 2 (fix diff 4e0cf58..24cc76e): code-quality review (cms-quality-reviewer, Sonnet)

PASS

Read the diff and grepped `publish.spec.ts` for leftover and unused identifiers; tests not run (relied on the controller's 30/30).

The move kept behaviour: `getJson`, `demoPointer`, `newDemoEvent`, `ensureDemoSite` identical to the removed code apart from the rename and exports; every import left in `publish.spec.ts` is used (`DEMO_DELIVERY_BASE_URL`, `DEMO_SITE_URL`, `requireLoopback`, `randomBytes`, `TITLE`, `SAVED`, `getJson`).

Timeouts and idempotency sound: the setup's 15-minute limit covers the worst case (event creation bounded by the 10 s autosave check and default timeouts, then the 120 s pointer poll and 600 s site poll, ~12–13 min); a second call finds the pointer, skips publishing and only checks the site (cheap in `publish.spec.ts`); a stale pointer with no site fails after 600 s with a message pointing at the demo-site webServer output; `demo-release` depends on `editor-session`, `chromium` on both, so a failed setup skips the specs.

## Minors
- [Minor] `apps/cms/e2e/publish.spec.ts:22`: the `Title` label is duplicated in `support/demo-release.ts`; export `TITLE` and import it.
- [Minor] `publish.spec.ts:13`: aliased imports (`demoPointer as pointer`, `newDemoEvent as newEvent`) hide their origin.
- [Minor] `support/demo-release.ts` `ensureDemoSite`: the 120 s and 600 s poll timeouts are inline literals; name them.
