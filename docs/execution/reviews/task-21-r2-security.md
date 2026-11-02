# Task 21, security review, round 2 (fix diff, Opus)

Verbatim report.

FAIL

I reviewed the Task 21 security fix diff (round 2: `git diff 0adf889..78bed55`, worktree /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next). The round-1 Major (the İ scan desync) is resolved. But the new comment handling makes the marker scan quadratic, so the fix brings in a new Major. A full re-review is not needed: the fix stays within the parser and the live-check fetcher.

**What I ran**
- `pnpm test`: 42 files, 791 tests passed.
- `pnpm lint`: exit 0.
- My own adversarial and timing scripts against `packages/sdk/src/parse-markers.ts`, run with `node --experimental-strip-types` from the session scratchpad.
- No database commands: the fix changes no migration or SQL. I started no process that is still running, and `git status --porcelain` in the worktree is empty.

**Round-1 Major (İ / case-fold desync): resolved**
- `asciiLower` (parse-markers.ts:34) is used for tag names, attribute keys and closing-tag names. `closingTagEnd` (:81-95) compares on the page itself, so no position can shift.
- I tried all 103 code points whose `toLowerCase` or `toUpperCase` changes length. Each was placed in text, in attributes and inside each skipped element, under 10 tag-name casings (`script`/`ScRiPt`, `TITLE`, `sTyLe`, `TextArea`, `TEMPLATE`, …), with upper-case closing tags. Each was also tried as a fake closer `</script{cp}>`. Result: 0 misses, and every scan was complete.
- Other inputs I checked:
  - An attribute containing `</script>`: handled.
  - Nested raw text (`<script><title></script>M</title>`): M is found, which matches a browser.
  - `</textareax>`: not taken as a closing tag.
  - A Kelvin-sign tag name, and `<scrİpt>` (not a script element): handled correctly.
  - `<!-->`, `<!--->` and `--!>`: correct.
  - An unclosed raw-text element, comment or tag: returns `complete: false`.
- The new tests at packages/sdk/src/__tests__/parse-markers.test.ts cover U+0130.

**New fail-open path for `absent`, including through the dedupe: none found**
- live-check.ts:130-132 runs the id check first and then `!complete` → `scan_incomplete`. An incomplete 404 own path fails too.
- The dedupe only shares a fetch while it is in flight: the key is dropped in `.finally` (live-check.ts:68-75). So no result is cached after it settles, and no failure is cached.
- The fetcher is created after a successful notify (deliver.ts:195, after :177-190). So every shared fetch started after that notify.
- A poll can join a fetch that started before the resend. Its result is still a real observation of the site after the first notification, so it cannot prove `present` or `absent` wrongly; at worst it costs one poll.
- A shared fetch uses the first caller's deadline. A waiter whose deadline has passed gets `timeout`. Both fail closed.
- The key includes `maxBytes`, so media HEAD-style fetches (0 bytes) never share with page reads.
- The slot handover keeps `active` at most 6.

**Checklist (items the fix touches)**

9. pass: release content is still decided only by the bundle. The fix touches only how the site is observed (deliver.ts:192-215).

10. pass: the fix adds no logging. The only log, `console.error` at live-check.ts:151, is unchanged and has no secret. lint exit 0.

11. fail (Major A below).
   - The proof rule itself holds: `present` needs 200 plus `{id, hash === contentHash}` from `scanned.markers` (live-check.ts:124-128). `absent` needs no id and a complete scan.
   - But the scan is no longer linear (Major A).

13. pass: no new contradiction. The round-1 contradiction (spec §7.4 exponential backoff for 24 h against the plan's fixed 10 attempts) still stands for the controller.

14. pass: `git diff --name-only 0adf889..78bed55 | grep -c '^.claude'` returns 0.

**Findings**

- **[Major] packages/sdk/src/parse-markers.ts:104-114 (`commentEnd`): the scan is quadratic in the number of comments closed by `--!>`.**
  - Each comment runs `html.indexOf('-->', body)` again. Only the `--!>` position is remembered between comments, the `-->` position is not.
  - So a page of `<!--x--!>` repeated, with no `-->` (or with a single `-->` at the end), rescans the rest of the page once per comment.
  - Measured with `scanEntryMarkers`:

    | Page size | Time |
    |---|---|
    | 50 KB | 444 ms |
    | 100 KB | 1,799 ms |
    | 200 KB | 7,348 ms |
    | 0.62 MB | 75,285 ms |

  - That is ×4 per ×2 in size. Extrapolated to the 5 MB cap, it is about 80 minutes of synchronous CPU per fetched page.
  - The parser before the fix took 18 ms on the same 5 MB input (`git show 0adf889:packages/sdk/src/parse-markers.ts`). This is a regression introduced by the fix, and it breaks the file's own linear-cost claim (header :6, from Task 18 security 11c).
  - Who can trigger it: not editors. React escapes `<`, there is no `dangerouslySetInnerHTML` in packages, modules or apps/demo-site/src, and Next escapes `<` in its flight scripts (next/dist/shared/lib/htmlescape.js:36). But any site page the worker fetches can, through a site author's markup or a compromised or taken-over site host.
  - Effect: it blocks the worker's event loop, and the sweep handles all tenants in one invocation. So it affects other tenants, and it is far above the 5 s bound. Under the resource-exhaustion rule I rate it normally: Major.
  - Fix direction: remember the next `-->` position between calls the same way as `bang`, and add a timing or scaling test for both comment closers.

- **[Minor] parse-markers.ts:166-171 (raw-text skip) with :104-114: script double-escaping is not handled.** You asked me to rate this. The implementer's note understates it: it can produce a false `absent`, not only a false `present`.
  - `<script><!--<script></script> <!-- </script><span data-cms-entry="E" data-cms-hash="H"> -->` returns `{ids: [], complete: true}`. A browser renders that span. So an `absent` check passes falsely.
  - `<script><!--<script></script>M</script>` returns M, which a browser keeps inside the script. That is the false `present`.
  - Rated Minor: only markup inside an inline script written by the site author can produce this. Editor text cannot, because Next.js escapes `<` in its inline scripts (htmlescape.js:36) and nothing renders raw HTML. Leaving this case aside, the scan marks every malformed-input stop as incomplete.

- **[Minor] parse-markers.ts:136-141 (generic `</…>` skip to the first `>`): quoted attributes on end tags are ignored, so a false `absent` is possible from author HTML.**
  - `</div a="><!--" ><span data-cms-entry="E" data-cms-hash="H"> -->` returns `{ids: [], complete: true}`, while a browser renders the span.
  - Same exposure as the previous Minor: author-written markup only.

Files: /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/packages/sdk/src/parse-markers.ts, /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/live-check.ts, /Users/einarzoega/litljomi-cms/.worktrees/lane-a-next/apps/cms/src/privileged/worker/deliver.ts.
