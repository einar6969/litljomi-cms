// PW-03 (spec §4.4): the first password from an invitation, and a forgotten password reset by email,
// against the local CMS and stack. Each link lands on the confirm page, whose button's POST uses it;
// the CMS then keeps the editor on the set-password page, whatever they open, until the password
// is set, and goes on from there. Opening a link alone (a mail scanner) uses nothing up.
//
// Throwaway accounts of their own (support/console-admin.ts): setting a password ends the account's
// other sessions, which the fixed personas' stored sessions must keep. The local Auth container reads
// its templates when it starts: restart the stack (`pnpm db:stop`, `pnpm db:start`) so that it mails
// the current invite.html and recovery.html.
import { randomBytes } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { arrangeAccount, inviteAccount, removeUser } from './support/console-admin';
import { CMS_URL } from './support/local';
import { confirmLinkOf, messageIds, waitForNewMessage } from './support/mailpit';
import { PERSONA_PASSWORD } from './support/personas';
import { openLink, signIn, submitSignIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';

const newPassword = () => `nýtt ${randomBytes(6).toString('hex')}`;

/** The one confirm-page link of the next mail to `email` that is not in `seen`, of `type`. */
async function mailedLink(email: string, seen: Set<string>, type: 'invite' | 'recovery'): Promise<URL> {
  const message = await waitForNewMessage(email, seen);
  if (!message) throw new Error(`no mail arrived for ${email}`);
  const link = confirmLinkOf(message);
  expect(link.searchParams.get('type')).toBe(type);
  return link;
}

/** Presses "Halda áfram" on the link's confirm page and waits for the set-password page, for `email`. */
async function pressLink(page: Page, link: URL, email: string): Promise<void> {
  await openLink(page, link);
  await page.getByRole('button', { name: t.confirm.submit }).click();
  await page.waitForURL(`${CMS_URL}/auth/password`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.password.title);
  await expect(page.getByRole('main')).toContainText(`${t.password.account} ${email}.`);
}

/** Sets `password` on the set-password page and waits for where it goes on to. */
async function setPassword(page: Page, password: string): Promise<URL> {
  await page.getByLabel(t.password.label).fill(password);
  await page.getByRole('button', { name: t.password.submit }).click();
  await page.waitForURL((url) => url.pathname !== '/auth/password');
  return new URL(page.url());
}

/** Opens `link` in a browser of its own, as a mail scanner would, without pressing anything. */
async function scan(browser: Browser, link: URL): Promise<void> {
  const scanner = await newLoopbackContext(browser);
  try {
    await openLink(await scanner.newPage(), link);
  } finally {
    await scanner.close();
  }
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: t.app.signOut }).click();
  await page.waitForURL(`${CMS_URL}/login`);
}

test('an invitation leads to setting a password first; after signing out, the password signs in', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const { id, email } = await inviteAccount();
  try {
    const link = await mailedLink(email, new Set(), 'invite');
    await scan(browser, link);
    await pressLink(page, link, email);

    await test.step('every other page leads back to the set-password page', async () => {
      for (const path of ['/', '/t/demo', '/t/labak/news', '/console']) {
        await page.goto(path);
        await expect(page, path).toHaveURL(`${CMS_URL}/auth/password`);
      }
    });

    await test.step('a refused password says so and stays', async () => {
      await page.getByLabel(t.password.label).fill('12345');
      await page.getByRole('button', { name: t.password.submit }).click();
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.password.tooShort);
      await expect(page).toHaveURL(`${CMS_URL}/auth/password`);
      await expect(page.getByLabel(t.password.label)).toHaveValue('');
    });

    const password = newPassword();
    await test.step('the password is set and the editor goes on', async () => {
      // The account belongs to no tenant, so it lands on the tenant picker.
      expect((await setPassword(page, password)).pathname).toBe('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.tenants.title);
      expect((await page.goto('/t/demo'))?.status()).toBe(404);
      // The step is over: the set-password page itself goes home.
      await page.goto('/auth/password');
      await expect(page).toHaveURL(`${CMS_URL}/`);
    });

    await test.step('after signing out, the password signs in', async () => {
      await signOut(page);
      expect((await signIn(page, email, password)).pathname).toBe('/');
    });
  } finally {
    await removeUser(id);
  }
});

test('a reset from "Gleymt lykilorð?": the new password signs in, the old one no longer', async ({ page, browser }) => {
  test.setTimeout(60_000);
  const { id, email } = await arrangeAccount();
  try {
    const seen = await messageIds(email);
    await page.goto('/login');
    await page.getByRole('link', { name: t.login.forgotLink }).click();
    await expect(page).toHaveURL(`${CMS_URL}/login/forgot`);
    await page.getByLabel(t.login.emailLabel).fill(email);
    await page.getByRole('button', { name: t.forgot.submit }).click();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.forgot.sent);
    await expect(page.getByRole('main')).not.toContainText(email);

    const link = await mailedLink(email, seen, 'recovery');
    await scan(browser, link);

    // In another browser: the link works in any.
    const editor = await newLoopbackContext(browser);
    try {
      const editorPage = await editor.newPage();
      await pressLink(editorPage, link, email);
      const password = newPassword();
      expect((await setPassword(editorPage, password)).pathname).toBe('/');
      await signOut(editorPage);

      await submitSignIn(page, email, PERSONA_PASSWORD);
      await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.login.failed);
      expect((await signIn(page, email, password)).pathname).toBe('/');
    } finally {
      await editor.close();
    }
  } finally {
    await removeUser(id);
  }
});

test('"Gleymt lykilorð?" shows the same confirmation for an address no account has, and sends nothing', async ({ page }) => {
  const email = `nobody-${randomBytes(6).toString('hex')}@test.local`;
  await page.goto('/login/forgot');
  await page.getByLabel(t.login.emailLabel).fill(email);
  await page.getByRole('button', { name: t.forgot.submit }).click();
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.forgot.sent);
  expect(await waitForNewMessage(email, new Set(), 2_000)).toBeNull();
});
