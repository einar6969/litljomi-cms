# Decision 43.3 (vendored SDK on LABAK `hub-integration`), security review, round 1

Reviewer: cms-security-reviewer, 2026-11-03. CMS `15fc6c9`; LABAK `240b3fb..0687ad8`.

**Verdict: PASS** (one Minor).

## Evidence

- Tarballs extracted and `diff -r` against `git archive 15fc6c9`: only `src/__tests__` absent (intended); package.json identical; private, no lifecycle scripts.
- `npm pack --ignore-scripts --offline` from the archive reproduces both SHA-256 values; sha512 matches `vendor/README.md` and `package-lock.json`.
- Lockfile: every `resolved` is registry.npmjs.org except the two `file:vendor/*.tgz`; no absolute paths, no `git+`; old monorepo-relative entries removed; no existing package changed. 43 added packages: 26 @tiptap 3.32.2, 13 prosemirror-*, linkifyjs, orderedmap, rope-sequence, w3c-keyname; all MIT with integrity, no install scripts; versions match the CMS lockfile.
- noindex: `SITE_NOINDEX === "1"` only; `headers()` new; `remotePatterns`, `dangerouslyAllowLocalIP`, the fixture-only guard and `transpilePackages` unchanged; `main` = `origin/main` = `aec9f95` does not contain it.
- Tracing-root removal narrows what tracing can include (neutral to positive).
- `hub-integration` has no upstream; `.claude`, `.github`, `vercel.json` untouched; `.gitignore` unchanged.
- Checklist: 1–9, 11, 12 n.a.; 10 pass (no literal secrets in the tarballs; secret handling only as parameters); 13 pass (spec §9.1 as amended, decision 43.3/43.7); 14 pass.

## Findings

- [Minor] LABAK `.env.example` does not list `SITE_NOINDEX`; `labak-hub` could be configured without it and be indexable. Suggest listing it, or a runbook check of the header on labak-hub.litljomi.is.

Process note: one read-only `git ls-remote --heads origin` was refused by the sandbox (github.com); not retried or worked around.
