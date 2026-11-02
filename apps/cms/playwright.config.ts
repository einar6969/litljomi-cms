import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { DEMO_SITE_READY_LINE } from './e2e/support/demo-site';
import { CMS_PORT, CMS_URL, NO_CLI_NETWORK_ENV } from './e2e/support/local';

// Browser tests of the CMS (decision 37.3). They run outside the Bash sandbox (Einar's
// `sandbox.excludedCommands` for `pnpm --filter cms e2e`), so they reach only loopback addresses
// and this repository (Einar, 2026-11-02): the CMS on CMS_PORT, the demo site on 3101, Supabase on
// 54321, Mailpit on 54324.
//
// The CMS is built and started through tests/integration/scripts/cms-next.sh, which reads the
// local stack's URL and keys from `supabase status` at run time and refuses a non-loopback stack;
// nothing is written to a file. The global setup seeds the fixed identities (`pnpm seed:local`'s
// script). The `editor-session` setup project signs editor_labak and editor_demo in once; specs
// reuse their state. The demo site (Task 25) is served on 3101 by e2e/demo-site-server.ts, also
// loopback only, reading the local stack's public delivery bucket.
const cmsNext = 'sh ../../tests/integration/scripts/cms-next.sh';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  globalSetup: './e2e/global-setup.ts',
  // One shared local stack and Auth rate limits: tests run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: CMS_URL,
    headless: true,
    trace: 'off',
  },
  webServer: [
    {
      name: 'cms',
      // `next start` listens on loopback only; the browser reaches it as localhost (the Auth site URL).
      command: `${cmsNext} build && ${cmsNext} start -p ${CMS_PORT} -H 127.0.0.1`,
      url: `http://127.0.0.1:${CMS_PORT}/login`,
      reuseExistingServer: false,
      timeout: 300_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // The editor's publish action triggers the worker here (decision 9; Task 25).
        CMS_PUBLIC_URL: CMS_URL,
        CMS_INTERNAL_SECRET: randomBytes(24).toString('hex'),
        CRON_SECRET: randomBytes(24).toString('hex'),
        ...NO_CLI_NETWORK_ENV,
      },
    },
    {
      // The real demo site on its seeded URL (Task 25's live checks). It can be built only once the
      // demo tenant has a release, so Playwright waits only for its announcement; publish.spec.ts
      // waits for the site itself (and makes the first release when there is none).
      name: 'demo-site',
      command: `${JSON.stringify(process.execPath)} e2e/demo-site-server.ts`,
      wait: { stdout: new RegExp(DEMO_SITE_READY_LINE) },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...NO_CLI_NETWORK_ENV },
    },
  ],
  projects: [
    { name: 'editor-session', testMatch: /editor-session\.setup\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      testIgnore: /\.setup\.ts$/,
      dependencies: ['editor-session'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
