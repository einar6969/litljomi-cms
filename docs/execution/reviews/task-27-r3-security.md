# Task 27, round 3 (fix diff c5c478e..7147edc): security review (cms-security-reviewer, Opus)

**FAIL**

Read files and git show/diff/grep/check-ignore only; no builds, servers or installs. `git status --porcelain` in LABAK empty before and after.

Is any Critical or Major left? Yes, two Majors. Both come from the planned unsandboxed `npm run test:visual` run; neither is visible to the new route-based check. The round-2 Major is only partly fixed: real HTTP requests to non-loopback hosts are aborted, but the run can still open connections to non-loopback hosts and fetch data.

## Round-2 findings
- [Major, partly resolved] Google Fonts fetch: `e2e/visual/shots.pw.ts:31-45` `context.route` with `!LOOPBACK.test(url.href)` → `route.abort()`, installed before `newPage()`/`goto()` (lines 66-68) in both projects; the anchored regex `^http://(127\.0\.0\.1|localhost):\d+(/|$)` aborts `http://127.0.0.1:3200@evil.com/` and `http://localhost:3200.evil.com`. Stylesheet and font-file requests are aborted; the preconnect hints still connect (Major A).
- [Minor, resolved] `e2e/harness.ts:28-38` `childEnv()` allowlist (PATH, HOME, USER, SHELL, LANG, LC_ALL, TMPDIR/TEMP/TMP, NODE_PATH, NODE_OPTIONS, SystemRoot + FIXTURE_ENV, `NODE_ENV=production`, `NEXT_TELEMETRY_DISABLED=1`); no tokens, keys or proxy variables reach Next. Still full env (harmless): the `playwright test` process, the `npm run serve:fixture` webServer, the in-process fixture server (reads no secrets).
- [Minor, unchanged] `main` trusts whatever answers on 127.0.0.1:3202; route handlers run only for the first URL of a redirect (`playwright-core/types/types.d.ts:4441`), so a 3202 server redirecting externally would be followed. The hub has no redirects.

## Checklist
1-8 n/a. 9 n/a. 10 pass (no credential; telemetry off; child env allowlisted, `harness.ts:29,37`). 11 n/a. 12 n/a. 13 pass. 14 pass.

## Findings
- **[Major A]** `src/app/layout.tsx:19-20` (main the same) via `shots.pw.ts:31-45`: `<link rel="preconnect">` to fonts.googleapis.com and fonts.gstatic.com are speculative socket preconnects in Chromium (Blink PreconnectHelper → NetworkContext::PreconnectSockets), not URL requests, so neither CDP Fetch nor `context.route`/`page.route` sees them. Every page load resolves both hosts and opens TCP/TLS connections, breaking "loopback only", undetectable by the unexpected-host check (lines 73-74). Not confirmed by running (read-only); Major because unsure. Fix: launch Chromium with `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost` (`use.launchOptions.args`), keep the route for detection.
- **[Major B]** npm's update check: `package.json:18` (`test:visual`) and `e2e/visual/playwright.config.ts:31` (`npm run serve:fixture`) go through npm 10.9.8, whose update notifier (`…/npm/lib/cli/update-notifier.js:84-118`, from `lib/cli/entry.js:70-72`) fetches from registry.npmjs.org at most weekly, skipped only with `update-notifier` false or in CI; `~/.npm/_update-notifier-last-checked` mtime Oct 27 10:52, so from Nov 3 10:52 an unsandboxed run fetches from the registry, breaking "download nothing". Present in round 2 too, missed then. Fix: `npm_config_update_notifier=false` / `--no-update-notifier`, or call `node_modules/.bin/playwright` and `node e2e/serve.ts` directly.
- [Minor] `shots.pw.ts:31-45` covers HTTP(S) only; WebSockets, service-worker traffic and redirect hops not recorded. No current exposure (no serviceWorker/WebSocket/EventSource in `src`, no HMR on `next start`). `serviceWorkers: 'block'` for depth.
- [Minor] The run writes outside the repository: `~/.npm/_logs/*-debug-0.log`, `~/.npm/_update-notifier-last-checked`, a temporary Chromium profile in TMPDIR.

## Other checks (pass)
- Chromium background traffic: Playwright 1.64.1 launches with `--disable-background-networking`, `--disable-component-update`, `--disable-client-side-phishing-detection`, `--disable-sync`, `--no-service-autorun`, `--disable-default-apps`, `--disable-field-trial-config`, `--metrics-recording-only`, and disables `NetworkTimeServiceQuerying`, `AimEnabled` (`playwright-core/lib/coreBundle.js:36200-36255`); no further known traffic, not provable without a run; the resolver rule would close that gap.
- next build/start: native SWC installed (no wasm download); no build-time Google Fonts inlining in Next 16 (plain `<link>`, not `next/font`); telemetry off; static pages and image optimisation fetch only 127.0.0.1:3201; external URLs in `src` only `<a href>` and `siteUrl`; `next/link` prefetches internal routes only.
- Writes inside the repo only gitignored: `.next` (`.gitignore:17`), `/e2e/visual/shots/` (49), `/test-results/` (50), `next-env.d.ts` (42), `*.tsbuildinfo` (41); `tsconfig.json` already includes the `.next/types` globs; `generate.ts` not run.
- Rest of the fix diff: `FIXTURE_PORT`/`MEDIA_PREFIX` imports; nothing new.
