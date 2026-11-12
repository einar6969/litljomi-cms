// Password sign-in and double-confirmed email changes over Supabase Auth's HTTP API
// (spec §4.4; plan decisions 19, 21, 22, 72, 72.1 and 72.3; docs/plans/passwords.md PW-01). The
// sign-in hook, private.sign_in_access_token, issues tokens for a password, `otp` (Auth's
// method for every link verified by token hash: invitation, recovery, email change), TOTP
// step-up and refresh. Magic links and email codes are stopped in the email: the mail Auth
// sends for them carries no link, token hash or code. Supabase Auth calls the hook as
// supabase_auth_admin, so these tests are also the proof that the hook executes as that role
// (decision 22).
//
// Every test uses its own throwaway user, never a fixed persona: setting a password
// revokes the user's other sessions, and an email change moves the address.
import crypto from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  adminAuth, auth, brief, claims, clearMail, deleteThrowawayUsers, followVerify, generateLinkSession, newUser, passwordSession,
  passwordSignIn, pkce, sleep, tokenHashOf, totp, verifyUrlFor, waitMail, requestEmail, type AuthResponse, type MailMessage,
} from './auth-api.ts';
import { stack } from './env.ts';
import { closeAll, ownerQuery } from './sql.ts';

/** The hook's refusal, as Auth passes it on. It names no method. */
const REFUSED = 'Sign-in not allowed';

const methods = (accessToken: string) => (claims(accessToken).amr as { method: string }[]).map((a) => a.method);
const refresh = (refreshToken: string) => auth('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
const emailOf = async (userId: string) => (await adminAuth(`/admin/users/${userId}`, { method: 'GET' })).json.email as string;

/** A refusal by the sign-in hook: 403 with its message, and no token. */
function expectRefused(r: AuthResponse) {
  expect(r.status, brief(r)).toBe(403);
  expect(r.json.msg ?? r.json.message, brief(r)).toBe(REFUSED);
  expect(r.json.access_token).toBeUndefined();
  expect(r.json.refresh_token).toBeUndefined();
}

/**
 * The token hash in an emailed link: the CMS confirm page's `token_hash` (every template the
 * repository sets, recovery.html included since PW-03), or the `token` of Auth's own GET /verify link.
 */
function linkTokenOf(mail: MailMessage): string {
  for (const href of [...mail.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'))) {
    if (!URL.canParse(href)) continue;
    const url = new URL(href);
    const token = url.searchParams.get('token_hash') ?? url.searchParams.get('token');
    if (token) return token;
  }
  throw new Error(`no link with a token in mail "${mail.Subject}"`);
}

/** Auth's stored hash of an emailed code: hex SHA-224 of the address followed by the code. */
const codeHash = (email: string, code: string) => crypto.createHash('sha224').update(email + code).digest('hex');

/** The hashes of the one-time tokens Auth holds for a user, without the `pkce_` prefix. */
const storedTokenHashes = async (userId: string) =>
  (await ownerQuery<{ token_hash: string }>('select token_hash from auth.one_time_tokens where user_id = $1', [userId]))
    .map((r) => r.token_hash.replace(/^pkce_/, ''));

/**
 * A mail that signs no one in (decisions 72.1, 72.3): no link, no token hash, no code of any
 * length, none of the user's stored token hashes, and the CMS address to sign in at with a password.
 */
function expectSignsNoOneIn(mail: MailMessage, tokenHashes: string[]) {
  expect(mail.Subject).toBe('Innskráning í Litljómi vefumsjón');
  for (const body of [mail.HTML, mail.Text]) {
    expect(body).not.toMatch(/href\s*=/i);
    expect(body).not.toContain('/auth/');
    expect(body).not.toContain('/verify');
    expect(body).not.toMatch(/[0-9a-f]{40,}/i);
    expect(body).not.toMatch(/\d{6,}/);
    for (const hash of tokenHashes) expect(body).not.toContain(hash);
  }
  expect(mail.HTML).toContain('lykilorði');
  expect(mail.HTML).toContain(stack.cmsUrl);
}

/** The amr methods Auth has recorded for a user's sessions (what a refresh is built from). */
const recordedMethods = async (userId: string) =>
  (await ownerQuery<{ authentication_method: string }>(
    `select c.authentication_method from auth.mfa_amr_claims c join auth.sessions s on s.id = c.session_id where s.user_id = $1`,
    [userId],
  )).map((r) => r.authentication_method);

afterAll(async () => {
  await deleteThrowawayUsers();
  await closeAll();
});

describe('PW-01: a password and the emailed links sign in; the sign-in email signs no one in', () => {
  it('a password sign-in gets a session that refreshes; a wrong password gets no token', async () => {
    const user = await newUser('password');
    const s = await passwordSession(user);
    expect(claims(s.json.access_token).sub).toBe(user.id);
    expect(claims(s.json.access_token).aal).toBe('aal1');
    expect(methods(s.json.access_token)).toEqual(['password']);

    const r1 = await refresh(s.json.refresh_token);
    expect(r1.status, brief(r1)).toBe(200);
    const r2 = await refresh(r1.json.refresh_token);
    expect(r2.status, brief(r2)).toBe(200);
    expect(methods(r2.json.access_token)).toEqual(['password']);

    // The address is matched without regard to case.
    const upper = await passwordSignIn(user.email.toUpperCase(), user.password!);
    expect(upper.status, brief(upper)).toBe(200);

    const wrong = await passwordSignIn(user.email, `${user.password!}x`);
    expect(wrong.status, brief(wrong)).toBe(400);
    expect(wrong.json.access_token).toBeUndefined();
  });

  it.each([
    ['a plain request', false],
    // The CMS's server client is a PKCE client.
    ['a PKCE request', true],
  ])('a sign-in email requested through the OTP endpoint by %s arrives with no link, token hash or code', async (_case, withPkce) => {
    const user = await newUser('magic');
    await clearMail();
    const challenge = withPkce ? { code_challenge: pkce().challenge, code_challenge_method: 's256' } : {};
    await requestEmail('/otp', { email: user.email, create_user: false, ...challenge });
    const [mail] = await waitMail(user.email);
    const tokens = await storedTokenHashes(user.id);
    expect(tokens.length, 'Auth issued a token for the request').toBeGreaterThan(0);
    // It tells the editor where to sign in with a password instead.
    expectSignsNoOneIn(mail!, tokens);
  });

  // F2 of the PW-01 security review (decision 72.3): anyone can ask Auth to resend a pending
  // invitee's sign-up confirmation. Auth's default mail links to GET /verify?type=signup, which
  // hands over a session; the repository's confirmation template carries no link, hash or code.
  it('a sign-up confirmation resent for a pending invitee arrives with no link, token hash or code', async () => {
    const invited = await newUser('pending', { invite: true });
    await clearMail();
    await requestEmail('/resend', { type: 'signup', email: invited.email });
    const [mail] = await waitMail(invited.email);
    const tokens = await storedTokenHashes(invited.id);
    expect(tokens.length, 'Auth issued a token for the request').toBeGreaterThan(0);
    expectSignsNoOneIn(mail!, tokens);
  });

  // F1 of the PW-01 security review (decision 72.3): Auth makes a code for every /otp request and
  // POST /verify accepts it, though no mail carries it, and every token-hash link is the hash of
  // such a code. So codes are 10 digits (spec §4.4), not the default 6.
  it('emailed codes are 10 digits: an admin link is built from a 10-digit code, and an /otp code is no 6-digit one', async () => {
    const linked = await newUser('code-length');
    const link = await adminAuth('/admin/generate_link', { body: { type: 'magiclink', email: linked.email } });
    expect(link.status, brief(link)).toBe(200);
    expect(link.json.email_otp).toMatch(/^\d{10}$/);
    expect(link.json.hashed_token).toBe(codeHash(linked.email, link.json.email_otp));

    // The code of an /otp request is never shown, only its hash: none of the 10^6 six-digit codes makes it.
    const user = await newUser('otp-length');
    await clearMail();
    await requestEmail('/otp', { email: user.email, create_user: false });
    await waitMail(user.email);
    const [hash, ...others] = await storedTokenHashes(user.id);
    expect(others).toEqual([]);
    expect(hash).toMatch(/^[0-9a-f]{56}$/);
    for (let n = 0; n < 1_000_000; n++) {
      const guess = String(n).padStart(6, '0');
      if (codeHash(user.email, guess) === hash) expect.fail(`the /otp code is the 6-digit ${guess}`);
    }
  });

  it('a PKCE exchange is refused with 403, and leaves no session', async () => {
    const user = await newUser('pkce');
    // A reset requested by a PKCE client; its link, followed on Auth's own GET /verify, gives a code.
    await clearMail();
    const p = pkce();
    await requestEmail('/recover', { email: user.email, code_challenge: p.challenge, code_challenge_method: 's256' });
    const location = await followVerify(verifyUrlFor(linkTokenOf((await waitMail(user.email))[0]!), 'recovery'));
    const code = location !== null && URL.canParse(location) ? new URL(location).searchParams.get('code') : null;
    expect(code, location ?? 'no redirect').toBeTruthy();
    expectRefused(await auth('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.verifier } }));
    // The hook runs inside the transaction that creates the session, so a refusal leaves nothing behind.
    expect(await recordedMethods(user.id)).toEqual([]);
  });

  it('a session whose amr holds a PKCE method (magiclink, recovery) cannot refresh', async () => {
    const user = await newUser('old-session');

    // A session made by a PKCE magic link alone (one from before the switch).
    const magic = await passwordSession(user);
    const magicSession = claims(magic.json.access_token).session_id as string;
    await ownerQuery(`update auth.mfa_amr_claims set authentication_method = 'magiclink' where session_id = $1`, [magicSession]);
    expectRefused(await refresh(magic.json.refresh_token));

    // A session that holds a PKCE recovery next to a password.
    const mixed = await passwordSession(user);
    const mixedSession = claims(mixed.json.access_token).session_id as string;
    await ownerQuery(
      `insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
       values (gen_random_uuid(), $1, now(), now(), 'recovery')`,
      [mixedSession],
    );
    expectRefused(await refresh(mixed.json.refresh_token));

    // The user's own password still signs in.
    const fresh = await passwordSession(user);
    expect(methods(fresh.json.access_token)).toEqual(['password']);
  });

  it('an invitation and a recovery link each sign in by POST and refresh; the invited user then sets a password that signs in', async () => {
    const invited = await newUser('invite', { invite: true });
    const accepted = await auth('/verify', { body: { type: 'invite', token_hash: invited.inviteTokenHash } });
    expect(accepted.status, brief(accepted)).toBe(200);
    expect(claims(accepted.json.access_token).sub).toBe(invited.id);
    // Auth reports every link verified by token hash as otp (decision 72.1).
    expect(methods(accepted.json.access_token)).toEqual(['otp']);
    const r1 = await refresh(accepted.json.refresh_token);
    expect(r1.status, brief(r1)).toBe(200);

    // The first password, from the invitation's fresh session (decision 21: under 24 hours, no MFA).
    const set = await auth('/user', { method: 'PUT', token: r1.json.access_token, body: { password: 'first password 7' } });
    expect(set.status, brief(set)).toBe(200);
    const signedIn = await passwordSignIn(invited.email, 'first password 7');
    expect(signedIn.status, brief(signedIn)).toBe(200);
    expect(claims(signedIn.json.access_token).sub).toBe(invited.id);

    const user = await newUser('recovery');
    const recovered = await generateLinkSession(user.email, 'recovery');
    expect(recovered.status, brief(recovered)).toBe(200);
    expect(claims(recovered.json.access_token).sub).toBe(user.id);
    expect(methods(recovered.json.access_token)).toEqual(['otp']);
    const r2 = await refresh(recovered.json.refresh_token);
    expect(r2.status, brief(r2)).toBe(200);
  });

  it('TOTP step-up after a password gives aal2 and survives refresh; a later sign-in is aal1 until TOTP; /reauthenticate issues no token', async () => {
    const user = await newUser('mfa');
    const s = await passwordSession(user);
    const enrol = await auth('/factors', { token: s.json.access_token, body: { factor_type: 'totp', friendly_name: 'it' } });
    expect(enrol.status, brief(enrol)).toBe(200);
    const c1 = await auth(`/factors/${enrol.json.id}/challenge`, { token: s.json.access_token, body: {} });
    const v1 = await auth(`/factors/${enrol.json.id}/verify`, {
      token: s.json.access_token, body: { challenge_id: c1.json.id, code: totp(enrol.json.totp.secret) },
    });
    expect(v1.status, brief(v1)).toBe(200);
    expect(claims(v1.json.access_token).aal).toBe('aal2');
    // amr order is not stable when both share a timestamp.
    expect(methods(v1.json.access_token).sort()).toEqual(['password', 'totp']);
    const r1 = await refresh(v1.json.refresh_token);
    expect(r1.status, brief(r1)).toBe(200);
    expect(claims(r1.json.access_token).aal).toBe('aal2');

    await sleep(31_000); // the next TOTP window, so the code is not a replay
    const later = await passwordSession(user);
    expect(claims(later.json.access_token).aal).toBe('aal1');
    const c2 = await auth(`/factors/${enrol.json.id}/challenge`, { token: later.json.access_token, body: {} });
    const v2 = await auth(`/factors/${enrol.json.id}/verify`, {
      token: later.json.access_token, body: { challenge_id: c2.json.id, code: totp(enrol.json.totp.secret) },
    });
    expect(v2.status, brief(v2)).toBe(200);
    expect(claims(v2.json.access_token).aal).toBe('aal2');

    const re = await auth('/reauthenticate', { method: 'GET', token: later.json.access_token });
    expect(re.status, brief(re)).toBe(200);
    expect(re.json.access_token).toBeUndefined();
  });

  // Sign-up and anonymous sign-in are off in config.toml, so Auth refuses them (422) before any
  // token is made; the hook would refuse them too (012_auth_hook.test.sql).
  it('sign-up, anonymous, phone, id_token, web3, forged PKCE, SSO and OAuth give no token', async () => {
    const tries: [string, string, object, number][] = [
      ['sign-up with email and password', '/signup', { email: `new-${Date.now()}@test.local`, password: 'abcdefgh12345' }, 422],
      ['anonymous sign-in', '/signup', {}, 422],
      ['phone password grant', '/token?grant_type=password', { phone: '+3545550000', password: 'admin set password 9' }, 422],
      ['id_token grant', '/token?grant_type=id_token', { provider: 'google', id_token: 'x' }, 400],
      ['forged PKCE grant', '/token?grant_type=pkce', { auth_code: 'x', code_verifier: 'y'.repeat(43) }, 404],
      ['web3 grant', '/token?grant_type=web3', { chain: 'ethereum', message: 'x', signature: 'y' }, 422],
      ['SSO', '/sso', { domain: 'test.local' }, 404],
    ];
    for (const [name, path, body, status] of tries) {
      const r = await auth(path, { body });
      expect(r.json.access_token, name).toBeUndefined();
      expect(r.status, `${name}: ${brief(r)}`).toBe(status);
    }
    const oauth = await auth('/authorize?provider=github', { method: 'GET' });
    expect(oauth.status).toBeGreaterThanOrEqual(400);
    expect(oauth.location ?? '').not.toContain('access_token');
  });

  it('an email change confirmed only by the new address, or only by the old one, does not change the email; both addresses do, by POST; over PKCE, both are needed and the exchange is refused', async () => {
    const user = await newUser('email');
    const newAddress = `new-${user.email}`;
    const s = await passwordSession(user);

    // Only the new address confirms: no change.
    await clearMail();
    const put1 = await auth('/user', { method: 'PUT', token: s.json.access_token, body: { email: newAddress } });
    expect(put1.status, brief(put1)).toBe(200);
    const toNew1 = (await waitMail(newAddress))[0]!;
    await waitMail(user.email);
    const onlyNew = await auth('/verify', { body: { type: 'email_change', token_hash: tokenHashOf(toNew1) } });
    expect(onlyNew.json.access_token, brief(onlyNew)).toBeUndefined();
    expect(await emailOf(user.id)).toBe(user.email);

    // A new request; only the old address confirms: no change. Then the new one: changed.
    await sleep(1100);
    await clearMail();
    const put2 = await auth('/user', { method: 'PUT', token: s.json.access_token, body: { email: newAddress } });
    expect(put2.status, brief(put2)).toBe(200);
    const toOld = (await waitMail(user.email))[0]!;
    const toNew2 = (await waitMail(newAddress))[0]!;
    const old = await auth('/verify', { body: { type: 'email_change', token_hash: tokenHashOf(toOld) } });
    expect(old.json.access_token, brief(old)).toBeUndefined();
    expect(await emailOf(user.id)).toBe(user.email);
    const both = await auth('/verify', { body: { type: 'email_change', token_hash: tokenHashOf(toNew2) } });
    expect(both.status, brief(both)).toBe(200);
    expect(await emailOf(user.id)).toBe(newAddress);
    expect(methods(both.json.access_token)).toEqual(['otp']);
    // The password now signs in with the new address.
    expect((await passwordSignIn(newAddress, user.password!)).status).toBe(200);

    // PKCE, back to the first address: one link is not enough; both are.
    await sleep(1100);
    await clearMail();
    const p = pkce();
    const put3 = await auth('/user', {
      method: 'PUT', token: both.json.access_token, body: { email: user.email, code_challenge: p.challenge, code_challenge_method: 's256' },
    });
    expect(put3.status, brief(put3)).toBe(200);
    const pkceOld = (await waitMail(newAddress))[0]!;
    const pkceNew = (await waitMail(user.email))[0]!;
    // The mails link to the CMS (M5-03); their token hashes also work on Auth's own GET /verify.
    await followVerify(verifyUrlFor(tokenHashOf(pkceNew), 'email_change'));
    expect(await emailOf(user.id)).toBe(newAddress);
    const location = await followVerify(verifyUrlFor(tokenHashOf(pkceOld), 'email_change'));
    expect(await emailOf(user.id)).toBe(user.email);
    // The second confirmation redirects with a PKCE code (observed 2026-11-02), which the hook
    // refuses: the CMS verifies by POST and never exchanges a code.
    const code = location ? new URL(location).searchParams.get('code') : null;
    expect(code, location ?? 'no redirect').toBeTruthy();
    expectRefused(await auth('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.verifier } }));
  });
});
