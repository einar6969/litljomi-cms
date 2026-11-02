# Task 27, round 5 (fix diff 2f8bb63..9b19560): security review (cms-security-reviewer, Opus)

PASS

One commit (9b19560 "fix: visual webServer runs from the repository root"), 2 files, +5/-1; small and not security-relevant, so no full re-review.

- `e2e/visual/playwright.config.ts:31` `ROOT = fileURLToPath(new URL('../..', import.meta.url))`; line 54 `cwd: ROOT` on the hub webServer. Resolved with Node from the config's location: exactly the repository root. Only makes the unchanged command `node e2e/serve.ts` (line 53) find its file.
- `e2e/harness.ts:7`, `:47`: serve.ts starts only Next.js via `spawn(process.execPath, [nextBin, ...args], { cwd: appDir })`, `appDir` from the harness file's location; build/server writes (`.next`, gitignored) unchanged; line 66 still binds `next start` to `-H 127.0.0.1`.
- Unchanged: host-resolver rule (line 44), `serviceWorkers: 'block'` (line 42), `outputDir` (line 36), shots folder, the second webServer (59–65). Nothing downloads, calls npm or reaches a non-loopback host.
- `package.json` scripts unchanged (`test:visual` line 18, `serve:fixture` line 17): the approved exclusion covers the same command.
- `e2e/serve.ts:2` comment only.

Exclusion conditions after the fix: loopback only, download nothing, writes limited to gitignored repo paths, npm logs and Chromium's temp profile — kept.

Checklist: 10 pass; 14 pass; 1–9, 11–13 n/a. Findings: none. The round-4 PASS stands. Read-only; `git status --porcelain` empty.
