// M4-05: the console pages (spec §8.4), against the local CMS and stack. An aal2 admin sees the
// seeded tenants and two fixture tenants (support/console-admin.ts): one active with a failed
// request, release and delivery, one suspended with nothing (named "paused", so only its status
// says suspended). Read only: the pages have no form.
import type { BrowserContext, Locator, Page } from '@playwright/test';
import { arrangePages, cleanPages, resetAdmin } from './support/console-admin';
import { CMS_URL } from './support/local';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';
import { totp } from './support/totp';

test.describe('without a session', () => {
  test('a tenant page sends a visitor to sign in', async ({ page }) => {
    await page.goto('/console/t/labak');
    await expect(page).toHaveURL(`${CMS_URL}/login`);
  });
});

test.describe('as an editor', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('a tenant page answers 404', async ({ page }) => {
    expect((await page.goto('/console/t/labak'))?.status()).toBe(404);
  });
});

test.describe('as the platform admin at aal2', () => {
  test.describe.configure({ mode: 'serial', timeout: 60_000 });

  // One browser context for the whole block: it signs in and enrols once.
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    await resetAdmin();
    await arrangePages();
    context = await newLoopbackContext(browser);
    page = await context.newPage();
  });
  test.afterAll(async () => {
    await context?.close();
    await cleanPages();
  });

  const row = (name: string) => page.getByRole('row').filter({ hasText: name });

  test('signs in and enrols a factor to reach aal2', async () => {
    await signIn(page, PERSONA_EMAILS.platform_admin);
    await page.goto('/console');
    await expect(page).toHaveURL(`${CMS_URL}/console/mfa`);
    const secret = await page.getByRole('main').locator('code').innerText();
    await page.getByLabel('Six-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForURL(`${CMS_URL}/console`);
  });

  test('the overview lists every tenant, and a suspended tenant as suspended', async () => {
    await page.goto('/console');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console');
    for (const name of ['LABAK', 'Demo', 'Console fixture', 'Console paused']) await expect(row(name)).toHaveCount(1);
    await expect(row('Console paused').getByText('suspended', { exact: true })).toBeVisible();
    await expect(row('Console fixture').getByText('suspended', { exact: true })).toHaveCount(0);
    await expect(row('Console paused')).toContainText('No release yet');
    await expect(row('Console fixture')).toContainText('active');
    await expect(row('Console fixture')).toContainText('build_failed at previous_bundle');
  });

  test('a tenant page shows the failed delivery, request, release and site', async () => {
    await page.goto('/console');
    await page.getByRole('link', { name: 'Console fixture' }).click();
    await expect(page).toHaveURL(`${CMS_URL}/console/t/console-fixture`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console fixture');
    await expect(page.getByRole('region', { name: 'Deliveries' })).toContainText('notify_failed (500)');
    await expect(page.getByRole('region', { name: 'Deliveries' })).toContainText('4 attempts');
    await expect(page.getByRole('region', { name: 'Releases' })).toContainText('build_failed at previous_bundle');
    await expect(page.getByRole('region', { name: 'Requests' })).toContainText('invalid_data');
    await expect(page.getByRole('region', { name: 'Sites' })).toContainText('http://localhost:3299/fixture');
    await page.getByRole('link', { name: 'All tenants' }).click();
    await expect(page).toHaveURL(`${CMS_URL}/console`);
  });

  test('a suspended tenant shows as suspended with empty lists, and an unknown slug is a 404', async () => {
    await page.goto('/console/t/console-paused');
    await expect(page.getByRole('main').getByText('suspended', { exact: true })).toBeVisible();
    for (const noun of ['requests', 'releases', 'deliveries', 'sites', 'audit events']) await expect(page.getByText(`No ${noun}.`)).toBeVisible();
    expect((await page.goto('/console/t/no-such-tenant'))?.status()).toBe(404);
  });

  test('both pages fit 375, 768 and 1440 px, and at 375 each table scrolls to its last column', async () => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ['/console', '/console/t/console-fixture']) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}`).toBeLessThanOrEqual(0);
      }
    }

    // scrollWidth of the page cannot see inside a table's own scrolling wrapper: scroll each one to
    // its end and check that the last header cell then lies within the viewport.
    const lastColumnReachable = (wrapper: Locator) =>
      wrapper.evaluate((element: HTMLElement) => {
        element.scrollLeft = element.scrollWidth;
        const last = element.querySelector('th:last-child')?.getBoundingClientRect();
        return !!last && last.left >= 0 && last.right <= document.documentElement.clientWidth + 1;
      });
    await page.setViewportSize({ width: 375, height: 900 });
    await page.goto('/console/t/console-fixture');
    for (const name of ['Requests', 'Releases', 'Deliveries', 'Sites', 'Audit events']) {
      const wrapper = page.getByRole('region', { name }).locator('.overflow-x-auto');
      await expect(wrapper, `${name} has a table`).toHaveCount(1);
      expect(await lastColumnReachable(wrapper), `${name}: last column reachable at 375`).toBe(true);
    }
    await page.goto('/console');
    await expect(row('Console paused').getByText('suspended', { exact: true })).toBeVisible();
    expect(await lastColumnReachable(page.getByRole('region', { name: 'Tenants' }).locator('.overflow-x-auto'))).toBe(true);
  });
});
