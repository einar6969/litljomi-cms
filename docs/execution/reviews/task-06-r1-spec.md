# Task 6: spec-compliance review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-02 (told not to run the database suite; the parallel security reviewer used it)
- Change: bcbc955
- The reviewer's report, verbatim:

---

PASS

I found no Critical or Major findings. I read the code and tests only. I did not run `pnpm db:test` or `pnpm db:reset`, and I relied on the controller's output (Files=6, Tests=282 PASS).

Commands run: `git show bcbc955 --stat`, `git show bcbc955 -- <tenancy, _helpers, 010, 020>`, `cat` of the 20261102000300_content.sql migration and 030_content.test.sql, `sed` of Task 6 in the plan, `grep` of `deferred-minors.md` and `architecture.md`, `git status --porcelain`. The status output shows only the controller's three `docs/execution/` files; I modified nothing.

Interfaces checked against the task text, all met:
- **Tables:** columns, types, defaults, `unique (tenant_id, id)`, the partial unique index and the composite FKs match. `drafts` has the slug-format check and the object/1 MB check. The `entries_published_rev_fkey` is MATCH SIMPLE.
- **Triggers:** `drafts_bump_version`, `entries_lock_slug` and `force_actor` are in `private`, invoker, with `search_path` set. `force_actor` is attached as `entries` BEFORE INSERT (`created_by`) and `drafts` BEFORE INSERT OR UPDATE (`updated_by`). It takes the column name as its trigger argument.
- **RLS:** enabled on all three tables, with membership `EXISTS` policies for select, insert and update on `entries` and `drafts`, and select on `revisions`. No platform-admin clause.
- **Grants:** per-column grants to `authenticated` and `service_role` match §4.5 exactly. `anon` has nothing, and there is no UPDATE or DELETE on `revisions` for any API role.

Step 1: every plan assertion is present in `030_content.test.sql`. That covers isolation, worker-owned columns, integrity, slugs, actor spoofing, `revisions` not updatable or deletable, and the slug lock with `P0001` / `slug_locked`. Extra cases are added: column-privilege sets, FK cross-tenant cases, revoked, outsider, platform_admin and anon, pointer FK cases, and a later-BEFORE-trigger probe.

Deferred Minors (Task 5 quality r1, Minors 1–4 and 6–8) are all cleared:
- Minor 1 (the `WHEN`-guard comment): the lock function now re-checks the condition itself, and the comment says so.
- Minor 2: the comments for `memberships.created_by` having no FK and `platform_admins.user_id` having no cascade are in place.
- Minor 3: the anon test message now reads "(no privilege)".
- Minor 4: an explicit revoked-membership check was added to 020.
- Minor 6: the stale "redundant today" note in `_helpers.sql` is replaced.
- Minor 7: the vacuous-check comment in 010 now names only the `api` anon-execute check.
- Minor 8: the `pg_default_acl` role assumption is noted.

The trigger-order gap is cleared for both `tenants` and `entries` by the AFTER UPDATE triggers. Each has a probe test: a `zz_` BEFORE trigger that changes the slug is still caught.

Implementer's deliberate differences:
- [Minor] `20261102000300_content.sql` (`entries_lock_slug`) and `20261102000200_tenancy.sql` (`tenants_lock_slug`): the plan says "BEFORE UPDATE OF slug". The change uses AFTER UPDATE on every update, with a `WHEN` guard and the function re-checking the condition.
  - The behaviour is the same (`P0001` / `slug_locked`, rolled back), and it is stronger against trigger order.
  - The spec text I searched (`architecture.md`) names no timing, so this is no contradiction. It does differ from the literal plan text, and it is what the controller assigned to clear the deferred Minor.
- [Minor] `030_content.test.sql` (actor test): the plan's `order by created_at desc limit 1` is non-deterministic within one transaction. Selecting by slug is a sound replacement and still tests that `created_by` is forced to `auth.uid()`.
- [Minor] `not null` on `created_at`, `updated_at` and `committed_at`: this goes beyond the plan's interface but contradicts nothing. It is consistent with the defaults.

Other Minor:
- [Minor] The commit message subject matches the plan. The trailer reads "Claude Opus 5.5", while the attribution reminder given to the reviewers says "Claude Sonnet 5.5". The controller may want to check which is intended.

---

## Controller ruling

PASS accepted. The three plan differences are accepted. The AFTER-trigger slug locks are the controller's assignment for the trigger-order Minor, and the plan's "BEFORE UPDATE OF slug" wording goes to C1 for a plan wording update. The trailer is correct: Task 6's implementer ran on Opus (high tier).
