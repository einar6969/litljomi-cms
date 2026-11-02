# Task 3 (Hosted environments runbook): security review, round 4 (scoped to 30c8a25)

- Reviewer: fresh `cms-security-reviewer` (Opus), 2026-11-02
- Change: 30c8a25 (runbook only, 13 lines in, 13 out)
- Result: **PASS**; the three round-3 Minors ADDRESSED; N1–N8 and F1–F3 still hold; 1 new Minor
- Method: fix package compared with `git diff 4c0ac84 30c8a25`; both scripts taken from 30c8a25 and diffed against the round-3 copies (exactly two changed lines each: the `EXPECT_REF` refusal message and `curl` → `curl -q`); the round-3 harness re-run on a copy (`t3r4sec/`), stub server on 127.0.0.1, argv-logging wrappers, `env -i`, /bin/bash; nothing hosted contacted.

Checklist: 1 not applicable; 2, 3 pass (no exposure or grant text changed); 4–9, 11 not applicable; 10 pass (all 11 curl calls exactly `curl -q --config -`; no fake key, token, hash or unrelated secret in argv or output; the stub received the key in headers on all 5 secret-key requests); 12 pass; 13 pass; 14 pass (no `.claude` or plan change in the commit).

Verdicts: G6.0 stops on any Git connection of the existing project to the LABAK repository, consistently at lines 25, 33, 44, 47, 56, 95, 583, 586-587, 601, 737 (the Ignored Build Step text at 602 concerns the new project, correctly); `EXPECT_REF` from Einar's Supabase dashboard (lines 164, 287, refusal messages 334 and 483; `m1-report.md` for the record only); `curl -q --config -` with `-q` first (lines 364, 498; a control test with a `trace-ascii` `.curlrc` showed `-q` keeps it from being read, and the scripts' own runs created no trace). Re-run: part 1 normal rc 0, 5 requests; part 2 normal rc 0, "H6 delete: 200 (ok)"; hostile cases (duplicate key, `$(touch …)` in the key, later URL, wrong `EXPECT_REF` in both parts, later `export URL=` in part 2) each rc 1 with 0 requests; no marker file; no URL blocked.

New finding
- Minor (plan:1476): Task 27's G7 note still says "if it would build that branch, stop and report" (the old test); it should match G6.0 ("any Git connection to the LABAK repository").

## Controller ruling
Fixed by the controller in the plan (Task 27 note now says any Git connection stops, with a pointer to G6.0).
