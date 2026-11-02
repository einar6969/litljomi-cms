// Adversarial review probe (security reviewer). Keys from env only; nothing persisted except stack state.
import crypto from 'node:crypto';
const API = process.env.API_URL, ANON = process.env.PUBLISHABLE_KEY, SERVICE = process.env.SECRET_KEY;
const MAIL = 'http://127.0.0.1:54324/api/v1';
const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
async function call(path, { method = 'POST', body, token, key = ANON, headers = {} } = {}) {
  const res = await fetch(`${API}/auth/v1${path}`, { method, redirect: 'manual',
    headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, json, location: res.headers.get('location') };
}
const admin = (p, o = {}) => call(p, { ...o, key: SERVICE, token: SERVICE });
const brief = (r) => `${r.status} ${r.json.error_code ?? r.json.code ?? ''} ${r.json.msg ?? r.json.message ?? r.json.error_description ?? ''}`.trim();
const tok = (r) => r.json.access_token ? (({ probe_method, amr, aal }) => `probe_method=${probe_method} aal=${aal} amr=${JSON.stringify(amr?.map((a) => a.method))}`)(claims(r.json.access_token)) : 'no token';
const log = (label, s) => console.log(`${label} :: ${s}`);
async function mails(to) {
  const list = await (await fetch(`${MAIL}/messages`)).json();
  return Promise.all((list.messages ?? []).filter((x) => x.To.some((t) => t.Address === to)).map(async (m) => (await fetch(`${MAIL}/message/${m.ID}`)).json()));
}
async function waitMail(to, n = 1) { for (let i = 0; i < 40; i++) { const m = await mails(to); if (m.length >= n) return m; await sleep(250); } throw new Error(`no mail for ${to}`); }
async function clearMail() { await fetch(`${MAIL}/messages`, { method: 'DELETE' }); }
const hrefs = (msg) => [...msg.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
const verifyLink = (msg) => hrefs(msg).find((h) => h.includes('/verify'));
const tokenHashOf = (msg) => new URL(verifyLink(msg)).searchParams.get('token');
async function retry429(fn) { for (let i = 0; i < 20; i++) { const r = await fn(); if (r.status !== 429) return r; await sleep(5000); } throw new Error('rate limited'); }
function pkce() { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; }
async function followVerify(link) { const r = await fetch(link, { redirect: 'manual', headers: { apikey: ANON } }); return r.headers.get('location'); }
const E1 = `f1-${RUN}@probe.local`, E2 = `f2-${RUN}@probe.local`, UNC = `unc-${RUN}@probe.local`;
for (const e of [E1, E2]) log(`setup create ${e}`, brief(await admin('/admin/users', { body: { email: e, email_confirm: true } })));
await clearMail();
await retry429(() => call('/otp', { body: { email: E1, create_user: false } }));
let [m] = await waitMail(E1);
const s = await call('/verify', { body: { type: 'magiclink', token_hash: tokenHashOf(m) } });
log('F0 session', `${brief(s)} ${tok(s)}`);
// second session for the same editor
await sleep(1500); await clearMail();
await retry429(() => call('/otp', { body: { email: E1, create_user: false } }));
[m] = await waitMail(E1);
const s2 = await call('/verify', { body: { type: 'magiclink', token_hash: tokenHashOf(m) } });
log('F1 set password via own session', brief(await call('/user', { method: 'PUT', token: s.json.access_token, body: { password: 'probe-pass-123' } })));
log('F1b other session refresh after password set', brief(await call('/token?grant_type=refresh_token', { body: { refresh_token: s2.json.refresh_token } })));
log('F1c own session refresh after password set', brief(await call('/token?grant_type=refresh_token', { body: { refresh_token: s.json.refresh_token } })));
for (let i = 0; i < 2; i++) {
  let t = Date.now(); const a = await call('/token?grant_type=password', { body: { email: E1, password: 'probe-pass-123' } }); const ta = Date.now() - t;
  t = Date.now(); const b = await call('/token?grant_type=password', { body: { email: E1, password: 'nope-nope-1' } }); const tb = Date.now() - t;
  log(`F2 correct vs wrong password (${i})`, `${brief(a)} [${ta}ms]  vs  ${brief(b)} [${tb}ms]`);
}
log('F3 unknown user', brief(await call('/token?grant_type=password', { body: { email: `nobody-${RUN}@probe.local`, password: 'x12345678' } })));
log('F4 user without password', brief(await call('/token?grant_type=password', { body: { email: E2, password: 'x12345678' } })));
log('G1 admin create unconfirmed', brief(await admin('/admin/users', { body: { email: UNC, email_confirm: false, password: 'unc-pass-1234' } })));
log('G2 /otp for unconfirmed', brief(await call('/otp', { body: { email: UNC, create_user: false } })));
log('G3 correct password for unconfirmed user', brief(await call('/token?grant_type=password', { body: { email: UNC, password: 'unc-pass-1234' } })));
log('G4 ban E2 then wrong password', (await admin(`/admin/users/${(await admin('/admin/users', { method: 'GET' })).json.users.find((u) => u.email === E2).id}`, { method: 'PUT', body: { ban_duration: '1h' } })).status + ' ' + brief(await call('/token?grant_type=password', { body: { email: E2, password: 'whatever-1' } })));
const gl = await admin('/admin/generate_link', { body: { type: 'signup', email: `gl-${RUN}@probe.local`, password: 'gl-pass-123456' } });
log('H1 generate_link signup', `${gl.status} ${gl.json.hashed_token ? 'hashed_token present' : brief(gl)}`);
const ht = gl.json.hashed_token ?? gl.json.properties?.hashed_token;
if (ht) {
  const r = await call('/verify', { body: { type: 'signup', token_hash: ht } });
  log('H2 verify signup link', `${brief(r)} ${tok(r)}`);
  log('H3 password grant for that user', brief(await call('/token?grant_type=password', { body: { email: `gl-${RUN}@probe.local`, password: 'gl-pass-123456' } })));
}
const gm = await admin('/admin/generate_link', { body: { type: 'magiclink', email: E1 } });
const hm = gm.json.hashed_token ?? gm.json.properties?.hashed_token;
const rm = await call('/verify', { body: { type: 'magiclink', token_hash: hm } });
log('H4 admin generate_link magiclink -> verify', `${brief(rm)} ${tok(rm)}`);
// I. reauthenticate endpoint
await clearMail();
const ra = await call('/reauthenticate', { method: 'GET', token: rm.json.access_token });
log('I1 /reauthenticate', `${brief(ra)} token-in-body=${!!ra.json.access_token}`);
// J. MFA verify with a forged/expired JWT style: TOTP verify on a session where refresh is refused cannot happen; check factors list
console.log(JSON.stringify({ RUN, E1 }));
