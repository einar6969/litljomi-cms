# Task 0 (Execution setup): security review, round 4

- Reviewer: fresh `cms-security-reviewer`, 2026-11-01
- Change: fix commit `4bfafe6`, full sweep of live docs, and `git diff 250e8ac..57f7a1a`
- Result: **FAIL** (documentation only; checklist items 1–14 pass or not applicable)

Round-3 findings resolved (plan :160, :330, :429). Tests 17/17.

## Findings (complete sweep)

- A. Plan `:69` (cause of FAIL) and `CLAUDE.md:19`: the network allowlist is presented as the backstop without noting that in Auto mode the classifier can approve extra hosts for a single command (`allowed_domains`), so a sandboxed command to a hosted API could avoid the `ask` rules. `environment.md:103` already listed sandbox host prompts as unverified.
- Minor: plan `:1527` "enforced gates" predates the guard's removal; conflicts with :56 unless it means the `state.mjs start` check.
- Observation: `.claude/settings.local.json` holds local `allow` entries no review covered (reported to Einar).
- All other live statements checked and acceptable (plan :39, :56, :68, :135, :307, :328, :331, :332, :341, :346, :1428, :1460; `CLAUDE.md:20`, `:31`; `RESUME.md`; the four agent files).

## Resolution

Fixed by the controller in the commit "docs: note Auto mode can widen the sandbox network per command (round 4 security findings)"; re-reviewed in round 5.
