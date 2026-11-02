# Task 5: quality review, round 1

- Reviewer: fresh `cms-quality-reviewer` (Sonnet), 2026-11-02, after spec r2 and security r2 passed
- Change: 5ec57b4 and feb8734
- The reviewer's report, verbatim:

---

PASS

I read the four changed files (migration, `_helpers.sql`, `020_tenancy.test.sql`, `010_catalog.test.sql`). I did not run any database commands. I recounted both plans by hand: `020_tenancy.test.sql` has 44 assertions and `010_catalog.test.sql` has 19, so both `plan(n)` values match. Relying on your run of Files=5, Tests=185, PASS.

No Critical or Major findings. Each assertion would fail if its policy, grant, trigger or constraint were removed. Examples:
- Dropping `memberships_select_own` would make the editor's membership count 2 instead of 1.
- Dropping the `platform_admins` clause from the console policy is caught by the "editor with aal2 still sees only own tenant" test.
- Dropping the `aal2` check is caught by the "platform admin without MFA sees no tenants" test.
- The trigger is tested as both owner and `service_role`.

Minors:

1. [Minor] `supabase/migrations/20261102000200_tenancy.sql:~59` (`private.tenants_lock_slug`): the function raises unconditionally and relies entirely on the trigger's `WHEN` clause. If someone reuses it or removes the `WHEN`, every tenant update fails. This is touching a security-relevant trigger, so it would go back through the security review. Suggested change: a comment above the function saying "only valid with the WHEN (old.slug is distinct from new.slug) guard". No logic change.

2. [Minor] `20261102000200_tenancy.sql:memberships`: `created_by uuid` has no foreign key and no comment saying why (audit value that survives user deletion?). `platform_admins.user_id` references `auth.users` without `on delete cascade`, while `memberships` has it, so deleting a platform admin's auth user fails. That may be intended. Suggested change: add a one-line comment on each saying it is deliberate. If either is not deliberate, send it to the security review, because it touches a table definition.

3. [Minor] `020_tenancy.test.sql` (anon section): anon is tested only against `cms.tenants` (`throws_ok`, line ~58). The table-level `anon: nothing` privilege checks and the `010` catalog test cover the other tables, so this is not a hole. The test message could say "anon cannot read tenants (no privilege)" so nobody reads it as a policy test.

4. [Minor] `020_tenancy.test.sql` (about line 30): the three seed assertions check the "revoked" persona's membership only indirectly, through the exact-two-rows check. That is enough to catch a regression, but a name for the "delete after seeding" intent would help Tasks 6–12. The comment in `tests.seed()` already says it. Optional: `is_empty` on memberships for `tests.persona('revoked')`, with a message.

5. [Minor] `_helpers.sql`, `tests.persona` and `tests.tenant`: the UUIDs are duplicated against `tests/integration/src/fixtures.ts`, and the only guard is a comment. A drift would show up only in integration tests. Acceptable for now. If Task 12 adds a cross-check, this is the place.

6. [Minor] `_helpers.sql` grants: the comment "redundant today" is accurate but will be stale after Task 4. Suggested change: tag it "remove this note when Task 4 lands".

7. [Minor] `010_catalog.test.sql:~27`: the comment says "The three function checks below are vacuous…", but only the `anon`-execute check is vacuous for `api`. The SECURITY DEFINER and `search_path` checks do cover `private`, which already holds functions. Suggested change: reword to name the `api` anon-execute check only.

8. [Minor] `010_catalog.test.sql` (default-ACL check): the assertion queries `pg_default_acl` for `defaclrole = 'postgres'`, which is brittle if migrations run as another role. It is correct for the local stack. Optional: add a note on the assumption.

The seed is clear and reusable. It is owner-context only, named tenants and personas resolve through helper functions (no inline UUIDs), and it matches the plan's fixed identities. Its comment says it runs in the owner context, and `execute` is revoked from PUBLIC.

---

## Controller ruling

PASS accepted. The Minors are deferred in `deferred-minors.md`:
- **To Task 6**, which extends these migrations, the seed and the catalog tests:
  - Minor 1 (comment on the trigger function; security-relevant wording, reviewed in Task 6's security review);
  - Minor 2 (comment why `memberships.created_by` has no foreign key and why `platform_admins.user_id` has no cascade);
  - Minors 3, 4, 6, 7 and 8 (test wording and comments).
- **To Task 12:** Minor 5 (cross-check the fixture UUIDs against `tests/integration/src/fixtures.ts`).
