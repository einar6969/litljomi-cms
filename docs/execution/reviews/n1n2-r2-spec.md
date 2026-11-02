# Decisions 18 and 19 (N1, N2): spec review, round 2 (scoped)

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Changes: cef9a95 (plan and spec rulings, Einar's words quoted, probes copied), 1670c80 and 87ad497 (config test)
- Result: **PASS** (no Critical or Important; 1 Minor note)

Report (verbatim in substance):
(a) Rulings applied as stated: Step C1 now requires a non-empty list containing none of `public`, `cms`, `private` (plan:488). Minors 2 and 3 in Task 4 Step 4b (unchanged claims, exact 403 body, `mfa/recovery_code`, `mfa/webauthn`, `mfa/phone`, `passkey`, positive and negative `amr` cases, `plpgsql`/`stable`, `search_path` `''`, grantees exactly owner plus `supabase_auth_admin` via `aclexplode`, nothing else for `supabase_auth_admin` in `api`, `cms`, `private`). Minor 4: Task 4 Files line for the config test (hook enabled with URI, `schemas == ["api"]`). Minor 7: runbook revokes all sessions on first enable (`delete from auth.sessions;` as an example; access tokens last at most an hour). Minor 9: two new Task 12 lines (old-address-only and PKCE email change; later magic link aal1; `/reauthenticate` issues no token). Minor 5: architecture.md:232 "one of these email methods or `totp`", the only spec change. Minor 6: limitations listed in decision 18 and the runbook; `secure_password_change` only as a limitation. Minor 8: runbook cleanup added; no recurring check added. Minor 11: decisions 18 and 19 quote Einar exactly. No hook implementation; only architecture.md, the plan and the one test file touched in code/text; no new auth service.
Minor (note): decision 18's "verified on local GoTrue v2.197.0 only until Task 29" is accurate and meets the hosted-verification instruction.
(b) Test change: 1670c80 adds `Array.isArray(schemas)` and `schemas.length > 0` and renames the test, keeping the `not.toContain` loop; 87ad497 removes only the `SUPABASE_CONFIG_PATH` override (path from `import.meta.url`); other assertions untouched.
(c) Probes: byte-identical to the originals (`cmp`, `diff -rq`); the README lists exactly what is copied; no key patterns; the `probe_method` note is correct.
Commands: read-only (`git status/diff/show`, `cmp`, `diff -rq`, greps, reads). Working tree unchanged by the reviewer.
