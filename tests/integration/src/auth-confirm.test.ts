// Cross-device links (plan Task 32, decision 41.1; spec §4.4). The invitation and email-change
// mails link to the CMS's /auth/confirm page with the token hash; when the editor presses its
// button, the CMS verifies the hash on the server with POST /auth/v1/verify { type, token_hash }
// (supabase-js verifyOtp). No PKCE verifier is needed, so the link works in any browser. This file
// checks the emailed links and that their verification goes through the sign-in hook (PW-01): Auth
// reports each as `otp`, which the hook allows (decision 72.1). The sign-in (magic-link) mail has
// no link at all (auth-sign-in.test.ts).
//
// The mail templates are served by the running local stack, so this file needs the stack started
// with this repository's supabase/templates and config.toml.
import { afterAll, describe, expect, it } from 'vitest';
import {
  adminAuth, auth, brief, claims, clearMail, confirmLink, deleteThrowawayUsers, newUser, passwordSession, sleep, waitMail,
} from './auth-api.ts';
import { closeAll } from './sql.ts';

/** The method Auth reports for every link verified by token hash, which the sign-in hook allows (decision 72.1). */
const LINK_METHODS = ['otp'];
/** The shape Auth issues for `{{ .TokenHash }}` (GoTrue v2.197.0): SHA-224 hex, `pkce_` for a PKCE request. */
const TOKEN_HASH = /^(?:pkce_)?[0-9a-f]{56}$/;
/** The local Auth Site URL (supabase/config.toml, decision 37.4): the CMS. */
const SITE_URL = 'http://localhost:3100';

const methods = (accessToken: string) => (claims(accessToken).amr as { method: string }[]).map((a) => a.method);

afterAll(async () => {
  await deleteThrowawayUsers();
  await closeAll();
});

/** The link of the one new mail to `email`, checked to be the CMS's confirm page for `type`. */
async function emailedConfirmLink(email: string, type: 'invite' | 'email_change'): Promise<string> {
  const link = confirmLink((await waitMail(email))[0]!);
  expect(link.origin).toBe(SITE_URL);
  expect(link.pathname).toBe('/auth/confirm');
  expect([...link.searchParams.keys()].sort()).toEqual(['token_hash', 'type']);
  expect(link.searchParams.get('type')).toBe(type);
  const tokenHash = link.searchParams.get('token_hash')!;
  expect(tokenHash).toMatch(TOKEN_HASH);
  return tokenHash;
}

describe('the CMS confirm link (decision 41.1) signs in through the sign-in hook (PW-01)', () => {
  it('an invitation links to the confirm page with type=invite, and its verification signs the new editor in', async () => {
    const email = `confirm-invite-${Date.now().toString(36)}@test.local`;
    await clearMail();
    const invited = await adminAuth('/invite', { body: { email } });
    expect(invited.status, brief(invited)).toBe(200);
    try {
      const tokenHash = await emailedConfirmLink(email, 'invite');
      const accepted = await auth('/verify', { body: { type: 'invite', token_hash: tokenHash } });
      expect(accepted.status, brief(accepted)).toBe(200);
      expect(claims(accepted.json.access_token).sub).toBe(invited.json.id);
      for (const method of methods(accepted.json.access_token)) expect(LINK_METHODS, `amr method ${method}`).toContain(method);
    } finally {
      await deleteThrowawayUsers([invited.json.id]);
    }
  });

  it('both mails of an email change link to the confirm page; the first verification issues nothing, the second a token for the new address', async () => {
    const user = await newUser('confirm-change');
    const newAddress = `new-${user.email}`;
    const session = await passwordSession(user);
    await sleep(1100);
    await clearMail();
    const put = await auth('/user', { method: 'PUT', token: session.json.access_token, body: { email: newAddress } });
    expect(put.status, brief(put)).toBe(200);
    const fromOld = await emailedConfirmLink(user.email, 'email_change');
    const fromNew = await emailedConfirmLink(newAddress, 'email_change');
    expect(fromOld).not.toBe(fromNew);

    // What confirmSignIn does for each: verifyOtp({ token_hash, type: 'email_change' }).
    const first = await auth('/verify', { body: { type: 'email_change', token_hash: fromOld } });
    expect(first.status, brief(first)).toBe(200);
    expect(first.json.access_token).toBeUndefined();

    const second = await auth('/verify', { body: { type: 'email_change', token_hash: fromNew } });
    expect(second.status, brief(second)).toBe(200);
    expect(claims(second.json.access_token).email).toBe(newAddress);
    for (const method of methods(second.json.access_token)) expect(LINK_METHODS, `amr method ${method}`).toContain(method);
  });

  it('a token hash of the wrong type, or a made-up one, gives no token', async () => {
    const email = `confirm-wrong-${Date.now().toString(36)}@test.local`;
    await clearMail();
    const invited = await adminAuth('/invite', { body: { email } });
    expect(invited.status, brief(invited)).toBe(200);
    try {
      const tokenHash = await emailedConfirmLink(email, 'invite');
      const asEmailChange = await auth('/verify', { body: { type: 'email_change', token_hash: tokenHash } });
      expect(asEmailChange.json.access_token, brief(asEmailChange)).toBeUndefined();
      const madeUp = await auth('/verify', { body: { type: 'invite', token_hash: '0'.repeat(56) } });
      expect(madeUp.status, brief(madeUp)).toBe(403);
      expect(madeUp.json.access_token).toBeUndefined();
    } finally {
      await deleteThrowawayUsers([invited.json.id]);
    }
  });
});

// Decision 42.2 (Q1): when a signed-in visitor presses "Halda áfram" for another link, confirmSignIn
// writes the new session over the old cookies and then revokes the old session with
// `auth.admin.signOut(oldAccessToken, 'local')`, i.e. POST /logout?scope=local with the old token.
// This checks that call ends the old session only, and leaves the new one (and the old account's
// other sessions) working.
describe('replacing a session (decision 42.2)', () => {
  it('logout with scope=local and the old access token ends that session only', async () => {
    const before = await newUser('replace-old');
    const after = await newUser('replace-new');
    const old = await passwordSession(before);
    const elsewhere = await passwordSession(before);
    const fresh = await passwordSession(after);
    for (const r of [old, elsewhere, fresh]) expect(r.status, brief(r)).toBe(200);

    const out = await auth('/logout?scope=local', { token: old.json.access_token });
    expect(out.status, brief(out)).toBe(204);

    const refreshOld = await auth('/token?grant_type=refresh_token', { body: { refresh_token: old.json.refresh_token } });
    expect(refreshOld.status, brief(refreshOld)).not.toBe(200);
    expect(refreshOld.json.access_token).toBeUndefined();
    const userOld = await auth('/user', { method: 'GET', token: old.json.access_token });
    expect(userOld.status, brief(userOld)).not.toBe(200);

    const userNew = await auth('/user', { method: 'GET', token: fresh.json.access_token });
    expect(userNew.status, brief(userNew)).toBe(200);
    expect(userNew.json.id).toBe(after.id);
    const refreshNew = await auth('/token?grant_type=refresh_token', { body: { refresh_token: fresh.json.refresh_token } });
    expect(refreshNew.status, brief(refreshNew)).toBe(200);
    const userElsewhere = await auth('/user', { method: 'GET', token: elsewhere.json.access_token });
    expect(userElsewhere.status, brief(userElsewhere)).toBe(200);
  });
});
