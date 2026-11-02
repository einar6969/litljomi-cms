# Task 21, spec review, round 2 (fix diff, Sonnet)

Verbatim report.

PASS

The round-2 fix resolves the security Major and both Minors. It keeps the Task 21 text and decisions 34–35, and I found nothing Critical or Major.

**Findings (both Minor, no action required)**
- [Minor] apps/cms/src/privileged/worker/live-check.ts (`createPageFetcher`, shared map): a fetch that was already in flight when `resend()` fired could be reused by a later poll of the same URL. That poll could then see a pre-resend response. The window is one round, a later poll re-fetches, and the code comment only claims "started after notification" for the first sharing. It affects no stated requirement.
- [Minor] apps/cms/src/privileged/worker/live-check.ts:`runLiveChecks`: `absent` on the own path now fails with `scan_incomplete` when a 404 body cannot be scanned to its end. This is stricter than the spec's "no marker plus 404". It fails closed and a real 404 page is complete. It is the same kind of conservative strictness I accepted in round 1.

**Checks**
- **Task 21 semantics are intact.**
  - `present` needs 200 and the entry's own hash.
  - `absent` needs no marker id (the id-only fail-closed behaviour is kept), 404 on the own path, and 200 on other paths.
  - Media needs 200.
  - There is one `resend`, and the defaults are still 3000 and 60000.
  - `present` still passes when its marker is found before a scan stops early. A test covers this.
- **Exported interfaces:** only additive changes.
  - `scanEntryMarkers` (new SDK export) lets one scan return ids, markers and `complete`. `parseEntryMarkers` and `parseEntryMarkerIds` keep their signatures and now delegate to it.
  - `createPageFetcher`, `PageFetcher`, `FetchedPage` and `MAX_CONCURRENT_FETCHES` are new in `live-check.ts`.
  - `LiveCheckInput.fetchPage` is optional, defaulting to one fetcher per run. `deliver.ts` creates one fetcher per site and delivery, after the notification. This is the justified way to bound and dedupe fetches.
- **Major fix (U+0130):**
  - Tag and attribute names are folded ASCII-only on the page itself.
  - `closingTagEnd` no longer uses a lower-cased copy, so no position can shift.
  - The tests cover İ and other non-ASCII text before each skipped element and before a comment, for entry markers and the release marker. They also cover a look-alike `</ſcript>` and the exact repros from the review, so they can fail.
- **Minor fix (`complete`):** `scan` returns `complete:false` at an unterminated tag, quote, comment or declaration, and at a skipped element that is never closed. The live check's `absent` fails with `scan_incomplete`. The tests cover each case, with the markers found before the stop kept.
- **Minor fix (bound and dedupe):**
  - At most 6 fetches run at once, and an identical URL with the same size cap is shared while it is in flight or waiting.
  - A fetch still waiting for a slot past its deadline is not made (`timeout`).
  - The tests assert a peak of exactly 6, one hit across shared runs and targets, and the deadline case.
- **Comment endings (`<!-->`, `<!--->`, `--!>`):** I judge this acceptable and correct. It matches the HTML parsing rules, where those forms close a comment. Not handling them would let a comment-hidden marker desynchronise the scan. The `bang` cache keeps the scan linear. Tests cover each form and a performance guard.
- **Extras beyond the findings:** none, apart from the comment-ending change above.

**Commands run**
- `git diff 0adf889..78bed55`
- `pnpm lint` (clean)
- `pnpm typecheck` (clean)
- `pnpm test` (42 files, 791 tests, all pass)

I ran no database command and no e2e. `git status --porcelain` was not changed by me.
