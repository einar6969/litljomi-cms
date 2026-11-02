# Task 3 (Hosted environments runbook): spec review, round 3 (scoped to fix round 2)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Changes: 6a5f940 (runbook) and controller commit 898d834 (Task 27 G7 note)
- Result: **PASS** (no Critical or Important; 4 Minor notes)

(a) Rulings applied as stated: N1 (`.env.local` read, never sourced; duplicate, non-plain or malformed names refused; URL shape asserted and target host printed before any request; the `.env` Edit/Write deny raised as a `.claude/**` change in the open items); N2 (URL checks before G3.3 and the sign-up check; local-stack URL refused); N3 (new step G6.0 with owner, when, settings, verify, stop-and-report, wired into P3, sequence rows 0, 3, 12, G2.5, G6.1); N4 ("Entering a token": `read -rs`, subshell, export inside only, `unset`); N5 (conventions bullet and section 12 sentence); N6 (`call` returns `curl error <n>`; every part-1 failure ends with `FAILED:` and its hint; refresh skipped after a failed verify; part 2 handles transport errors); N8 (`has_any_column_privilege` query). `EXPECT_REF` and the key-character restriction stay within N1 ("the URL must be `https://<project-ref>.supabase.co`", "refuse malformed values"), stated with "stop and report, do not loosen the check".
(b) Task 3 requirements still met; section 13 unchanged; nothing executed; only the runbook changed.
(c) The Task 27 note adds exactly ruling N7's two items; the runbook open item says the same.
(d) Minor notes: ENV_FILE hard-codes `/Users/einarzoega/litljomi-cms/.env.local` (works; a choice to confirm); `KEY_RE` refuses quoted values and CRLF line endings (conservative; a quoted value stops the run); G6.2 describes piping the read token to `vercel env add` without a command block (Vercel CLI details are "confirm at execution time"); G6.0 depends on Einar reading the existing project's Settings → Git (the runbook says stop and report if he cannot tell).
Commands: read-only git and greps; tests and scripts not re-run (controller's run relied on).

## Controller note
The four notes need no change; the hard-coded path and the strict value format are reported to Einar with the checkpoint.
