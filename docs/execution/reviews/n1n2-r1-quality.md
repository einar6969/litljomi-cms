# Task 2 correction (decision 19): quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02
- Change: 84b2899, 1670c80, 87ad497 (code only)
- Result: **APPROVED** (no Critical or Important; 5 Minor). `pnpm vitest run tools/checks` 116 pass (5 in the new file); `pnpm lint` clean; working tree clean.

The tests assert behaviour; each fails when its setting regresses to a wrong value, a missing key (`undefined` fails `toBe(true)`) or `[]` for `schemas`. The file is easy for Task 4 to extend (path anchored to the file, one `describe`, one `it` per setting).

Minor (verbatim in substance)
1. supabase-config.test.ts:30-31 (also :22-27, :36): a missing `[auth.mfa]`, `[auth.mfa.totp]`, `[auth.email]` or `[api]` section fails with a TypeError that does not name the setting; a `setting(path)` helper that throws "supabase/config.toml: missing auth.mfa.totp.enroll_enabled" would, and lets the cast type at 10-14 go.
2. :37: `expect(Array.isArray(schemas)).toBe(true)` gives no cause; use a message or `toBeInstanceOf(Array)`.
3. :39-41: the forbidden list is an inline literal; a named constant (e.g. `NEVER_EXPOSED`) helps Task 4.
4. :22-23, :31-32: two assertions share one `it`; `it.each` over `[path, expected]` would report each separately (acceptable as is).
5. package.json:6-8: `engines` reformatted from one line to three (tool churn, harmless).

## Controller ruling
Minors 1–4 are carried to Task 4, which extends this test (recorded in Task 2's notes); Minor 5 needs no change.
