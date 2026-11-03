// M2-15: the list and group inputs, as editor_demo against the local CMS and stack. The demo
// event's optional `program` group holds a text field and a list of event references (modules/demo).
// Items are added, filled in, reordered with the keyboard and removed; each change is autosaved
// and comes back after a reload.
import { randomBytes } from 'node:crypto';
import { t } from '../src/i18n/is';
import { createEvent } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_demo') });

const SAVED = { timeout: 10_000 };
const item = (n: number) => t.editor.list.item.replace('{label}', 'Event').replace('{n}', String(n));
const fill = (s: string, n: number) => s.replace('{item}', item(n));

test('a group with a list: add, fill in, reorder by keyboard and remove, each autosaved', async ({ page }) => {
  // Fresh titles per run: the local database keeps earlier runs' entries.
  const run = randomBytes(4).toString('hex');
  const ids: Record<string, string> = {};
  for (const name of ['Fyrsti', 'Annar']) {
    ids[name] = await createEvent(page);
    await page.getByLabel('Title').fill(`${name} ${run}`);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);
  }
  const option = (name: string) => ({ label: `${name} ${run} (${t.entries.statuses.draft})` });

  await createEvent(page);
  await page.getByLabel('Title').fill(`Dagskrá ${run}`);
  const program = page.getByRole('group', { name: 'Program' });
  const highlights = program.getByRole('group', { name: 'Highlights' });
  await expect(page.getByText(t.editor.unsupportedField)).toHaveCount(0);
  await program.getByLabel('Introduction').fill('Kvöldið hefst klukkan átta.');
  await expect(highlights.getByText('Mest 10 atriði.')).toBeVisible();

  await test.step('add two items and pick an event in each', async () => {
    await highlights.getByRole('button', { name: t.editor.list.add }).click();
    // The new item's picker has the focus.
    await expect(highlights.getByLabel(item(1), { exact: true })).toBeFocused();
    await expect(highlights.getByLabel(item(1), { exact: true })).toBeEnabled();
    await highlights.getByLabel(item(1), { exact: true }).selectOption(option('Fyrsti'));
    await highlights.getByRole('button', { name: t.editor.list.add }).click();
    await expect(highlights.getByLabel(item(2), { exact: true })).toBeEnabled();
    await highlights.getByLabel(item(2), { exact: true }).selectOption(option('Annar'));
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await test.step('move the second item up with the arrow key on its handle', async () => {
    await highlights.getByRole('button', { name: fill(t.editor.list.handle, 2) }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(highlights.getByLabel(item(1), { exact: true })).toHaveValue(ids.Annar!);
    await expect(highlights.getByLabel(item(2), { exact: true })).toHaveValue(ids.Fyrsti!);
    // Focus stays on the moved item's handle.
    await expect(highlights.getByRole('button', { name: fill(t.editor.list.handle, 1) })).toBeFocused();
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await page.reload();
  await expect(page.getByLabel('Introduction')).toHaveValue('Kvöldið hefst klukkan átta.');
  await expect(page.getByLabel(item(1), { exact: true })).toBeEnabled();
  await expect(page.getByLabel(item(1), { exact: true })).toHaveValue(ids.Annar!);
  await expect(page.getByLabel(item(2), { exact: true })).toHaveValue(ids.Fyrsti!);

  await test.step('remove the first item', async () => {
    await page.getByRole('button', { name: fill(t.editor.list.remove, 1) }).click();
    await expect(page.getByLabel(item(1), { exact: true })).toHaveValue(ids.Fyrsti!);
    await expect(page.getByLabel(item(2), { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);
  });

  await page.reload();
  await expect(page.getByLabel(item(1), { exact: true })).toBeEnabled();
  await expect(page.getByLabel(item(1), { exact: true })).toHaveValue(ids.Fyrsti!);
  await expect(page.getByLabel(item(2), { exact: true })).toHaveCount(0);
});
