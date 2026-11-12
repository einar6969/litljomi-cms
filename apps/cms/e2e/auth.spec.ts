// Task 22 and PW-02: sign-in with a password and tenant routing, against the local CMS (`next start`
// on `CMS_PORT`, support/local.ts) and the local stack. A wrong password and an unknown address get
// the same neutral message (spec §4.4). Task 32 (decision 41.1): a link works in any browser, once,
// and opening it alone (as an email security scanner does) signs nobody in and does not use it up.
// Decision 42.2 (Q1): a visitor who is already signed in is told so; a bad link changes nothing.
// M3-14: the page drops the token hash from the address bar once loaded; a link for another account
// then names that account and asks before replacing the visitor's session ("Skipta um aðgang"
// revokes the old session, "Hætta við" keeps it), and a password sign-in discards the question.
//
// The confirm page refuses magic links (PW-03), so the links are password-reset links for the fixed
// personas, from the admin script (support/sign-in.ts, recoveryLink); the confirm page takes them as
// it takes an emailed one. A reset link signs in on the set-password page, which names the account;
// these tests set no password there, so the personas keep theirs.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { CMS_URL } from './support/local';
import { PERSONA_EMAILS, PERSONA_PASSWORD } from './support/personas';
import { sessionState } from './support/session';
import { followLink, openLink, recoveryLink, signIn, submitSignIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';

// The M3-14 question's cookie, as src/app/auth/confirm/pending.ts names it (server-only, so not imported).
const PENDING_COOKIE = 'cms-confirm-pending';

/** The set-password page a reset link lands on, signed in as `email`. */
async function expectSetPassword(page: Page, email: string): Promise<void> {
  await expect(page).toHaveURL(`${CMS_URL}/auth/password`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.password.title);
  await expect(page.getByRole('main')).toContainText(`${t.password.account} ${email}.`);
}

/** In a new tab of the same browser: still signed in as editor_demo. */
async function expectStillDemo(page: Page): Promise<void> {
  const tab = await page.context().newPage();
  expect((await tab.goto('/t/demo'))?.status()).toBe(200);
  await expect(tab.getByRole('heading', { level: 1 })).toHaveText('Demo');
  await tab.close();
}

test.describe('without a session', () => {
  test('editor_labak signs in with a password and lands on /t/labak', async ({ page }) => {
    // Editor routes need a session.
    await page.goto('/t/labak');
    await expect(page).toHaveURL(`${CMS_URL}/login`);

    const landed = await signIn(page, PERSONA_EMAILS.editor_labak);
    expect(landed.href).toBe(`${CMS_URL}/t/labak`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
    expect((await page.goto('/t/labak'))?.status()).toBe(200);
  });

  test('a wrong password and an unknown address get the same neutral message, and sign nobody in', async ({ page, context }) => {
    const known = PERSONA_EMAILS.editor_demo;
    const unknown = `nobody-${randomBytes(6).toString('hex')}@test.local`;
    const refusal = page.getByRole('main').getByRole('alert');

    await submitSignIn(page, known, `${PERSONA_PASSWORD}-wrong`);
    await expect(refusal).toHaveText(t.login.failed);
    const wrongUrl = page.url();
    const wrongText = await page.locator('main').innerText();

    await submitSignIn(page, unknown, PERSONA_PASSWORD);
    await expect(refusal).toHaveText(t.login.failed);
    expect(page.url()).toBe(wrongUrl);
    expect(await page.locator('main').innerText()).toBe(wrongText);

    expect(new URL(wrongUrl).pathname).toBe('/login');
    expect(wrongText).not.toContain(known);
    await expect(page.getByLabel(t.login.passwordLabel)).toHaveValue('');
    expect((await context.cookies()).filter(({ name }) => name.startsWith('sb-'))).toEqual([]);
    await page.goto('/t/demo');
    await expect(page).toHaveURL(`${CMS_URL}/login`);
  });

  test('a sign-in goes on to next when it is a path on the CMS, and home otherwise', async ({ browser }) => {
    for (const [next, landing] of [
      ['/t/labak/news', '/t/labak/news'],
      ['//evil.example/t/labak/news', '/t/labak'],
    ] as const) {
      const context = await newLoopbackContext(browser);
      try {
        const landed = await signIn(await context.newPage(), PERSONA_EMAILS.editor_labak, PERSONA_PASSWORD, `?${new URLSearchParams({ next })}`);
        expect(landed.href).toBe(`${CMS_URL}${landing}`);
      } finally {
        await context.close();
      }
    }
  });

  test('a link signs in in any browser, once', async ({ page, browser }) => {
    const link = await recoveryLink('editor_labak');

    // Another browser or device: a fresh context of its own.
    const other = await newLoopbackContext(browser);
    try {
      const otherPage = await other.newPage();
      const landed = await followLink(otherPage, link);
      expect(landed.href).toBe(`${CMS_URL}/auth/password`);
      await expectSetPassword(otherPage, PERSONA_EMAILS.editor_labak);
    } finally {
      await other.close();
    }

    // This browser is still signed out.
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

  test('opening the link without pressing the button signs nobody in and does not use it up', async ({ browser }) => {
    const link = await recoveryLink('editor_demo');

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
      const editorPage = await editor.newPage();
      const landed = await followLink(editorPage, link);
      expect(landed.href).toBe(`${CMS_URL}/auth/password`);
      await expectSetPassword(editorPage, PERSONA_EMAILS.editor_demo);
    } finally {
      await editor.close();
    }
  });

  test('the confirm page drops the token hash from the address bar, and its button still signs in', async ({ browser }) => {
    const link = await recoveryLink('editor_demo');
    const tokenHash = link.searchParams.get('token_hash')!;
    const visitor = await newLoopbackContext(browser);
    try {
      const visitorPage = await visitor.newPage();
      await openLink(visitorPage, link);
      await expect(visitorPage).toHaveURL(`${CMS_URL}/auth/confirm`);
      await visitorPage.getByRole('button', { name: t.confirm.submit }).click();
      await visitorPage.waitForURL(`${CMS_URL}/auth/password`);
      await expectSetPassword(visitorPage, PERSONA_EMAILS.editor_demo);
      // The history entry was replaced, not kept: going back shows the address without the hash.
      await visitorPage.goBack();
      expect(new URL(visitorPage.url()).pathname).toBe('/auth/confirm');
      expect(visitorPage.url()).not.toContain(tokenHash);
    } finally {
      await visitor.close();
    }
  });

  test('a signed-in editor pressing another account\'s link is shown that account and asked; "Skipta um aðgang" replaces the session', async ({ page, browser }) => {
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);
    const demoSession = await page.context().storageState();
    const link = await recoveryLink('editor_labak');

    await openLink(page, link);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(`${t.confirm.signedIn} ${t.confirm.signedInDetail}`);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(1);
    await expect(page.getByRole('main')).not.toContainText(PERSONA_EMAILS.editor_demo);
    await expect(page.getByRole('main')).not.toContainText(PERSONA_EMAILS.editor_labak);

    // The press verifies the link but changes nothing yet: it names the link's account and asks.
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.replaceTitle);
    await expect(page.getByRole('main')).toContainText(`${t.confirm.replaceAccount} ${PERSONA_EMAILS.editor_labak}.`);
    await expect(page.getByRole('main')).not.toContainText(PERSONA_EMAILS.editor_demo);
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(2);
    await expectStillDemo(page);

    // "Skipta um aðgang": now editor_labak, on the set-password page a reset link leads to, which
    // every other page, demo's included, leads back to.
    await page.getByRole('button', { name: t.confirm.replace }).click();
    await page.waitForURL(`${CMS_URL}/auth/password`);
    await expectSetPassword(page, PERSONA_EMAILS.editor_labak);
    await page.goto('/t/demo');
    await expectSetPassword(page, PERSONA_EMAILS.editor_labak);

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

  test('a signed-in editor answering "Hætta við" stays signed in as before', async ({ page, browser }) => {
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);
    const link = await recoveryLink('editor_labak');

    await openLink(page, link);
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page.getByRole('main')).toContainText(PERSONA_EMAILS.editor_labak);
    await page.getByRole('button', { name: t.confirm.keep }).click();
    await page.waitForURL((url) => url.pathname !== '/auth/confirm');
    await expectStillDemo(page);

    // The question is gone, and the link is used up.
    await page.goto('/auth/confirm');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
    await openLink(page, link);
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page).toHaveURL(`${CMS_URL}/login?error=link`);
    await expectStillDemo(page);
  });

  test('a signed-in editor pressing a bad link stays signed in as before', async ({ page }) => {
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);

    // A token hash of the right shape that Auth never issued.
    await openLink(page, new URL(`${CMS_URL}/auth/confirm?token_hash=${'0'.repeat(56)}&type=recovery`));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(`${t.confirm.signedIn} ${t.confirm.signedInDetail}`);
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

  test('a password sign-in discards a question left waiting on the confirm page (M3-14)', async ({ page, context }) => {
    const cookieNames = async () => (await context.cookies()).map(({ name }) => name);
    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);
    await openLink(page, await recoveryLink('editor_labak'));
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.replaceTitle);
    expect(await cookieNames()).toContain(PENDING_COOKIE);

    expect((await signIn(page, PERSONA_EMAILS.editor_demo)).href).toBe(`${CMS_URL}/t/demo`);
    expect(await cookieNames()).not.toContain(PENDING_COOKIE);
    await page.goto('/auth/confirm');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
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
