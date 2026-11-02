// Task 23: entry list, new entry, generated form, autosave, conflict and slugs, as editor_labak
// (the session saved by the editor-session setup project), against the local CMS and stack.
import { randomBytes } from 'node:crypto';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

// The labak module's own field labels (its type is the news type with Icelandic labels).
const TITLE = 'Titill';
const SAVED = { timeout: 10_000 };

test('creates a news entry, suggests the slug from the title and autosaves', async ({ page }) => {
  await createNews(page);
  await page.getByLabel(TITLE).fill('Brauð ársins 2025');
  await expect(page.getByTestId('slug-suggestion')).toContainText('braud-arsins-2025');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  // Since Task 24 every field kind of the news type has a component, so no field shows the
  // component-less notice (decision 37.6; that notice is unit-tested with the form's fields).
  await expect(page.getByText(t.editor.unsupportedField)).toHaveCount(0);

  // The title is in the draft after a reload, and the entry is in the list under it.
  await page.reload();
  await expect(page.getByLabel(TITLE)).toHaveValue('Brauð ársins 2025');
  await page.getByRole('link', { name: t.entries.back }).click();
  await expect(page.getByRole('link', { name: 'Brauð ársins 2025' }).first()).toBeVisible();
});

test('a second tab editing the same entry gives the first the conflict notice and keeps its text', async ({ page, context }) => {
  await createNews(page);
  await page.getByLabel(TITLE).fill('Fyrsti flipi');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  const second = await context.newPage();
  await second.goto(page.url());
  await second.getByLabel(TITLE).fill('Annar flipi');
  await expect(second.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await page.getByLabel(TITLE).fill('Fyrsti flipi, meira');
  // (Next.js's own route announcer is also an alert, so the notice is picked by its text.)
  await expect(page.getByRole('alert').filter({ hasText: t.editor.conflict })).toBeVisible(SAVED);
  await expect(page.getByLabel(TITLE)).toHaveValue('Fyrsti flipi, meira');
});

test('a duplicate slug shows "Slóðin er þegar í notkun"', async ({ page }) => {
  // A fresh slug per run: the local database keeps earlier runs' entries.
  const title = `Afrit ${randomBytes(5).toString('hex')}`;
  const slug = title.toLowerCase().replace(' ', '-');

  await createNews(page);
  await page.getByLabel(TITLE).fill(title);
  await page.getByRole('button', { name: t.editor.slug.save }).click();
  await expect(page.getByTestId('slug-notice')).toHaveText(t.editor.slug.saved);
  await expect(page.getByLabel(t.editor.slug.label)).toHaveValue(slug);

  await createNews(page);
  await page.getByLabel(TITLE).fill(title);
  await page.getByRole('button', { name: t.editor.slug.save }).click();
  await expect(page.getByTestId('slug-notice')).toHaveText('Slóðin er þegar í notkun');
});

// Review focus 1: the session ends while the editor is typing.
test('an expired session shows the sign-in notice and keeps the text on the screen', async ({ page, context }) => {
  await createNews(page);
  await page.getByLabel(TITLE).fill('Fyrir útskráningu');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  await context.clearCookies();
  await page.getByLabel(TITLE).fill('Eftir útskráningu');
  await expect(page.getByRole('alert').filter({ hasText: t.editor.signedOut })).toBeVisible(SAVED);
  await expect(page.getByLabel(TITLE)).toHaveValue('Eftir útskráningu');
});
