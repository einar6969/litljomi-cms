# Task 28 Step 5 tool `cms provision`, combined spec-and-quality review, round 1

Reviewer: cms-quality-reviewer (combined mode), 2026-11-03. Diff `96df3d9..1521293`. cli tests 82/82; real pnpm invocation checked without network (stdin reaches the tool; missing env file refused; usage error exits 2).

**Verdict: PASS** (Minors only). Decision 44 met: existing slug and existing site refused cleanly (site via `api.worker_sites`); half-done editor prints user id, missing tenants and a finish command; `einsi@litljomi.is`; proposal items covered; runbook G3.3 sentence verbatim and A1 note; section 11 commands fit sections 1, 12, 13.

## Minors

1. `staging.md:776` (G4.3), `:939`, `:1021` still say `cms provision`; G4.3's command is not runnable; point it at P-3.
2. `--env-file` is swallowed by vite-node/node through `pnpm … cli`; `provision.ts:~305` may print it in the finish command. Note it, accept `--env-file=…`, or drop it from the finish line.
3. `worker_sites` returns active sites only; an inactive duplicate would not be refused (M1 never deactivates); add a comment.
4. pnpm adds an `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` block on failure; `--silent` in the runbook commands would remove it.
