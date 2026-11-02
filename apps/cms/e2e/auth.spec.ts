// Task 22: magic-link sign-in, tenant routing and the neutral sign-in message, against the local
// CMS (`next start -p 3100`), the local stack and its Mailpit. Task 32 (decision 41.1): the link
// works in a browser other than the one that asked for it, and opening it alone (as an email
// security scanner does) signs nobody in and does not use it up.
import { randomBytes } from 'node:crypto';
import { t } from '../src/i18n/is';
import { CMS_URL } from './support/local';
import { messageIds, waitForNewMessage } from './support/mailpit';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { followLink, openLink, requestLink, requestMagicLink, signIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';

test.describe('without a session', () => {
  test('editor_labak signs in through the Mailpit link and lands on /t/labak', async ({ page }) => {
    // Editor routes need a session.
    await page.goto('/t/labak');
    await expect(page).toHaveURL(`${CMS_URL}/login`);

    const landed = await signIn(page, PERSONA_EMAILS.editor_labak);
    expect(landed.href).toBe(`${CMS_URL}/t/labak`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
  });

  test('a link requested in one browser signs in in another, once', async ({ page, browser }) => {
    const link = await requestMagicLink(page, PERSONA_EMAILS.editor_labak);

    // Another browser or device: a fresh context without the requesting browser's cookies.
    const other = await newLoopbackContext(browser);
    try {
      const otherPage = await other.newPage();
      const landed = await followLink(otherPage, link);
      expect(landed.href).toBe(`${CMS_URL}/t/labak`);
      await expect(otherPage.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
    } finally {
      await other.close();
    }

    // The browser that asked for the link is still signed out.
    await page.goto('/t/labak');
    await expect(page).toHaveURL(`${CMS_URL}/login`);

    // The link is used up: a third browser pressing the button is sent back to sign in.
    const third = await newLoopbackContext(browser);
    try {
      const thirdPage = await third.newPage();
      await openLink(thirdPage, link);
      await thirdPage.getByRole('button', { name: t.confirm.submit }).click();
      await expect(thirdPage).toHaveURL(`${CMS_URL}/login?error=link`);
      // Scoped to `main`: after the client-side redirect, Next.js's route announcer is also an alert.
      await expect(thirdPage.getByRole('main').getByRole('alert')).toHaveText(t.login.linkInvalid);
    } finally {
      await third.close();
    }
  });

  test('opening the link without pressing the button signs nobody in and does not use it up', async ({ page, browser }) => {
    const link = await requestMagicLink(page, PERSONA_EMAILS.editor_demo);

    // A mail scanner: opens the link in its own context and never presses the button.
    const scanner = await newLoopbackContext(browser);
    try {
      const scannerPage = await scanner.newPage();
      await openLink(scannerPage, link);
      await expect(scannerPage.getByRole('button', { name: t.confirm.submit })).toBeVisible();
      await scannerPage.goto(`${CMS_URL}/t/demo`);
      await expect(scannerPage).toHaveURL(`${CMS_URL}/login`);
    } finally {
      await scanner.close();
    }

    // The editor, in another context, still signs in with the same link.
    const editor = await newLoopbackContext(browser);
    try {
      const landed = await followLink(await editor.newPage(), link);
      expect(landed.href).toBe(`${CMS_URL}/t/demo`);
    } finally {
      await editor.close();
    }
  });

  test('an unknown email gets the same neutral message as a known one', async ({ page }) => {
    const known = PERSONA_EMAILS.editor_demo;
    const unknown = `nobody-${randomBytes(6).toString('hex')}@test.local`;
    const seenKnown = await messageIds(known);

    await requestLink(page, known);
    const knownUrl = page.url();
    const knownText = await page.locator('main').innerText();

    await requestLink(page, unknown);
    expect(page.url()).toBe(knownUrl);
    expect(await page.locator('main').innerText()).toBe(knownText);
    expect(knownText).toContain(t.login.sent);
    expect(knownText).not.toContain(known);

    // The known address got its link; the unknown one got nothing and no account.
    expect(await waitForNewMessage(known, seenKnown)).not.toBeNull();
    expect(await waitForNewMessage(unknown, new Set(), 3000)).toBeNull();
  });
});

test.describe('as editor_labak', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('visiting /t/demo gives 404', async ({ page }) => {
    const own = await page.goto('/t/labak');
    expect(own?.status()).toBe(200);

    const other = await page.goto('/t/demo');
    expect(other?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.notFound.title);
  });
});
