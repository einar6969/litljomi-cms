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
| 4 | security r1, Minor 1 | `010_catalog.test.sql:23-24`: nothing asserts that the global default revoke exists (anon-executes-nothing passes trivially while `api` is empty); assert a `pg_default_acl` row for postgres, `defaclnamespace = 0`, objtype `f`, with no PUBLIC entry (`task-04-r1-security.md`) | Task 5 (extends `010_catalog`) | cleared 5ec57b4 |
| 4 | security r1, Minor 2 | `010_catalog.test.sql:15-20`: definer and `search_path` checks cover only `api`, `cms`, `private`; §4.2 says no SECURITY DEFINER anywhere, and Supabase's per-schema default ACLs still grant EXECUTE/ALL to anon, authenticated, service_role in `public` and `storage`; widen to every postgres-owned function (`task-04-r1-security.md`) | Task 8 | open |
| 4 | quality r1, Minors 1–3, 5 | `012_auth_hook.test.sql`: select the "amr missing" row by `a.amr is null`, not by label; comment the `plan(81)` arithmetic; add refused amr cases `[null]`, `[{"method": null}]`, `[{"method": 1}]`; note or drop the PG17-only `MAINTAIN` privilege (`task-04-r1-quality.md`) | Task 12 | open |
| 4 | quality r1, Minor 4 (security-relevant) | An allowed method with no `claims` or JSON-null `claims` returns `{"claims": null}`; Auth answers 500 (fails closed, N1 evidence :23), but nothing pins it. Add a test or comment; Task 12's security review decides whether the hook should refuse instead (`task-04-r1-quality.md`, `task-04-r1-security.md`) | Task 12 | open |
| 4 | quality r1, Minor 6 | `010_catalog.test.sql`: comment "anon (hence PUBLIC)"; a note that the definer/search_path/anon checks are vacuous until functions exist; positive `has_schema_privilege` asserts (authenticated and service_role usage on `api` and `cms`; service_role none on `private`) (`task-04-r1-quality.md`) | Task 5 | cleared 5ec57b4 |
| 4 | quality r1, Minor 7 | `supabase-config.test.ts`: say why both the "none of public, cms, private" and the "exactly [\"api\"]" tests exist, or merge them (`task-04-r1-quality.md`) | C1 | open |
| workflow update | security r2, M1 | `state.mjs`: `atCommits` counts recorded commits, not the reviewed hash; record the HEAD the reviewer saw or compare with git (`workflow-update-r2-security.md`). Controller records every fix commit meanwhile | C1 | open |
| workflow update | security r2, M2 | Plan step 3: the low-tier checklist-subject list is narrower than the 14 items (items 6, 12); say "anything the 14-item checklist covers"; `start` could also require `status: reported` with approval. Controller applies all 14 items meanwhile | C1 | open |
| workflow update | security r2, M3 | Plan: a Lane B merge with manual conflict resolution in security-relevant files, or a lockfile change beyond the reviewed `package.json`, gets a fix-diff security review. Controller applies it meanwhile | C1 | open |
| workflow update | spec-quality r2 | `state.mjs` `done`: stale-security refusal is a template literal with no interpolation (cosmetic) | C1 | open |
| 13 | spec-quality r1 | `link.ts:40`: `link.project` returns the stored value and its projected type is `LinkValue`, while `tsType()` says `{ entry: EntrySummary \| null }`; Task 15 must edit `link.ts` so an unpublished entry projects to null (`task-13-r1-spec-quality.md`) | Task 15 | open |
| 13 | spec-quality r1 | `FieldKind.withOptions` must be implemented by Task 15's `image` and `richText`, or `extendType` overrides on them fail (Task 16's LABAK overrides) (`task-13-r1-spec-quality.md`) | Task 15 | open |
| 13 | spec-quality r1 | Quality: `preview`/`orderBy`/`transforms` shape duplicated in `define-type.ts`; `ProjectionContext` comments overlap; comment that `queryColumns` yields null for non-string fields; comment on the `ref.ts` double cast; tests for draft `date` `''`, `preview.media`, `extendType` keeping `name`/`version`/`transforms` (`task-13-r1-spec-quality.md`) | Task 15 | open |
| 13 | spec-quality r1 | Process: failing-test-first order reversed (failure produced by moving `index.ts` away); the reviewer traced every claimed behaviour to a test that would fail (`task-13-r1-spec-quality.md`) | C1 | open |
| 13 | spec-quality r1 (security note) | `link.ts:16-23` `isSafeHref`: WHATWG URL parsing strips embedded tabs and newlines, so the stored href is not normalized (no protocol bypass) (`task-13-r1-spec-quality.md`) | Task 18 security review | open |
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
