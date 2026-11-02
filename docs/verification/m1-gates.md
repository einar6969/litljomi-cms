# M1 validation gates: evidence

Status lives in `docs/execution/state.json` (`node tools/harness/state.mjs show`). This file holds the evidence, newest section last.

## V-SANDBOX re-check for Docker and localhost (Task 2, 2026-11-01)

Original result (Task 0): pass, evidence in `docs/execution/environment.md`.

**Before the change** (sandboxed, OrbStack installed and running, Docker 29.8.2, context `orbstack`):
- `docker version` → `permission denied while trying to connect to the docker API at unix:///Users/einarzoega/.orbstack/run/docker.sock`
- Node `net.connect(…, '127.0.0.1')` → `EPERM`; `net.createServer().listen(0, '127.0.0.1')` → `EPERM`
- `supabase --version` → `EPERM … open '/Users/einarzoega/.supabase/telemetry.json.tmp…'`; with `SUPABASE_TELEMETRY_DISABLED=1` → `2.121.0` (no settings change needed for this)

**Change** (`.claude/settings.json`, approved by Einar in chat on 2026-11-01: "I approve the exact proposed `.claude/settings.json` change for Task 2 … This approval is specifically for running the local Supabase stack and its tests, not for unrelated container operations or access to other projects."):

```diff
     "network": {
-      "allowedDomains": ["registry.npmjs.org"]
+      "allowedDomains": ["registry.npmjs.org"],
+      "allowUnixSockets": [
+        "/Users/einarzoega/.orbstack/run/docker.sock",
+        "/var/run/docker.sock"
+      ],
+      "allowLocalBinding": true
     }
```

**After the change** (sandboxed):
- `docker info` → `server=29.8.2 os=OrbStack arch=aarch64`, exit 0
- loopback listen and connect on `127.0.0.1` → ok
- outside host still blocked: `net.connect(443, '1.1.1.1')` → `EPERM`
- throwaway project in the scratchpad: `supabase init` exit 0; `supabase start` exit 0 (images pulled by the OrbStack daemon, about 2 min 40 s first run); `supabase db reset` exit 0 (CLI → Postgres on 127.0.0.1:54322); `supabase stop --no-backup` exit 0, no containers left
- no further sandbox refusals

**Result: pass**, with these known limitations:
- Docker socket access lets a sandboxed command start containers that mount host folders shared by OrbStack (the home directory by default), so the sandbox's filesystem boundary does not hold for Docker-mediated actions. Einar accepted this for running the local Supabase stack and its tests only; agents use Docker only through the `pnpm db:*` scripts and the Supabase CLI.
- `allowLocalBinding` allows connections to any service on this Mac's loopback, not only Supabase.
- The Supabase CLI must run with `SUPABASE_TELEMETRY_DISABLED=1` (it otherwise writes to `~/.supabase`, outside the sandbox).

## Plan defect found in pre-flight (Task 2, 2026-11-01)

With the plan's `[api] schemas = ["api"]`, `supabase start` fails before Task 4 creates `api`: PostgREST logs `schema "api" does not exist` (3F000) and the health check ends `HealthCheckTimeoutError … supabase_rest_… unexpected status 503`. With `schemas = []`, `supabase start` and `supabase db reset` succeed. Task 4's Step 2 expects the stack to run before `api` exists. Reported to Einar for a decision.

Decision (Einar, 2026-11-01: "I approve Option A: temporarily expose no application schemas until Task 4 creates `api`."): Task 2 sets `[api] schemas = []` as a temporary bootstrap value; Task 4 creates `api`, `cms` and `private`, sets `["api"]` in the same commit, and verifies that the API works and that `cms` and `private` stay unexposed. Recorded as implementation-level decision 16 in the plan (sequencing, not architecture).

## V-HELPERS (Task 2, 2026-11-01)

Assumption: `supabase test db` runs files that include a shared helper file with `\ir`. Task 2 Step 4: "V-HELPERS passes if `\ir` resolved. If `supabase test db` also tries to run `_helpers.sql` as a test file and fails, apply the V-HELPERS fallback and record it."

Evidence (controller's own runs on commit 7933579, Supabase CLI 2.121.0, local stack on OrbStack):
- `\ir _helpers.sql` resolves: `000_harness.test.sql .. ok`, 3 tests (act_as sets `auth.uid()`, switches role to `authenticated`, `act_as_owner` resets role).
- Plain `supabase test db` (no arguments) also runs `_helpers.sql` as a test file: `_helpers.sql .. No subtests run … Parse errors: No plan found in TAP output … Result: FAIL`. Because the helper file then runs outside a test transaction, schema `tests` is committed and the next plain run fails with `ERROR: schema "tests" already exists` until `pnpm db:reset`.

**Result: pass** (`\ir` resolves), **with the fallback applied**: `pnpm db:test` is `node tools/db/test.mjs`, a tooling-only wrapper that passes only the `*.test.sql` files to `supabase test db` (with `SUPABASE_TELEMETRY_DISABLED=1`). The plan's fallback text describes concatenating the helpers into each test file; that is unnecessary because `\ir` resolves, so the wrapper only filters which files run (controller ruling, Task 2 notes). `pnpm db:reset && pnpm db:test` → `Files=1, Tests=3 … Result: PASS`; a repeated `pnpm db:test` without reset also passes. Limitation: run the database tests through `pnpm db:test`, never as a plain `supabase test db`; CI's `database` job already calls `pnpm db:test`.

## Correction to the bootstrap exposure (Task 2 security review, 2026-11-01)

The security review found that `[api] schemas = []` makes PostgREST fall back to exposing `public` (empty at the time; `Accept-Profile: public` returned the OpenAPI document). Controller pre-check: `["graphql_public"]` keeps the stack healthy and rejects `public` (406). Einar approved the correction on 2026-11-01 ("I approve F1–F3 as recommended, including the three minor corrections."); recorded as plan decision 17, with decision 16 corrected in place.

## A13 (Task 7, 2026-11-02)

Assumption (spec §11.1): the reference extraction finds `_ref` at any depth, including inside arrays and rich text. Under decision 25 (spec §4.3 revised), `private.extract_refs` walks the document recursively and returns each reference's location as jsonpath text, and the tests cross-check the walk against the recursive JSON path `strict $.**._ref`.

Evidence: `supabase/tests/database/040_refs.test.sql`. Local stack: PostgreSQL 17.11, Supabase CLI. `pnpm db:reset && pnpm db:test` gave `Files=7, Tests=405 … Result: PASS`. The A13 assertions, as reported:

```
ok 22 - refs found at any depth
ok 23 - each reference's location is a jsonpath to the reference object, with its kind
ok 24 - the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (rich-text document)
ok 25 - edge cases: root, nested inside a reference, arrays of arrays, duplicates, quoted keys
ok 26 - the walk finds exactly the refs jsonb_path_query(strict $.**._ref) finds (edge cases)
ok 27 - every path evaluates, as a jsonpath, to the reference object it names
ok 51 - draft_refs rebuilt on save
ok 56 - draft_refs replaced by the new document's references (stray and old rows gone)
ok 78 - revision_refs equal the draft's draft_refs at that version
```

- Test 22 uses the plan's document: a top-level field, an array element, a rich-text link mark (`attrs.entry`) and a rich-text image node (`attrs.asset`), the shapes of `packages/rich-text/src/doc-schema.ts`.
- Test 23 pins the locations, for example `$."body"."content"[0]."content"[0]."marks"[0]."attrs"."entry"`.
- Tests 24 and 26 compare the walk with `jsonb_path_query(p_data, 'strict $.**._ref')` as multisets (`bag_eq`), so duplicates count.
- Tests 51 and 56 show the same documents saved through the draft trigger as an editor.

Malformed and canonical cases (decision 25), tests 30–48:
- Rejected with 22P02: upper-case, braced, unhyphenated, extra digit, leading space, leading or trailing newline, JSON null, number, object and array `_ref`.
- Accepted: the nil UUID and a canonical non-v4 UUID.
- Rejected with `invalid_reference`: an unknown, missing, wrong-case or non-string `_kind`.

Mutation check: each mutation was applied inside the test's transaction and rolled back.
- A walk that skips arrays fails tests 22–26.
- A cast-only `_ref` check (no pattern) fails the upper-case, braced and unhyphenated cases.

**Re-run at Task 7 completion (2026-11-02, commit `f3eab7a`).** After the fixes for decisions 27–29 (128-level depth limit, lean walk that builds paths only for references, object keys `^[A-Za-z0-9_-]{1,64}$`, at most 1,000 references, all checked in linear time before the walk with 54000), the A13 assertions above are unchanged and still pass, now alongside regression tests bounding temp files and run time (about 10 MB of temp space per statement in the worst case inside the limits). The controller ran `pnpm db:reset && pnpm db:test` on PostgreSQL 17.11: `Files=7, Tests=496 … Result: PASS` (`040_refs.test.sql`: 187 tests). Reviews: spec r1–r4 pass; security r1–r3 fail, r4 and r5 pass; quality r1 fail, r2 pass (`docs/execution/reviews/task-07-*`).
- A newline-sensitive pattern (`(?n)`) still rejects a trailing newline, because the `uuid` cast also rejects it. Checked directly: the plain anchored `~` gives `false` for a trailing newline, `(?n)` gives `true`, and the cast raises 22P02.

**Result: pass.**
