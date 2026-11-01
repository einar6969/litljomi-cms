# Execution environment (decision record)

## Decision

- **Environment:** local Claude Code in the desktop app's Code tab (Local), working directory `/Users/einarzoega/litljomi-cms`, with subagents. Decided with Einar on 2026-11-01.
- **Sessions:** a fresh controller session per phase. A new session resumes from `docs/execution/RESUME.md` alone; `docs/execution/state.json` is authoritative.
- **Execution:** strictly sequential, one implementer at a time, in the order of `tools/harness/plan-index.json`.
- **Claude Code Projects:** deferred. Evaluated at checkpoint C4 only, with Einar's approval at that time (see the plan, "Future execution environment").

## Models

| Role | Model |
|---|---|
| Controller (main session) | Opus |
| `cms-implementer` | Inherits the model the controller passes: Opus for security-sensitive tasks, Sonnet for the others |
| `cms-security-reviewer` | Opus |
| `cms-spec-reviewer` | Sonnet |
| `cms-quality-reviewer` | Sonnet |

Einar may change these; record any change here with the date.

## Connectors Einar switches off

For the implementation session, in the desktop app: Supabase, Vercel, Neon, Netlify, Sanity, Zoho Mail, Claude Docs, and both browser tools (Claude in Chrome and the built-in browser). The guard denies every `mcp__*` tool except `mcp__ccd_turn__*` (the app's task list) as a second layer, and `.claude/settings.json` denies the servers observed on 2026-11-01.

## Connector audit

<!-- Task 0, Step 8: the controller lists every mcp__* tool available in the session, without calling any. -->

| Date | Session | `mcp__*` tools available | Result |
|---|---|---|---|
| | | | |
