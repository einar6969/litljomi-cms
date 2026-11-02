# Task 32, round 2 (fix diff 4e0cf58..24cc76e): security review (cms-security-reviewer, Opus)

PASS

One commit (24cc76e, "test(cms): e2e passes from a freshly reset database"), five files, all test infrastructure: `apps/cms/e2e/demo-release.setup.ts` (new), `apps/cms/e2e/support/demo-release.ts` (new), `apps/cms/e2e/publish.spec.ts`, `apps/cms/playwright.config.ts`, `apps/cms/e2e/demo-site-server.ts` (comments and one error string). No database, app, privileged or `.claude/**` changes. Round 1 had no Critical or Major findings; reviewed the fix for anything new; no full re-review requested.

## Unsandboxed e2e condition (loopback and repository only)
- Only loopback: `getJson` (`support/demo-release.ts:26`) via `requireLoopback`, `redirect: 'error'`, `cache: 'no-store'`; `demoPointer` (line 31) reads `http://127.0.0.1:54321/storage/v1/object/public/delivery/demo/current.json`; `ensureDemoSite` (line 59) polls `http://localhost:3101/events`; browser navigation via `createEvent` (`/t/demo`, CMS on 3100). `isLoopbackUrl` (`support/local.ts:20-30`) accepts only http(s) on localhost, 127.0.0.1, [::1]. No other host, URL or `fetch`; the only other fetch in `apps/cms/e2e` is `mailpit.ts:10`, guarded.
- Browser guard: `demo-release.setup.ts:6` imports `test` from `./support/test` (`guardLoopback`, `support/test.ts:8-14, 22-26`); the new project uses `devices['Desktop Chrome']`; `chromium` depends on `demo-release`.
- Existing local test values only (`editor_demo` storage state, seeded demo-site constants, fixed labels); nothing downloaded (no package manager, npx, browser install or new spawn; `webServer` list unchanged); writes only `test-results/` (gitignored) and the local stack.
- `tools/checks/__tests__/e2e-loopback.test.ts` still applies (webServer names, env, commands unchanged; new files start no CLI or server; spec/helper files are covered by the runtime guards).

## Checklist
1–9, 11, 12 n/a. 10 pass. 13 n/a. 14 pass (`git diff --stat` only the five files; `git status --porcelain` empty).

## Findings
- [Minor] `support/demo-release.ts:59`: the readiness poll `fetch(requireLoopback(...))` lacks `redirect: 'error'`, so a redirect from the local demo site would be followed outside `requireLoopback`. Not reachable today; the line existed in round-1 `publish.spec.ts:81` and was only moved. Add `redirect: 'error'` for depth.

No builds or writes; stack untouched; relied on the controller's 30/30.
