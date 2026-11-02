// Passwordless sign-in and double-confirmed email changes over Supabase Auth's
// HTTP API (spec §4.4; plan decisions 18, 19, 21 and 22). Reproduces the N1
// investigation's probes (docs/verification/n1-probes/probe.mjs, adversarial.mjs,
// adversarial2.mjs, emailchange.mjs) as assertions against the repository's own
// configuration and hook. Supabase Auth calls the hook as supabase_auth_admin,
// so these tests are also the proof that the hook executes as that role
// (decision 22).
//
// Every test uses its own throwaway user, never a fixed persona: setting a
// password revokes the user's other sessions, and an email change moves the
// address.
import { afterAll, describe, expect, it } from 'vitest';
import {
  adminAuth, auth, brief, claims, clearMail, deleteThrowawayUsers, followVerify, generateLinkSession, newUser,
  pkce, sleep, tokenHashOf, totp, verifyLink, waitMail, requestEmail,
} from './auth-api.ts';
import { closeAll, ownerQuery } from './sql.ts';

const methods = (accessToken: string) => (claims(accessToken).amr as { method: string }[]).map((a) => a.method);
const refresh = (refreshToken: string) => auth('/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } });
const emailOf = async (userId: string) => (await adminAuth(`/admin/users/${userId}`, { method: 'GET' })).json.email as string;

afterAll(async () => {
  await deleteThrowawayUsers();
  await closeAll();
});

describe('decision 18: only email methods issue tokens', () => {
  it('magic link (implicit and PKCE), email one-time code and invite sign in', async () => {
    const user = await newUser('signin');

    // Implicit, POST /verify with the hashed token (the editorClient path).
    const link = await generateLinkSession(user.email, 'magiclink');
    expect(link.status, brief(link)).toBe(200);
    expect(methods(link.json.access_token)).toEqual(['otp']);

    // Implicit, GET /verify from the emailed link: tokens in the redirect fragment.
    await clearMail();
    await requestEmail('/otp', { email: user.email, create_user: false });
    const location = await followVerify(verifyLink((await waitMail(user.email))[0]!));
    const fragment = new URLSearchParams(location?.split('#')[1] ?? '');
    expect(fragment.get('access_token'), location ?? 'no redirect').toBeTruthy();
    expect(claims(fragment.get('access_token')!).sub).toBe(user.id);

    // PKCE: the emailed link redirects with a code, exchanged with the verifier.
    await clearMail();
    const p = pkce();
    await requestEmail('/otp', { email: user.email, create_user: false, code_challenge: p.challenge, code_challenge_method: 's256' });
    const pkceLocation = await followVerify(verifyLink((await waitMail(user.email))[0]!));
    const code = new URL(pkceLocation!).searchParams.get('code');
    expect(code, pkceLocation ?? 'no redirect').toBeTruthy();
    const exchanged = await auth('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.verifier } });
    expect(exchanged.status, brief(exchanged)).toBe(200);
    expect(methods(exchanged.json.access_token)).toEqual(['magiclink']);

    // Email one-time code.
    const generated = await adminAuth('/admin/generate_link', { body: { type: 'magiclink', email: user.email } });
    const otp = await auth('/verify', { body: { type: 'email', email: user.email, token: generated.json.email_otp } });
    expect(otp.status, brief(otp)).toBe(200);
    expect(claims(otp.json.access_token).sub).toBe(user.id);

    // Invite: a new user accepts the invitation link.
    const invited = await newUser('invite', { invite: true });
    const accepted = await auth('/verify', { body: { type: 'invite', token_hash: invited.inviteTokenHash } });
    expect(accepted.status, brief(accepted)).toBe(200);
    expect(claims(accepted.json.access_token).sub).toBe(invited.id);
  });

  it('sessions refresh; TOTP step-up gives aal2 and survives refresh; recovery signs in', async () => {
    const user = await newUser('mfa');
    const s = await generateLinkSession(user.email, 'magiclink');
    const r1 = await refresh(s.json.refresh_token);
    expect(r1.status, brief(r1)).toBe(200);
    const r2 = await refresh(r1.json.refresh_token);
    expect(r2.status, brief(r2)).toBe(200);
    expect(methods(r2.json.access_token)).toEqual(['otp']);

    const enrol = await auth('/factors', { token: r2.json.access_token, body: { factor_type: 'totp', friendly_name: 'it' } });
    expect(enrol.status, brief(enrol)).toBe(200);
    const challenge = await auth(`/factors/${enrol.json.id}/challenge`, { token: r2.json.access_token, body: {} });
    const verified = await auth(`/factors/${enrol.json.id}/verify`, {
      token: r2.json.access_token, body: { challenge_id: challenge.json.id, code: totp(enrol.json.totp.secret) },
    });
    expect(verified.status, brief(verified)).toBe(200);
    expect(claims(verified.json.access_token).aal).toBe('aal2');
    // amr order is not stable when both share a timestamp.
    expect(methods(verified.json.access_token).sort()).toEqual(['otp', 'totp']);
    const r3 = await refresh(verified.json.refresh_token);
    expect(r3.status, brief(r3)).toBe(200);
    expect(claims(r3.json.access_token).aal).toBe('aal2');

    const recovered = await generateLinkSession(user.email, 'recovery');
    expect(recovered.status, brief(recovered)).toBe(200);
    expect(claims(recovered.json.access_token).sub).toBe(user.id);
    const r4 = await refresh(recovered.json.refresh_token);
    expect(r4.status, brief(r4)).toBe(200);
  });

  it('a password set by the editor or the admin API never signs in (403), and no session records password', async () => {
    const user = await newUser('password');
    const s = await generateLinkSession(user.email, 'magiclink');
    // A fresh session can still set a password (decision 21: under 24 hours, no MFA).
    const set = await auth('/user', { method: 'PUT', token: s.json.access_token, body: { password: 'correct horse battery 7' } });
    expect(set.status, brief(set)).toBe(200);
    const good = await auth('/token?grant_type=password', { body: { email: user.email, password: 'correct horse battery 7' } });
    expect(good.status, brief(good)).toBe(403);
    expect(good.json.msg ?? good.json.message).toBe('Only email sign-in is allowed');
    expect(good.json.access_token).toBeUndefined();
    const wrong = await auth('/token?grant_type=password', { body: { email: user.email, password: 'wrong password 123' } });
    expect(wrong.status, brief(wrong)).toBe(400);
    const upper = await auth('/token?grant_type=password', { body: { email: user.email.toUpperCase(), password: 'correct horse battery 7' } });
    expect(upper.status, brief(upper)).toBe(403);

    expect((await adminAuth(`/admin/users/${user.id}`, { method: 'PUT', body: { password: 'admin set password 9' } })).status).toBe(200);
    const admin = await auth('/token?grant_type=password', { body: { email: user.email, password: 'admin set password 9' } });
    expect(admin.status, brief(admin)).toBe(403);
    expect(admin.json.access_token).toBeUndefined();

    // A generate_link sign-up with a password: the link signs in, the password does not.
    const signupEmail = `signup-${Date.now()}@test.local`;
    const signup = await adminAuth('/admin/generate_link', { body: { type: 'signup', email: signupEmail, password: 'signup pass 12345' } });
    expect(signup.status, brief(signup)).toBe(200);
    const unconfirmed = await auth('/token?grant_type=password', { body: { email: signupEmail, password: 'signup pass 12345' } });
    expect(unconfirmed.status, brief(unconfirmed)).toBe(400); // email_not_confirmed, before the hook
    const confirmed = await auth('/verify', { body: { type: 'signup', token_hash: signup.json.hashed_token } });
    expect(confirmed.status, brief(confirmed)).toBe(200);
    const signupPw = await auth('/token?grant_type=password', { body: { email: signupEmail, password: 'signup pass 12345' } });
    expect(signupPw.status, brief(signupPw)).toBe(403);
    await deleteThrowawayUsers([signup.json.id]);

    // The hook runs inside the transaction that creates the session, so a refused
    // grant leaves nothing behind.
    expect(await ownerQuery(`select 1 from auth.mfa_amr_claims where authentication_method = 'password'`)).toEqual([]);
    const magic = await generateLinkSession(user.email, 'magiclink');
    expect(magic.status, brief(magic)).toBe(200);
  });

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

  it('an email change confirmed only by the new address, or only by the old one, does not change the email; both addresses do; also over PKCE', async () => {
    const user = await newUser('email');
    const newAddress = `new-${user.email}`;
    const s = await generateLinkSession(user.email, 'magiclink');

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
    await followVerify(verifyLink(pkceNew));
    expect(await emailOf(user.id)).toBe(newAddress);
    const location = await followVerify(verifyLink(pkceOld));
    expect(await emailOf(user.id)).toBe(user.email);
    // The second confirmation redirects with a PKCE code (observed 2026-11-02).
    const code = location ? new URL(location).searchParams.get('code') : null;
    expect(code, location ?? 'no redirect').toBeTruthy();
    const exchanged = await auth('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.verifier } });
    expect(exchanged.status, brief(exchanged)).toBe(200);
    expect(claims(exchanged.json.access_token).email).toBe(user.email);
  });

  it('a later magic-link sign-in is aal1 until TOTP; /reauthenticate issues no token', async () => {
    const user = await newUser('stepup');
    const s = await generateLinkSession(user.email, 'magiclink');
    const enrol = await auth('/factors', { token: s.json.access_token, body: { factor_type: 'totp', friendly_name: 'it' } });
    const c1 = await auth(`/factors/${enrol.json.id}/challenge`, { token: s.json.access_token, body: {} });
    const v1 = await auth(`/factors/${enrol.json.id}/verify`, {
      token: s.json.access_token, body: { challenge_id: c1.json.id, code: totp(enrol.json.totp.secret) },
    });
    expect(claims(v1.json.access_token).aal).toBe('aal2');

    await sleep(31_000); // the next TOTP window, so the code is not a replay
    const later = await generateLinkSession(user.email, 'magiclink');
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
});
