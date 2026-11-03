# `cms provision` stdin fix (`10e8a75..629a18f`), security fix-diff review

Reviewer: cms-security-reviewer, 2026-11-03. **Verdict: PASS** (Minors only, no change needed).

Checked: the secret still only from stdin (`readStdinSync`, `readFileSync(0)`), TTY returns null without reading and is refused; read errors become `StdinUnreadable` naming only the code (tests EAGAIN, EOF, EISDIR), printed as `FAILED: unexpected error (StdinUnreadable)`; `process.exitCode = 1` before `await runCli` so an early exit cannot report success (residual: an explicit `process.exit(0)` by the runtime, covered by the runbook's "require `site: <id>`" rule); `provision.ts`/`cli.ts` untouched; runbook re-run line pipes the secret only and runs after `site: <id>`. cli tests 94/94; offline vite-node runs refuse empty and short secrets with exit 1. Checklist 6, 10, 13, 14 pass; others n.a.

Minors: P-2 re-run sentence says the tool generates the secret (it is `openssl rand`); the plain P-2 `vercel env add` line lacks `--sensitive`; the `main.ts` checks in `stdin.test.ts` are source-text checks.
