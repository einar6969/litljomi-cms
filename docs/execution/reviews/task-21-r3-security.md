# Task 21, security review, round 3 (fix diff, Opus)

Verbatim report.

PASS

Task 21 security review, round 3 (fix diff `git diff 78bed55..c337b48`, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next). The round-2 Major is fixed, the fix adds no new finding, and a full re-review is not needed. The diff touches only /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/packages/sdk/src/parse-markers.ts and /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/packages/sdk/src/__tests__/parse-markers.test.ts.

**What I ran**
- No database commands.
- Timing and comparison scripts, run with `node --experimental-strip-types` against copies of the parser at 78bed55 and c337b48 (taken with `git show`). They are in /private/tmp/claude-501/-Users-einarzoega-litljomi-cms/7a6f2c82-cf64-4cb8-b189-37672d4c376f/scratchpad/r3/: time.mts, diff.mts, canfail.mts.
- `pnpm vitest run packages/sdk/src/__tests__/parse-markers.test.ts`, three times.
- Afterwards, `git status --porcelain` in the worktree is empty.

**Round-2 Major (`commentEnd` quadratic on repeated `<!--x--!>`): fixed**
- `nextAt` (parse-markers.ts:104-107) gives the same result as `indexOf`, because the starting position never moves backwards:
  - `commentEnd` is called only from `scan` (:141), with `lt` taken from `indexOf('<', i)`, and `i` never decreases.
  - A remembered position at or after the new start is still the first match after it.
  - A remembered -1 stays correct, since a later start cannot find a match an earlier one missed.
- My round-2 input, with the new code, up to the 5 MB cap:

  | Input | 0.31 MB | 1.25 MB | 5 MB |
  |---|---|---|---|
  | `<!--x--!>` repeated, no `-->` | 5 ms | 16 ms | 65 ms |
  | same, one `-->` at the end | 6 ms | 18 ms | 68 ms |

  For comparison, 78bed55 takes 1,820 ms on 100 KB of the first input, so the round-2 measurement still reproduces on the old code.
- New adversarial shapes, all timed at 5 MB and all linear. The slowest is 584 ms (5 MB of entity text in one attribute value).
  - Comments:
    - `-->` comments with one `--!>` at the end
    - the two closer kinds alternating
    - `<!-- --!-->`
    - a run of bare `<!--` with only `-->` or only `--!>` at the end
    - comments mixed with tags whose attributes contain `-->`
  - Declarations: `<!x>`, and `<!x` repeated with one `>` at the end.
  - `</` without names, many of them, with one `>` at the end: 2 ms.
  - Stray `<`, and `< <`.
  - Raw-text elements with near-miss closers:
    - `<script>` followed by `</scriptx` repeated, or by `</` repeated, closed by `</script>` at the end: 414 ms at most
    - near-miss `</titl` inside a `<title>` element
    - `</textarea` without its `>`
  - Unterminated quotes: `<a b="` repeated, with a closing quote at the end. The result is `complete: false`, which is fail-closed.
  - Large tags: one tag with very many attributes, quoted or duplicated; a very long tag name; many spans.
  - A mixture of all of the above. The result is `complete: false`, which is fail-closed.
  - The other search sites (`closingTagEnd` :81-94, the skip for `<!` / `<?` / `</` at :147-153, `readTag`'s quote search at :63) are unchanged, and each moves strictly forward.

**Results unchanged / no new fail-open path for `absent`**
- I compared 78bed55 and c337b48 on 300,000 random pages. Each page was built from 35 tokens: both comment closers, `<!-->` and `<!--->`, raw-text openers and closers including near-misses and upper-case forms, quotes, markers, the release meta tag, İ, and the deferred end-tag-quote shape.
- Output compared: `scanEntryMarkers` (ids, markers, complete) plus `parseReleaseMarker`. Result: 0 differences.
- The `complete` flag and the stops that return incomplete (:142, :150, :159, :164) are unchanged.

**Scaling tests can fail and are not flaky by design**
- Can fail: I re-ran the test's own logic (same sizes, best of three, 1,500 ms bound, ratio under 10× with a 20 ms floor) against 78bed55. Both `--!>` cases fail at 125,000 characters: 5,507 ms and 5,489 ms, which break both the bound and the ratio.
- Not flaky by design: with the fix, the worst 5 MB input takes 584 ms, so the 2 MB step is about 0.25 s, well under 1,500 ms. A linear scan gives a ratio of about 4×, against a limit of 10×. Best-of-three and the 20 ms floor absorb pauses.
- Three runs of the file: 100/100 passing each time, in about 2.6 s.

**Checklist (items the fix touches)**

10. pass: the fix adds no logging. `grep -n "console\." packages/sdk/src/parse-markers.ts` finds nothing. The diff contains no secret.

11. pass: the scan is linear again, as the file header claims (:5-6). `present` and `absent` decisions are identical to 78bed55 (0 differences over 300,000 pages), so the round-2 proof analysis still holds: `present` needs the id with the new hash, and `absent` needs a complete scan.

13. pass: the fix brings in no new contradiction. The earlier one (spec §7.4 exponential backoff for 24 h against the plan's fixed 10 attempts) still stands for the controller.

14. pass: `git diff --name-only 78bed55..c337b48` lists only the two parser files. Nothing under `.claude/**`.

**Findings**
- No new findings.
- The two deferred Minors are unchanged in exposure and stay Minor:
  - [Minor] parse-markers.ts:162-166 with :115-124: script double-escaping is not handled.
  - [Minor] parse-markers.ts:147-152: quoted attributes on end tags are ignored.
  - The code paths behind both are untouched, and the comparison shows identical outputs. Both still need markup written by the site author.
