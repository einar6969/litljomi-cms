# Task 3 (Hosted environments runbook): quality review, round 2

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02
- Changes: 9d15d26 (quality fixes), fc9e807 (final security Minors)
- Result: **APPROVED** (no Critical or Important; 6 Minor). Env test 6/6; lint clean; working tree untouched.

Round 1 verdicts (verbatim in substance): Important 1 ADDRESSED (G3.4 names its rows at :161; section 6 Step column; section 3 row 5 points at it). Important 2 ADDRESSED (`CMS_WEBHOOK_SECRETS` excluded in G6.2 and section 3; G6.5 deploys the sites without it on purpose; P-2 sets and verifies it). Important 3 ADDRESSED (dashboard the executor's only route; the API route Einar's with PAT handling, `REF` checks and revocation, :221–244; sections 12 and 16 match). Important 4 ADDRESSED (rule in section 1 :35; 2a–2e, 4a–4e, H5a/b, H6a/b; 4a gates 4b; references resolve). Minors 5–13 ADDRESSED (canonical statements with pointers; SMTP table a headed subsection at the end of section 8; G6.3/G6.4 checks after G6.5; rate-limit reason; `$NEXT_PUBLIC_*` and `exit 1`; `SITE_PROJECT` with `--cwd`; `data_line`/`expect`, "keep identical" notes, stderr refusals; terminology mapping at :32, :36; contents list). Env-test notes ADDRESSED (comment, file-naming messages, duplicates caught in both sources). No dangling references (2a–2e, 4a–4e, H5a/b, H6a/b, "If any check fails"); section 3 sequencing consistent; no contradictions introduced.

New Minor
1. :38, :695: placeholders used in commands (`<project>`, `<team>`, `<site-project>`, `<field-name>`, `<schema>`) are missing from section 1's placeholder list.
2. :728: P-2 relies on `~/vercel-link/<project>` without pointing to G6.2 "Selecting the Vercel project".
3. :737: "`select count(*) from vault.secrets;` increased by one per site" does not say to record the count before P-2.
4. :159, :211: G3.4's Owner says "Executor", but the secure-password-change fallback is Einar's; add "(Einar for the Management API fallback, section 6)".
5. :221, :116: "as in G2.5" yet "never exported", while G2.5's pattern exports inside the subshell; reword.
6. :184–193: the URL check's `exit 1` would close an interactive shell; say to paste it into `bash -c`, a script file, or `( … )`.

## Controller ruling
Approved. The six Minors are wording and navigation fixes in a document executed only in Task 28 (under gates, with its own security review); they are parked and carried to Task 28's first step (recorded in Task 3's notes).
