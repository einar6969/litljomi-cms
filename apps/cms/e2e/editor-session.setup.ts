// Setup project: signs editor_labak in through the real magic-link flow once per run and saves the
// browser state, which the specs reuse instead of signing in again.
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, test } from './support/test';

test('sign editor_labak in and save the session', async ({ page }) => {
  const landed = await signIn(page, PERSONA_EMAILS.editor_labak);
  expect(landed.pathname).toMatch(/^\/t\//);
  await page.context().storageState({ path: sessionState('editor_labak') });
});
