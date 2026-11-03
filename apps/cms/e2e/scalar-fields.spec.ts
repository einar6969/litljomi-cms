// M2-07: the editor inputs for the scalar kinds, on the demo event type (one optional field of each
// kind: capacity is a whole number from 0, free entry a boolean, category a select, doors open a
// datetime), as editor_demo against the local CMS and stack. Each input is operated by keyboard;
// the values are autosaved and come back after a reload.
import { t } from '../src/i18n/is';
import { createEvent } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo'), timezoneId: 'Atlantic/Reykjavik' });

const SAVED = { timeout: 10_000 };

test('number, boolean, select and datetime inputs are keyboard-operable and autosave typed values', async ({ page }) => {
  await createEvent(page);
  await page.getByLabel('Title').fill('Tónleikar í Hörpu');
  // Only the reference field (its picker is M2-08) still shows the component-less notice.
  await expect(page.getByText(t.editor.unsupportedField)).toHaveCount(1);

  await test.step('number: typing, the error for a refused value, and arrow-key steps', async () => {
    const capacity = page.getByLabel('Capacity');
    await expect(page.locator('#field-capacity-help')).toHaveText('Heil tala, minnst 0.');
    await capacity.focus();
    await page.keyboard.type('-1');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.number.invalid })).toBeVisible();
    await expect(capacity).toHaveAttribute('aria-invalid', 'true');
    await capacity.fill('');
    await page.keyboard.type('119');
    await page.keyboard.press('ArrowUp');
    await expect(capacity).toHaveValue('120');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.number.invalid })).toHaveCount(0);
  });

  await test.step('boolean: a radio group named by its label, answered with the keyboard', async () => {
    const group = page.getByRole('group', { name: 'Free entry' });
    await expect(group.getByRole('radio', { name: t.editor.boolean.unset })).toBeChecked();
    await group.getByRole('radio', { name: t.editor.boolean.yes }).focus();
    await page.keyboard.press('Space');
    await expect(group.getByRole('radio', { name: t.editor.boolean.yes })).toBeChecked();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: t.editor.boolean.no })).toBeChecked();
  });

  await test.step('select: the empty choice first, then the options, chosen with the keyboard', async () => {
    const category = page.getByLabel('Category');
    await expect(category.locator('option')).toHaveText([t.editor.select.placeholder, 'Concert', 'Workshop', 'Talk']);
    await category.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(category).toHaveValue('workshop');
  });

  await test.step('datetime: entered in the browser time zone, which the help text names', async () => {
    const doors = page.getByLabel('Doors open');
    await expect(page.locator('#field-doorsOpen-help')).toHaveText(t.editor.datetime.help.replace('{zone}', 'Atlantic/Reykjavik'));
    await doors.fill('2026-11-14T19:30');
    await expect(doors).toHaveValue('2026-11-14T19:30');
  });

  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);

  // The saved draft holds the typed values: they come back after a reload.
  await page.reload();
  await expect(page.getByLabel('Capacity')).toHaveValue('120');
  await expect(page.getByRole('group', { name: 'Free entry' }).getByRole('radio', { name: t.editor.boolean.no })).toBeChecked();
  await expect(page.getByLabel('Category')).toHaveValue('workshop');
  await expect(page.getByLabel('Doors open')).toHaveValue('2026-11-14T19:30');
});

test('clearing the inputs saves an event without the values', async ({ page }) => {
  await createEvent(page);
  await page.getByLabel('Title').fill('Fyrirlestur');
  await page.getByLabel('Capacity').fill('30');
  await page.getByRole('group', { name: 'Free entry' }).getByRole('radio', { name: t.editor.boolean.yes }).check();
  await page.getByLabel('Category').selectOption('talk');
  await page.getByLabel('Doors open').fill('2026-12-01T18:00');
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await page.getByLabel('Capacity').fill('');
  await page.getByRole('group', { name: 'Free entry' }).getByRole('radio', { name: t.editor.boolean.unset }).check();
  await page.getByLabel('Category').selectOption('');
  await page.getByLabel('Doors open').fill('');
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await page.reload();
  await expect(page.getByLabel('Title')).toHaveValue('Fyrirlestur');
  await expect(page.getByLabel('Capacity')).toHaveValue('');
  await expect(page.getByRole('group', { name: 'Free entry' }).getByRole('radio', { name: t.editor.boolean.unset })).toBeChecked();
  await expect(page.getByLabel('Category')).toHaveValue('');
  await expect(page.getByLabel('Doors open')).toHaveValue('');
});
