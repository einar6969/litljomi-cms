PASS

I read the diffs of `feb827c` (credentials) and `10dbbb5~1..7caffe3` (cleanup) by hand. Note that `10dbbb5~1` is `feb827c`, so your diff range excludes the credentials commit. I took that one from `git show feb827c`. I did not re-run any test suite; the counts below are the implementer's, and I checked them by reading only.

Commands run (all read-only): `git diff --stat`, `git diff` and `git show feb827c`, plus `grep` and `sed` on `tools/harness/state.mjs`, `docs/architecture.md`, the plan and the pgTAP files. `git status --porcelain` shows only ` M docs/execution/deferred-minors.md`, which was already modified before I started and which I did not touch.

**spec: ruling 5, credentials in links.** Met.
- `isSafeHref` in `packages/schema/src/fields/link.ts` and in `packages/rich-text/src/doc-schema.ts` now also requires an empty `username` and `password`. The two copies stay identical, as the existing comment requires.
- The tests cover `labak.is@evil.com`, `u:p@`, `user@`, `:secret@` and upper-case scheme and user.
- They also check that an empty userinfo (`https://@x.is`, which canonicalises to `https://x.is/`) and `mailto:u:p@x.is` still pass.
- A Tiptap paste test checks that a credentialed link is dropped and the result still parses.
- The 11 failures before the fix are plausible: 5 cases × 2 packages plus the paste test.

**spec: the dispositions.** Each one I checked is in the diff and correct.
- **Task 4 q M7 comment:** added.
- **`state.mjs` template literal:** now a plain string.
- **Entry-points walker:**
  - It adds a `<computed import>` marker for `import(x)`, `` import(`…${}`) `` and `require(x)`.
  - The first test asserts the marker is absent. A new test, with temp-file fixtures, shows the marker is recorded for computed imports and not for a literal one.
  - It also flags literal template strings and code in comments, which is fail-closed and acceptable.
- **`refs` migration comments:** the btree limit and the XX000 guard are documented.
- **040:**
  - The `temp_bytes` bound is added at both probe sites.
  - A `work_mem = 4MB` precondition is added, and the plan moves 187 to 188 accordingly.
- **050:** the `register_asset` filename comment, the exact id set, the header glosses, and the test names. The names say "checked at the end of the file", and I confirmed the closing `results_eq` on `storage.objects` exists.
- **060:** the header, the loose `indpred` match (`matches`), the collation comment, the id sets, and the rename comment.
- **`audit_log` INSERT:** it now covers every column except `id`.
  - Two `throws_ok` tests with 42501 and `OVERRIDING SYSTEM VALUE` (editor and `service_role`) show the id column cannot be named.
  - `table_privs_are` and a `set_eq` on column privileges check the exact grants.
  - The plan counts match: 081→83 in 070 and 160→163 in 080.
  - It is consistent with spec §4.5, which says `INSERT` only, and with §4.7.
- **`request_publish`:** the check is now `not exists (… status = 'active')`, so it fails closed.
  - The new test hides the tenant rows with a restrictive policy and expects `tenant_inactive`.
  - It first asserts the precondition that the rows really are hidden, so the test can fail.
  - It drops the policy afterwards.
  - The null expected-version test is present.
- **Comments:** audit, `api_editor`, the magic counts, and `pgrowlocks`.
- **Storage upsert test:** it uses different bytes and downloads the original to confirm it is unchanged.
- **Integration cleanup, each item present:**
  - `pgAs` closes the client on a failed setup.
  - `closeClient` is exported and used.
  - `expectBlocked` waits 5 s.
  - `global-setup` closes in a `finally`.
  - The parity test closes its client.
  - The `setof` flag replaces the `worker_sites` special case.
  - The A2 foreign-asset test expects exactly 23503 and also checks the draft version is still 1.
  - Mailpit and Auth responses are checked.
  - The `env.ts` error carries a hint and its cause.
- **`state.test.mjs`:**
  - The busy rule is isolated with a plan variant in which Task 9 depends only on Task 7. The test also asserts the message does not mention "depends on".
  - The blocked case and the in-review case are both covered.
  - A test for two Lane A tasks in review was added, and the header comment is updated.
- **`FIELD_KEY`:** capped at 64 characters, with tests at exactly 64 (accepted) and 65 (rejected). It matches decision 29, whose database pattern is wider (`-` allowed) than the schema's identifier regex, so the cap is consistent.
- **Nothing else changed:** only test, comment, and the listed code and migration edits. The uncommitted `deferred-minors.md` change is the controller's.

**Findings**
- [Minor] quality: `tests/integration/src/impersonation-parity.test.ts` (the `viaSql` value line): a non-`setof` case now does `unwrap(rows[0].v)`. If a scalar function ever returned no row, the resulting `TypeError` would be reported as a failed outcome with an undefined code. Suggestion: not needed now; optionally assert `rows.length === 1` for non-`setof` cases to give a clearer failure.
- [Minor] quality: `packages/rich-text/src/__tests__/entry-points.test.ts`: the computed-import regex also matches `import(` inside comments or strings in the walked sources. This fails closed and is acceptable. A short note would help the next reader.

**Security-relevant edits (the security reviewer should look at these):**
- the credentials rule in the two link validators;
- the `audit_log` per-column INSERT grant, with `at` and `actor_id` left insertable and relying on the force-actor trigger;
- the fail-closed `request_publish` tenant check;
- the new `restrictive` policy in the 080 test, which exists only inside the rolled-back test transaction.

I found nothing that contradicts `docs/architecture.md`.
