# Task 27, round 2 (fix diff 3aa74b2..c5c478e): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

PASS

Read-only; no builds, tests or servers (reported 3/3 unit, 13/13 e2e and the visual run unverified by the reviewer). Commands: `git diff --stat`, `git diff` over non-fixture files, grep for `react-markdown` and `visual` in package.json, src and README, `git status --porcelain`, read of the r1 review.

## Round-1 findings
1. tsconfig exclusion of legacy articles: unchanged, Minor; keep in the Task 28/M6 handoff.
2. `react-markdown`: resolved (package.json, lockfile, README; no use left).
3. Env-gated local-IP/protocol/port: partly mitigated, Minor. `next.config.ts` throws when `VERCEL` is set with any of them; `remotePatterns` gains `pathname` `/storage/v1/object/public/media-public/**`; security-relevant, back through security review. The throw checks only `VERCEL` (another hosted build without it is not covered). `dangerouslyAllowLocalIP` reads `=== "1"`, the guard fires on any non-empty value (stricter, fine).
4. Hash-drift comment: resolved.
5. Test title: resolved ("the oldest article page has only its own marker (no older entries to relate)").
6. Fail-closed mapping: resolved; new `src/core/data/news/index.test.ts` (vitest config, alias, `npm test`) drops entries with null slug, empty title, undefined date or null image, keeps complete entries in order, checks mapped fields (`image.url → src`, `contentHash`), null/undefined excerpt → '', `getArticleBySlug` null for a left-out entry.
7. README Getting started: resolved.
8. `getAllArticles()` twice: unchanged, Minor (SDK caches).
9. `sourceRoot()` widening: unchanged, Minor; Task 28 checklist.

## New in the fix
- Fixture media URLs use the Hub's path shape; `MEDIA_PREFIX` shared by fixture server and bundle.
- [Minor] `e2e/fixtures.test.ts:36` and `e2e/fixtures/generate.ts:16` repeat the prefix literal; import `MEDIA_PREFIX` from `fixture-server.ts`.

## Visual config
- Pairwise comparison holds: same test list, widths, viewport heights, `settle()` (image load + 1200 ms), full page; file names `${name}-${widthName}.png` in `shots/hub/` and `shots/main/`.
- webServer entries sound: hub builds and serves (`reuseExistingServer: false`); main only checks 3202 answers, else fails with a clear message; `node -e` quoting valid.
- [Minor] `shots.pw.ts:5`: one `ARTICLE_SLUG` for both projects; say in the config comment that main must have that slug.
- [Minor] The hub server starts even with `--project=main` alone (harmless).

Nothing Critical or Major. The security review must see the `next.config.ts` hunk.
