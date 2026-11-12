// Cross-device links (plan Task 32, decision 41.1; spec §4.4). The invitation, password-reset and
// email-change mails link to the CMS's /auth/confirm page with the token hash; when the editor presses its
// button, the CMS verifies the hash on the server with POST /auth/v1/verify { type, token_hash }
// (supabase-js verifyOtp). No PKCE verifier is needed, so the link works in any browser. This file
// checks the emailed links and that their verification goes through the sign-in hook (PW-01): Auth
// reports each as `otp`, which the hook allows (decision 72.1). The sign-in (magic-link) mail has
// no link at all (auth-sign-in.test.ts).
//
// PW-03: after an invitation or a reset the CMS has the editor set a password from the link's
// session, in the browser (supabase-js updateUser). With `secure_password_change` on, Auth lets a
// session under a day old do that without reauthentication, and refuses an older one. For an
// account with a verified factor (a platform admin with TOTP, §4.4) it wants an `aal2` session, so
// the page has the code verified first, in the same session.
//
// The mail templates are served by the running local stack, so this file needs the stack started
// with this repository's supabase/templates and config.toml.
import { afterAll, describe, expect, it } from 'vitest';
import {
  adminAuth, auth, brief, claims, clearMail, confirmLink, deleteThrowawayUsers, mailsTo, newUser, passwordSession, passwordSignIn, pkce,
  requestEmail, sleep, totp, waitMail, type MailMessage,
} from './auth-api.ts';
import { stack } from './env.ts';
import { closeAll, ownerQuery } from './sql.ts';

/** The method Auth reports for every link verified by token hash, which the sign-in hook allows (decision 72.1). */
const LINK_METHODS = ['otp'];
/** The shape Auth issues for `{{ .TokenHash }}` (GoTrue v2.197.0): SHA-224 hex, `pkce_` for a PKCE request. */
const TOKEN_HASH = /^(?:pkce_)?[0-9a-f]{56}$/;
/** The local Auth Site URL (supabase/config.toml, decision 37.4; the stack slot's): the CMS. */
const SITE_URL = stack.cmsUrl;

const methods = (accessToken: string) => (claims(accessToken).amr as { method: string }[]).map((a) => a.method);

afterAll(async () => {
  await deleteThrowawayUsers();
  await closeAll();
});

/** The link of the one new mail to `email`, checked to be the CMS's confirm page for `type`. */
async function emailedConfirmLink(email: string, type: 'invite' | 'recovery' | 'email_change'): Promise<string> {
  return confirmLinkIn((await waitMail(email))[0]!, type);
}

function confirmLinkIn(mail: MailMessage, type: 'invite' | 'recovery' | 'email_change'): string {
  const link = confirmLink(mail);
  expect(link.origin).toBe(SITE_URL);
  expect(link.pathname).toBe('/auth/confirm');
  expect([...link.searchParams.keys()].sort()).toEqual(['token_hash', 'type']);
  expect(link.searchParams.get('type')).toBe(type);
  const tokenHash = link.searchParams.get('token_hash')!;
  expect(tokenHash).toMatch(TOKEN_HASH);
  return tokenHash;
}

/**
 * A mail that carries its link's token hash and nothing else that signs in: no code of any length
 * (codes are 10 digits, decision 72.3) and no link to Auth's own GET /verify.
 */
function expectNoCode(mail: MailMessage) {
  for (const body of [mail.HTML, mail.Text]) {
    expect(body).not.toContain('/verify');
    // Without the link's token hash (hex), no run of six or more digits is left.
    expect(body.replace(/(?:pkce_)?[0-9a-f]{56}/g, '')).not.toMatch(/\d{6,}/);
  }
}

describe('the CMS confirm link (decision 41.1) signs in through the sign-in hook (PW-01)', () => {
  it('an invitation links to the confirm page with type=invite, says a password is chosen, and its verification signs the new editor in', async () => {
    const email = `confirm-invite-${Date.now().toString(36)}@test.local`;
    await clearMail();
    const invited = await adminAuth('/invite', { body: { email } });
    expect(invited.status, brief(invited)).toBe(200);
    try {
      const [mail] = await waitMail(email);
      expect(mail!.Subject).toBe('Þér er boðið í Litljómi vefumsjón');
      expect(mail!.HTML).toContain('lykilorð');
      expect(mail!.HTML).not.toContain('þarft ekkert lykilorð');
      expectNoCode(mail!);
      const tokenHash = confirmLinkIn(mail!, 'invite');
      const accepted = await auth('/verify', { body: { type: 'invite', token_hash: tokenHash } });
      expect(accepted.status, brief(accepted)).toBe(200);
      expect(claims(accepted.json.access_token).sub).toBe(invited.json.id);
      for (const method of methods(accepted.json.access_token)) expect(LINK_METHODS, `amr method ${method}`).toContain(method);
    } finally {
      await deleteThrowawayUsers([invited.json.id]);
    }
  });

  // PW-03: the CMS's "Gleymt lykilorð?" form asks from the browser, whose client is a PKCE client,
  // with the confirm page as its redirect. The mail links to the confirm page all the same.
  it('a password reset requested as the browser does links to the confirm page with type=recovery, and its verification signs in', async () => {
    const user = await newUser('confirm-recovery');
    await clearMail();
    const { challenge } = pkce();
    const redirect = encodeURIComponent(`${SITE_URL}/auth/confirm`);
    await requestEmail(`/recover?redirect_to=${redirect}`, { email: user.email, code_challenge: challenge, code_challenge_method: 's256' });
    const [mail] = await waitMail(user.email);
    expect(mail!.Subject).toBe('Nýtt lykilorð í Litljómi vefumsjón');
    expect(mail!.HTML).toContain('<html lang="is">');
    expectNoCode(mail!);
    const tokenHash = confirmLinkIn(mail!, 'recovery');

    // What confirmSignIn does: verifyOtp({ token_hash, type: 'recovery' }), by POST.
    const accepted = await auth('/verify', { body: { type: 'recovery', token_hash: tokenHash } });
    expect(accepted.status, brief(accepted)).toBe(200);
    expect(claims(accepted.json.access_token).sub).toBe(user.id);
    for (const method of methods(accepted.json.access_token)) expect(LINK_METHODS, `amr method ${method}`).toContain(method);
    const again = await auth('/verify', { body: { type: 'recovery', token_hash: tokenHash } });
    expect(again.json.access_token, brief(again)).toBeUndefined();
  });

  it('a reset for an address Auth does not know answers as for a known one, and sends nothing', async () => {
    const email = `confirm-nobody-${Date.now().toString(36)}@test.local`;
    await clearMail();
    const r = await auth('/recover', { body: { email } });
    expect(r.status, brief(r)).toBe(200);
    await sleep(1000);
    expect(await mailsTo(email)).toEqual([]);
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

// PW-03 (spec §4.4): after an invitation or a reset the set-password page calls updateUser({ password })
// from the browser with the link's session, i.e. PUT /user { password }. `secure_password_change`
// is on (supabase/config.toml): Auth takes a password from a session under a day old without
// reauthentication, and refuses an older session's.
describe('setting the password from the link\'s session (PW-03)', () => {
  const setPassword = (accessToken: string, password: string) => auth('/user', { method: 'PUT', token: accessToken, body: { password } });
  const recoverySession = async (email: string) => {
    const link = await adminAuth('/admin/generate_link', { body: { type: 'recovery', email } });
    expect(link.status, brief(link)).toBe(200);
    const session = await auth('/verify', { body: { type: 'recovery', token_hash: link.json.hashed_token } });
    expect(session.status, brief(session)).toBe(200);
    return session;
  };
  /** Makes a session look as if it had been created, and last refreshed, `hours` ago. */
  const age = (accessToken: string, hours: number) =>
    ownerQuery(
      `update auth.sessions set created_at = now() - make_interval(hours => $2), refreshed_at = now() - make_interval(hours => $2),
       updated_at = now() - make_interval(hours => $2) where id = $1`,
      [claims(accessToken).session_id, hours],
    );

  it('an invitation\'s session sets the first password without reauthentication; the password then signs in', async () => {
    const invited = await newUser('pw-invite', { invite: true });
    const session = await auth('/verify', { body: { type: 'invite', token_hash: invited.inviteTokenHash } });
    expect(session.status, brief(session)).toBe(200);
    const set = await setPassword(session.json.access_token, 'first password 7');
    expect(set.status, brief(set)).toBe(200);
    expect((await passwordSignIn(invited.email, 'first password 7')).status).toBe(200);
  });

  it('a reset\'s session sets a new password without reauthentication: the new one signs in, the old one no longer, and the session goes on', async () => {
    const user = await newUser('pw-reset');
    const elsewhere = await passwordSession(user);
    const session = await recoverySession(user.email);
    // Verifying the link alone ends no other session of the account.
    expect((await auth('/user', { method: 'GET', token: elsewhere.json.access_token })).status).toBe(200);

    const set = await setPassword(session.json.access_token, 'new password 8');
    expect(set.status, brief(set)).toBe(200);
    expect((await passwordSignIn(user.email, 'new password 8')).status).toBe(200);
    const old = await passwordSignIn(user.email, user.password!);
    expect(old.status, brief(old)).toBe(400);
    expect(old.json.access_token).toBeUndefined();
    expect((await auth('/user', { method: 'GET', token: session.json.access_token })).status).toBe(200);
    // Auth ends the account's other sessions when the password changes.
    const refreshElsewhere = await auth('/token?grant_type=refresh_token', { body: { refresh_token: elsewhere.json.refresh_token } });
    expect(refreshElsewhere.json.access_token, brief(refreshElsewhere)).toBeUndefined();
  });

  // The sign-in page's invalid-link notice points to "Gleymt lykilorð?": it serves an invitee whose
  // invitation link has expired as well.
  it('a pending invitee gets in by a reset, and then sets the first password', async () => {
    const invited = await newUser('pw-pending', { invite: true });
    await clearMail();
    await requestEmail('/recover', { email: invited.email });
    const tokenHash = confirmLinkIn((await waitMail(invited.email))[0]!, 'recovery');
    const session = await auth('/verify', { body: { type: 'recovery', token_hash: tokenHash } });
    expect(session.status, brief(session)).toBe(200);
    expect((await setPassword(session.json.access_token, 'first password 9')).status).toBe(200);
    expect((await passwordSignIn(invited.email, 'first password 9')).status).toBe(200);
  });

  it('refuses a password shorter than 6 and the current password, as the page shows them', async () => {
    const user = await newUser('pw-refused');
    const session = await recoverySession(user.email);
    const short = await setPassword(session.json.access_token, '12345');
    expect(short.status, brief(short)).toBe(422);
    expect(short.json.error_code).toBe('weak_password');
    const same = await setPassword(session.json.access_token, user.password!);
    expect(same.status, brief(same)).toBe(422);
    expect(same.json.error_code).toBe('same_password');
    // Six characters of any kind are enough (no password rules, decision 72).
    expect((await setPassword(session.json.access_token, 'aaaaaa')).status).toBe(200);
  });

  // Auth answers 401 insufficient_aal to a password from an aal1 session of an account with a
  // verified factor (GoTrue v2.197.0). The set-password page then asks for the TOTP code first and
  // verifies it from the browser with the link's session (supabase-js mfa.challengeAndVerify).
  it('a platform admin with TOTP resets by the mailed link: the code raises the link\'s session to aal2, then the new password signs in and the old one no longer', async () => {
    const admin = await newUser('pw-admin-totp');
    await ownerQuery('insert into cms.platform_admins (user_id) values ($1)', [admin.id]);
    try {
      const signedIn = await passwordSession(admin);
      const enrolled = await auth('/factors', { token: signedIn.json.access_token, body: { factor_type: 'totp', friendly_name: 'Console' } });
      expect(enrolled.status, brief(enrolled)).toBe(200);
      const factorId: string = enrolled.json.id;
      const secret: string = enrolled.json.totp.secret;
      const verifyCode = async (accessToken: string) => {
        const challenge = await auth(`/factors/${factorId}/challenge`, { token: accessToken, body: {} });
        expect(challenge.status, brief(challenge)).toBe(200);
        return auth(`/factors/${factorId}/verify`, { token: accessToken, body: { challenge_id: challenge.json.id, code: totp(secret) } });
      };
      expect((await verifyCode(signedIn.json.access_token)).status).toBe(200);

      await clearMail();
      await requestEmail('/recover', { email: admin.email });
      const tokenHash = confirmLinkIn((await waitMail(admin.email))[0]!, 'recovery');
      const link = await auth('/verify', { body: { type: 'recovery', token_hash: tokenHash } });
      expect(link.status, brief(link)).toBe(200);
      expect(claims(link.json.access_token).aal).toBe('aal1');

      const refused = await setPassword(link.json.access_token, 'admin password 10');
      expect(refused.status, brief(refused)).toBe(401);
      expect(refused.json.error_code).toBe('insufficient_aal');
      expect((await passwordSignIn(admin.email, admin.password!)).status).toBe(200);

      const raised = await verifyCode(link.json.access_token);
      expect(raised.status, brief(raised)).toBe(200);
      expect(claims(raised.json.access_token).aal).toBe('aal2');
      // The same session, so the set-password step (keyed on the session id) still applies.
      expect(claims(raised.json.access_token).session_id).toBe(claims(link.json.access_token).session_id);

      const set = await setPassword(raised.json.access_token, 'admin password 10');
      expect(set.status, brief(set)).toBe(200);
      expect((await passwordSignIn(admin.email, 'admin password 10')).status).toBe(200);
      const old = await passwordSignIn(admin.email, admin.password!);
      expect(old.status, brief(old)).toBe(400);
      expect(old.json.access_token).toBeUndefined();
    } finally {
      // The row would keep the account from being deleted after the file (tenancy migration).
      await ownerQuery('delete from cms.platform_admins where user_id = $1', [admin.id]);
    }
  });

  it('refuses the password of a session more than a day old without reauthentication (secure_password_change)', async () => {
    const user = await newUser('pw-old-session');
    const session = await recoverySession(user.email);
    await age(session.json.access_token, 25);
    const set = await setPassword(session.json.access_token, 'too late 9');
    expect(set.status, brief(set)).toBe(400);
    expect(set.json.error_code).toBe('reauthentication_needed');
    expect((await passwordSignIn(user.email, user.password!)).status).toBe(200);
  });
});
