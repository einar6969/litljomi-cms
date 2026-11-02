// Signing in through the real flow: the sign-in form, the magic link from Mailpit, and the
// "Halda áfram" button of the CMS's /auth/confirm page (decision 41.1).
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
 * Requests a magic link for `email` on `page` and returns the emailed link, without opening it. A
 * missing mail is requested again after RESEND_BACKOFF_MS, up to three times.
 */
export async function requestMagicLink(page: Page, email: string): Promise<URL> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const seen = await messageIds(email);
    await requestLink(page, email);
    const message = await waitForNewMessage(email, seen);
    if (message) return magicLinkOf(message);
    await page.waitForTimeout(RESEND_BACKOFF_MS);
  }
  throw new Error(`no magic link arrived for ${email}`);
}

/** Opens the confirm page of `link` on `page`, without pressing its button (as a mail scanner would). */
export async function openLink(page: Page, link: URL): Promise<void> {
  await page.goto(link.href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
}

// How long the URL must stay unchanged, with the landing page's heading shown, to count as settled.
const SETTLE_MS = 500;

/**
 * Waits until `page` has left /auth/confirm and settled: its `main` shows a level-1 heading and the
 * URL stays the same for SETTLE_MS. "Halda áfram" is a server action, so its redirect is followed by
 * the client router, and a page it lands on may redirect again (the tenant picker at `/` sends an
 * editor with one tenant on to `/t/<slug>`); the intermediate URL is not the landing.
 */
async function settledLanding(page: Page): Promise<URL> {
  await page.waitForURL((url) => url.origin === CMS_URL && url.pathname !== '/auth/confirm');
  await expect(async () => {
    const before = page.url();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: SETTLE_MS });
    await page.waitForTimeout(SETTLE_MS);
    expect(page.url()).toBe(before);
    expect(new URL(before).pathname).not.toBe('/auth/confirm');
  }).toPass();
  return new URL(page.url());
}

/**
 * Opens `link` on `page`, presses "Halda áfram" and returns where the sign-in settled. A link that
 * fails lands on `/login?error=link`; that is an error here, not a signed-in landing.
 */
export async function followLink(page: Page, link: URL): Promise<URL> {
  await openLink(page, link);
  await page.getByRole('button', { name: t.confirm.submit }).click();
  const landed = await settledLanding(page);
  if (landed.pathname === '/login') throw new Error(`the magic link did not sign in (landed on ${landed.pathname}${landed.search})`);
  return landed;
}

/** Signs `email` in on `page` through the magic link and returns where the sign-in settled. */
export async function signIn(page: Page, email: string): Promise<URL> {
  return followLink(page, await requestMagicLink(page, email));
}
