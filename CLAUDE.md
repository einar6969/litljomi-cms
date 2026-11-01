# Litljómi CMS Hub

This repository holds Litljómi CMS Hub: one Litljómi-owned CMS platform (a Next.js CMS app over one Supabase project) that gives each client site an isolated editing environment. LABAK is the first tenant.

**Sources of truth, in order:**
1. `docs/architecture.md`, the approved specification.
2. `docs/plans/2026-11-01-m0-m1.md`, the M0–M1 implementation plan.

If the plan and the spec disagree, the spec wins: stop and report the conflict instead of choosing.

## How to resume

Read `docs/execution/RESUME.md` first. Execution state lives in `docs/execution/` (`state.json` is authoritative), never in conversation history.

## Gate rules

- Nothing happens outside this repository without a gate (G0–G7) recorded in `docs/execution/gates.json`. An approval given in chat but not recorded there unlocks nothing.
- Gates are recorded by Einar himself with `node tools/harness/gate.mjs` in his own terminal. Claude never runs it.
- Never edit protected files: `.claude/**`, `tools/harness/guard-lib.mjs`, `tools/harness/gate.mjs`, `tools/harness/integrity.mjs`, `tools/harness/plan-index.json`, `docs/execution/gates.json`, `docs/execution/harness.lock.json`.
- Harness changes are Einar's: he makes them himself, or approves the exact diff in chat, then re-locks with `node tools/harness/integrity.mjs --lock` in his terminal.

## Agents

- **Controller** (the main session): holds the plan, talks to Einar, dispatches subagents, is the only writer of `docs/execution/state.json`, `progress.md`, `reviews/` and `checkpoints/`, and the only party that asks for gate approvals.
- **`cms-implementer`**: a fresh one per task and per round of fixes. Implements one task exactly as written, test-first, commits, reports.
- **`cms-spec-reviewer`**: read-only. Does the change do what the task text says? Every task.
- **`cms-security-reviewer`**: read-only. Reviews against the architecture with the plan's 14-item checklist. Security-sensitive tasks only, in parallel with the spec review.
- **`cms-quality-reviewer`**: read-only. Readability, duplication, error handling and test quality, after the spec and security reviews pass.

## Safeguards

The permission rules, the guard hook (`.claude/hooks/guard.mjs`) and the Bash sandbox are **defence in depth, not proof**. They reduce risk; the gates, the reviews and Einar's approvals are the real controls. A guard denial is reported to the controller (and by the controller to Einar), **never worked around**.

## Commands

- `node --test "tools/harness/__tests__/*.test.mjs"`: the harness tests (Node's native test glob; quote the pattern).
- `node tools/harness/state.mjs show`: current execution state and the next task.
- `node tools/harness/integrity.mjs`: checks the protected files against the lock.

Task 1 adds the `pnpm` scripts here.
