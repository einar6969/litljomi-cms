// M2-17 (spec §4.4, §13.2 "session expiry loses no work"): editor_labak's session ends mid-edit.
// The form keeps the values and shows the sign-in prompt; after signing in again in another tab the
// save lands with every edit by itself. Signing out removes the tab's copy of unsaved changes.
import { t } from '../src/i18n/is';
import { UNSAVED_KEY_PREFIX } from '../src/editor/unsaved';
import { createNews } from './support/editor';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, test } from './support/test';

test.use({ storageState: sessionState('editor_labak') });

const TITLE = 'Titill';
const SAVED = { timeout: 10_000 };
// The form looks again every few seconds while signed out (RESUME_POLL_MS), and on focus.
const RESUMED = { timeout: 20_000 };

const unsavedKeys = (prefix: string) => Object.keys(sessionStorage).filter((key) => key.startsWith(prefix));

test('an expired session loses no work: the save lands after signing in again in another tab', async ({ page, context }) => {
  await createNews(page);
  await page.getByLabel(TITLE).fill('Fyrir útrunna innskráningu');
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

  // The browser's session is gone (its cookies cleared): the next save is refused.
  await context.clearCookies();
  await page.getByLabel(TITLE).fill('Skrifað eftir að innskráningin rann út');
  const notice = page.getByRole('alert').filter({ hasText: t.editor.signedOut });
  await expect(notice).toBeVisible(SAVED);
  await expect(notice).toContainText(t.editor.signedOutBody);
  await expect(page.getByLabel(TITLE)).toHaveValue('Skrifað eftir að innskráningin rann út');
  expect(await page.evaluate(unsavedKeys, UNSAVED_KEY_PREFIX)).toHaveLength(1);

  const entryUrl = page.url();

  // Signing in again in another tab of the same browser.
  const other = await context.newPage();
  await signIn(other, PERSONA_EMAILS.editor_labak);
  await other.close();
  await page.bringToFront();
  await expect(notice).toBeHidden(RESUMED);
  await expect(page.getByRole('status')).toHaveText(t.editor.saved, RESUMED);
  expect(await page.evaluate(unsavedKeys, UNSAVED_KEY_PREFIX)).toHaveLength(0);

  // The draft on the server has the edit made while signed out.
  await page.goto(entryUrl);
  await expect(page.getByLabel(TITLE)).toHaveValue('Skrifað eftir að innskráningin rann út');
});

test('signing out removes the tab\'s copy of unsaved changes', async ({ page, context }) => {
  await createNews(page);
  await context.clearCookies();
  await page.getByLabel(TITLE).fill('Óvistað');
  await expect(page.getByRole('alert').filter({ hasText: t.editor.signedOut })).toBeVisible(SAVED);
  expect(await page.evaluate(unsavedKeys, UNSAVED_KEY_PREFIX)).toHaveLength(1);

  await page.getByRole('button', { name: t.app.signOut }).click();
  await page.waitForURL(/\/login$/);
  expect(await page.evaluate(unsavedKeys, UNSAVED_KEY_PREFIX)).toHaveLength(0);
});
