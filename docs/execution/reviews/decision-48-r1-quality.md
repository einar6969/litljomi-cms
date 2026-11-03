# Decision 48, quality review round 1 (cms-quality-reviewer, fresh context)

Scope: commit `c193b70` (the live check's resend waits until the pointer's CDN max-age has passed), against architecture §7.2 and §7.4 only.

**Verdict: PASS**, five Minors, all fixed in `0ca5aee`:

1. `live-check.ts:6` imported `POINTER_MAX_AGE_S` from `build-release`, loading the whole build module. Fixed: the constant lives in `storage-paths.ts`; `POINTER_CACHE_CONTROL` is built from it (value unchanged, `public, max-age=30`).
2. `staleSeen` is sticky (resend still goes out when due after a later non-stale failure). Kept on purpose; commented.
3. `pointerWrittenAt` comes from the injectable `now()` but is compared with `Date.now()`. Doc comments now say it must be wall time.
4. Badly wrapped `runLiveChecks` doc comment. Rewrapped.
5. No fake-clock tests for a missing write time or a resend moment past the window. Added.

The reviewer's own vitest run in the sandbox produced only certificate-trust noise; it traced the timing by hand. Controller's runs: typecheck, lint, `check:slugs`, unit 1345/1345, CMS integration 35/35 on the local stack.
