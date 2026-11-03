// Task 23: entry list, new entry, generated form, autosave, conflict and slugs, as editor_labak
// (the session saved by the editor-session setup project), against the local CMS and stack.
import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { t } from '../src/i18n/is';
import { createNews } from './support/editor';
import { sessionState } from './support/session';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

// The labak module's own field labels (its type is the news type with Icelandic labels).
const TITLE = 'Titill';
const DATE = 'Dagsetning';
const BODY = 'Meginmál';
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

// Decision 39.3: the suggestion is a placeholder, so typing into the field after focusing it gives
// exactly what was typed, never the suggestion with the typing appended.
test('typing a slug into the focused field gives exactly what was typed', async ({ page }) => {
  const slug = `min-slod-${randomBytes(5).toString('hex')}`;
  await createNews(page);
  await page.getByLabel(TITLE).fill('Brauð ársins 2025');
  const field = page.getByLabel(t.editor.slug.label);
  await expect(field).toHaveAttribute('placeholder', 'braud-arsins-2025');
  await field.click();
  await page.keyboard.type(slug);
  await expect(field).toHaveValue(slug);
  await page.getByRole('button', { name: t.editor.slug.save }).click();
  await expect(page.getByTestId('slug-notice')).toHaveText(t.editor.slug.saved);
  await page.reload();
  await expect(page.getByLabel(t.editor.slug.label)).toHaveValue(slug);
});

// Decision 39.3: the rich-text area is named by its field label.
test('the rich-text area has its field label as its accessible name', async ({ page }) => {
  await createNews(page);
  const body = page.getByRole('textbox', { name: BODY });
  await expect(body).toHaveAttribute('contenteditable', 'true');
  await expect(body).toHaveAccessibleName(BODY);
});

// Decision 39.3: keyboard date entry. The same keys are typed into a plain, uncontrolled
// <input type="date"> on a page with no network (page.setContent) in the same browser context and
// locale, and into our field; our field must give exactly what the plain input gives. The segment
// order is found by experiment, not from Intl: Intl's order differed from the input's in the first
// run. Result (2026-11-02): headless Chromium uses day-month-year for both is-IS and en-US,
// whatever Playwright's locale; "14112026" gives 2026-11-14 in the plain input and in ours, so
// DateField handles keyboard input correctly. A browser whose date input uses another order (such
// as month-day-year) needs the keys in that order.
const WALKTHROUGH_KEYS = '14112026';
const DATE_DIGITS = { day: '14', month: '11', year: '2026' } as const;
type Segment = keyof typeof DATE_DIGITS;
const SEGMENT_ORDERS: Segment[][] = [
  ['day', 'month', 'year'],
  ['month', 'day', 'year'],
  ['year', 'month', 'day'],
  ['year', 'day', 'month'],
  ['day', 'year', 'month'],
  ['month', 'year', 'day'],
];

/** What a plain, uncontrolled date input reports after `keys` are typed into it, focused and empty. */
async function plainDateValue(plain: Page, keys: string): Promise<string> {
  await plain.setContent('<label>Plain<input type="date" id="plain"></label>');
  const input = plain.locator('#plain');
  await input.focus();
  await plain.keyboard.type(keys);
  return input.inputValue();
}

/** Prints a keyboard-date finding in the run's output (the list reporter shows a test's stdout). */
function recordDateFinding(finding: string): void {
  console.log(`keyboard date entry, ${finding}`);
}

/** The segment order for which a plain date input turns the keys for 14 Nov 2026 into 2026-11-14. */
async function browserSegmentOrder(plain: Page): Promise<Segment[]> {
  for (const order of SEGMENT_ORDERS) {
    if ((await plainDateValue(plain, order.map((part) => DATE_DIGITS[part]).join(''))) === '2026-11-14') return order;
  }
  throw new Error('no segment order gives 2026-11-14 in a plain date input');
}

for (const locale of ['is-IS', 'en-US']) {
  test.describe(`keyboard date entry (${locale})`, () => {
    test.use({ locale });

    test('our date field takes typed keys exactly as a plain date input does', async ({ page, context }) => {
      const plain = await context.newPage();
      const expected = await plainDateValue(plain, WALKTHROUGH_KEYS);
      await plain.close();
      await createNews(page);
      const date = page.getByLabel(DATE);
      await date.focus();
      await page.keyboard.type(WALKTHROUGH_KEYS);
      recordDateFinding(`${locale}: "${WALKTHROUGH_KEYS}" gives "${expected}" in a plain input, "${await date.inputValue()}" in ours`);
      await expect(date).toHaveValue(expected);
    });

    test('a date typed in the browser\'s segment order is saved', async ({ page, context }) => {
      const plain = await context.newPage();
      const order = await browserSegmentOrder(plain);
      await plain.close();
      const keys = order.map((part) => DATE_DIGITS[part]).join('');
      recordDateFinding(`${locale}: the date input's segment order is ${order.join('-')} → ${keys}`);

      await createNews(page);
      const date = page.getByLabel(DATE);
      await date.focus();
      await page.keyboard.type(keys);
      await expect(date).toHaveValue('2026-11-14');
      await expect(page.getByRole('main').getByRole('status')).toHaveText(t.editor.saved, SAVED);
      await page.reload();
      await expect(page.getByLabel(DATE)).toHaveValue('2026-11-14');
    });
  });
}

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
