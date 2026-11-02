# Lane B C2 cleanup, security review, round 1 (cms-security-reviewer)

Diff `d578ef4..6057d03` in `.worktrees/lane-b`. Report as returned by the reviewer:

PASS

Commands: `sh -n cms-next.sh` OK; `pnpm --dir <wt> lint` 0; `typecheck` 0; `test` 43 files, 843 passed; `git status --porcelain` empty. No database, stack or e2e command.

1. n/a (only a comment in `098_worker_recovery.test.sql:9-12`, correct against `20261102000600_publishing.sql:223`). 2–5. n/a. 6. pass (`missingOriginals` builds every path from `read.tenant.id` via `privateMediaPath`; unbuildable paths count as missing). 7. pass (only `createAdminClient` and `worker_*` RPCs; storage-js 2.118.0 `exists` returns `{data:true}`, `{data:false,error}` for 400/404, throws otherwise; the new non-boolean guard fails the request via `failUnexpected` with the path only in the log and the service_role alert, never in `publish_requests.error`; batches of 8, a rejection rejects the whole `Promise.all`, results matched by index; tests at `process-request.test.ts:543-571`). 8–9. n/a. 10. pass (the key is only captured in `cms-next.sh:12`, never printed or written; the new error path echoes a fixed message; loopback check intact; no new secret-key reference; `MEDIA_PRIVATE` is a bucket name). 11–12. n/a. 13. pass. 14. pass.

Focus: fixture-server traversal pass (`resolve(root)` makes the prefix check correct; decoded, joined, normalised before the check; `.json` only; 127.0.0.1); harness `stop()` pass; e2e-local signal handling pass (kills only its own children); port probe binds 127.0.0.1 only.

Minors:
- `tests/integration/scripts/cms-next.sh:12`: stderr of `supabase status -o env` is no longer discarded; safe because the keys go to stdout (captured) and only diagnostics to stderr; not confirmed by running the CLI. A note or check would make the assumption explicit.
- `cms-next.sh:21` (pre-existing): the loopback glob `http://localhost:*` would also accept userinfo such as `http://localhost:x@host`; `$api_url` comes from the local CLI, no exposure; anchor the port to digits.
