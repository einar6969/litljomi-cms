# Task 5: spec-compliance review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02
- Change: 5ec57b4
- The reviewer's report, verbatim:

---

PASS

No Critical or Major findings. Every Task 5 requirement is met, and both deferred Minors are cleared.

Task text
- Migration: `/Users/einarzoega/litljomi-cms/supabase/migrations/20261102000200_tenancy.sql` matches the listed columns, constraints, defaults and foreign keys on `cms.tenants`, `cms.membership_role` (enum 'editor'), `cms.memberships` and `cms.platform_admins`. `memberships.created_by` is a plain uuid, as the plan has it.
- Slug trigger: `private.tenants_lock_slug()` is invoker with `search_path` pinned to empty. It is attached as BEFORE UPDATE OF slug with a WHEN old.slug is distinct from new.slug guard, and raises `slug_locked` with errcode P0001. It fires for the owner and for service_role, and both are tested.
- RLS: enabled on all three tables. `memberships` and `platform_admins` each have a select-own-row policy for `authenticated`. `tenants` has a member policy and a separate aal2 platform-admin policy. Permissive policies combine with OR, so this matches the plan's single "member or admin at aal2" rule.
- Grants: `authenticated` gets select on all three. `service_role` gets select, insert, update on `tenants` and select, insert, delete on `memberships` and `platform_admins`. Nothing goes to `anon`. All are table-level.
- Seed: `tests.seed()` in `_helpers.sql` matches the "Fixed test identities" table. It inserts labak and demo, one editor membership each, revoked's membership deleted afterwards, and platform_admin only in `platform_admins`. The emails match the table.

Step 1 assertions
- `020_tenancy.test.sql` contains every plan assertion: editor sees only the own tenant and own membership, the membership insert is refused with 42501, revoked sees no tenant, platform admin sees none at aal1 and both tenants at aal2, and the slug update fails with P0001 `slug_locked`.
- It adds privilege checks, extra negative cases for editor, anon, outsider and platform admin, and integrity checks (slug format and uniqueness, status values, single role).
- plan(42) matches the number of assertions.

Catalog additions
- `010_catalog.test.sql` now asserts RLS enabled on every cms table and `memberships.tenant_id` not null.

Deferred Minors
- "4 | security r1, Minor 1": cleared. A new assertion checks pg_default_acl for postgres, defaclnamespace = 0, objtype 'f', with no PUBLIC entry.
- "4 | quality r1, Minor 6": cleared.
  - The comment now reads "anon (hence PUBLIC)".
  - A note says the definer, search_path and anon-execute checks are vacuous until functions exist.
  - Positive has_schema_privilege asserts cover authenticated and service_role usage on api and cms, and service_role having no usage on private.
- The controller still has to mark both rows cleared in `docs/execution/deferred-minors.md`. They read `open` and the commit does not touch that file.

Extras
- `created_at not null` on both tables and the `memberships_user_id_idx` index are acceptable additions. They are not in the plan text but don't contradict it or the architecture.
- The extra catalog check that anon has no privilege on any cms relation is acceptable. It matches the catalog tests row in architecture section 8.5.

Commit message: `feat(db): tenancy tables with RLS`, as the plan specifies, with a Co-Authored-By trailer.

Contradictions with `docs/architecture.md`: none found.

Commands run
- `git show 5ec57b4 --stat`
- `git show 5ec57b4 -- supabase`
- `pnpm db:test`: Files=5, Tests=183, PASS. I did not run `pnpm db:reset`, so the "fails before the migration" half of the red-green claim rests on the implementer's report.
- Reads of the plan, the architecture and `docs/execution/deferred-minors.md`.
- `git status --porcelain` showed only the three `docs/execution` files that were already modified before the review (`environment.md`, `progress.md`, `state.json`).

---

## Controller ruling

PASS accepted. The two Task 5 rows in `deferred-minors.md` are marked cleared by 5ec57b4.
