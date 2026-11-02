// Raw Supabase Auth HTTP calls, the local mailbox (Mailpit), TOTP and PKCE for
// auth-passwordless.test.ts. Ported from the N1 probes
// (docs/verification/n1-probes/*.mjs), which are kept byte-identical as evidence;
// this is the code that runs. Local stack only (env.ts refuses anything else).
import crypto from 'node:crypto';
import { sleep } from './clients.ts';
import { env } from './env.ts';

export { sleep };

export type AuthResponse = { status: number; json: Record<string, any>; location: string | null };

type CallOptions = { method?: string; body?: unknown; token?: string; key?: string };

export async function auth(path: string, { method = 'POST', body, token, key = env.publishableKey }: CallOptions = {}): Promise<AuthResponse> {
  const res = await fetch(`${env.apiUrl}/auth/v1${path}`, {
    method,
    redirect: 'manual',
    headers: { apikey: key, 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, any>;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: res.status, json: json ?? {}, location: res.headers.get('location') };
}

export const adminAuth = (path: string, opts: CallOptions = {}) => auth(path, { ...opts, key: env.secretKey, token: env.secretKey });

export const claims = (jwt: string): Record<string, any> => JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString());

export const brief = (r: AuthResponse) =>
  `${r.status} ${r.json.error_code ?? r.json.code ?? ''} ${r.json.msg ?? r.json.message ?? r.json.error_description ?? ''}`.trim();

/** Retries a call that answered 429 (Auth's rate limits), waiting between tries. */
export async function retry429(fn: () => Promise<AuthResponse>, tries = 40): Promise<AuthResponse> {
  for (let i = 1; ; i++) {
    const r = await fn();
    if (r.status !== 429 || i >= tries) return r;
    await sleep(5000);
  }
}

/** Asks Auth to send an email (/otp, /recover); fails unless it answers 200. */
export async function requestEmail(path: string, body: object): Promise<AuthResponse> {
  const r = await retry429(() => auth(path, { body }));
  if (r.status !== 200) throw new Error(`${path}: ${brief(r)}`);
  return r;
}

// Throwaway users, deleted after the file.
const RUN = Date.now().toString(36);
let counter = 0;
const created: string[] = [];

export type TestUser = { id: string; email: string; inviteTokenHash?: string };

export async function newUser(prefix: string, { invite = false } = {}): Promise<TestUser> {
  const email = `${prefix}-${RUN}-${++counter}@test.local`;
  if (invite) {
    const r = await adminAuth('/admin/generate_link', { body: { type: 'invite', email } });
    if (r.status !== 200) throw new Error(`invite ${email}: ${brief(r)}`);
    created.push(r.json.id);
    return { id: r.json.id, email, inviteTokenHash: r.json.hashed_token };
  }
  const r = await adminAuth('/admin/users', { body: { email, email_confirm: true } });
  if (r.status !== 200) throw new Error(`create ${email}: ${brief(r)}`);
  created.push(r.json.id);
  return { id: r.json.id, email };
}

export async function deleteThrowawayUsers(ids: string[] = created.splice(0)) {
  for (const id of ids) {
    if (!id) continue;
    const r = await adminAuth(`/admin/users/${id}`, { method: 'DELETE' });
    // 404: already gone (a test deleted it); anything else is a failed cleanup.
    if (r.status !== 200 && r.status !== 404) throw new Error(`delete user ${id}: ${brief(r)}`);
  }
}

/** A session through admin generate_link and POST /verify with the hashed token. */
export async function generateLinkSession(email: string, type: 'magiclink' | 'recovery'): Promise<AuthResponse> {
  const link = await adminAuth('/admin/generate_link', { body: { type, email } });
  if (link.status !== 200) throw new Error(`generate_link ${type}: ${brief(link)}`);
  return retry429(() => auth('/verify', { body: { type, token_hash: link.json.hashed_token } }));
}

// Mailpit (the local SMTP sink).
type MailMessage = { ID: string; To: { Address: string }[]; HTML: string; Text: string; Subject: string };
const mailApi = `${env.mailUrl}/api/v1`;

export async function clearMail() {
  const res = await fetch(`${mailApi}/messages`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Mailpit: clearing the mailbox answered ${res.status}`);
}

async function mailsTo(to: string): Promise<MailMessage[]> {
  const res = await fetch(`${mailApi}/messages`);
  if (!res.ok) throw new Error(`Mailpit: listing messages answered ${res.status}`);
  const list = (await res.json()) as { messages?: MailMessage[] };
  const mine = (list.messages ?? []).filter((m) => m.To.some((t) => t.Address.toLowerCase() === to.toLowerCase()));
  return Promise.all(mine.map(async (m) => (await (await fetch(`${mailApi}/message/${m.ID}`)).json()) as MailMessage));
}

/** Waits up to 10 s for at least n messages to an address. */
export async function waitMail(to: string, n = 1): Promise<MailMessage[]> {
  for (let i = 0; i < 40; i++) {
    const m = await mailsTo(to);
    if (m.length >= n) return m;
    await sleep(250);
  }
  throw new Error(`no mail for ${to}`);
}

const hrefs = (msg: MailMessage) => [...msg.HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
export const verifyLink = (msg: MailMessage): string => {
  const link = hrefs(msg).find((h) => h.includes('/verify'));
  if (!link) throw new Error(`no verify link in mail "${msg.Subject}"`);
  return link;
};
export const tokenHashOf = (msg: MailMessage) => new URL(verifyLink(msg)).searchParams.get('token') ?? '';

/**
 * The CMS sign-in link of a magic-link or invitation mail (decision 41.1): the CMS's
 * `/auth/confirm` page with the token hash and type, built from `{{ .SiteURL }}`.
 */
export const confirmLink = (msg: MailMessage): URL => {
  const link = hrefs(msg).find((h) => URL.canParse(h) && new URL(h).pathname === '/auth/confirm');
  if (!link) throw new Error(`no /auth/confirm link in mail "${msg.Subject}"`);
  return new URL(link);
};

/**
 * Supabase Auth's own GET /verify URL for a token hash (what `{{ .ConfirmationURL }}` links to), so
 * the redirect flows stay covered now that the templates link to the CMS instead.
 */
export const verifyUrlFor = (tokenHash: string, type: 'magiclink' | 'invite'): string =>
  `${env.apiUrl}/auth/v1/verify?${new URLSearchParams({ token: tokenHash, type })}`;

/** GET of an emailed /verify link without following the redirect: its Location. */
export async function followVerify(link: string): Promise<string | null> {
  const res = await fetch(link, { redirect: 'manual', headers: { apikey: env.publishableKey } });
  return res.headers.get('location');
}

export function pkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for a base32 secret. */
export function totp(secretB32: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretB32.replace(/=+$/, '')) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30000)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
