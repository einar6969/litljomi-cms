# Task 28 Step 0 (decision 43.1 local preparation), combined spec-and-quality review, round 1

Reviewer: cms-quality-reviewer (combined mode), 2026-11-03. Diff `aa6e91b..m1/lane-a-next` (3f8702e, e1893dc, 4fd79ff). `pnpm test` in the worktree: 67 files, 1190 tests pass.

**Verdict: FAIL** (one Major).

## Findings

1. **[Major] spec** `docs/runbooks/staging.md:40-45`: the per-gate network table has rows for G2, G3, G4/G5 and G6 but none for G7. G7.1's `git push` to github.com, its `git ls-remote` and its `curl https://labak-hub.litljomi.is/` check need hosts after the G2 and G6 diffs are removed; Task 29's host needs are not stated. Fix: a G7 row (`github.com`, `labak-hub.litljomi.is`) and a Task 29 row (or state that the G7 diff stays until C4).
2. **[Minor] spec** `staging.md:899`, `:978`: no preview secret (decision 43.1 lists it); raised as an open item before G6.2. The controller must put it to Einar.
3. **[Minor] spec** plan `:1823` (Task 28 Step 0 still the decision-42 version) and the plan's gate table `:50-54` (old project names, "SendGrid or Resend", G5 email records). Outside this diff; controller's call.
4. **[Minor] quality** `staging.md:818, 859, 925` vs `.env.example:28-29`: `SITE_NOINDEX` has no consumer in this repository; nothing guards the claim that `hub-integration` reads it. Optional: G6.2 Verify greps the LABAK branch.
5. **[Minor] quality** `staging.md:3`, `:72`: note that G2.5 (sitting 1) is local G7 work, separate from the G7 push (sitting 3).

## Checked and correct

Names and hosts; G2 (private repo, two branches, no secrets, pins and history scan before the first push); vendored `npm pack`, no token traces; Supabase Free/Frankfurt, 36.7 before `db push`, Einar runs link/push; OTP expiry 3600 in section 6 and pinned by test; SendGrid fields; G5 three CNAMEs, no email records; G6 Pro, fra1, noindex, Standard Protection, env per `.env.example`, per-minute cron; G6.0 truth, exact Ignored Build Step and mirror, `labak-hub` created before its Git connection; G7 push `hub-integration` only, no force; Task 29 (Einar runs browser tests, `einsi@litljomi.is` in both tenants, A6/A7/A8/A11/A15, A1–A4 re-run, phone check); undo table; no leftover Resend/GitHub Packages steps; cross-references and section numbers consistent; spec §4.4 and revision row; tests pin both `vercel.json` files with `toEqual` and the OTP expiry.
