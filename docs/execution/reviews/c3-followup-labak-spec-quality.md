# C3 follow-up, LABAK side (42ed226..240b3fb): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

PASS

Commands: `git diff 42ed226..240b3fb`; `git show aec9f95:src/core/data/news/articles/hvad-fa-eg-fyrir-minn-snud.ts`; `git diff aec9f95 240b3fb` on `ArticleBodySection.tsx` and `[slug]/page.tsx`; `npm test` 5/5; `npx tsc --noEmit` clean. e2e and lint not run (implementer's 14/14). `git status --porcelain` empty.

Spec met:
- Label and href: "Skoða námskeiðið á idan.is" byte-identical to main's `source.label`; href `https://www.idan.is/idngreinar/matvaela-og-veitingagreinar/` identical; `generate.ts` reads both from the Markdown article (only the label gated by `LABELLED`).
- Button markup: `ArticleBodySection.tsx` untouched; the `<ArrowLink size="sm" target="_blank" rel="noopener noreferrer">` block with `sourceRule` is main's; renders from the mapped `article.source`.
- Additive: `NewsEntry.sourceLabel: string | null`; `NewsArticle.source` keeps `{label, href}`.
- Mapping: `toSource` only for an external href plus a non-empty trimmed label; entry links, null sources, null/empty/whitespace/absent labels give no button.
- README: `export VAR=… \` lines; both `next build` and `next start` get the variables; only change.
- Fixture hashes changed in every entry (added field). Nothing extra.

Quality (Minors):
- `e2e/site.test.ts` "renders the source button from sourceLabel…": the href regex overlaps the first assertion and does not tie the label to the same anchor; use one regex.
- `e2e/site.test.ts` "does not render a source link without a label": `not.toContain('mbl.is/matur')` and `news[1]` assume fixture content/order.
- `src/core/data/news/index.test.ts`: `toSource` cases in one loop; `it.each` would name the failing case.
- `src/core/data/news/index.ts`: the `toArticle` doc comment now sits above `toSource`.

No security-relevant code touched.
