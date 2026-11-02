# Task 27 follow-up (LABAK image fallback, 81cd795..42ed226): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

PASS

One commit, four files. `npx vitest run` in LABAK: 4/4. Lint, tsc, e2e not rerun (implementer's report). Nothing changed.

Spec — ruling implemented: `toArticle` (`src/core/data/news/index.ts`) leaves out an entry only when slug, title or date is missing; no image → `{ src: IMAGE_TODO_SRC, alt: ALT_TODO }`, which `getRenderableNewsImage` turns into `/brand/labak-merki-1958.jpg` with the title as alt; no new copy or images; `NewsCard.tsx`, `FeaturedArticleSection.tsx`, `RelatedArticleCard.tsx` all go through `getRenderableNewsImage`; no other consumer of `article.image`, so the marker string cannot reach a `next/image` src; `secondaryImage` optional; `getRenderableNewsImage.ts` only exports the two constants.

Spec — README: env names (`CMS_DELIVERY_BASE_URL`, `CMS_TENANT`, `CMS_WEBHOOK_SECRETS`, `CMS_MEDIA_HOST`, `CMS_MEDIA_PROTOCOL`, `CMS_MEDIA_PORT`, `CMS_MEDIA_ALLOW_LOCAL_IP=1`) match `src/core/config/cms.ts`, `next.config.ts`, `.env.example`; `=== "1"` check matches; protocol/port consistent with the remotePattern; block in the existing "Hub environment" section; no credentials (`labak-local-secret` local placeholder; 54321 standard local port).

Quality — tests: missing-image case removed from the omit test; left-out test uses `title: ''`; new test covers null and undefined image, asserts the exact markers and the rendered result through the real helper; constants imported, not duplicated.

- [Minor] README new block: say that `CMS_TENANT` and `CMS_WEBHOOK_SECRETS` must match the local stack's tenant and site secret.
- [Minor] `src/core/data/news/index.ts:25`: the fallback relies on the "TODO" marker strings (existing convention, documented, covered by the new test).
