# Runbook: staging keys in `.env.staging.local` (G3 ruling), security fix-diff review, round 1

Reviewer: cms-security-reviewer, 2026-11-03. Diff `6504caf..3051ece` (37d4062, 3051ece), `docs/runbooks/staging.md` only. **Verdict: PASS** (two Minors).

Evidence: all three `ENV_FILE` lines (228, 514, 665) name the staging file; the three `env_value` copies hash identically after stripping indentation (`9c20a8fc…`), only the file name in their `FAILED:` lines changed; `REF_RE`/`URL_RE`/`KEY_RE` and the `https://$REF.supabase.co` comparisons unchanged (local-stack and wrong-project URLs still refused before anything is sent); every sourcing mention is a prohibition; no value on a command line; no prose tells Einar to put staging values in `.env.local`; the section 16 row matches `.claude/settings.json` and the sandbox read-deny list; the file is git-ignored. Checklist 10, 13, 14 pass; others n.a.

## Minors

1. `staging.md:53`, `:902`: says `tools/cli` reads the staging file, but `cms provision` does not exist yet (open item line 1012); when designed, hold it to the scripts' rules (read without executing, refuse duplicates, `EXPECT_REF` and URL check).
2. `staging.md:943-945`: section 13's "Set on" column lists only `.env.staging.local` for the three Supabase variables, while line 939 says local work uses `.env.local`; wording only.
