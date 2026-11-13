// Steps the editor specs share (Tasks 23–25), as an editor does them in the browser.
import { expect, type Page } from '@playwright/test';
import { t } from '../../src/i18n/is';
import { CMS_URL } from './local';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const NEWS_ENTRY_URL = new RegExp(`^${CMS_URL}/t/labak/news/(${UUID})$`);

/** Opens the news list from labak's start page, creates an entry and returns its id. */
export async function createNews(page: Page): Promise<string> {
  await page.goto('/t/labak');
  await page.getByRole('main').getByRole('link', { name: 'Fréttir' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fréttir');
  await page.getByRole('button', { name: t.entries.new }).click();
  await page.waitForURL(NEWS_ENTRY_URL);
  return NEWS_ENTRY_URL.exec(page.url())![1]!;
}

export const EVENT_ENTRY_URL = new RegExp(`^${CMS_URL}/t/demo/event/(${UUID})$`);

/** Opens the demo event list from demo's start page, creates an event and returns its id. */
export async function createEvent(page: Page): Promise<string> {
  await page.goto('/t/demo');
  await page.getByRole('main').getByRole('link', { name: 'Events', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Events');
  await page.getByRole('button', { name: t.entries.new }).click();
  await page.waitForURL(EVENT_ENTRY_URL);
  return EVENT_ENTRY_URL.exec(page.url())![1]!;
}
