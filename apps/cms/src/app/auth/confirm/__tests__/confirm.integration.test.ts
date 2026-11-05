// The magic link's confirm actions and the proxy against the local stack's Auth (M3-14). The
// browser's cookies are a jar standing in for next/headers; the proxy (lib/supabase/proxy.ts) runs on
// the same request as the confirm POST, as Next.js does, and the action sees the request cookies the
// proxy left. Covers the C3 follow-up "proxy refresh of an expired old session on the confirm POST"
// and Task 32 security r1's session swap: a link for another account is only held aside until the
// visitor answers the question.
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAuth, auth, brief, deleteThrowawayUsers, generateLinkSession, newUser, tokenHashOf, waitMail, type TestUser } from '../../../../../../../tests/integration/src/auth-api.ts';
import { env } from '../../../../../../../tests/integration/src/env.ts';
import { closeAll } from '../../../../../../../tests/integration/src/sql.ts';

type Cookie = { name: string; value: string };
const jar = new Map<string, string>();
const cookieStore = {
  get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
  getAll: (): Cookie[] => [...jar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string, options?: { maxAge?: number }) => {
    if (value === '' || options?.maxAge === 0) jar.delete(name);
    else jar.set(name, value);
  },
  delete: (name: string) => jar.delete(name),
};
vi.mock('next/headers', () => ({ cookies: async () => cookieStore }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const { confirmSignIn, keepSession, replaceSession } = await import('../actions');
const { PENDING_COOKIE } = await import('../pending');
const { updateSession } = await import('@/lib/supabase/proxy');
const { createEditorClient } = await import('@/lib/supabase/server');

const CMS = 'http://localhost:3100';
const HOME = /^REDIRECT \/$/;
const QUESTION = /^REDIRECT \/auth\/confirm$/;
// Past the access token's lifetime (`jwt_expiry`, 3600 s in supabase/config.toml).
const LATER_MS = 2 * 3600 * 1000;

/** A fresh magic-link token hash for `email`, as `{{ .TokenHash }}` carries it. */
async function tokenHash(email: string): Promise<string> {
  const link = await adminAuth('/admin/generate_link', { body: { type: 'magiclink', email } });
  expect(link.status, brief(link)).toBe(200);
  return link.json.hashed_token as string;
}

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

/** The session in the jar and its account as Auth verifies it, or null. */
async function jarSession() {
  const client = await createEditorClient();
  const { data } = await client.auth.getSession();
  if (!data.session) return null;
  const { data: verified } = await client.auth.getUser(data.session.access_token);
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token, user: { id: verified.user?.id } };
}

/** Whether Auth still accepts an access token (GET /user checks that its session exists). */
const accepted = async (accessToken: string) => (await auth('/user', { method: 'GET', token: accessToken })).status === 200;

/**
 * The proxy on a POST /auth/confirm carrying the jar, as Next.js runs it before the action; the
 * request cookies it leaves (which Next.js passes on to the action) replace the jar.
 */
async function proxyPost(): Promise<Response> {
  const cookie = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
  const request = new NextRequest(`${CMS}/auth/confirm`, { method: 'POST', headers: { cookie } });
  const response = await updateSession(request);
  jar.clear();
  for (const { name, value } of request.cookies.getAll()) if (value !== '') jar.set(name, value);
  return response;
}

/** Signs `user` in to the jar through the confirm action, as a visitor without a session. */
async function signInToJar(user: TestUser) {
  await expect(confirmSignIn(form({ token_hash: await tokenHash(user.email), type: 'email' }))).rejects.toThrow(HOME);
  const session = await jarSession();
  expect(session?.user.id).toBe(user.id);
  return session!;
}

let a: TestUser;
let b: TestUser;
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.publishableKey);
  a = await newUser('m314-a');
  b = await newUser('m314-b');
});
beforeEach(() => {
  jar.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await deleteThrowawayUsers();
  await closeAll();
});

describe('the proxy on the confirm POST (C3 follow-up)', () => {
  it('refreshes an expired session, and the action then asks before replacing the refreshed session', async () => {
    const old = await signInToJar(a);

    // An hour and more later, the access token in the jar has expired.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + LATER_MS);
    const response = await proxyPost();
    vi.useRealTimers();

    expect(response.headers.get('location')).toBeNull();
    const refreshed = await jarSession();
    expect(refreshed?.user.id).toBe(a.id);
    expect(refreshed!.refresh_token).not.toBe(old.refresh_token);
    // The browser gets the refreshed session too.
    expect(response.headers.getSetCookie().some((c) => c.startsWith('sb-'))).toBe(true);

    // The action, on the same request, sees the refreshed session: it holds B's link aside and asks.
    await expect(confirmSignIn(form({ token_hash: await tokenHash(b.email), type: 'email' }))).rejects.toThrow(QUESTION);
    expect(jar.has(PENDING_COOKIE)).toBe(true);
    expect((await jarSession())?.user.id).toBe(a.id);
    expect(await accepted(refreshed!.access_token)).toBe(true);

    // "Skipta um aðgang": now B, and A's refreshed session is revoked.
    await expect(replaceSession()).rejects.toThrow(HOME);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    const now = await jarSession();
    expect(now?.user.id).toBe(b.id);
    expect(await accepted(now!.access_token)).toBe(true);
    expect(await accepted(refreshed!.access_token)).toBe(false);
  });

  it('fails closed: a session Auth will not refresh is cleared, and the link then signs in without a question', async () => {
    const old = await signInToJar(a);
    const out = await auth('/logout?scope=local', { token: old.access_token });
    expect(out.status, brief(out)).toBe(204);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + LATER_MS);
    const response = await proxyPost();
    vi.useRealTimers();

    expect(response.headers.get('location')).toBeNull();
    expect(await jarSession()).toBeNull();
    await expect(confirmSignIn(form({ token_hash: await tokenHash(b.email), type: 'email' }))).rejects.toThrow(HOME);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    expect((await jarSession())?.user.id).toBe(b.id);
  });
});

describe('an email change (spec §4.4, M5 finding 9)', () => {
  const addressOf = async (user: TestUser) => (await adminAuth(`/admin/users/${user.id}`, { method: 'GET' })).json.email as string;

  it('needs the POST of each address, and the second signs in with the new address', async () => {
    const user = await newUser('m503-change');
    const newAddress = `new-${user.email}`;
    const session = await generateLinkSession(user.email, 'magiclink');
    const put = await auth('/user', { method: 'PUT', token: session.json.access_token, body: { email: newAddress } });
    expect(put.status, brief(put)).toBe(200);
    const fromOld = tokenHashOf((await waitMail(user.email))[0]!);
    const fromNew = tokenHashOf((await waitMail(newAddress))[0]!);

    await expect(confirmSignIn(form({ token_hash: fromOld, type: 'email_change' }))).rejects.toThrow(/^REDIRECT \/login\?emailChange=waiting$/);
    expect(await addressOf(user)).toBe(user.email);
    expect(await jarSession()).toBeNull();

    await expect(confirmSignIn(form({ token_hash: fromNew, type: 'email_change' }))).rejects.toThrow(HOME);
    expect(await addressOf(user)).toBe(newAddress);
    expect((await jarSession())?.user.id).toBe(user.id);
  });
});

describe('a link for another account (Task 32 security r1)', () => {
  it('changes no session until answered; "Hætta við" keeps the visitor\'s and ends the link\'s', async () => {
    const own = await signInToJar(a);
    const before = new Map(jar);

    await expect(confirmSignIn(form({ token_hash: await tokenHash(b.email), type: 'email', next: '/t/acme' }))).rejects.toThrow(QUESTION);
    // Only the pending cookie was added; the session cookies are as they were.
    expect([...jar].filter(([name]) => name !== PENDING_COOKIE)).toEqual([...before]);
    const held = JSON.parse(jar.get(PENDING_COOKIE)!) as { accessToken: string; next: string };
    expect(held.next).toBe('/t/acme');
    const user = await auth('/user', { method: 'GET', token: held.accessToken });
    expect(user.json.email).toBe(b.email);

    await expect(keepSession()).rejects.toThrow(HOME);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    expect((await jarSession())?.user.id).toBe(a.id);
    expect(await accepted(own.access_token)).toBe(true);
    expect(await accepted(held.accessToken)).toBe(false);
  });

  it('a link for the account already signed in takes over without a question, revoking the old session', async () => {
    const own = await signInToJar(a);
    await expect(confirmSignIn(form({ token_hash: await tokenHash(a.email), type: 'email', next: '/t/acme' }))).rejects.toThrow('REDIRECT /t/acme');
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    const now = await jarSession();
    expect(now?.user.id).toBe(a.id);
    expect(now!.access_token).not.toBe(own.access_token);
    expect(await accepted(now!.access_token)).toBe(true);
    expect(await accepted(own.access_token)).toBe(false);
  });

  it('a used link changes nothing for a signed-in visitor', async () => {
    await signInToJar(a);
    const hash = await tokenHash(b.email);
    const used = await auth('/verify', { body: { type: 'email', token_hash: hash } });
    expect(used.status, brief(used)).toBe(200);
    const before = new Map(jar);
    await expect(confirmSignIn(form({ token_hash: hash, type: 'email' }))).rejects.toThrow('REDIRECT /login?error=link');
    expect(new Map(jar)).toEqual(before);
  });
});
