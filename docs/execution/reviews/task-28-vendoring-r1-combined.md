# Decision 43.3 (vendored SDK on LABAK `hub-integration`), combined spec-and-quality review, round 1

Reviewer: cms-quality-reviewer (combined mode), 2026-11-03. CMS `15fc6c9`; LABAK `240b3fb..0687ad8` (14ea843, 0687ad8).

**Verdict: PASS** (Minors only).

## Findings

- [Minor] quality `next.config.test.ts:12-14`: "every path" checked only through the `/:path*` source pattern; no e2e assertion on the header (optional).
- [Minor] spec `vendor/README.md` Verify step: accurate; no change needed.
- [Minor] quality: two pre-existing `<img>` lint warnings, unrelated.

## Checked and correct

CMS commit touches only the two package.json files (0.1.0, `files`, private kept); README hashes match the files and `package-lock.json`; `npm pack --ignore-scripts` from `15fc6c9` reproduces both tarballs byte for byte; fresh clone at `0687ad8` with an empty cache: `npm ci` ok, `npm test` 10, lint 0 errors, `npm run test:e2e` 14 (builds with the fixture env), no processes left; no absolute paths; tracing-root removal justified; no pages, layout or copy changed; noindex gated on `=== "1"`; tests load a fresh module per case; two clean commits on `hub-integration` only.
