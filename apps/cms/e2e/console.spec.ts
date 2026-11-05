// M4-04: console access (spec §2.1, §4.4, §8.1), against the local CMS and stack. An editor gets
// 404; an admin at aal1 is sent to /console/mfa, enrols a first TOTP factor and reaches /console;
// a later session asks for the code and shows no secret. The Auth hook still refuses a password.
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { adminFactors, adminPasswordSignIn, resetAdmin } from './support/console-admin';
import { CMS_URL } from './support/local';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';
import { totp, wrongCode } from './support/totp';

const REFUSED = "That code didn't work. Try again.";
const CONSOLE = `${CMS_URL}/console`;
const MFA = `${CMS_URL}/console/mfa`;

const manualCode = (page: Page) => page.getByRole('main').locator('code');

async function submitCode(page: Page, code: string): Promise<void> {
  await page.getByLabel('Six-digit code').fill(code);
  await page.getByRole('button', { name: 'Verify' }).click();
}

const expectConsole = async (page: Page) => {
  await page.waitForURL(CONSOLE);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console');
};

test.describe('without a session', () => {
  test('the console sends a visitor to sign in', async ({ page }) => {
    await page.goto('/console');
    await expect(page).toHaveURL(`${CMS_URL}/login`);
    await page.goto('/console/mfa');
    await expect(page).toHaveURL(`${CMS_URL}/login`);
  });
});

test.describe('as an editor', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('/console and /console/mfa answer 404, as an unknown tenant does', async ({ page }) => {
    expect((await page.goto('/console'))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.notFound.title);

    expect((await page.goto('/console/mfa'))?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.notFound.title);
    await expect(page.locator('img')).toHaveCount(0);
  });
});

test.describe('as the platform admin', () => {
  // Signing in and each step in the script (support/console-admin.ts) take seconds of their own.
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  // Every run enrols from nothing; a verified factor from an earlier run would only be challenged.
  test.beforeAll(async () => {
    await resetAdmin();
  });

  let secret = '';

  test('at aal1 is sent to /console/mfa, is refused a wrong code, enrols and reaches /console', async ({ page }) => {
    await signIn(page, PERSONA_EMAILS.platform_admin);

    await page.goto('/console');
    await expect(page).toHaveURL(MFA);
    const qr = page.getByRole('img', { name: 'QR code for your authenticator app' });
    await expect(qr).toBeVisible();
    await expect.poll(() => qr.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);

    // An attempt abandoned by reloading: the old factor is removed and a fresh one enrolled.
    const abandoned = await manualCode(page).innerText();
    await page.reload();
    secret = await manualCode(page).innerText();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);
    expect(secret).not.toBe(abandoned);
    expect(await adminFactors()).toEqual({ verified: 0, unverified: 1 });

    await submitCode(page, wrongCode(secret));
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(REFUSED);
    await expect(page).toHaveURL(MFA);
    expect(await adminFactors()).toEqual({ verified: 0, unverified: 1 });

    // The same factor stays on the page after a mistyped code.
    await expect(manualCode(page)).toHaveText(secret);
    await submitCode(page, totp(secret));
    await expectConsole(page);
    expect(await adminFactors()).toEqual({ verified: 1, unverified: 0 });

    // aal2 holds across pages, and the MFA page has nothing left to ask.
    await page.goto('/console');
    await expectConsole(page);
    await page.goto('/console/mfa');
    await expectConsole(page);
  });

  test('a later session asks for the code, shows no secret and enrols nothing', async ({ browser }) => {
    const later = await newLoopbackContext(browser);
    try {
      const laterPage = await later.newPage();
      await signIn(laterPage, PERSONA_EMAILS.platform_admin);

      await laterPage.goto('/console');
      await expect(laterPage).toHaveURL(MFA);
      await expect(laterPage.getByLabel('Six-digit code')).toBeVisible();
      await expect(laterPage.locator('img')).toHaveCount(0);
      await expect(manualCode(laterPage)).toHaveCount(0);
      expect(await laterPage.content()).not.toContain(secret);

      await submitCode(laterPage, wrongCode(secret));
      await expect(laterPage.getByRole('main').getByRole('alert')).toHaveText(REFUSED);
      await laterPage.goto('/console');
      await expect(laterPage).toHaveURL(MFA);

      await submitCode(laterPage, totp(secret));
      await expectConsole(laterPage);
      expect(await adminFactors()).toEqual({ verified: 1, unverified: 0 });
    } finally {
      await later.close();
    }
  });

  test('the Auth hook still refuses a password sign-in', async () => {
    expect(await adminPasswordSignIn()).toEqual({ status: 403, signedIn: false });
  });
});
