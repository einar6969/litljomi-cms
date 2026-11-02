// The CMS's Playwright `test`: every browser context aborts the requests it can intercept that are
// not to a loopback host, so a page cannot make the browser reach the network (the e2e tests run
// outside the sandbox; Einar, 2026-11-02). Specs import `test` and `expect` from here.
import { test as base } from '@playwright/test';
import { isLoopbackUrl } from './local';

export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(
      (url) => !isLoopbackUrl(url),
      (route) => route.abort('blockedbyclient'),
    );
    await use(context);
  },
});

export { expect } from '@playwright/test';
