// PW-02 against the local stack's Auth: the browser client the sign-in form uses
// (lib/supabase/browser.ts, publishable key) gives the same error for a wrong password on a real
// account as for an address with no account, so the form's one neutral message is all it can show
// (spec §4.4). Auth's per-address limit is not tested here: local Auth limits nothing, so it is proved
// on the hosted production project (decision 72.4; docs/verification/pw-production.md).
//
// Node, not jsdom (whose URL the integration helpers cannot use): the browser client gets a
// `document.cookie` jar and a plain-http `location` instead of a browser's.
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { deleteThrowawayUsers, newUser, type TestUser } from '../../../../../../tests/integration/src/auth-api.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';

let user: TestUser;

/** `document.cookie` as the browser client uses it: `name=value` pairs, and Max-Age=0 removes one. */
const jar = new Map<string, string>();
const documentStandIn = {
  get cookie() {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  },
  set cookie(written: string) {
    const [pair = '', ...attributes] = written.split('; ');
    const separator = pair.indexOf('=');
    const name = pair.slice(0, separator);
    if (attributes.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, pair.slice(separator + 1));
  },
};

beforeAll(async () => {
  vi.stubGlobal('document', documentStandIn);
  vi.stubGlobal('location', { protocol: 'http:' });
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.publishableKey);
  user = await newUser('pw02');
});
afterAll(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await deleteThrowawayUsers();
});

const { createBrowserEditorClient } = await import('@/lib/supabase/browser');
const { signInFailureMessage } = await import('../outcome');
const { t } = await import('@/i18n/is');

/** What the form sees of a refused sign-in: the error's kind, status, code and text. */
async function refusal(email: string, password: string) {
  const { data, error } = await createBrowserEditorClient().auth.signInWithPassword({ email, password });
  expect(data.session).toBeNull();
  expect(error).not.toBeNull();
  return { name: error!.name, status: error!.status, code: error!.code, message: error!.message };
}

const sessionCookies = () => [...jar.keys()].filter((name) => name.startsWith('sb-'));

describe('PW-02: password sign-in from the browser client', () => {
  it('a wrong password on a real account and an unknown address get the same Auth error, and the same message', async () => {
    const wrongPassword = await refusal(user.email, `${user.password!}x`);
    const unknownAddress = await refusal(`nobody-${randomBytes(6).toString('hex')}@test.local`, user.password!);
    expect(wrongPassword).toEqual(unknownAddress);
    expect(wrongPassword).toMatchObject({ status: 400, code: 'invalid_credentials' });
    expect(signInFailureMessage(wrongPassword)).toBe(t.login.failed);
    expect(sessionCookies()).toEqual([]);
  });

  it('the right password signs in and writes the session cookies', async () => {
    const client = createBrowserEditorClient();
    const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: user.password! });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(user.id);
    expect(sessionCookies().length).toBeGreaterThan(0);
    await client.auth.signOut({ scope: 'local' });
  });
});
