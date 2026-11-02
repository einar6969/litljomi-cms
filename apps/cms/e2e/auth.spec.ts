// Task 22: magic-link sign-in, tenant routing and the neutral sign-in message, against the local
// CMS (`next start -p 3100`), the local stack and its Mailpit.
import { randomBytes } from 'node:crypto';
import { t } from '../src/i18n/is';
import { CMS_URL } from './support/local';
import { messageIds, waitForNewMessage } from './support/mailpit';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { requestLink, signIn } from './support/sign-in';
import { expect, test } from './support/test';

test.describe('without a session', () => {
  test('editor_labak signs in through the Mailpit link and lands on /t/labak', async ({ page }) => {
    // Editor routes need a session.
    await page.goto('/t/labak');
    await expect(page).toHaveURL(`${CMS_URL}/login`);

    const landed = await signIn(page, PERSONA_EMAILS.editor_labak);
    expect(landed.href).toBe(`${CMS_URL}/t/labak`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
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
