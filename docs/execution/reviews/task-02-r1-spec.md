# Task 2 (Local Supabase stack and pgTAP harness): spec review, round 1

- Reviewer: fresh `cms-spec-reviewer` (Sonnet), 2026-11-01
- Change: `c35e720..7933579` (7933579)
- Result: **PASS** (no Critical or Important; 3 Minor)

Report (verbatim in substance):

Minor
- tools/db/test.mjs:1: the task's `pnpm db:test` is `supabase test db`; the script is `node tools/db/test.mjs`, which runs `supabase test db` on the `*.test.sql` files only and sets `SUPABASE_TELEMETRY_DISABLED=1`; not in the Files list. It is the V-HELPERS fallback T7 allows. The plan's fallback text says "concatenates helpers into each test file"; the wrapper keeps `\ir` and excludes `_helpers.sql` instead. No new software, tooling only; within T7 and the fallback's intent. Literal concatenation would be the controller's call.
- CLAUDE.md:25: the change removed "Later tasks add the `pnpm db:*` scripts." and added the four `db:*` lines; T8 allowed appending and "change nothing else". Removing the obsolete sentence is slightly wider.
- Commit trailer "Claude Opus 5.5" vs the reviewer's own reminder ("Claude Sonnet 5.5"); outside spec scope.

Matches: files (config.toml and supabase/.gitignore from `supabase init`, `_helpers.sql`, `000_harness.test.sql`, package.json, tools/db/test.mjs; `.temp`/`.branches` ignored and untracked); config.toml (`project_id = "litljomi-cms"`, `[api] schemas = []`, `extra_search_path = ["extensions"]`, `major_version = 17`, `[auth]` enable_signup false, site_url and redirect URLs as listed, `[auth.email]` enable_signup false and enable_confirmations false, `[auth.mfa.totp]` enroll and verify true; rest generated defaults); the harness test identical to Step 1; helpers all plpgsql with `set search_path = ''`, exact signatures, UUIDs and emails per the identities table, `persona`/`tenant` raise on unknown input, `seed()` stub inserts the five users only, `act_as` with `set local role authenticated` and the exact `set_config(... , true)` claims, `act_as_service` role claim `service_role`, `act_as_owner` `reset role`, schema `tests` created in the transaction, T5 grants, nothing in a migration; scripts (`db:start/stop/reset` with telemetry off inline, `db:test` via the wrapper, no `test:integration`); commit message exact; no docs/verification or docs/execution changes in the commit. Acceptance: `pnpm db:test` → `000_harness.test.sql .. ok`, `Files=1, Tests=3`, `Result: PASS`.

No plan/spec contradiction. Commands: `git status --porcelain`, `git log -1 --format=%B 7933579`, `git ls-files supabase`, `pnpm db:test`. Working tree clean.

## Controller notes
- Wrapper: accepted as the plan's V-HELPERS fallback (ruling recorded in m1-gates.md and Task 2 notes): `\ir` resolves, so concatenation is unnecessary; the wrapper only filters which files run.
- CLAUDE.md: removing the obsolete "Later tasks add the `pnpm db:*` scripts." line is accepted; leaving it would make CLAUDE.md false.
- Trailer: not a defect; the controller's attribution instruction for this session is "Claude Opus 5.5".
