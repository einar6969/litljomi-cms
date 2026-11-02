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

// Auth answers a repeat request for one address within `[auth.email] max_frequency` (1 s in
// supabase/config.toml) without sending a mail, so a retry waits longer than that.
const RESEND_BACKOFF_MS = 2000;

/**
 * Signs `email` in on `page` and returns where the callback landed. A missing mail is requested
 * again after RESEND_BACKOFF_MS, up to three times. A callback that fails lands on
 * `/login?error=link`; that is an error here, not a signed-in landing.
 */
export async function signIn(page: Page, email: string): Promise<URL> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seen = await messageIds(email);
    await requestLink(page, email);
    const message = await waitForNewMessage(email, seen);
    if (!message) {
      await page.waitForTimeout(RESEND_BACKOFF_MS);
      continue;
    }
    await page.goto(magicLinkOf(message).href);
    await page.waitForURL((url) => url.origin === CMS_URL && url.pathname !== '/auth/callback');
    const landed = new URL(page.url());
    if (landed.pathname === '/login') throw new Error(`the magic link for ${email} did not sign in (landed on ${landed.pathname}${landed.search})`);
    return landed;
  }
  throw new Error(`no magic link arrived for ${email}`);
}
