# C2 rulings documentation change, combined review, round 2 (fix diff, Sonnet)

Verbatim report.

PASS

Commands run (read-only): `git diff HEAD~1..HEAD` excluding reviews, `git diff --stat`, and grep/sed over supabase/migrations/20261102000500_assets_storage.sql, docs/architecture.md and the plan. No database command.

Round-1 Major: resolved.
- Task 30 "Missing private files" (plan ~1455) now checks the private originals before commit. A draft referencing an asset with no `public_path` whose original is missing fails as `failed_validation { code: 'asset_missing', assetIds }` with an alert. The request is never committed, so a live entry stays at its current revision.
- The projection fallback is gone. The text says the build-time remainder is "an error under §7.1 (the entry is omitted, no fallback in M1, alerted)". That agrees with §7.1 and with M3 owning the fallback rules. It adds nothing Einar did not state beyond the pre-commit check, which implements "fails the request that needs it, with a clear error code, and raises an alert".
- The Task 30 tests were updated to match: they no longer test an already-live entry keeping a projection. They check non-commit and that the previous revision stays live.
- The premise holds: in `20261102000500_assets_storage.sql` the only storage policies for `media-private` are `media_private_select_member` and `media_private_insert_member`, both for `authenticated`. There is no update or delete policy, and so no upsert-overwrite. Only service_role bypasses RLS. The "no DELETE policy" claim is accurate. A file can therefore be missing at pre-check only if the asset row was registered without its upload.

Round-1 Minors:
- Decision order: resolved. Decision 36 now follows 35.
- "ready = delivered": resolved. Item 3 now reads "ready (that is, `delivered`) releases".
- Task 25 body `'ok'`: resolved. The unit test now says `live_status = 'ok'` (decision 35).
- `asset_missing` shown as a validation failure: resolved. It now shows as "Ekki hægt að birta: …" with the missing image named. The earlier addition that mapped it to "Birting á vef mistókst" is removed.
- §8.4 milestone wording: resolved. It now says "in M1 through the audit log and the server log; by email from M3", consistent with §7.4.
- Task 0 count note: resolved. It now says "(Task 30 added at C2, decision 36)".
- Lane B list: resolved. It now includes "in Phase 4, Task 30".
- Spec cross-reference to "plan decision 36" (docs/architecture.md lines 476, 506, 507): left as is. This is still Minor. The text is self-contained, and leaving it is reasonable.

New findings:
- [Minor] docs/plans/2026-11-01-m0-m1.md ~1455: the pre-commit check does not say whether `assetIds` lists all missing assets or only the first. Tests should assert all of them. No action is required.

No Critical or Major findings.
