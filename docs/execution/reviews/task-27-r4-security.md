# Task 27, round 4 (fix diff 7147edc..2f8bb63): security review (cms-security-reviewer, Opus)

PASS

Read files and ran git diff/log/status, grep, sed and scutil only; nothing built, installed or started; `git status --porcelain` empty at the end. No Critical or Major remains; both round-3 Majors resolved; the diff touches only `.npmrc` (new) and `e2e/visual/playwright.config.ts`.

## Round-3 findings
- Major A (Google Fonts preconnect): resolved. `playwright.config.ts:38-43` top-level `use.launchOptions.args` `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost`. The flag reaches the browser (`playwright/lib/index.js:191,196-199` worker-scoped `launchOptions` spread into launch options; the two projects (`:45-46`) set only `baseURL`; `playwright-core/lib/coreBundle.js:44785` user args after defaults; Playwright adds its own `--host-resolver-rules` only for a SOCKS proxy (`:44774`); no proxy or `clientCertificates`). Syntax right for Chromium 156.0.8078.4 / headless shell 1248 (same shape Playwright emits; argv without shell). `MAP *` matches host strings incl. IP literals before any lookup: preconnect, DNS prefetch, redirect hops, WebSocket, background requests to non-loopback fail NOTFOUND. localhost excluded → built-in handling (127.0.0.1 or ::1); `[::1]` literal mapped to NOTFOUND (harmless); run uses 127.0.0.1 only (`:27-28`). DoH: rule applied before the resolver; secure DNS not set up in headless shell. System proxy: `scutil --proxy` empty. `serviceWorkers: 'block'` (`:39`) valid (`index.js:263`).
- Major B (npm update notifier): resolved. `.npmrc:2` `update-notifier=false`, tracked, not ignored; npm reads project config from the package root. webServer `node e2e/serve.ts` (`:50`): no npm child. No other npm/npx: `serve.ts` imports `startSite`; `harness.ts:47` spawns `process.execPath` with `next`; second webServer `node -e`; `test:visual` (`package.json:18`) is `playwright test`. `run-script` triggers no audit/funding; remaining: debug log under `~/.npm/_logs` (accepted).
- Minors from round 3: WebSocket/service-worker/redirect gap closed by the resolver rule and blocked service workers; 3202 external redirect cannot resolve; `~/.npm/_update-notifier-last-checked` write gone; `~/.npm/_logs` and the Chromium temp profile remain (accepted).

## Checklist
1-9 n/a. 10 pass (no secret; `.npmrc` only `update-notifier`; harness env allowlist unchanged). 11-12 n/a. 13 pass. 14 pass.

## `.npmrc` effect on other LABAK workflows
None harmful: only the version-check message; no change to resolution, lockfile, `npm ci`, registry or auth; Vercel CI already skips the notifier. Separately, the existing `file:/Users/einarzoega/litljomi-cms/...` dependencies (`package.json:21-22`) would break a Vercel build on their own (predates this diff; Task 28).

## Further findings
- [Minor] `e2e/serve.ts:2`: comment still says the server is used via `npm run serve:fixture`.
- [Minor] Residual, not provable without a run: WebRTC/STUN sockets do not use the mapped resolver (no WebRTC in `src`); the run's Node processes are not covered by the Chromium rule (checked in round 3, unchanged).
