# Task 4: quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02, after spec r1 and security r1 passed
- Change: c6ad33f
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major issues. `pnpm db:test` passes (4 files, 132 tests). `pnpm vitest run tools/checks/__tests__/supabase-config.test.ts` ran, but the macOS certificate noise filled the tail of its output, so I didn't see a pass/fail line. `git status --porcelain` was empty after my commands. The pgTAP plan counts add up: 10 in 010 and 81 in 012 (23 method cases, 42 amr cases, 6 definition checks, 5 grant checks, 5 for supabase_auth_admin).

**Minor**

1. `supabase/tests/database/012_auth_hook.test.sql` (the `insert into cases ... from base b, amr_cases a` block, about line 85): the "amr missing" row is picked out by comparing the label string (`a.label = 'amr missing'`). Renaming the label would silently turn it into a JSON-null case. Suggested change: use `case when a.amr is null then b.claims - 'amr' else jsonb_set(b.claims, '{amr}', a.amr) end`, with no `coalesce`. The `'amr JSON null'` row already holds `'null'::jsonb`, which is not SQL NULL, so the two cases stay distinct.

2. `012_auth_hook.test.sql`, `select plan(81)`: the count is a magic number. Every new case row changes it, and the only error is a plan mismatch. Suggested change: add a comment with the arithmetic (23 + 42 + 6 + 5 + 5). This test file does not touch the hook body, but the hook itself is security-relevant.

3. `012_auth_hook.test.sql`, malformed amr shapes: the cases cover `["otp"]` and `[{"x":"otp"}]`. There is no case for `[null]`, `[{"method": null}]` or `[{"method": 1}]`. The `coalesce(..., true)` branch that fails closed on a NULL method is only reached by the `[{"x":"otp"}]` case. Suggested change: add those three amr cases, each refused. Adding tests is not a change to security code.

4. `012_auth_hook.test.sql`: no case sends an event with no `claims` key, or with `claims` as JSON null, and an allowed method such as `otp`. The hook then returns `{"claims": null}` (a "success" with no claims), and nothing pins that behaviour. **Security-relevant.** This is a question for the security reviewer or controller, not a quality fix. If the answer is "must refuse", the hook body changes and goes back through security review. If the answer is "Auth never sends this", a test or a comment should say so.

5. `012_auth_hook.test.sql`, the table-privilege `is_empty`: `'MAINTAIN'` in the `has_table_privilege` privilege list exists only in PostgreSQL 17 and later. The test passes on the current local stack. On an older Postgres it would error rather than fail cleanly. Suggested change: add a short comment that the check assumes PG17+, or drop the `MAINTAIN` privilege.

6. `supabase/tests/database/010_catalog.test.sql`:
   - **Description mismatch.** The last assertion is described as "nothing in api is executable by anon or PUBLIC" in the comment, but it checks only `anon`. The check does cover PUBLIC in effect, because anon inherits it. Suggested change: align the comment to "anon (hence PUBLIC)".
   - **Vacuous passes.** Today `api`, `cms` and `private` hold only the hook, so the "no security definer", "search_path pinned" and "anon executes nothing in api" assertions pass trivially. They only become real once later tasks add functions. That is acceptable, and the file header says later tasks extend it. A one-line note would help the next reader.
   - **Missing positive checks.** Nothing asserts that `authenticated` and `service_role` have usage on `api` and `cms`, or that `service_role` has no usage on `private`. The migration comments claim all of this. Suggested change: add three `has_schema_privilege` asserts. These asserts check grants. They do not change grants.
   - **Missing messages.** The three `has_schema` calls have no description, so the pgTAP default text is used. This is fine.

7. `tools/checks/__tests__/supabase-config.test.ts`: the test "schemas is a non-empty list that exposes none of public, cms, private" is subsumed by the next test, "schemas is exactly ["api"]". The two overlap but fail with different messages. The first states the invariant and the second states the current decision, so keeping both is defensible. Suggested change: add a comment saying why both exist, or merge them.

**Positive notes**
- The data-driven `cases` table orders by label, and its labels are unique. The `is()` messages name the method and the expected outcome, and the tests assert the exact refusal JSON, so a regression would fail clearly.
- The `setting()` helper in the config test throws a message that names the missing path.
- The tightened `throws_ok` in `001_helpers.test.sql` now matches the specific missing-EXECUTE message instead of any 42501. The message is locale-dependent but fine here.
- The hook's comments explain why the NULL-safe separate checks exist.

No suggestion above asks for a change to the hook body, grants, default privileges or exposure, except item 4, which I have flagged for the security reviewer.

---

## Controller ruling

PASS accepted. The controller's own run of the config test shows 12 passed.

Item 4 (absent or null `claims`) was already examined by the independent security review (`task-04-r1-security.md`, "Other notes"). The hook returns `{"claims": null}`, and the N1 evidence (`n1-passwordless-investigation.md:23`) shows that Supabase Auth answers that with HTTP 500, so it fails closed. The rating stays Minor. A test or comment pinning it is deferred to Task 12, which adds the hook's HTTP regression. The security reviewer of that round must decide whether a refusal in the hook body is wanted.

The Minors are deferred in `docs/execution/deferred-minors.md`:
- items 1–5 (`012_auth_hook.test.sql`) go to Task 12;
- item 6 (`010_catalog.test.sql`) goes to Task 5, which extends that file;
- item 7 (config test comment) goes to checkpoint C1.
