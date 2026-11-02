// The CMS's Playwright `test`: every browser context aborts the requests it can intercept that are
// not to a loopback host, so a page cannot make the browser reach the network (the e2e tests run
// outside the sandbox; Einar, 2026-11-02). Specs import `test` and `expect` from here.
import { test as base, type Browser, type BrowserContext } from '@playwright/test';
import { isLoopbackUrl } from './local';

/** Aborts every request of `context` that is not to a loopback host. */
async function guardLoopback(context: BrowserContext): Promise<BrowserContext> {
  await context.route(
    (url) => !isLoopbackUrl(url),
    (route) => route.abort('blockedbyclient'),
  );
  return context;
}

/**
 * A separate, fresh browser context (no cookies or storage: another browser or device), with the
 * same loopback guard as the test's own context. The caller closes it.
 */
export const newLoopbackContext = async (browser: Browser): Promise<BrowserContext> => guardLoopback(await browser.newContext());

export const test = base.extend({
  context: async ({ context }, use) => {
    await use(await guardLoopback(context));
  },
});

export { expect } from '@playwright/test';
