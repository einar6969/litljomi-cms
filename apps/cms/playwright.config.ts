import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { CMS_URL } from './e2e/support/local';

// Browser tests of the CMS (decision 37.3). They run outside the Bash sandbox (Einar's
// `sandbox.excludedCommands` for `pnpm --filter cms e2e`), so they reach only loopback addresses
// and this repository (Einar, 2026-11-02): the CMS on 3100, Supabase on 54321, Mailpit on 54324.
//
// The CMS is built and started through tests/integration/scripts/cms-next.sh, which reads the
// local stack's URL and keys from `supabase status` at run time and refuses a non-loopback stack;
// nothing is written to a file. The global setup seeds the fixed identities (`pnpm seed:local`'s
// script). The `editor-session` setup project signs editor_labak in once; specs reuse its state.
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
  webServer: {
    // `next start` listens on loopback only; the browser reaches it as localhost (the Auth site URL).
    command: `${cmsNext} build && ${cmsNext} start -p 3100 -H 127.0.0.1`,
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      CMS_PUBLIC_URL: CMS_URL,
      CMS_INTERNAL_SECRET: randomBytes(24).toString('hex'),
      CRON_SECRET: randomBytes(24).toString('hex'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
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
