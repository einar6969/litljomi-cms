# C3 follow-up, LABAK side (42ed226..240b3fb): security review (cms-security-reviewer, Opus)

PASS

One commit (240b3fb), 7 files; checked against the Hub's `modules/labak` and the shared link validator. `npx vitest run src/core/data/news/index.test.ts` 5/5. `git status --porcelain` empty before and after.

1–9 n/a. 10 pass: no secret; README.md:36 `CMS_WEBHOOK_SECRETS=labak-local-secret` predates the diff (local placeholder; README.md:30 "Never commit real values"); the change only adds `export`. 11 pass: the source button renders in the same `<section>` as `<CmsEntryMarker entry={article} />` (`ArticleBodySection.tsx:46-64`); `contentHash` covers `sourceLabel` (`generate.ts:4-6, 31`; all seven hashes regenerated). 12 n/a. 13 pass. 14 pass.

- No HTML injection (§7.3): label is a React text child (`ArticleBodySection.tsx:55` → `ArrowLink` children, `ArrowLink.tsx:65-66`); href to `next/link` `href`; no `dangerouslySetInnerHTML`; Hub field `text({ max: 80 })` (`modules/labak/src/index.ts:32`; 81 rejected, `labak.test.ts:50-51`).
- No `javascript:` or credentials: href from the Hub `link()` field (`fields/link.ts:18-29`): only `https:`, `http:`, `mailto:`; username/password and surrounding whitespace rejected; canonical `new URL(s).href`.
- An entry link cannot produce the button: `toSource()` (`index.ts:16-21`) needs `"href" in source && source.href` and a non-empty trimmed label; unit test (`index.test.ts:51-66`) covers entry link, `{entry:null}`, null source, null/empty/whitespace/missing label; the Hub union is `strictObject` on both arms.
- Link attributes `target="_blank" rel="noopener noreferrer"` (`ArticleBodySection.tsx:52-53`); e2e checks href, label, rel (`site.test.ts:70-76`) and no label-less button (`77-82`).
- Types: `src/types/cms.ts:31` `sourceLabel: string | null`.

- [Minor] `index.ts:18`: the shared validator also allows `http:` and `mailto:`, so an editor can publish such a source button (no script vector; the spec's link rule); an https-only check in `toSource()` would be defence in depth.

No Critical or Major.
