# Task 27 follow-up (LABAK image fallback, 81cd795..42ed226): security review (cms-security-reviewer, Opus)

PASS

One commit, 4 files: README.md, `src/core/data/news/index.ts`, `src/core/data/news/index.test.ts`, `src/core/utils/getRenderableNewsImage.ts` (two constants exported). Vitest not run (writes a cache); read-only.

1–8 n/a.
9. pass: the site still reads only the SDK's current-bundle entries; the change only drops `!data.image` from the filter (`index.ts:17`); slug, title, date still required; no fallback, cache or second source, so no unpublished/archived/never-published entry can return; bundle contents decided by the Hub build (`build-release.ts:385-450`). An archived asset is still excluded (`contextAssets` filters `!a.archived`, `build-release.ts:385-387`; projection `image: null`, `fields/image.ts:31-35`); the site shows the crest instead.
10. pass: README.md:34-38 local values only (`labak-local-secret` = `tests/integration/src/fixtures.ts:46`; 127.0.0.1:54321 URLs); `.env.example` unchanged ("Never set in staging or production"). [Minor] README.md:33-38: repeat "local only" next to `CMS_MEDIA_ALLOW_LOCAL_IP=1`/`CMS_MEDIA_PROTOCOL=http`.
11. pass: markers from the same entry object (`ArticleBodySection.tsx:64`, `RelatedArticlesSection.tsx:34`, `NewsCard.tsx`, `heim.tsx:14-16` from the same `article`, `home/index.ts:93-104`); `contentHash` from the bundle; every news-image consumer goes through `getRenderableNewsImage`, so the placeholder never reaches `next/image`.
    Live confirmation with no image: `mediaUrlsIn` (`deliver.ts:81-95`) collects only media-prefixed strings in projected data; with `image: null` nothing to check; `present` checks still need the new `contentHash`. In production `image` is required (`library/news.ts:17`) and URLs https, so null only when the asset is archived or unknown (invalid paths are left out with `asset_path_invalid`, `build-release.ts:394-398`); then "Birt á vef ✓" matches §7.4 (declared pages render this version; all its public media, none, answer 200; §7.4 Limits). Before, the site dropped an entry the release contained (404, "live not confirmed") — a site/release mismatch. Locally, http images project as null, so "live" shows with the crest.
    [Minor] An editor whose required image's asset was later archived sees "Birt á vef ✓" while the site shows the crest; meets §7.4 but gives no sign the image is gone; a Hub-side refinement (warning when a required asset resolves to null).
12. n/a. 13. pass. 14. pass.

- [Minor] `getRenderableNewsImage.ts:2-3`: in-band placeholders; an editor alt exactly "TODO: Descriptive alt text" would show the title as alt (cosmetic).
- Not a finding: `index.test.ts:36-44` is a real regression test.
