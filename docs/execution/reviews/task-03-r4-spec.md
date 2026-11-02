# Task 3 (Hosted environments runbook): spec review, round 4 (scoped to the quality fixes, 9d15d26)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Result: **PASS** (no Critical or Important; 2 Minor)

(a) Quality findings applied: Important 1 (G3.4 rows listed by name at :161, row 5 points at them, section 6 Step column); Important 2 (G6.2 excludes `CMS_WEBHOOK_SECRETS`; section 3, G6.5 and P-2 say the sites deploy without it on purpose; P-2 verifies it); Important 3 (dashboard the executor's only route; the Management API route Einar's alone, :221-240; sections 12 and 16 match); Important 4 (every SQL block a single statement, 2a–2e, 4a–4e, H5a/b, H6a/b; 4b gated on 4a `true`). Minors 5–13 applied (canonical statements with pointers; SMTP table after G4.3; settings and live checks split; rate-limit reason; `$NEXT_PUBLIC_*` and `exit 1`; `--cwd` project selection; helper renames and "keep identical" notes; terminology and Task 29 item/A11 mapping stated once; contents list). Env test: file-naming messages, duplicates checked in both files, long comment split, empty-values test kept; the two "Consider" items not adopted.
(b) Task 3 requirements hold (Step 1 list, decisions 20 and 21, G2–G7 boundaries, upgrade markers, variable table vs `.env.example`, nothing executed); no content lost in the deduplication.
(c) Additions within scope: Einar's Management API block (hidden prompt in a subshell, token off every command line, prints only an HTTP code and the value); `~/vercel-link/<project>` with `--cwd` and the project-ID comparison, applied consistently; `NODE_AUTH_TOKEN` in G6.2's verify matches its setting step ("confirm at execution time").

Minor
- staging.md:412, :565 (and :555): part 1's "points at … not …" refusal and part 2's usage refusal still print to stdout (no secret; only inconsistent with Minor 11).
- staging.md:691: the executor reading `~/vercel-link/<project>/.vercel/project.json` and running `vercel env ls` implies Einar's Vercel login and a path outside the repository, not said explicitly; covered by "confirm at execution time" and P5; no change asked.

The reviewer's own `pnpm vitest run tools/checks` printed only certificate-trust noise; it relied on the controller's 123/123.

## Controller ruling
Both Minors parked (cosmetic; the second is covered by the runbook's execution-time confirmation and P5). Recorded for Task 28.
