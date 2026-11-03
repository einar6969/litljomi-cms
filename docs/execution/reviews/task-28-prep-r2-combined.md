# Task 28 Step 0, combined spec-and-quality review, round 2 (fix diff `4fd79ff..46e5df7`; LABAK `0687ad8..56bb9dd`)

Reviewer: cms-quality-reviewer (combined mode), 2026-11-03. **Verdict: PASS** (two Minors).

The round-1 Major is resolved: G7 row (`github.com`; `labak-hub.litljomi.is`) and Task 29 row (three staging hosts and `<project-ref>.supabase.co`, read-only curl; browser and admin-link runs in Einar's terminal), each shown as an exact diff and removed when done. G2.5 note added. Wider G2.0 scan, G7.1 pre-push checks (`vercel.json` override, `main..hub-integration` scan incl. tarballs) and `X-Robots-Tag`/`SITE_NOINDEX` checks are consistent with decision 43. The scan was run read-only and printed only prefix plus up to 4 characters; commit messages: nothing.

## Minors

1. `staging.md` G2.0 (~121-140): the scan matches the runbook's own example `postgres://user:pw@` (prints `postgres://user…`), which is not in the expected list; an executor following "anything else: stop" would stop on it. Add it to the expected list or reword the example.
2. Same place: `.{0,4}` in the `sed` cut can split a multibyte character (`"pk�…`); set a UTF-8 locale or cut byte-safely.
