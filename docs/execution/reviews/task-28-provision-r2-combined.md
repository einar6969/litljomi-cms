# Task 28 Step 5 tool `cms provision`, combined fix-diff review, round 2 (`1521293..a419294`)

Reviewer: cms-quality-reviewer, 2026-11-03. cli tests 87/87. **Verdict: PASS** (Minors only).

Checked: `--flag=value` split at the first `=`, name checked against the known set before the value is used (unknown flags, including a secret-as-flag, refused naming only the flag); repeat rules apply to both forms; empty and relative `--env-file=` refused (exit 2, no request); `pnpm --silent` consistent between `FINISH_PREFIX` and the runbook; no `cms provision` left in the runbook; tests cover the equals form, the refusals and the unexpected-error branch (name only, no request).

Minors: an explicit `--webhook-secret=x` case would document the refusal; P-3's re-send behaviour stays "confirm at execution time".
