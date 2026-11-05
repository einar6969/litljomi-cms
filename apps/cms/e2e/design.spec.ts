// Task 31 (editor design): screenshots at 375, 768 and 1440 px wide (full page), saved to the
// gitignored apps/cms/e2e-screenshots/. Step 1 (`step1-*.png`): the sign-in page, the entry list and
// the edit form in each publish state that can be reached on the local stack. Step 2 (`step2-*.png`):
// the tenant picker (as a user with no tenant), the tenant home, not found, the image field, the
// conflict and signed-out notices, "Enginn vefur tengdur", and the magic link's confirm page (Task
// 32, which also asserts the status tones: "Tekið af vef" neutral, "Enginn vefur tengdur" a
// warning). The suspended-tenant notice and a picker with several tenants cannot be reached: the e2e
// support has no database access (a tenant's status is changed only by the owner/CLI) and no seeded
// user belongs to two tenants. Each screen at 375 px must not scroll sideways. Run as
// `pnpm --filter cms e2e design`. Every request is to a loopback address (support/test.ts aborts the
// rest); the only thing written is the PNG files.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createEvent, createNews } from './support/editor';
import { signIn } from './support/sign-in';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

const SHOTS = join(import.meta.dirname, '..', 'e2e-screenshots');
const WIDTHS = [375, 768, 1440] as const;
const SAVED = { timeout: 10_000 };
const CONFIRMED = { timeout: 150_000 };
const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const state = (page: Page) => page.getByTestId('publish-state');

/** Saves `<step>-<name>-<width>.png` (full page) at each width; at 375 px the page must not scroll sideways. */
async function shoot(page: Page, name: string, step: 'step1' | 'step2' = 'step1'): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // Let fonts and the layout settle after the resize.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width === 375) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} scrolls sideways at 375 px`).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: join(SHOTS, `${step}-${name}-${width}.png`), fullPage: true });
  }
}

test.describe('sign-in page', () => {
  test('screenshots', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.login.title);
    // The self-hosted fonts must load before there is a session (the proxy must not redirect them).
    await page.evaluate(() => document.fonts.ready);
    const fontsLoaded = await page.evaluate(() => [document.fonts.check('16px "Albert Sans"'), document.fonts.check('700 28px "Bricolage Grotesque"')]);
    expect(fontsLoaded, 'Albert Sans and Bricolage Grotesque loaded signed out').toEqual([true, true]);
    const faces = await page.evaluate(() => [...document.fonts].map((f) => f.status));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((s) => s === 'loaded'), `font faces: ${faces.join(',')}`).toBe(true);
    await shoot(page, 'login');
    // The invalid-link alert, as it shows after a failed sign-in link.
    await page.goto('/login?error=link');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.login.linkInvalid);
    await shoot(page, 'login-link-invalid');
    // The magic link's confirm page (Task 32): one "Halda áfram" button. A made-up hash, never pressed.
    await page.goto(`/auth/confirm?token_hash=${'0'.repeat(56)}&type=email`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
    await expect(page.getByRole('button', { name: t.confirm.submit })).toBeVisible();
    await shoot(page, 'auth-confirm', 'step2');
  });
});

test.describe('demo editor (event)', () => {
  test.use({ storageState: sessionState('editor_demo') });

  async function newEvent(page: Page, title: string): Promise<void> {
    await createEvent(page);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Start date').fill('2026-12-01');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  }

  test('edit form in each publish state, and the entry list', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await newEvent(page, 'Opnunarhátíð vorsins með tónlist og veitingum fyrir alla fjölskylduna');
    await shoot(page, 'form-never-published');

    // In progress: the status read is held back so the "Í birtingu…" state stays on screen.
    await page.route('**/rest/v1/publication_status*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      // fallback, not continue: the context's loopback guard (support/test.ts) still applies.
      await route.fallback().catch(() => undefined);
    });
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.inProgress);
    await shoot(page, 'form-in-progress');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await expect(state(page)).toHaveAttribute('data-tone', 'ok');
    await shoot(page, 'form-live');

    await page.getByRole('button', { name: t.publish.unpublish }).click();
    await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
    // Task 32: a final neutral tone, without the pending tone's pulsing dot.
    await expect(state(page)).toHaveAttribute('data-tone', 'neutral');
    await expect(state(page).locator('[class*="animate-pulse"]')).toHaveCount(0);
    await shoot(page, 'form-removed');

    // The entry list, with rows from this and earlier runs.
    await page.getByRole('link', { name: t.entries.back }).click();
    await expect(page.getByRole('table')).toBeVisible();
    await shoot(page, 'entry-list');
  });

  test('edit form with a publish error', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await createEvent(page);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toContainText(t.publish.invalid, CONFIRMED);
    await shoot(page, 'form-publish-error');
  });
});

test.describe('labak editor (news, rich text)', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('edit form with the rich-text editor', async ({ page }) => {
    await createNews(page);
    await page.getByLabel('Titill').fill('Nýtt brauð í bakaríinu');
    await page.getByRole('textbox', { name: 'Meginmál' }).click();
    await page.keyboard.type('Við bökum nú súrdeigsbrauð alla daga vikunnar.');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await shoot(page, 'form-richtext');
  });
});

// Step 2: the screens step 1 did not style.
const TITLE = 'Titill';
const shoot2 = (page: Page, name: string) => shoot(page, name, 'step2');

test.describe('labak editor, remaining screens', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('tenant home and not found', async ({ page }) => {
    await page.goto('/t/labak');
    // The tenant home's h1 is the seeded tenant name (tests/integration/src/seed.ts).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
    await shoot2(page, 'tenant-home');
    await page.goto('/t/finnst-ekki');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.notFound.title);
    await shoot2(page, 'not-found');
  });

  test('conflict and signed-out notices', async ({ page, context }) => {
    await createNews(page);
    await page.getByLabel(TITLE).fill('Fyrsti flipi');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

    const second = await context.newPage();
    await second.goto(page.url());
    await second.getByLabel(TITLE).fill('Annar flipi');
    await expect(second.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await second.close();

    await page.getByLabel(TITLE).fill('Fyrsti flipi, meira');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.conflict })).toBeVisible(SAVED);
    await shoot2(page, 'notice-conflict');

    // A fresh entry for the signed-out notice: the session ends while the editor is typing.
    await createNews(page);
    await page.getByLabel(TITLE).fill('Fyrir útskráningu');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await context.clearCookies();
    await page.getByLabel(TITLE).fill('Eftir útskráningu');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.signedOut })).toBeVisible(SAVED);
    await shoot2(page, 'notice-signed-out');
  });

  test('image field, then "Enginn vefur tengdur" (labak has no site)', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await createNews(page);
    await page.getByLabel(TITLE).fill('Nýtt brauð í bakaríinu');
    await page.getByLabel('Dagsetning').fill('2026-11-14');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

    // A file of the wrong type: the field's error notice (checked in the browser, before any upload).
    await page.locator('#field-image').setInputFiles({ name: 'texti.txt', mimeType: 'text/plain', buffer: Buffer.from('ekki mynd') });
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.type);
    await shoot2(page, 'image-field-error');

    // A real image: the preview, the alt text and the buttons.
    await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    const preview = page.getByTestId('field-image-preview');
    await expect(preview).toBeVisible(SAVED);
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), SAVED).toBeGreaterThan(0);
    await page.locator('#field-image-alt').fill('Rúgbrauð á borði');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await shoot2(page, 'image-field');

    // Publish in a tenant with no active site: nothing can confirm it, so it ends at "Enginn vefur tengdur".
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.noSite, CONFIRMED);
    // The kit's warning: #85520a on #fcf3e2.
    await expect(state(page)).toHaveAttribute('data-tone', 'warning');
    await expect(state(page)).toHaveCSS('background-color', 'rgb(252, 243, 226)');
    await expect(state(page)).toHaveCSS('color', 'rgb(133, 82, 10)');
    await shoot2(page, 'publish-no-site');
  });
});

test.describe('a user with no tenant', () => {
  test('tenant picker', async ({ page }) => {
    // The seeded outsider belongs to no tenant, so the picker shows its empty state (a user with
    // exactly one tenant is redirected past it, and no seeded user has two).
    await signIn(page, 'outsider@test.local');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.tenants.title);
    await expect(page.getByText(t.tenants.none)).toBeVisible();
    await shoot2(page, 'tenant-picker');
  });
});
