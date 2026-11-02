# Task 27, round 1: combined spec-and-quality review (cms-quality-reviewer, Sonnet)

Scope: LABAK `aec9f95..3aa74b2` (branch hub-integration); CMS `ba8defc..10f43bd` (m1/lane-a-next).

PASS

No Critical or Major findings. Not re-run (read-only): the 13 e2e tests, the build, `pnpm --filter @litljomi/cli test`. Playwright not run, as agreed.

Commands run (read-only): `git diff --stat`/`git diff` on both ranges, `git show 3aa74b2:<file>`, `git grep react-markdown`, a loop over `git show aec9f95:` for article dates, `git status --porcelain` in LABAK, reads of the SDK `revalidate-handler.ts` and the demo-site revalidate route.

## Spec: matches the task text and Pre-check amendments
- `getAllArticles`/`getArticleBySlug` async in `src/core/data/news/index.ts`; map `BundleEntry<NewsEntry>` → `NewsArticle` + `id` + `contentHash`; `image.url → src`; entries missing slug/title/date/image dropped; `source` not mapped (decision 41.2).
- All four consumers converted; `slice(0, 6)` kept (`HOME_NEWS_COUNT`), including `homeContent` (static `articles` removed).
- Markers beside each article's content in `NewsCard`, `NewsPreviewCard`, `RelatedArticleCard`, `ArticleBodySection`; client components get the server-rendered `CmsEntryMarker` as a `marker` prop (no SDK import in a client file). `ArticleGridSection` uses `NewsCard`; `FeaturedArticleSection` untouched.
- Layout `CmsReleaseMarker`; `remotePatterns` only `CMS_MEDIA_HOST`; `src/types/cms.ts` generated; `ArticleBodySection` uses `RichText`; `file:` deps.
- Revalidate route identical to the demo-site reference.
- CMS: `tools/cli` depends on `module-labak`; CLI test for `gen-types --module labak`.
- Ports 3200/3201.
- Fixture bundle = the seven newest articles on main (2024-11-07 … 2024-09-16, matching `git show aec9f95:`). `e2e/fixtures.test.ts` compares title, excerpt, date, image path and body word for word against `src/core/data/news/articles/*.ts` (unchanged files = main's text); it ignores Markdown punctuation, so it is a word comparison, not byte.
- Layout and copy preserved: no CSS/wrapper changes; JSX changes only marker insertions and the body swap.
- Tests that exist and can fail: marker+hash on `/frettir/<slug>`; `/frettir` and `/` (latest six, not the seventh); release marker on every page; 404 unknown slug; revalidate 401 and 200; no source link without a label.
- Playwright: `e2e/visual/playwright.config.ts`, `shots.pw.ts`: `/`, `/frettir`, one article at 375/768/1440, full page, scroll for fade-ins, wait for images; `BASE_URL`+`LABEL` shoot main into a separate folder.
- README edits accurate and limited. Nothing extra beyond the amended scope; lockfile churn mostly the new dev tooling.

## Findings (all Minor)
1. [Minor] `tsconfig.json:41`: legacy `src/core/data/news/articles` excluded from typecheck (needed; they lack `id`/`contentHash`). Keep visible in the Task 28/M6 handoff.
2. [Minor] `package.json:28`: `react-markdown` still a dependency, unused in `src`. Remove, or say why in README.
3. [Minor] `next.config.ts:321-323`: env-gated `dangerouslyAllowLocalIP`, `CMS_MEDIA_PROTOCOL=http`, `CMS_MEDIA_PORT`; default off; security-relevant (SSRF/cleartext if set in a real environment) — send through security review; possible hardening: ignore them when `VERCEL` or production is set.
4. [Minor] `e2e/fixtures/generate.ts:4-6`: comment claims Hub hash drift shows up in `fixtures.test.ts`, but the test recomputes with the same local copy; reword or test against the SDK/CMS implementation.
5. [Minor] `e2e/site.test.ts`: test title "an article page may add markers only for related cards" does not match its assertion (oldest article carries only its own marker); rename.
6. [Minor] No test for the fail-closed mapping in `toArticle` (entry missing image/title/date/slug left out).
7. [Minor] `next.config.ts:307-308`: build/dev throw without `CMS_MEDIA_HOST`; README Getting-started should point at the new section.
8. [Minor] `src/ui/pages/frettir-article.tsx:15`: `getAllArticles()` called again after `page.tsx` resolved the article (SDK caches; harmless).
9. [Minor] `next.config.ts:291-303`: `sourceRoot()` widens Turbopack root/`outputFileTracingRoot` to a common ancestor (`/Users/einarzoega`) while packages are symlinked; reverts once published packages are installed (Task 28). Record in the Task 28 checklist.
