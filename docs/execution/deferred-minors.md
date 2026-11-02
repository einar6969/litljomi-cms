# Deferred Minors

> Written by the controller only (plan, "Findings, deferred Minors and escalation", Einar 2026-11-02). One row per Minor finding that did not block its review. A row is **cleared** by its owning task (with the commit) or **reviewed** at the next checkpoint, where Einar sees every open row. Statuses: `open`, `cleared <commit>`, `accepted` (with the reason), `moved <owner>`.

## Open and cleared

| Task | Round | Finding (report) | Owner | Status |
|---|---|---|---|---|
| 2 | security r4 | `001_helpers.test.sql:23-25`: the `seed()` denial `throws_ok(..., '42501', null, ...)` accepts any 42501; expect the message `permission denied for function seed` (`task-02-r4-security.md`) | Task 4 | cleared c6ad33f |
| 2 (N1/N2 correction) | quality r1, Minor 1 | `supabase-config.test.ts`: a missing section fails with a TypeError that does not name the setting; a `setting(path)` helper with a clear message (`n1n2-r1-quality.md`) | Task 4 | cleared c6ad33f |
| 2 (N1/N2 correction) | quality r1, Minor 2 | `supabase-config.test.ts:37`: `Array.isArray(...)` check gives no cause; add a message or `toBeInstanceOf(Array)` (`n1n2-r1-quality.md`) | Task 4 | cleared c6ad33f |
| 2 (N1/N2 correction) | quality r1, Minor 3 | `supabase-config.test.ts:39-41`: inline forbidden list; a named constant such as `NEVER_EXPOSED` (`n1n2-r1-quality.md`) | Task 4 | cleared c6ad33f |
| 2 (N1/N2 correction) | quality r1, Minor 4 | `supabase-config.test.ts`: two assertions share one `it`; one test per setting, e.g. `it.each` (`n1n2-r1-quality.md`) | Task 4 | cleared c6ad33f |
| 4 | security r1, Minor 1 | `010_catalog.test.sql:23-24`: nothing asserts that the global default revoke exists (anon-executes-nothing passes trivially while `api` is empty); assert a `pg_default_acl` row for postgres, `defaclnamespace = 0`, objtype `f`, with no PUBLIC entry (`task-04-r1-security.md`) | Task 5 (extends `010_catalog`) | open |
| 4 | security r1, Minor 2 | `010_catalog.test.sql:15-20`: definer and `search_path` checks cover only `api`, `cms`, `private`; §4.2 says no SECURITY DEFINER anywhere, and Supabase's per-schema default ACLs still grant EXECUTE/ALL to anon, authenticated, service_role in `public` and `storage`; widen to every postgres-owned function (`task-04-r1-security.md`) | Task 8 | open |
| 3 | quality r2, Minors 1–6 | `docs/runbooks/staging.md`: placeholder list; P-2 pointer to G6.2; record the `vault.secrets` count before P-2; G3.4 owner note for the Management API fallback; "as in G2.5 but not exported" wording; wrap the URL check so `exit 1` does not close the shell (`task-03-r2-quality.md`) | Task 28 (before executing the runbook) | open |
| 3 | security r6, Minors 1–2 | `staging.md:226` whole-string `REF` check; `staging.md:737` "less likely to be swapped" wording (`task-03-r6-security.md`) | Task 28 | open |
| 3 | spec r4, Minor 2 | `vercel link` implies Einar's Vercel login, outside the repository (`task-03-r4-spec.md`) | Task 28 | open |

## Carried from Phase 0 before ratings existed

Parked items from Task 1, recorded in its notes in `state.json` with their IDs; listed here so this file is the single list.

| Task | Item | Owner | Status |
|---|---|---|---|
| 1 | N1: backslash path separators in the lint path regexes | Task 17 | open |
| 1 | Q3-1, Q3-2: comment wording at `eslint.config.mjs:57`; temp-dir cleanup style | Task 17 | open |
| 1 | C-F1: require the `check:slugs` roots once `apps/cms/src` exists | Task 17 | open |
| 1 | C-S2b, S6 (apps), S11: decisions on `@supabase/supabase-js` outside `privileged/`, app package-name imports, the worker/cron route exception | Task 17 | open |
| 1 | S6 (modules): module-to-module imports | Task 16 | open |
| 1 | S12: SHA-pin the GitHub Actions | G2 | open |
