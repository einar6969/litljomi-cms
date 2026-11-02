import crypto from 'node:crypto';
const API = process.env.API_URL, ANON = process.env.PUBLISHABLE_KEY, SERVICE = process.env.SECRET_KEY;
const MAIL = 'http://127.0.0.1:54324/api/v1'; const RUN = Date.now().toString(36);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const claims = (jwt) => JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
async function call(path, { method = 'POST', body, token, key = ANON } = {}) {
  const res = await fetch(`${API}/auth/v1${path}`, { method, redirect: 'manual', headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await res.text(); let json; try { json = JSON.parse(t); } catch { json = { raw: t.slice(0, 200) }; } return { status: res.status, json };
}
const admin = (p, o = {}) => call(p, { ...o, key: SERVICE, token: SERVICE });
const brief = (r) => `${r.status} ${r.json.error_code ?? r.json.code ?? ''} ${r.json.msg ?? r.json.message ?? ''}`.trim();
const tok = (r) => r.json.access_token ? (({ probe_method, amr, email }) => `probe_method=${probe_method} email=${email} amr=${JSON.stringify(amr?.map((a) => a.method))}`)(claims(r.json.access_token)) : 'no token';
async function all() { const l = await (await fetch(`${MAIL}/messages`)).json(); return Promise.all((l.messages ?? []).map(async (m) => (await fetch(`${MAIL}/message/${m.ID}`)).json())); }
const link = (msg) => [...msg.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&')).find((h) => h.includes('/verify'));
const pkce = () => { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; };
const OLD = `ec-${RUN}@probe.local`, NEW = `ecnew-${RUN}@probe.local`;
const u = await admin('/admin/users', { body: { email: OLD, email_confirm: true } });
await fetch(`${MAIL}/messages`, { method: 'DELETE' });
await call('/otp', { body: { email: OLD, create_user: false } }); await sleep(1500);
let ms = await all(); const s = await call('/verify', { body: { type: 'magiclink', token_hash: new URL(link(ms[0])).searchParams.get('token') } });
console.log('session', brief(s), tok(s));
const mode = process.argv[2] ?? 'implicit';
const p = pkce();
await fetch(`${MAIL}/messages`, { method: 'DELETE' });
console.log('PUT /user email', mode, brief(await call('/user', { method: 'PUT', token: s.json.access_token, body: mode === 'pkce' ? { email: NEW, code_challenge: p.c, code_challenge_method: 's256' } : { email: NEW } })));
await sleep(2000);
ms = await all();
for (const m of ms) { const l = new URL(link(m)); console.log('mail to', m.To.map((t) => t.Address).join(), '| subject', m.Subject, '| type', l.searchParams.get('type'), '| token prefix', l.searchParams.get('token').slice(0, 6)); }
const order = process.argv[3] === 'newfirst' ? [...ms].sort((a) => (a.To[0].Address === NEW ? -1 : 1)) : [...ms].sort((a) => (a.To[0].Address === OLD ? -1 : 1));
for (const m of order) {
  const l = new URL(link(m));
  if (mode === 'pkce') {
    const r = await fetch(l, { redirect: 'manual', headers: { apikey: ANON } });
    const loc = r.headers.get('location'); console.log('GET verify for', m.To[0].Address, '->', loc);
    const code = loc && new URL(loc).searchParams.get('code');
    if (code) { const t = await call('/token?grant_type=pkce', { body: { auth_code: code, code_verifier: p.v } }); console.log('  pkce token', brief(t), tok(t)); }
  } else {
    const r = await call('/verify', { body: { type: 'email_change', token_hash: l.searchParams.get('token') } });
    console.log('POST verify for', m.To[0].Address, '->', brief(r), tok(r));
  }
  const cur = await admin(`/admin/users/${u.json.id}`, { method: 'GET' });
  console.log('  user email now', cur.json.email, 'new_email', cur.json.new_email);
}
