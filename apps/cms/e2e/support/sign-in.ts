// Signing in through the real flows: the sign-in form's email and password (PW-02), and a link's
// "Halda áfram" button on the CMS's /auth/confirm page (decision 41.1). An invitation or a reset
// link then lands on the set-password page (PW-03).
import { expect, type Page } from '@playwright/test';
import { t } from '../../src/i18n/is';
import { recoveryTokenHash } from './console-admin';
import { CMS_URL } from './local';
import { PERSONA_PASSWORD, type E2ePersona } from './personas';

/** Opens /login (with `query`, if any), fills in `email` and `password` and presses "Skrá inn". */
export async function submitSignIn(page: Page, email: string, password: string, query = ''): Promise<void> {
  await page.goto(`/login${query}`);
  await page.getByLabel(t.login.emailLabel).fill(email);
  await page.getByLabel(t.login.passwordLabel).fill(password);
  await page.getByRole('button', { name: t.login.submit }).click();
}

/**
 * A password-reset link for `persona`, as the reset mail carries it, made by the admin script (the
 * confirm page refuses magic links, PW-03). Not opened; it works once, in any browser, and signs
 * the persona in on the set-password page without changing its password.
 */
export async function recoveryLink(persona: E2ePersona): Promise<URL> {
  const { tokenHash } = await recoveryTokenHash(persona);
  return new URL(`${CMS_URL}/auth/confirm?${new URLSearchParams({ token_hash: tokenHash, type: 'recovery' })}`);
}

/** Opens the confirm page of `link` on `page`, without pressing its button (as a mail scanner would). */
export async function openLink(page: Page, link: URL): Promise<void> {
  await page.goto(link.href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
}

// A landing counts as settled when its `main` shows a level-1 heading within HEADING_MS and the URL
// then stays the same for STILL_MS. The window covers the one redirect a landing page makes on its
// own: the tenant picker at `/` sending an editor with one tenant on to `/t/<slug>`.
const HEADING_MS = 500;
const STILL_MS = 500;
// How long the page may take to leave, and then to settle (repeated tries of the check above).
const SETTLE_TIMEOUT_MS = 15_000;

/**
 * Waits until `page` has left the path `from` and settled (see HEADING_MS and STILL_MS). The sign-in
 * form navigates when Auth has answered, and "Halda áfram" is a server action whose redirect the
 * client router follows; a page either lands on may redirect again (the tenant picker), so the
 * intermediate URL is not the landing.
 */
async function settledLanding(page: Page, from: string): Promise<URL> {
  await page.waitForURL((url) => url.origin === CMS_URL && url.pathname !== from, { timeout: SETTLE_TIMEOUT_MS });
  await expect(async () => {
    const before = page.url();
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible({ timeout: HEADING_MS });
    await page.waitForTimeout(STILL_MS);
    expect(page.url()).toBe(before);
    expect(new URL(before).pathname).not.toBe(from);
  }).toPass({ timeout: SETTLE_TIMEOUT_MS });
  return new URL(page.url());
}

/**
 * Opens `link` on `page`, presses "Halda áfram" and returns where the sign-in settled. A link that
 * fails lands on `/login?error=link`; that is an error here, not a signed-in landing.
 */
export async function followLink(page: Page, link: URL): Promise<URL> {
  await openLink(page, link);
  await page.getByRole('button', { name: t.confirm.submit }).click();
  const landed = await settledLanding(page, '/auth/confirm');
  if (landed.pathname === '/login') throw new Error(`the link did not sign in (landed on ${landed.pathname}${landed.search})`);
  return landed;
}

/**
 * Signs `email` in on `page` with the sign-in form and returns where the sign-in settled. The
 * password is the personas' fixture password unless given; `query` is the sign-in page's, such as
 * `?next=…`. A refused sign-in stays on /login, so it fails here after SETTLE_TIMEOUT_MS.
 */
export async function signIn(page: Page, email: string, password = PERSONA_PASSWORD, query = ''): Promise<URL> {
  await submitSignIn(page, email, password, query);
  return settledLanding(page, '/login');
}
