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
