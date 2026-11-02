# Task 3 (Hosted environments runbook): quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02
- Change: final state 30c8a25 (runbook in full; `.env.example` and the env test since 7e9aea2)
- Result: **CHANGES REQUESTED** (4 Important, 9 Minor, plus env-test notes). Env test 4/4; lint clean; working tree untouched.
- Package line = file line + 132.

Important (verbatim in substance)
1. Section 5 G3.4 "Settings" (pkg 273): "every row of section 6 except SMTP, the rate limit and the URLs" also covers exposed schemas (G3.3), the hook (G3.5) and email templates (Task 22), and the first two cannot exist before G3.2; section 3 row 5 (pkg 181) words the exclusion differently ("except SMTP and the Site URL"). List G3.4's rows by name; point section 3 row 5 at them; consider a "Step" column in section 6.
2. Section 10 G6.2 (pkg 740-741) vs section 3 rows 15-17 and P-2: G6.2 requires exactly section 13's variables, but `CMS_WEBHOOK_SECRETS` is created in P-2 after G6.5, so G6.2's verify fails at order 15 and G6.5 deploys the sites without it. Exclude it in G6.2, verify it in P-2, say G6.5 deploys the sites without it on purpose.
3. Section 6 "Secure password change" row (pkg 320): offers `PATCH /v1/projects/<project-ref>/config/auth` (Management API) in an executor step; it needs a Supabase personal access token (a secret), contradicting sections 1 and 12. Make that path Einar's, or keep the dashboard as the executor's only route; route back through security review.
4. Section 7.1 steps 2 and 4, H5, H6 (pkg 346-382, 386-393, 567-575, 640-643): blocks with several `select`s; the SQL editor may show only the last result, so a pass could be recorded without seeing the others; in step 4 the `has_table_privilege` check and the `delete` share a block, so the check cannot gate the delete. Split into numbered single statements (confirm the editor behaviour at execution time); put the privilege check in its own block that must return `true` first.

Minor
5. Duplicated narrative that can drift (LABAK/Vercel approval text in section 1 twice, G6.0, G6.1, two section 16 rows; the 100/hour limit in G3.6, section 6, section 16; token scopes in G2.5, section 12 twice, G6.2): keep one canonical statement and point to it.
6. Section 8: the unnumbered "SMTP settings in Supabase Auth" table sits between G4.2 and G4.3; move it.
7. Section 3 rows 15-16 list G6.2–G6.4 before G6.5, but G6.3/G6.4 verify after G6.5; say so.
8. Section 6 email rate limit row: "Why" just says "G3.6"; use G3.6's reason.
9. Section 6 uses `$URL`/`$PK`, G3.3 writes `$NEXT_PUBLIC_SUPABASE_URL`; pick one; the URL check block prints "stop" without `exit 1`.
10. Section 11 P-2: `vercel env add … in the site's Vercel project` does not say how the project is selected; name it (wrong project = webhook secret on the wrong site).
11. Scripts: `body()` vs `BODY` differ only in case; `check()` too generic; `env_value` duplicated in part 2 without a "keep identical" note; the `EXPECT_REF` refusal prints to stdout, `env_value` refusals to stderr.
12. Terminology: "Executor" vs "executor"; "Task 29 criterion 11" vs "A11" — define the mapping once.
13. No contents list in ~750 lines; add one ("execution order is section 3; sections 4–11 are reference by gate").

Env test (passes on its own terms: bounded section, rename-tolerant heading regex, missing heading throws, empty table blocked, both directions with named variables, a commented-out variable caught)
- Line 56 comment over 120 characters (lint silent).
- Lines 96-99: "names at least one variable" has no message saying which file.
- Lines 64-71, 77-90: duplicate names collapse in a Map/Set; a duplicated line or row passes silently.
- Consider: tie the "SECRET" comments in `.env.example` to the table's "Secret" column (touches secret classification; would need security review).
- Consider: a test that every "section N" cross-reference resolves (new scope).
