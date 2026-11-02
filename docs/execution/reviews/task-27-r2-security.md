# Task 27, round 2 (fix diff 3aa74b2..c5c478e): security review (cms-security-reviewer, Opus)

**FAIL**

Read files and git show/diff/grep only, plus one node comparison of the two lockfiles from `git show` (temp copies in $TMPDIR, deleted). `git status --porcelain` in LABAK empty. The single Major finding is not in the fix code: it comes from the planned unsandboxed `npm run test:visual` run. The two round-1 Minors targeted are resolved; the fix code adds nothing new.

## Round-1 findings
- [Minor, resolved] Fixture-only switches: `next.config.ts:28-33` throws when `VERCEL` is set with a non-empty `CMS_MEDIA_PROTOCOL`, `CMS_MEDIA_PORT` or `CMS_MEDIA_ALLOW_LOCAL_IP` (Vercel sets `VERCEL=1` during builds).
- [Minor, resolved] `remotePatterns` pathname: `next.config.ts:45` `/storage/v1/object/public/media-public/**`; fixture server (`e2e/fixture-server.ts:12,37-39`), `generate.ts:16` and regenerated `releases/1.json` moved to the same path (only 14 `url` and 14 `contentHash` values changed, all on `http://127.0.0.1:3201/storage/v1/object/public/media-public/...`).
- [Minor, unchanged] Turbopack/`outputFileTracingRoot` widening (`next.config.ts:10-22`), untrimmed `CMS_WEBHOOK_SECRETS.split(",")`, replay within 300 s.

## Checklist (items the diff touches)
1-8. n/a. 9. pass: new `src/core/data/news/index.test.ts` checks fail-closed leaving out and `getArticleBySlug`; mocked `@/core/config/cms`, no network; `vitest.config.ts` includes only `src/**/*.test.ts`. 10. pass: no credential added; `e2e-secret-*` fixture-only; `NEXT_TELEMETRY_DISABLED=1` still set. 11. n/a (marker code unchanged; `site.test.ts:43` rename only). 12. n/a. 13. pass. 14. pass (no `.claude/**`).

**Lockfile:** 77 entries removed (react-markdown and its unified/micromark/mdast/hast/vfile tree, incl. `@types/hast`, `@types/mdast`, `@types/unist`); none added; 8 changed only in dev/optional/peer flags (`@types/debug`, `@types/estree`, `@types/ms`, `@types/react`, `csstype`, `debug`, `ms`) plus root `dependencies`; no `version`, `resolved` or `integrity` changed.

**Unsandboxed run:** `test:visual` → `playwright test --config e2e/visual/playwright.config.ts`; `outputDir` `../../test-results` and `e2e/visual/shots/{hub,main}` gitignored (`.gitignore:49-50`, `git check-ignore`); `.next` gitignored. `serve:fixture` → `node e2e/serve.ts` → `startSite()`: fixture server on 127.0.0.1:3201 (GET/HEAD, traversal check, delivery JSON and public/ images only), then `next build` and `next start -p 3200 -H 127.0.0.1` with the local binary; nothing installed or downloaded. `main` webServer: fixed `node -e`, exits 1; with `reuseExistingServer: true` only probes 127.0.0.1:3202. `ARTICLE_SLUG` only a same-origin path.

## Findings
- [Major] `src/app/layout.tsx:19-22` (unchanged; main has the same at `layout.tsx:15-18`), reached through `e2e/visual/shots.pw.ts:39-43`: every page links Google Fonts (`fonts.googleapis.com`, preconnects to `fonts.gstatic.com`); `settle()` waits for `networkidle`, so Chromium fetches CSS and font files from Google on both builds. Under the planned exclusion the run would reach non-loopback hosts and download content, breaking the exclusion's stated condition (loopback only, download nothing). Rated Major (condition the exclusion relies on; higher rating when unsure). Options: (1) abort every non-loopback request in `shots.pw.ts`; (2) Einar's explicit approval for egress to the two hosts; (3) run sandboxed with only those hosts allowed.
- [Minor] `e2e/harness.ts` passes the whole `process.env` to `next build`/`next start`; unsandboxed, the controller's environment reaches the children; allowlist it.
- [Minor] `main` project trusts whatever answers on 127.0.0.1:3202 (loopback, screenshots only).
