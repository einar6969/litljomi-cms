# Harness verification (Task 0, Steps 8–10)

> **Superseded on 2026-11-01.** See "Superseded on 2026-11-01" at the end. The content below is kept as the historical record.

Live probes use local fixtures only (`tools/harness/fixtures/bin/` stubs and the bare repository `tools/harness/fixtures/remote.git`). No probe calls an external service, a hosted connector or a cloud session. Each probe runs once in the main session and once from a fresh `cms-implementer` subagent. Record the result and the matching `docs/execution/guard-log.jsonl` line (with its `agent_type`).

## Probes

| # | Probe | Expected | Main session: result | Main session: guard-log line | Subagent: result | Subagent: guard-log line (`agent_type`) |
|---|---|---|---|---|---|---|
| P1 | `PATH="$PWD/tools/harness/fixtures/bin:$PATH" vercel --version` | Denied; no marker file | | | | |
| P2 | `sh -c 'PATH="$PWD/tools/harness/fixtures/bin:$PATH" gh auth status'` | Denied; no marker file | | | | |
| P3 | `PATH="$PWD/tools/harness/fixtures/bin:$PATH" supabase link --project-ref probe` | Denied; no marker file | | | | |
| P4 | `git push ./tools/harness/fixtures/remote.git HEAD:refs/heads/probe` | Denied; `git --git-dir tools/harness/fixtures/remote.git show-ref` shows no `probe` | | | | |
| P5 | `Edit` of `.claude/settings.json` (a whitespace-only change) | Denied; `integrity.mjs` still clean | | | | |
| P6 | `Write` to `/Users/einarzoega/litljomi-cms-outside-probe.txt` | Denied by the guard | | | | |
| P7 | `cms-implementer` `Write` to `docs/execution/state.json` | Denied | | | | |
| P8 | `cms-spec-reviewer` `Write` to `tools/harness/fixtures/out/reviewer-probe.txt` | Denied | | | | |
| P9 | `echo probe > "$HOME/litljomi-cms-sandbox-probe.txt"` (the guard does not check this path, so this tests the sandbox alone) | Blocked by the sandbox. If the file appears, **V-SANDBOX fails**; Einar deletes the file | | | | |
| P10 | `CLAUDECODE` check: `env \| grep -c '^CLAUDECODE='` | Records whether the variable exists, which decides whether `gate.mjs`'s extra layer is real | | | | |

Marker files after the probes (`ls tools/harness/fixtures/out/`):

## V-HARNESS

Passes when P1–P8 are denied in **both** contexts and the subagent rows carry `agent_type`.

- Result:
- Evidence:
- Recorded with `state.mjs validate V-HARNESS …` on:

## V-CONNECTORS

Passes when the connector audit (Step 8, `docs/execution/environment.md`) finds no hosted-connector or browser tool in the implementation session.

- Result: **FAIL** (2026-11-01, session `81e2dc24-…`). Still available: Claude Docs (`mcp__1a59c906-04da-521d-bda7-7f71b9f9e01c__*`), the built-in browser (`mcp__Claude_Browser__*`) and Playwright MCP (`mcp__playwright__*`). Steps 9–11 were not started, per the fallback "stop until Einar switches them off".
- Evidence: `docs/execution/environment.md`, "Connector audit", 2026-11-01.
- Recorded with `state.mjs validate V-CONNECTORS fail docs/execution/environment.md` on: 2026-11-01

## V-SANDBOX

Passes per P9: the sandbox blocks the write outside the repository and temp. If it fails, record the incompatibility; continuing with hooks and permission rules only needs Einar's decision.

- Result: not yet probed (P9 not run, because V-CONNECTORS failed first).
- Observations on 2026-11-01, session `81e2dc24-…`, made without any probe:
  - `git add`/`git commit` fail inside the sandbox: `fatal: Unable to create '/Users/einarzoega/litljomi-cms/.git/index.lock': Operation not permitted`. The sandbox denies writes under `.git/`, so no commit (Step 8's lock commit, or any task's commit step) can run sandboxed. No `index.lock` was left behind, and nothing was staged.
  - The session's sandbox write allowlist reported by the app includes, besides the repository and temp, `/Users/einarzoega/Litljómi/litljomi.is` (added to this session as an additional working directory) and scratchpad paths of other projects' sessions. That is wider than "the repository and temp".
- Evidence:
- Einar's decision (if failed):
- Recorded with `state.mjs validate V-SANDBOX …` on:

## Superseded on 2026-11-01

Einar approved the simplified execution design on 2026-11-01 (`docs/execution/environment.md`, "Decision 2026-11-01: simplified execution"). The probes P1–P11 above were never run and are no longer part of Task 0. Everything above this section is kept unchanged as the historical record, including the failed connector audit and the sandbox observations.

- V-HARNESS: waived (the guard hook was removed).
- V-CONNECTORS: waived (connector availability no longer fails a gate). The 2026-11-01 result stays recorded above as FAIL.
- V-SANDBOX: recorded in the session that applies the simplified Task 0, from the reported sandbox configuration and a successful sandboxed `git commit`.
- `docs/execution/guard-log.jsonl` holds the guard's only logged denial (2026-11-01, `bash.rm-outside-repo`, an `rm` of a scratchpad copy in the controller session), kept as a record.
