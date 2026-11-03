// M2-08: the reference picker, as editor_demo (the session saved by the editor-session setup
// project), against the local CMS and stack. The demo event's optional `related` field refers to
// another event (modules/demo).
import { randomBytes } from 'node:crypto';
import { t } from '../src/i18n/is';
import { createEvent } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const TITLE = 'Title';
const RELATED = 'Related event';
const SAVED = { timeout: 10_000 };

test('picks another event by its title and status, saves the reference and clears it again', async ({ page }) => {
  // Fresh titles per run: the local database keeps earlier runs' entries.
  const run = randomBytes(4).toString('hex');
  const targetTitle = `Markmið ${run}`;
  const targetId = await createEvent(page);
  await page.getByLabel(TITLE).fill(targetTitle);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await createEvent(page);
  await page.getByLabel(TITLE).fill(`Tilvísun ${run}`);
  const picker = page.getByLabel(RELATED);
  await expect(picker).toBeEnabled();
  // The target is listed with its title and status; it has never been published.
  const option = `${targetTitle} (${t.entries.statuses.draft})`;
  await expect(picker.locator('option', { hasText: option })).toHaveCount(1);
  await picker.selectOption({ label: option });
  await expect(page.getByText(t.editor.reference.unpublished)).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await page.reload();
  await expect(page.getByLabel(RELATED)).toBeEnabled();
  await expect(page.getByLabel(RELATED)).toHaveValue(targetId);

  await page.getByLabel(RELATED).selectOption({ label: t.editor.reference.none });
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  await page.reload();
  await expect(page.getByLabel(RELATED)).toBeEnabled();
  await expect(page.getByLabel(RELATED)).toHaveValue('');
});
