// Task 31 (editor design), step 1: screenshots of the sign-in page, the entry list and the edit
// form in each publish state that can be reached on the local stack, at 375, 768 and 1440 px wide
// (full page), saved to the gitignored apps/cms/e2e-screenshots/. Each screen at 375 px must not
// scroll sideways. Run as `pnpm --filter cms e2e design`. Every request is to a loopback address
// (support/test.ts aborts the rest); the only thing written is the PNG files.
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createEvent, createNews } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

const SHOTS = join(import.meta.dirname, '..', 'e2e-screenshots');
const WIDTHS = [375, 768, 1440] as const;
const SAVED = { timeout: 10_000 };
const CONFIRMED = { timeout: 150_000 };
const state = (page: Page) => page.getByTestId('publish-state');

/** Saves `step1-<name>-<width>.png` (full page) at each width; at 375 px the page must not scroll sideways. */
async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    // Let fonts and the layout settle after the resize.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    if (width === 375) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} scrolls sideways at 375 px`).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: join(SHOTS, `step1-${name}-${width}.png`), fullPage: true });
  }
}

test.describe('sign-in page', () => {
  test('screenshots', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.login.title);
    await shoot(page, 'login');
    // The invalid-link alert, as it shows after a failed callback.
    await page.goto('/login?error=link');
    await shoot(page, 'login-link-invalid');
  });
});

test.describe('demo editor (event)', () => {
  test.use({ storageState: sessionState('editor_demo') });

  async function newEvent(page: Page, title: string): Promise<void> {
    await createEvent(page);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Start date').fill('2026-12-01');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await page.getByLabel(t.editor.slug.label).fill(`honnun-${randomBytes(5).toString('hex')}`);
    await page.getByRole('button', { name: t.editor.slug.save }).click();
    await expect(page.getByTestId('slug-notice')).toHaveText(t.editor.slug.saved);
  }

  test('edit form in each publish state, and the entry list', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await newEvent(page, 'Opnunarhátíð vorsins með tónlist og veitingum fyrir alla fjölskylduna');
    await shoot(page, 'form-never-published');

    // In progress: the status read is held back so the "Í birtingu…" state stays on screen.
    await page.route('**/rest/v1/publication_status*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.continue().catch(() => undefined);
    });
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.inProgress);
    await shoot(page, 'form-in-progress');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await shoot(page, 'form-live');

    await page.getByRole('button', { name: t.publish.unpublish }).click();
    await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
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
