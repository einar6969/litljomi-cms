// M5-03 (spec §4.4, §8.1; M5 findings 8 and 9), against the local CMS and stack: the page headers on
// a real response, the session cookies in a real browser, the pages working under the policy
// (nonced scripts, Tiptap's style element, an upload to Supabase, the QR data image), and an email
// change that needs the confirm page's POST from each address.
//
// The local Auth container reads its templates when it starts: restart the stack (`pnpm db:stop`,
// `pnpm db:start`) so that it mails the current email_change.html.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { SESSION_MAX_AGE } from '../src/lib/supabase/session-cookies';
import { addressOf, arrangeEmailChange, removeUser, resetAdmin } from './support/console-admin';
import { createNews } from './support/editor';
import { CMS_URL, SUPABASE_URL } from './support/local';
import { confirmLinkOf, waitForNewMessage } from './support/mailpit';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { accessToken, expectRefreshRefused, expireSession, expOf, sessionCookies } from './support/session-cookies';
import { signIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';

const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const SAVED = { timeout: 10_000 };

/** Collects what the browser reports when the policy blocks something on `page`. */
function policyViolations(page: Page): string[] {
  const seen: string[] = [];
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) seen.push(message.text());
  });
  return seen;
}

test.describe('headers', () => {
  test('a page carries the policy and the other headers, and every script carries that response\'s nonce', async ({ request }) => {
    const response = await request.get('/login');
    const headers = response.headers();
    const policy = headers['content-security-policy'] ?? '';
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain(`connect-src 'self' ${SUPABASE_URL}`);
    expect(policy).toContain(`img-src 'self' data: ${SUPABASE_URL}`);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('same-origin');
    expect(headers['strict-transport-security']).toContain('max-age=');

    const nonce = /'nonce-([^']+)'/.exec(policy)![1]!;
    const scripts = (await response.text()).match(/<script\b[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script).toContain(`nonce="${nonce}"`);

    const again = (await request.get('/login')).headers()['content-security-policy'];
    expect(again).not.toContain(nonce);
  });

  test('an /api route keeps its own headers', async ({ request }) => {
    const response = await request.get('/api/preview/labak');
    expect(response.status()).toBe(401);
    expect(response.headers()['content-security-policy']).toBeUndefined();
    expect(response.headers()['strict-transport-security']).toBeUndefined();
  });
});

test.describe('session cookies', () => {
  // R7: the CMS server never refreshes a session; the browser does, from the editor's own address.
  test('an expired session on a page navigation is refreshed in the browser, through /auth/refresh, back on the same page and still signed in', async ({ page, context }) => {
    // A session of its own: the refresh rotates its refresh token, which the stored sessions must keep.
    await signIn(page, PERSONA_EMAILS.editor_demo);
    // Off the editor first, whose browser client would otherwise refresh the session itself.
    await page.goto('about:blank');
    await expireSession(context);
    const forged = await accessToken(context);

    const refreshes: string[] = [];
    page.on('request', (request) => {
      if (new URL(request.url()).searchParams.get('grant_type') === 'refresh_token') refreshes.push(request.url());
    });
    // The page loads, one request per redirect hop.
    const loads: string[] = [];
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads.push(new URL(request.url()).pathname);
    });

    await page.goto('/t/demo/event?q=a');
    await expect(page).toHaveURL(`${CMS_URL}/t/demo/event?q=a`);
    await expect(page.getByRole('button', { name: t.app.signOut })).toBeVisible();
    expect(loads).toEqual(['/t/demo/event', '/auth/refresh', '/t/demo/event']);
    // One refresh, from the browser: none from the CMS server (its client refuses them).
    expect(refreshes).toEqual([`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`]);
    const fresh = await accessToken(context);
    expect(fresh).not.toBe(forged);
    expect(expOf(fresh)).toBeGreaterThan(Date.now() / 1000);
  });

  // R7 security review: the CMS server cannot load an expired session, so "Skrá út" signs out in the
  // browser first, which refreshes it from the editor's address and ends it in Auth.
  test('signing out once the access token has expired ends the session in Auth: its refresh token refreshes no more', async ({ page, context }) => {
    // A session of its own, which the sign-out ends.
    await signIn(page, PERSONA_EMAILS.editor_demo);
    await page.goto('/t/demo');
    // The page's browser client has started (KeepSessionFresh) with the session still good, so it
    // refreshes the expired one only at its next check, up to 30 s later: "Skrá út" comes first.
    await page.waitForLoadState('networkidle');
    await expireSession(context);
    const expired = await sessionCookies(context);

    await page.getByRole('button', { name: t.app.signOut }).click();
    await page.waitForURL(`${CMS_URL}/login`);
    expect(await sessionCookies(context)).toEqual([]);

    await expectRefreshRefused(page, expired, '/t/demo');
  });

  test('are same-site lax and bounded, readable by the browser client, and not Secure on local http', async ({ page, context }) => {
    await signIn(page, PERSONA_EMAILS.editor_demo);
    const cookies = (await context.cookies()).filter(({ name }) => name.startsWith('sb-'));
    expect(cookies.length).toBeGreaterThan(0);
    const latest = Date.now() / 1000 + SESSION_MAX_AGE + 60;
    for (const cookie of cookies) {
      expect(cookie.sameSite, cookie.name).toBe('Lax');
      expect(cookie.httpOnly, cookie.name).toBe(false);
      expect(cookie.secure, cookie.name).toBe(false);
      expect(cookie.expires, cookie.name).toBeGreaterThan(Date.now() / 1000);
      expect(cookie.expires, cookie.name).toBeLessThan(latest);
    }
  });
});

test.describe('the pages under the policy', () => {
  test.describe('as an editor', () => {
    test.use({ storageState: sessionState('editor_labak') });

    test('editing, autosave, the rich-text field and an upload to Supabase break no rule', async ({ page }) => {
      const violations = policyViolations(page);
      await createNews(page);
      await page.getByLabel('Titill').fill('Undir öryggisstefnu');
      await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

      await page.getByRole('textbox', { name: 'Meginmál' }).click();
      await page.keyboard.type('Texti');
      await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

      await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
      const preview = page.getByTestId('field-image-preview');
      await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), SAVED).toBe(64);

      expect(violations).toEqual([]);
    });
  });

  test('the QR on /console/mfa shows', async ({ page }) => {
    test.setTimeout(60_000);
    await resetAdmin();
    const violations = policyViolations(page);
    await signIn(page, PERSONA_EMAILS.platform_admin);
    await page.goto('/console/mfa');
    const qr = page.getByRole('main').locator('img');
    await expect.poll(() => qr.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), SAVED).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });
});

test.describe('an email change', () => {
  // Opens `link` in a browser of its own, as each mailbox's owner or scanner would, and hands its page on.
  async function atLink(browser: Browser, link: URL, use: (page: Page) => Promise<void>): Promise<void> {
    const context = await newLoopbackContext(browser);
    try {
      const page = await context.newPage();
      await page.goto(link.href);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.emailChangeTitle);
      await use(page);
    } finally {
      await context.close();
    }
  }
  const press = (page: Page) => page.getByRole('button', { name: t.confirm.submit }).click();

  async function linkMailedTo(address: string): Promise<URL> {
    const message = await waitForNewMessage(address, new Set());
    if (!message) throw new Error(`no email-change mail arrived for ${address}`);
    return confirmLinkOf(message);
  }

  test('needs the POST of each address, and opening the links confirms nothing', async ({ browser, page }) => {
    test.setTimeout(60_000);
    const { id, oldAddress, newAddress } = await arrangeEmailChange();
    try {
      const fromOld = await linkMailedTo(oldAddress);
      const fromNew = await linkMailedTo(newAddress);
      expect(fromOld.searchParams.get('type')).toBe('email_change');
      expect(fromNew.searchParams.get('type')).toBe('email_change');

      await test.step('a mail scanner opens both links: nothing changes and neither is used up', async () => {
        await atLink(browser, fromOld, async () => {});
        await atLink(browser, fromNew, async () => {});
        expect((await addressOf(id)).email).toBe(oldAddress);
      });

      await test.step('the first POST changes nothing and says the other address is needed', async () => {
        await atLink(browser, fromOld, async (visitor) => {
          await press(visitor);
          await visitor.waitForURL(`${CMS_URL}/login?emailChange=waiting`);
          await expect(visitor.getByRole('main').getByRole('status')).toHaveText(t.login.emailChangeWaiting);
        });
        expect((await addressOf(id)).email).toBe(oldAddress);
      });

      await test.step('the second POST completes the change and signs in', async () => {
        await atLink(browser, fromNew, async (visitor) => {
          await press(visitor);
          await visitor.waitForURL(({ pathname }) => pathname !== '/auth/confirm');
          expect(new URL(visitor.url()).pathname).not.toBe('/login');
        });
        expect((await addressOf(id)).email).toBe(newAddress);
      });

      await test.step('the new address signs in with the password from now on', async () => {
        // The account belongs to no tenant, so it lands on the tenant picker.
        expect((await signIn(page, newAddress)).pathname).toBe('/');
      });
    } finally {
      await removeUser(id);
    }
  });

  // The magic link's type (PW-03): sign-in is with a password.
  test('a link type no template sends is refused at the POST', async ({ page }) => {
    await page.goto(`/auth/confirm?token_hash=${'a'.repeat(56)}&type=email`);
    await page.getByRole('button', { name: t.confirm.submit }).click();
    await expect(page).toHaveURL(`${CMS_URL}/login?error=link`);
  });
});
