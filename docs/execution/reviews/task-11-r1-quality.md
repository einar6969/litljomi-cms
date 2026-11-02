FAIL

I ran no commands except reading the diff and the schema (`git diff`, `sed`, `grep` on the worktree); no database commands and no writes. The controller's run (Files=13, Tests=1233, PASS) is taken as given. The 090 and 100 test line numbers are in the files. The migration line numbers are file lines in `/Users/einarzoega/litljomi-cms/.worktrees/lane-a-alt/supabase/migrations/`.

[Major] tests/database/090_api_worker.test.sql:329-332: quality: the xmax assertions for the referenced asset f901 and the referenced entry c907 cannot fail if the explicit `FOR SHARE` locks are removed. The commit inserts `revision_refs` rows, and their foreign keys to `cms.entries (tenant_id, id)` and `cms.assets (tenant_id, id)` (`20261102000400_refs.sql:43`, `20261102000500_assets_storage.sql:45-48`) take `FOR KEY SHARE` on exactly those rows. That sets xmax to this transaction in any case. So "the commit locked the referenced asset/entry" passes with step 5's lock loop deleted, and only the negative f905 check still guards anything.
  - Suggested change: assert on something the foreign-key check cannot produce, such as the lock mode in the tuple infomask (`pageinspect`/`heap_page_items` if available), or a `pg_locks` or `FOR UPDATE NOWAIT` probe from a savepoint.
  - If that is not practical, drop the two assertions or word them honestly ("referenced rows are locked, by the lock loop or the foreign key") and leave the lock behaviour to Task 12's concurrent test.
  - The same limit applies to the draft assertion at line 327: xmax cannot tell `FOR UPDATE` from `FOR SHARE`. That one is acceptable, but it should say so.
  - This is a test-only change. It touches no security-relevant code.

[Minor] 20261102000900_api_worker.sql:248-264 and 362-377: quality: the tenant-active and membership re-check (about 16 lines, including the two rejected payloads) is copied verbatim between `worker_commit_publish` and `worker_commit_unpublish`. A later change to one copy, for example a new rejection code, can leave the other behind. The tests pin both today.
  - Suggested change: a private helper returning the rejection code or null, or a comment in each function pointing at the other.
  - Security-relevant: this is the authorization re-check, so a refactor goes back through the security review. Not required for PASS.

[Minor] 20261102000900_api_worker.sql:390-417 and 266-310: quality: the `error` payloads of `failed_validation` have no single documented shape. The commit writes `{code:'schema_version'|'invalid_reference', ...}`. `worker_reject_request` stores whatever `p_error` is; its own test uses `{"fields": ...}` with no `code`.
  - Anyone rendering `publish_requests.error` has to handle both. The codes (`superseded`, `schema_version`, `tenant_inactive`, `forbidden`, `invalid_reference`) are listed in no one place.
  - Suggested change: list them in the header comment of `worker_commit_publish`, and say in `worker_reject_request`'s comment that the payload is the caller's.

[Minor] 20261102000900_api_worker.sql:588-599 vs 603-615: quality: duplicate ids are handled inconsistently in `worker_finish_release`. Duplicate request ids are silently collapsed (`count(distinct u)`), but duplicate asset ids raise `forbidden`. Neither is documented or tested.
  - Suggested change: treat both the same way (probably forbidden), or document and test the difference.
  - Security-relevant if changed.

[Minor] 20261102000900_api_worker.sql:588-599, 621-627: quality: `worker_finish_release` with status `failed` still links the given requests to the release and sets `public_path`. A failed release then claims requests that no delivered release contains. Whether that is intended is not stated in the comment, and no test passes ids with `failed` (090 line 615 passes none).
  - Suggested change: state the contract in the comment and add a test.

[Minor] 20261102000900_api_worker.sql:35-40: quality: the comment says the trigger fires "on every UPDATE", but the trigger has a `WHEN` clause (fires only when old is not null and the value changes). The next sentence half-corrects this.
  - Suggested change: "on every UPDATE that changes a set first_published_at".

[Minor] tests/database/090_api_worker.test.sql:461-467: quality: both `revisions.data` constraint tests pass `null` for the message, so any other 23514 satisfies them, for example a different trigger or check.
  - Suggested change: match the constraint name (`revisions_data_check`) in the message pattern.

[Minor] tests/database/090_api_worker.test.sql:114-116: quality: `prosrc ~* 'for update skip locked'` also matches a comment. It is a reasonable stopgap given that Task 12 covers concurrency.
  - Suggested change: strip comments in the regex, or leave a note that the real test is Task 12.

[Minor] tests/database/090_api_worker.test.sql, coverage gaps (all minor, none can mask a defect today):
  - No test for a reference to an archived published entry (reason `archived`; only c925 exists, as a non-target).
  - No test that unpublishing an already unpublished entry is a no-op `committed` (the comment at lines 349-354 of the migration promises it).
  - Line 503-504: "second concurrent build refused" is single-session; name it "second build while one is building".
  - The file-order dependency is declared in the header and the 156 plan count is fixed. This is acceptable, but a reordering would fail confusingly.
  - Line 210-212: "no other requests exist (run after db:reset)" fails loudly on a dirty database, which is fine.

[Minor] tests/database/010_catalog.test.sql:20-22 and 100_escalation.test.sql:150-153: quality: the magic number 14 (worker and admin functions) appears in both files, and 23 and 6 in 100. Adding a function means editing several places. They fail loudly, so this is acceptable.

Checked and fine:
- The unqualified multi-array `unnest` has an accurate comment (lines 267-268).
- Every code path returns or raises the documented status or code. Nothing is swallowed. The `unique_violation` handlers in `worker_begin_release` and `admin_create_tenant` re-raise anything but the named constraint.
- In 100, the typed-null calls are sound: `format_type` produces valid casts, EXECUTE is checked before the body, `tests.sqlstate_of` isolates each call in a subtransaction, and the counts guard against vacuous passes.
- The 090 assertions on the commit outcomes, error payloads, tenant scoping in `worker_finish_release`, and "refused calls changed nothing" are behaviour-focused and able to fail.
