# Task 27, round 1: security review (cms-security-reviewer, Opus)

Scope: LABAK `hub-integration` aec9f95..3aa74b2; CMS lane-a-next ba8defc..10f43bd. Nothing built, installed or started; files read, git diff/show/grep, the existing `.next` output (BUILD_ID 2026-11-02 22:29, the e2e fixture build). `git status --porcelain` empty in both repositories at the end.

**PASS**

## Checklist
1. n/a: no SQL, functions or migrations (CMS diff: `pnpm-lock.yaml`, `tools/cli/package.json`, `tools/cli/src/__tests__/cli.test.ts`).
2. n/a. 3. n/a. 4. n/a. 5. n/a.
6. n/a (no DB functions). Site tenant from `CMS_TENANT`; SDK checks `pointer.tenant`/`bundle.tenant` match (`packages/sdk/src/client.ts` getBundle).
7. n/a. 8. n/a.
9. pass: `getAllArticles` shows only current-bundle entries, drops incomplete ones (`toArticle` → null, fail closed); no fallback or local list (21 Markdown files excluded in tsconfig, not imported).
10. pass: no Supabase credential in the LABAK diff (grep supabase, sb_secret, sb_publishable, eyJ, service_role: nothing); `.env.example` has empty `CMS_WEBHOOK_SECRETS=` and `.invalid` hosts, the only tracked env file; `e2e-secret-old/new` fixture-only; webhook secret read at request time server-side via `cmsEnv`; no `NEXT_PUBLIC_`; nothing in `src` logs; handler bare 500 if secret missing, 401/413 otherwise. `.next/static`: 0 files for createHmac, timingSafeEqual, CMS_WEBHOOK, x-cms-signature, current.json, cms-sdk, tiptap, rich-text/editor; `e2e-secret` nowhere in `.next`. SDK and `@/core/config/cms` imported only by server files; none of 26 "use client" files imports either. Revalidate route (`route.ts:5-8`): signature/timestamp format, ±300 s before body read, 64 KiB cap, constant-time HMAC per secret, empty secrets skipped; matches `apps/demo-site`.
11. pass: markers carry `id`/`contentHash` of the same object that renders the content: `NewsCard.tsx:55`; `ArticleBodySection.tsx:64`; `RelatedArticlesSection.tsx:34` → slot `RelatedArticleCard.tsx:69`; `heim.tsx:16` → slot `NewsPreviewCard.tsx:99`; home marker from the same item `getNewsPreviewArticles` returns. `CmsReleaseMarker` only in root layout `<head>` (diagnostic). No `dangerouslySetInnerHTML`, `<script>`, `next/script` in `src`; `RichText` has no raw-HTML path; no `rich-text/editor` import.
12. n/a.
13. pass: no contradiction. Note: `link:` → npm `file:` by decision 41's amendment, consistent with §9.1 as a local step before Task 28.
14. pass: `git diff --stat -- .claude` empty in both ranges.

## Other checks
- §7.3 build failure: unreachable/non-2xx/bad pointer or bundle → `readJson`/`getBundle` throw; `generateStaticParams` and the root layout await `getBundle`, so `next build` fails instead of deploying empty content. Missing `CMS_DELIVERY_BASE_URL`, `CMS_TENANT`, `CMS_MEDIA_HOST` also fail the build.
- Main untouched: `main` = `origin/main` = aec9f95; no remote `hub-integration`.
- LABAK lockfile: every new `resolved` is registry.npmjs.org with integrity, except the two `file:` links (`"link": true`); linked packages have no install scripts; new `hasInstallScript`: esbuild 0.28.2, fsevents 2.3.3 (optional), dev, via Vitest; only existing version change @types/estree 1.0.8 → 1.0.10; next 16.4.3 and react 19.2.4 unchanged.
- CMS lockfile: exactly 3 added lines (`'@litljomi/module-labak': specifier: workspace:* version: link:../../modules/labak`); nothing from a registry; `modules/labak/package.json` no scripts.

## Findings (all Minor)
- [Minor] `next.config.ts:28-29,42`: `CMS_MEDIA_PROTOCOL=http`, `CMS_MEDIA_PORT`, `CMS_MEDIA_ALLOW_LOCAL_IP=1` guarded only by comments. Defaults fail-safe; nothing stops them in staging/production (e.g. throw when `VERCEL`/`VERCEL_ENV` is set with them). Current `.next` built with http/127.0.0.1:3201 and `dangerouslyAllowLocalIP: true` (expected, gitignored). Effect if set by mistake limited to the one host. Defence in depth.
- [Minor] `next.config.ts:39`: `remotePatterns` without `pathname`; on staging the optimiser would proxy any path on the Supabase host, not only `media-public`. Matches §7.3 step 4 and the demo site. Refinement: `pathname: '/storage/v1/object/public/media-public/**'`.
- [Minor] `next.config.ts:10-22,34-35`: Turbopack root and `outputFileTracingRoot` widen to `/Users/einarzoega` with symlinked packages; every `.nft.json` resolves inside the project; falls back to the project with registry packages; `realpathSync` failure fails the build. Task 28 should confirm the staging root is the project.
- [Minor] `route.ts:6`: `CMS_WEBHOOK_SECRETS.split(",")` does not trim; " b" never matches (401, fail closed). Same in demo-site.
- [Minor] Replay within the 300 s window only triggers an extra `revalidateTag('cms')`; window per spec.
