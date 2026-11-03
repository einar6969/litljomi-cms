# Task 28 Step 0 (decision 43.1 local preparation), security review, round 1

Reviewer: cms-security-reviewer, 2026-11-03. Diff `aa6e91b..m1/lane-a-next` (3f8702e, e1893dc, 4fd79ff); settings diffs A (`8c95276…8f6f`) and B (`bd45e0e…316c`), approved by Einar, not yet applied; look-ahead at the G2 hosts diff.

**Verdict: PASS** (six Minors).

## Evidence (summary)

- G2.0 scan run over all refs: only fixtures, each printed as prefix plus 4 characters.
- Config tests 36/36; no secret shapes in the diff; no `.claude/**` change.
- The three `env_value` copies (G3.2c, section 7.2 parts 1 and 2) are byte-identical; section 7 differs from `aa6e91b` in two reference lines only.
- G3.2c: the DO blocks only lock and sleep in one implicit transaction (no data change, locks released at end); lock order and timing analysed (wrong order gives 55P03 and the documented retry); the script handles the secret key exactly as section 7.2 (never sourced, regex-checked, `EXPECT_REF`, `curl -q --config -` from builtin `printf`, never exported, unset; prints host, HTTP code, time, `.code`).
- G6.0: Einar's exact Ignored Build Step, set only by him; `labak-hub` mirror, created before its Git connection; no step touches the off-limits project beyond that, nor labak.litljomi.is, labak.is or LABAK `main`. Standard Protection kept; `*.vercel.app` checked for 401. `noindex`/`fra1` pinned by tests.
- Diff A tightens the sandbox (apply before staging values enter `.env.local`); diff B only adds denies and asks; diff G2 adds only `github.com`, `api.github.com`.
- Checklist: 1, 4, 5, 6, 8, 9, 11 n.a.; 2, 3, 7, 10, 12, 13, 14 pass.

## Findings (all Minor)

1. `staging.md:797-802,857-860`: a `vercel.json` with `ignoreCommand` or `git.deploymentEnabled` on `hub-integration` would override the G6.0 safeguard; add a pre-push check (none exists today).
2. `staging.md:119`: G2.0 regex misses `sbp_…`, Postgres URLs with passwords, Vercel tokens, `SUPABASE_DB_PASSWORD=`, generic `*_TOKEN=`/`*_SECRET=`/`PASSWORD=`; skips commit messages and binaries.
3. `staging.md:150-157,857-860`: no secret scan of `main..hub-integration` before the LABAK push.
4. diff B: the new `ask` rules may not match the bare command and miss flag reordering, `--db-url`, `npx`/`pnpm exec`; the sandbox network is the backstop.
5. Existing `Bash(git push *)`/`Bash(git remote *)` do not match `git -C <dir> push`; suggest `Bash(git -C * push *)` and the same for `remote` in the G2 diff, for Einar's approval.
6. Pre-existing, outside the diff: `.claude/settings.local.json` allows `Bash(git apply *)` from an earlier session; suggest Einar removes it.
