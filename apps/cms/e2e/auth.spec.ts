// Task 22: magic-link sign-in, tenant routing and the neutral sign-in message, against the local
// CMS (`next start` on `CMS_PORT`, support/local.ts), the local stack and its Mailpit. Task 32 (decision 41.1): the link
// works in a browser other than the one that asked for it, and opening it alone (as an email
// security scanner does) signs nobody in and does not use it up. Decision 42.2 (Q1): a visitor who
// is already signed in is told so, keeps that session until pressing "Halda áfram", and the press
// replaces it (the old session is revoked); a bad link changes nothing.
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

  test('a signed-in editor opening another account\'s link is told so, and only the press replaces the session', async ({ page, browser }) => {
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);
    const demoSession = await page.context().storageState();

    // editor_labak's link, requested in another browser and opened in this signed-in one.
    const requester = await newLoopbackContext(browser);
    let link: URL;
    try {
      link = await requestMagicLink(await requester.newPage(), PERSONA_EMAILS.editor_labak);
    } finally {
      await requester.close();
    }
    await openLink(page, link);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.confirm.signedIn);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('main')).not.toContainText(PERSONA_EMAILS.editor_demo);
    await expect(page.getByRole('main')).not.toContainText(PERSONA_EMAILS.editor_labak);

    // Before the press nothing has changed: this browser is still editor_demo.
    const tab = await page.context().newPage();
    expect((await tab.goto('/t/demo'))?.status()).toBe(200);
    await expect(tab.getByRole('heading', { level: 1 })).toHaveText('Demo');
    await tab.close();

    // The press replaces the session: now editor_labak, who has no access to demo.
    expect((await followLink(page, link)).href).toBe(`${CMS_URL}/t/labak`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
    expect((await page.goto('/t/demo'))?.status()).toBe(404);

    // The replaced editor_demo session is revoked, not just overwritten in this browser.
    const replaced = await newLoopbackContext(browser, { storageState: demoSession });
    try {
      const replacedPage = await replaced.newPage();
      await replacedPage.goto('/t/demo');
      await expect(replacedPage).toHaveURL(`${CMS_URL}/login`);
    } finally {
      await replaced.close();
    }
  });

  test('a signed-in editor pressing a bad link stays signed in as before', async ({ page }) => {
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);

    // A token hash of the right shape that Auth never issued.
    await openLink(page, new URL(`${CMS_URL}/auth/confirm?token_hash=${'0'.repeat(56)}&type=email`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.confirm.signedIn);
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page).toHaveURL(`${CMS_URL}/login?error=link`);

    expect((await page.goto('/t/demo'))?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Demo');
  });

  test('the favicon is served without a session (decision 42.2, Q7)', async ({ page }) => {
    await page.goto('/login');
    const href = await page.locator('head link[rel="icon"]').getAttribute('href');
    expect(href).toMatch(/^\/icon\.svg(?:\?|$)/);
    const icon = await page.request.get(href ?? '', { maxRedirects: 0 });
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
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
