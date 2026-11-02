# Task 27, round 3 (fix diff c5c478e..7147edc): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

PASS

Read-only: `git diff c5c478e..7147edc`, the round-2 review, grep of exports in `e2e/fixture-server.ts`, `git status --porcelain` (empty). No builds, tests or Playwright; the implementer's 3/3, 13/13 and lint results not verified; the visual run untested.

## Round-2 Minors
- Prefix literal repeated: resolved (`fixtures.test.ts`, `generate.ts` import `MEDIA_PREFIX` and `FIXTURE_PORT` from `fixture-server.ts` lines 11-12; node built-ins only, no cycle).
- `ARTICLE_SLUG` for both projects: resolved (`shots.pw.ts:5` comment).
- Hub server starting under `--project=main`: harmless, unchanged.

## External-request blocking (`e2e/visual/shots.pw.ts`)
- Correct: route registered on the context before any page or navigation; aborts everything not `http://127.0.0.1|localhost:<port>`; aborted hosts recorded (raw URL fallback); test fails on any host outside the Google Fonts allowlist.
- Comparable: both projects run the same code and fall back to the same system fonts; only font hosts tolerated.
- Readable: doc comment explains why; single-purpose helper.
- [Minor] `shots.pw.ts:~73`: the unexpected-hosts `expect` runs after `context.close()`; if `goto`/`settle` throws first, blocked hosts are not reported. Acceptable.
- [Minor] `shots.pw.ts:21-22`: `LOOPBACK` covers only `http:`; `https://localhost` blocked (intended; everything is http-only).

## Harness env allowlist (`e2e/harness.ts`)
- Sound: PATH, HOME, USER, SHELL, LANG, LC_ALL, temp variables, NODE_PATH, NODE_OPTIONS, SystemRoot; FIXTURE_ENV, `NODE_ENV`, telemetry flag layered on top; caller tokens and keys no longer reach `next`.
- [Minor] `INHERITED_ENV`: `NODE_OPTIONS` and `NODE_PATH` inherited from the caller, a small injection surface (env/secret handling: security review if changed). The comment "nothing else" slightly overstates; wording only.

No Critical or Major findings.
