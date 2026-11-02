// N1 investigation probe: drives the local Supabase Auth API with a Custom Access Token hook enabled.
// Keys come from the environment (supabase status -o env); nothing is written to disk.
import crypto from 'node:crypto';

const API = process.env.API_URL;
const ANON = process.env.PUBLISHABLE_KEY;
const SERVICE = process.env.SECRET_KEY;
const MAIL = 'http://127.0.0.1:54324/api/v1';
const EMAIL = 'editor@probe.local';
const results = [];

function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} [${id}] ${name} :: ${detail}`);
}

async function call(path, { method = 'POST', body, token, key = ANON } = {}) {
  const res = await fetch(`${API}/auth/v1${path}`, {
    method,
    headers: {
      apikey: key,
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, json };
}

const admin = (path, opts = {}) => call(path, { ...opts, key: SERVICE, token: SERVICE });
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
const brief = (r) => `${r.status} ${r.json.error_code ?? r.json.code ?? ''} ${r.json.msg ?? r.json.message ?? r.json.error_description ?? ''}`.trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clearMail() { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
async function latestMail(to) {
  for (let i = 0; i < 20; i++) {
    const list = await (await fetch(`${MAIL}/messages`)).json();
    const m = (list.messages ?? []).find((x) => x.To.some((t) => t.Address === to));
    if (m) return (await fetch(`${MAIL}/message/${m.ID}`)).json();
    await sleep(250);
  }
  throw new Error(`no mail for ${to}`);
}
const tokenHash = (msg) => decodeURIComponent((msg.Text + msg.HTML).match(/token=([a-zA-Z0-9_%-]+)/)?.[1] ?? '');
const otpCode = (msg) => msg.Text.match(/\b(\d{6})\b/)?.[1];

function totp(secretB32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

// Supabase limits how often one user can be emailed; wait it out instead of failing.
async function requestEmail(path, body) {
  for (let i = 0; i < 15; i++) {
    const r = await call(path, { body });
    if (r.status === 200) return r;
    if (r.status !== 429) throw new Error(`${path} ${brief(r)}`);
    await sleep(5000);
  }
  throw new Error(`${path} still rate limited`);
}

async function magicLinkSession() {
  await clearMail();
  await requestEmail('/otp', { email: EMAIL, create_user: false });
  const msg = await latestMail(EMAIL);
  return call('/verify', { body: { type: 'magiclink', token_hash: tokenHash(msg) } });
}

// --- setup: a provisioned editor (as the provisioning CLI would, through the admin API)
const created = await admin('/admin/users', { body: { email: EMAIL, email_confirm: true } });
console.log(`setup: admin create user -> ${created.status}`);
const userId = created.json.id;

// 1. Magic link and email OTP
const ml = await magicLinkSession();
record(1, 'magic link sign-in', ml.status === 200 && !!ml.json.access_token,
  `${ml.status} probe_method=${ml.json.access_token ? claims(ml.json.access_token).probe_method : '-'} amr=${ml.json.access_token ? JSON.stringify(claims(ml.json.access_token).amr) : '-'}`);

await clearMail();
await requestEmail('/otp', { email: EMAIL, create_user: false });
const codeMsg = await latestMail(EMAIL);
const code = otpCode(codeMsg);
const ot = await call('/verify', { body: { type: 'email', email: EMAIL, token: code } });
record(1, 'email one-time code sign-in', ot.status === 200 && !!ot.json.access_token,
  `code=${code ? 'found' : 'missing'} ${ot.status} probe_method=${ot.json.access_token ? claims(ot.json.access_token).probe_method : '-'}`);

// 3. Refresh of legitimate sessions (before any password change)
const rf1 = await call('/token?grant_type=refresh_token', { body: { refresh_token: ml.json.refresh_token } });
record(3, 'magic-link session refreshes', rf1.status === 200 && !!rf1.json.access_token,
  `${brief(rf1)} probe_method=${rf1.json.access_token ? claims(rf1.json.access_token).probe_method : '-'} amr=${rf1.json.access_token ? JSON.stringify(claims(rf1.json.access_token).amr) : '-'}`);
const rf2 = await call('/token?grant_type=refresh_token', { body: { refresh_token: rf1.json.refresh_token } });
record(3, 'refreshed session refreshes again (rotation)', rf2.status === 200, brief(rf2));
const rfOtp = await call('/token?grant_type=refresh_token', { body: { refresh_token: ot.json.refresh_token } });
record(3, 'one-time-code session refreshes', rfOtp.status === 200, brief(rfOtp));

// 2. Password: editor sets one with their own session, then tries to use it
const setPw = await call('/user', { method: 'PUT', token: rf2.json.access_token, body: { password: 'correct horse battery staple 7' } });
record(2, 'editor can still set a password (expected; the hook blocks its use)', setPw.status === 200, brief(setPw));
const afterPw = await call('/token?grant_type=refresh_token', { body: { refresh_token: rfOtp.json.refresh_token } });
console.log(`info: other session refresh after the editor's own password change -> ${brief(afterPw)}`);
const pwGood = await call('/token?grant_type=password', { body: { email: EMAIL, password: 'correct horse battery staple 7' } });
record(2, 'password sign-in with the correct password is refused', pwGood.status !== 200 && !pwGood.json.access_token, brief(pwGood));
const pwBad = await call('/token?grant_type=password', { body: { email: EMAIL, password: 'wrong password 123' } });
record(2, 'password sign-in with a wrong password is refused', pwBad.status !== 200, brief(pwBad));
// Password set by an administrator instead
await admin(`/admin/users/${userId}`, { method: 'PUT', body: { password: 'admin set password 9' } });
const pwAdmin = await call('/token?grant_type=password', { body: { email: EMAIL, password: 'admin set password 9' } });
record(2, 'password set through the admin API is refused too', pwAdmin.status !== 200 && !pwAdmin.json.access_token, brief(pwAdmin));

// Fresh legitimate session after the password changes (they may revoke earlier sessions)
const mlAfter = await magicLinkSession();
record(1, 'magic link still works after a password was set', mlAfter.status === 200 && !!mlAfter.json.access_token, brief(mlAfter));
const rfAfter = await call('/token?grant_type=refresh_token', { body: { refresh_token: mlAfter.json.refresh_token } });
record(3, 'new session refreshes after a password was set', rfAfter.status === 200, brief(rfAfter));
const rf2b = rfAfter;

// 4a. MFA (TOTP): enrol, challenge, verify -> aal2; refresh keeps aal2; a new sign-in steps up again
const enrol = await call('/factors', { token: rf2b.json.access_token, body: { factor_type: 'totp', friendly_name: 'probe' } });
const factorId = enrol.json.id;
const ch1 = await call(`/factors/${factorId}/challenge`, { token: rf2b.json.access_token, body: {} });
const v1 = await call(`/factors/${factorId}/verify`, { token: rf2b.json.access_token, body: { challenge_id: ch1.json.id, code: totp(enrol.json.totp.secret) } });
const c1 = v1.json.access_token ? claims(v1.json.access_token) : {};
record(4, 'TOTP enrolment and verification gives aal2', v1.status === 200 && c1.aal === 'aal2',
  `enrol ${enrol.status}, verify ${v1.status}, aal=${c1.aal}, probe_method=${c1.probe_method}, amr=${JSON.stringify(c1.amr)}`);
const rfMfa = await call('/token?grant_type=refresh_token', { body: { refresh_token: v1.json.refresh_token } });
const cr = rfMfa.json.access_token ? claims(rfMfa.json.access_token) : {};
record(4, 'aal2 session refreshes and stays aal2', rfMfa.status === 200 && cr.aal === 'aal2', `${rfMfa.status} aal=${cr.aal}`);
await sleep(31000); // next TOTP window, so the code is not a replay
const ml2 = await magicLinkSession();
const c2 = claims(ml2.json.access_token);
const ch2 = await call(`/factors/${factorId}/challenge`, { token: ml2.json.access_token, body: {} });
const v2 = await call(`/factors/${factorId}/verify`, { token: ml2.json.access_token, body: { challenge_id: ch2.json.id, code: totp(enrol.json.totp.secret) } });
record(4, 'new magic-link sign-in is aal1 and steps up to aal2 with TOTP', c2.aal === 'aal1' && v2.status === 200 && claims(v2.json.access_token).aal === 'aal2',
  `sign-in aal=${c2.aal}, step-up ${v2.status} aal=${v2.json.access_token ? claims(v2.json.access_token).aal : '-'}`);

// 4b. Recovery flow
await clearMail();
const rec = await requestEmail('/recover', { email: EMAIL });
const recMsg = await latestMail(EMAIL);
const recV = await call('/verify', { body: { type: 'recovery', token_hash: tokenHash(recMsg) } });
record(4, 'recovery email signs the editor in', rec.status === 200 && recV.status === 200 && !!recV.json.access_token,
  `recover ${rec.status}, verify ${recV.status}, probe_method=${recV.json.access_token ? claims(recV.json.access_token).probe_method : '-'}, aal=${recV.json.access_token ? claims(recV.json.access_token).aal : '-'}`);
const recRf = await call('/token?grant_type=refresh_token', { body: { refresh_token: recV.json.refresh_token } });
record(4, 'recovery session refreshes', recRf.status === 200, brief(recRf));

// 5. Other methods and bypass attempts
const tries = [
  ['signup with email and password', '/signup', { email: 'new@probe.local', password: 'abcdefgh12345' }],
  ['anonymous sign-in', '/signup', {}],
  ['phone password grant', '/token?grant_type=password', { phone: '+3545550000', password: 'admin set password 9' }],
  ['id_token grant', '/token?grant_type=id_token', { provider: 'google', id_token: 'x' }],
  ['pkce grant with forged flow', '/token?grant_type=pkce', { auth_code: 'x', code_verifier: 'y'.repeat(43) }],
  ['web3 grant', '/token?grant_type=web3', { chain: 'ethereum', message: 'x', signature: 'y' }],
  ['password grant via user metadata email casing', '/token?grant_type=password', { email: EMAIL.toUpperCase(), password: 'admin set password 9' }],
];
for (const [name, path, body] of tries) {
  const r = await call(path, { body });
  record(5, `${name} gives no token`, !r.json.access_token, brief(r));
}
const sso = await call('/sso', { body: { domain: 'probe.local' } });
record(5, 'SSO gives no token', !sso.json.access_token, brief(sso));
const oauth = await fetch(`${API}/auth/v1/authorize?provider=github`, { headers: { apikey: ANON }, redirect: 'manual' });
record(5, 'OAuth provider sign-in is unavailable', oauth.status >= 400, `${oauth.status}`);

// A password session obtained before the hook existed could only be refreshed if its amr held allowed methods.
console.log(`\nuser id: ${userId}`);
console.log(JSON.stringify({ passed: results.filter((r) => r.pass).length, failed: results.filter((r) => !r.pass).length }));
