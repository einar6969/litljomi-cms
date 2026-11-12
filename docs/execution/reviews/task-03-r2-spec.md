# Task 3 (Hosted environments runbook): spec review, round 2 (scoped to fix round 1)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Change: 771127c (`docs/runbooks/production.md` only)
- Result: **PASS** (1 Minor)

(a) Rulings applied as stated: F1 (part 1 asserts every result through `expect()` and exits 1 on mismatch; no cleanup trap; H5 runs while the account exists; part 2 and H6 a separate final step; on failure the account is kept as evidence until failure-handling step 4); F2 (`curl --config -` fed by `printf` and `jq` on stdin; no secret on a command line); F3 (Standard Protection on all three projects; `labak-hub-staging` builds limited to `hub-integration` via the Ignored Build Step, confirm at execution time, stop and report if absent; connecting the LABAK repository needs Einar's explicit approval at G6 and G7, also an open item and in the sequence table); Minors 1, 3–10 at the cited lines; Minor 2 (reason that stays true after Task 4; `ask`-rule gap raised for Einar; `.claude/**` untouched); spec Minor 1 (upgrade marker in sequence row 12) and spec Minor 2 (where secure password change is set, confirm at execution time, record which). Only the runbook changed; the section 13 table and `.env.example` untouched.
(b) Task 3 requirements still met: every G2–G6 step with owner, settings and verification; paid-step markers; Step 1 list complete; decision 20 (when, checks, expected results, failure handling, automation deferred); decision 21 matches Einar's wording (additional protection only; not fresh email verification for every change; no reauthentication under 24 hours); nothing executed; gates kept separate; off-limits list intact.
(c) New open items raised, not decided.

Minor: staging.md:481 vs plan line 142 (and brief line 31): the plan says the staging hostnames have "no deployment protection"; the runbook applies Standard Protection (production domains public, previews protected), per ruling F3; A15 still holds because the staging hostnames are the production domains. Differs from the plan's literal wording: note it as the ruled interpretation or raise it with Einar.

## Controller note
The Standard Protection reading is ruling F3; it is presented to Einar with the checkpoint as a deliberate interpretation of the plan's "without deployment protection" (the staging hostnames themselves stay unprotected).
