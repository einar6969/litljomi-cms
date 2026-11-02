// Signing in through the real flow: the sign-in form, the magic link from Mailpit, the callback.
import { expect, type Page } from '@playwright/test';
import { t } from '../../src/i18n/is';
import { CMS_URL } from './local';
import { magicLinkOf, messageIds, waitForNewMessage } from './mailpit';

/** Submits the sign-in form for `email` and waits for the neutral message. */
export async function requestLink(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(t.login.emailLabel).fill(email);
  await page.getByRole('button', { name: t.login.submit }).click();
  await expect(page.getByRole('status')).toHaveText(t.login.sent);
}

/**
 * Signs `email` in on `page` and returns where the callback landed. Auth answers a repeat request
 * for one address within `max_frequency` (1 s locally) without sending, so a missing mail is
 * requested again, up to three times.
 */
export async function signIn(page: Page, email: string): Promise<URL> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seen = await messageIds(email);
    await requestLink(page, email);
    const message = await waitForNewMessage(email, seen);
    if (!message) {
      await page.waitForTimeout(2000);
      continue;
    }
    await page.goto(magicLinkOf(message).href);
    await page.waitForURL((url) => url.origin === CMS_URL && url.pathname !== '/auth/callback');
    return new URL(page.url());
  }
  throw new Error(`no magic link arrived for ${email}`);
}
