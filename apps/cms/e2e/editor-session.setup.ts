// Setup project: signs editor_labak and editor_demo in through the sign-in form with their fixture
// password once per run and saves each browser state, which the specs reuse instead of signing in
// again.
import { PERSONA_EMAILS, type E2ePersona } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, test } from './support/test';

for (const persona of ['editor_labak', 'editor_demo'] as const satisfies readonly E2ePersona[]) {
  test(`sign ${persona} in and save the session`, async ({ page }) => {
    const landed = await signIn(page, PERSONA_EMAILS[persona]);
    expect(landed.pathname).toMatch(/^\/t\//);
    await page.context().storageState({ path: sessionState(persona) });
  });
}
