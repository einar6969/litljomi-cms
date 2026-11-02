# Task 27, round 4 (fix diff 7147edc..2f8bb63): combined spec-and-quality review (cms-quality-reviewer, Sonnet)

FAIL

Commands: `git diff 7147edc..2f8bb63`, `git status --porcelain` (empty), grep for serve:fixture/test:visual references, `git ls-files | grep npmrc`, read of the Playwright `cwd` doc (`node_modules/playwright/types/test.d.ts:11103`), and `cd e2e/visual && node e2e/serve.ts` (read-only). Playwright not run.

## Findings
- [Critical] `e2e/visual/playwright.config.ts:50`: webServer command `node e2e/serve.ts` is broken. `webServer.cwd` defaults to the config file's directory (`e2e/visual`), where `e2e/serve.ts` resolves to `e2e/visual/e2e/serve.ts`, which does not exist; reproduced: `cd e2e/visual && node e2e/serve.ts` → MODULE_NOT_FOUND. `npm run serve:fixture` worked because npm walks up to `package.json`. The hub server never starts; `npm run test:visual` fails after 600 s. Fix: `cwd: '../..'` on that webServer entry (preferred), keep `node e2e/serve.ts`; `harness.ts` paths come from `appDir`, so the cwd change should be enough; verify by running Playwright.
- [Minor] `e2e/serve.ts:2`: comment still says the visual comparison uses `npm run serve:fixture`.

## Checked and fine
- `serve:fixture` (`package.json:17`) still needed for README local work (`README.md:32`), accurate.
- `.npmrc` tracked, `update-notifier=false` correct, comment explains why.
- Host-resolver rule syntax right; `serviceWorkers: 'block'` under `use`; comment accurate. Confirm on running that the rule also covers the `main` project and `localhost` use.
