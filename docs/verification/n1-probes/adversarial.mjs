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

const E1 = `ed1-${RUN}@probe.local`, E2 = `ed2-${RUN}@probe.local`, E2NEW = `ed2new-${RUN}@probe.local`, INV = `inv-${RUN}@probe.local`, UNC = `unc-${RUN}@probe.local`;
for (const e of [E1, E2]) log(`setup create ${e}`, brief(await admin('/admin/users', { body: { email: e, email_confirm: true } })));

// A. PKCE magic link (what @supabase/ssr does by default with {{ .ConfirmationURL }})
await clearMail();
let p = pkce();
log('A1 /otp pkce', brief(await retry429(() => call('/otp', { body: { email: E1, create_user: false, code_challenge: p.c, code_challenge_method: 's256' } }))));
let [m] = await waitMail(E1);
let loc = await followVerify(verifyLink(m));
log('A2 verify GET redirect', loc);
let code = new URL(loc).searchParams.get('code');
let r = await call('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.v } });
log('A3 pkce token (magic link)', `${brief(r)} ${tok(r)}`);
const pkceSession = r;
r = await call('/token?grant_type=refresh_token', { body: { refresh_token: pkceSession.json.refresh_token } });
log('A4 refresh of pkce magiclink session', `${brief(r)} ${tok(r)}`);

// B. PKCE recovery
await sleep(1500); await clearMail(); p = pkce();
log('B1 /recover pkce', brief(await retry429(() => call('/recover', { body: { email: E1, code_challenge: p.c, code_challenge_method: 's256' } }))));
[m] = await waitMail(E1);
loc = await followVerify(verifyLink(m));
code = new URL(loc).searchParams.get('code');
r = await call('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.v } });
log('B2 pkce token (recovery)', `${brief(r)} ${tok(r)}`);

// C. Implicit GET /verify (tokens in fragment)
await sleep(1500); await clearMail();
log('C1 /otp implicit', brief(await retry429(() => call('/otp', { body: { email: E1, create_user: false } }))));
[m] = await waitMail(E1);
loc = await followVerify(verifyLink(m));
const frag = new URLSearchParams((loc.split('#')[1] ?? ''));
log('C2 implicit GET verify', frag.get('access_token') ? `token in fragment ${tok({ json: { access_token: frag.get('access_token') } })}` : loc);

// D. Invite (service role) then accept
await clearMail();
log('D1 /invite', brief(await admin('/invite', { body: { email: INV } })));
[m] = await waitMail(INV);
r = await call('/verify', { body: { type: 'invite', token_hash: tokenHashOf(m) } });
log('D2 accept invite POST /verify', `${brief(r)} ${tok(r)}`);
r = r.json.refresh_token ? await call('/token?grant_type=refresh_token', { body: { refresh_token: r.json.refresh_token } }) : r;
log('D3 refresh of invite session', `${brief(r)} ${tok(r)}`);

// E. Email change (double confirm), implicit and PKCE
await clearMail();
const s2 = await (async () => { await retry429(() => call('/otp', { body: { email: E2, create_user: false } })); const [mm] = await waitMail(E2); return call('/verify', { body: { type: 'magiclink', token_hash: tokenHashOf(mm) } }); })();
log('E0 E2 session', `${brief(s2)} ${tok(s2)}`);
await clearMail();
log('E1 PUT /user email', brief(await call('/user', { method: 'PUT', token: s2.json.access_token, body: { email: E2NEW } })));
const [mOld] = await waitMail(E2); const [mNew] = await waitMail(E2NEW);
r = await call('/verify', { body: { type: 'email_change', token_hash: tokenHashOf(mOld) } });
log('E2 confirm old address', `${brief(r)} ${tok(r)}`);
r = await call('/verify', { body: { type: 'email_change', token_hash: tokenHashOf(mNew) } });
log('E3 confirm new address', `${brief(r)} ${tok(r)} email=${r.json.user?.email}`);
const s2b = r;
await clearMail(); p = pkce();
log('E4 PUT /user email pkce (back)', brief(await call('/user', { method: 'PUT', token: s2b.json.access_token, body: { email: E2, code_challenge: p.c, code_challenge_method: 's256' } })));
const [mOld2] = await waitMail(E2NEW); const [mNew2] = await waitMail(E2);
log('E5 GET verify old', await followVerify(verifyLink(mOld2)));
loc = await followVerify(verifyLink(mNew2));
log('E6 GET verify new', loc);
code = loc && new URL(loc).searchParams.get('code');
r = code ? await call('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.v } }) : { status: 0, json: {} };
log('E7 pkce token (email change)', `${brief(r)} ${tok(r)}`);

// F. Password oracle and side effects
log('F1 set password via own session', brief(await call('/user', { method: 'PUT', token: pkceSession.json.access_token, body: { password: 'probe-pass-123' } })));
log('F2 correct password', brief(await call('/token?grant_type=password', { body: { email: E1, password: 'probe-pass-123' } })));
log('F3 wrong password', brief(await call('/token?grant_type=password', { body: { email: E1, password: 'nope-nope-1' } })));
log('F4 unknown user', brief(await call('/token?grant_type=password', { body: { email: `nobody-${RUN}@probe.local`, password: 'x12345678' } })));
log('F5 user without password (E2)', brief(await call('/token?grant_type=password', { body: { email: E2, password: 'x12345678' } })));
log('F6 pkce session still refreshes? (password change revokes others)', brief(await call('/token?grant_type=refresh_token', { body: { refresh_token: pkceSession.json.refresh_token } })));

// G. Unconfirmed provisioned user
log('G1 admin create unconfirmed', brief(await admin('/admin/users', { body: { email: UNC, email_confirm: false } })));
log('G2 /otp for unconfirmed', brief(await call('/otp', { body: { email: UNC, create_user: false } })));

// H. admin generate_link signup with password (service role), then verify
const gl = await admin('/admin/generate_link', { body: { type: 'signup', email: `gl-${RUN}@probe.local`, password: 'gl-pass-123456' } });
log('H1 generate_link signup', `${gl.status} ${gl.json.hashed_token ? 'hashed_token present' : brief(gl)}`);
if (gl.json.hashed_token) {
  r = await call('/verify', { body: { type: 'signup', token_hash: gl.json.hashed_token } });
  log('H2 verify signup link', `${brief(r)} ${tok(r)}`);
  log('H3 password grant for that user', brief(await call('/token?grant_type=password', { body: { email: `gl-${RUN}@probe.local`, password: 'gl-pass-123456' } })));
}
console.log(JSON.stringify({ RUN, E1, E2, INV }));
