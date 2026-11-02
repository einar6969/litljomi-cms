# Task 22, security review, round 2 (fix-diff re-review, cms-security-reviewer)

Fix diff `1bf5641..6c368c2` in `.worktrees/lane-a-alt`. Report as returned by the reviewer:

PASS

Full re-review not needed (small fix on the e2e path). `git status --porcelain` empty before and after; no temp dirs left.

Round-1 Major resolved: `SUPABASE_NO_UPDATE_NOTIFIER=1` at every `supabase` spawn on the e2e path (`cms-next.sh` with the telemetry variables; `tests/integration/src/env.ts:24-26`; `apps/cms/e2e/global-setup.ts:14-15` via `NO_CLI_NETWORK_ENV`; `apps/cms/playwright.config.ts:42`); no other spawn on the path.

`.env*` refusal works (scratch copy: `.env.example` and a `.envdir` directory each exit 1 "refusing to run", neither fake CLI ran; no match runs normally; a dangling `.env` symlink is refused; the glob refuses more than Next.js loads, the safe side).

The new test can fail (mutation: removing the `SUPABASE_NO_UPDATE_NOTIFIER` line makes `toMatchObject` fail; `cleanEnv` clears the caller's variables; the `env.ts` case fails if the real `supabase` is picked up; global-setup checks the mocked `spawn` env; config case checks `webServer.env`). Fakes live only under `mkdtempSync(tmpdir())`, removed in `afterEach`, PATH prepended in the child env only; `spawn` mocked so no seed runs.

Results: `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 49 files / 913 passed, the new file 9/9, `sh -n cms-next.sh` OK.

Checklist: 1–9 n/a (no SQL); 10 pass (no new secret handling; loopback key only; fake keys `pk`/`sk`; the `.env*` refusal closes the round-1 Minor); 11–12 n/a; 13 pass (38.1 placement reported as a contradiction, not chosen); 14 pass.

Decision 38.1: confirmed that pnpm 11.1.3 filters `.npmrc` to `@`/`//`, auth, proxy and strict-ssl keys (`readAndFilterNpmrc` ~113496-113506, `isNpmrcReadableKey` 113431-113432) and reads `update-notifier` from `pnpm-workspace.yaml`/`config.yaml` (`pnpmConfigFileKeys` 112387); the update check runs only on `install` or `add` (line 273911), so `pnpm --filter cms e2e` does not check by itself. Contradiction: 38.1's `.npmrc` placement has no effect; `updateNotifier: false` in `pnpm-workspace.yaml` works. No exposure on the e2e path.

Further findings:
- [Minor] `pnpm-workspace.yaml` sets no `verifyDepsBeforeRun`; pnpm 11's default is `install` (pnpm.mjs:114083): `pnpm run` would start `pnpm install` when `node_modules` is out of sync with the lockfile (e.g. after a merge changing it), which under the unsandboxed e2e command would reach registry.npmjs.org, write the global store outside the repository and run its own update check. No exposure today only because the user-global `~/Library/Preferences/pnpm/config.yaml` sets `verifyDepsBeforeRun: never` (outside the repository). Suggested: `verifyDepsBeforeRun: error` (or `never`) and `updateNotifier: false` in `pnpm-workspace.yaml`. Minor now; Major if that user config changed.
- [Minor] `pnpm` is a corepack shim and `package.json:5` pins `pnpm@11.1.3` without a hash; 11.1.3 is cached, so no fetch today. If the pin changed and the unsandboxed e2e command were the first pnpm call after that, corepack would download pnpm outside the sandbox. Mitigations: a hash in `packageManager`, `COREPACK_ENABLE_NETWORK=0` for that command, or a rule that the first pnpm call after a pin change is sandboxed.
- Not a finding: Next.js's version-staleness fetch exists only in `next dev` and `next info`; the e2e run uses `build` and `start`; telemetry off.
