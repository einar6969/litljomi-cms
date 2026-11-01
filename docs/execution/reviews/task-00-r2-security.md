# Task 0 (Execution setup): security review, round 2

- Reviewer: fresh `cms-security-reviewer`, 2026-11-01
- Change: `git diff 250e8ac..6d3b43c` (a09ff7b, 6d3b43c)
- Result: **FAIL** (documentation only; checklist items 1–14 pass or not applicable)

## Checklist

1–9, 11–12 not applicable (no database, release, live-check or editor code). 10 pass (no secrets). 13 pass (nothing contradicts the spec). 14 pass: Task 0 with Einar's approval; `.claude/settings.json` changes only by removing `disableAutoMode`; all other settings byte-identical; no other `.claude/**` change.

`waived` restriction correct: refused for every gate except V-HARNESS and V-CONNECTORS before the evidence check and before any write; nothing else in `state.mjs` weakened; tests 17/17. G1–G7 non-authorization stated in `CLAUDE.md:20`, `RESUME.md:6`, the plan (`:39`, `:328`, `:346`) and `environment.md:101`.

## Findings (cause of FAIL: live claims false or unverified in Auto mode)

1. Plan `:429` (Task 2): sandbox gaps "will produce 'Bash command (unsandboxed)' prompts" without limiting to Accept-edits or Manual mode; in Auto mode the unsandboxed retry goes to the Auto-mode classifier.
2. `environment.md:103` and plan `:69`: the sandbox is called the backstop for shell commands in Auto mode without noting that the classifier can approve an unsandboxed retry.
3. Plan `:1428` ("any push prompts Einar"), plan `:1460` ("each use prompts Einar … also prompts for the host"), `CLAUDE.md:19` (`ask` rules as a backing control): not limited to Accept-edits or Manual mode; whether `ask` rules and sandbox host prompts reach Einar in Auto mode is unverified.
4. Minor: `environment.md:84` (R3 sandbox record) still says Auto mode is impossible; not marked superseded.

## Resolution

Fixed by the controller in `5ea4f98` ("docs: qualify prompt claims by permission mode (round 2 security findings)"); re-reviewed in round 3.
