// Cross-device sign-in (plan Task 32, decision 41.1; spec §4.4). The magic-link and invitation
// mails link to the CMS's /auth/confirm page with the token hash; when the editor presses its
// button, the CMS verifies the hash on the server with POST /auth/v1/verify { type, token_hash }
// (supabase-js verifyOtp). No PKCE verifier is needed, so the link works in any browser. This
// file checks the emailed link and that this verification still goes through decision 18's hook:
// the token's amr is an email method, and a password still gets 403.
//
// The mail templates are served by the running local stack, so this file needs the stack started
// with this repository's supabase/templates and config.toml.
import { afterAll, describe, expect, it } from 'vitest';
import {
  adminAuth, auth, brief, claims, clearMail, confirmLink, deleteThrowawayUsers, generateLinkSession, newUser, pkce, requestEmail, sleep,
  waitMail,
} from './auth-api.ts';
import { closeAll } from './sql.ts';

/** The email methods decision 18's hook issues a sign-in token for. */
const EMAIL_METHODS = ['magiclink', 'otp', 'invite', 'recovery', 'email_change'];
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
async function emailedConfirmLink(email: string, type: 'email' | 'invite' | 'email_change'): Promise<string> {
  const link = confirmLink((await waitMail(email))[0]!);
  expect(link.origin).toBe(SITE_URL);
  expect(link.pathname).toBe('/auth/confirm');
  expect([...link.searchParams.keys()].sort()).toEqual(['token_hash', 'type']);
  expect(link.searchParams.get('type')).toBe(type);
  const tokenHash = link.searchParams.get('token_hash')!;
  expect(tokenHash).toMatch(TOKEN_HASH);
  return tokenHash;
}

describe('the CMS confirm link (decision 41.1) signs in through the passwordless hook (decision 18)', () => {
  it.each([
    // The CMS asks for the link with its PKCE client, as supabase-js's server client does.
    ['the PKCE client', true],
    ['a non-PKCE request', false],
  ])('a magic link requested by %s: one verification issues an email-method token; password sign-in stays 403', async (_case, withPkce) => {
    const user = await newUser('confirm');
    await clearMail();
    const challenge = withPkce ? { code_challenge: pkce().challenge, code_challenge_method: 's256' } : {};
    await requestEmail('/otp', { email: user.email, create_user: false, ...challenge });
    const tokenHash = await emailedConfirmLink(user.email, 'email');
    expect(tokenHash.startsWith('pkce_')).toBe(withPkce);

    // What confirmSignIn does: verifyOtp({ token_hash, type: 'email' }). No code verifier.
    const verified = await auth('/verify', { body: { type: 'email', token_hash: tokenHash } });
    expect(verified.status, brief(verified)).toBe(200);
    expect(verified.json.access_token).toBeTruthy();
    expect(claims(verified.json.access_token).sub).toBe(user.id);
    const amr = methods(verified.json.access_token);
    expect(amr.length).toBeGreaterThan(0);
    for (const method of amr) expect(EMAIL_METHODS, `amr method ${method}`).toContain(method);

    // Single use: the same link does not sign in twice.
    const again = await auth('/verify', { body: { type: 'email', token_hash: tokenHash } });
    expect(again.status, brief(again)).toBe(403);
    expect(again.json.access_token).toBeUndefined();

    // The hook still refuses a password, even one the signed-in editor set.
    const set = await auth('/user', { method: 'PUT', token: verified.json.access_token, body: { password: 'correct horse battery 7' } });
    expect(set.status, brief(set)).toBe(200);
    const password = await auth('/token?grant_type=password', { body: { email: user.email, password: 'correct horse battery 7' } });
    expect(password.status, brief(password)).toBe(403);
    expect(password.json.access_token).toBeUndefined();
  });

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
      for (const method of methods(accepted.json.access_token)) expect(EMAIL_METHODS, `amr method ${method}`).toContain(method);
    } finally {
      await deleteThrowawayUsers([invited.json.id]);
    }
  });

  it('both mails of an email change link to the confirm page; the first verification issues nothing, the second a token for the new address', async () => {
    const user = await newUser('confirm-change');
    const newAddress = `new-${user.email}`;
    const session = await generateLinkSession(user.email, 'magiclink');
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
    for (const method of methods(second.json.access_token)) expect(EMAIL_METHODS, `amr method ${method}`).toContain(method);
  });

  it('a token hash of the wrong type, or a made-up one, gives no token', async () => {
    const user = await newUser('confirm-wrong');
    await sleep(1100);
    await clearMail();
    await requestEmail('/otp', { email: user.email, create_user: false });
    const tokenHash = await emailedConfirmLink(user.email, 'email');
    const asInvite = await auth('/verify', { body: { type: 'invite', token_hash: tokenHash } });
    expect(asInvite.json.access_token, brief(asInvite)).toBeUndefined();
    const madeUp = await auth('/verify', { body: { type: 'email', token_hash: '0'.repeat(56) } });
    expect(madeUp.status, brief(madeUp)).toBe(403);
    expect(madeUp.json.access_token).toBeUndefined();
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
    const old = await generateLinkSession(before.email, 'magiclink');
    const elsewhere = await generateLinkSession(before.email, 'magiclink');
    const fresh = await generateLinkSession(after.email, 'magiclink');
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
