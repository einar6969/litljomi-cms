// The confirm page's actions and the proxy against the local stack's Auth (M3-14). The browser's
// cookies are a jar standing in for next/headers; the proxy (lib/supabase/proxy.ts) runs on the same
// request as the confirm POST, as Next.js does, and the action sees the request cookies the proxy
// left. Covers the C3 follow-up "proxy refresh of an expired old session on the confirm POST" (since
// R7 the server refreshes no session: the browser does) and Task 32 security r1's session swap: a
// link for another account is only held aside until the visitor answers the question.
//
// The visitor signs in with a password, as editors do (PW-01). The link for another account is an
// invitation, and the link for the visitor's own account is the second link of an email change.
// An invitation's session lands on the set-password page first (PW-03); the proxy keeps it there.
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAuth, auth, brief, deleteThrowawayUsers, newUser, passwordSession, tokenHashOf, waitMail, type TestUser } from '../../../../../../../tests/integration/src/auth-api.ts';
import { env, stack } from '../../../../../../../tests/integration/src/env.ts';
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
const { PASSWORD_STEP_COOKIE } = await import('@/lib/auth/password-step');
const { updateSession } = await import('@/lib/supabase/proxy');
const { createEditorClient } = await import('@/lib/supabase/server');

const CMS = stack.cmsUrl;
const HOME = /^REDIRECT \/$/;
const QUESTION = /^REDIRECT \/auth\/confirm$/;
const SET_PASSWORD = /^REDIRECT \/auth\/password$/;

/** An invitation for a new account: the account and its link's token hash, as `{{ .TokenHash }}` carries it. */
async function invitation(): Promise<{ user: TestUser; tokenHash: string }> {
  const user = await newUser('m314-b', { invite: true });
  return { user, tokenHash: user.inviteTokenHash! };
}

/**
 * The link that completes an email change `user` asked for with `accessToken`: the old address's
 * link is verified first, so the new address's link, returned, signs `user` in.
 */
async function ownLink(user: TestUser, accessToken: string): Promise<string> {
  const newAddress = `new-${user.email}`;
  const put = await auth('/user', { method: 'PUT', token: accessToken, body: { email: newAddress } });
  expect(put.status, brief(put)).toBe(200);
  const first = await auth('/verify', { body: { type: 'email_change', token_hash: tokenHashOf((await waitMail(user.email))[0]!) } });
  expect(first.status, brief(first)).toBe(200);
  return tokenHashOf((await waitMail(newAddress))[0]!);
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
  return proxy('/auth/confirm', 'POST');
}

/** The proxy on a request for `path` carrying the jar; the request cookies it leaves replace the jar. */
async function proxy(path: string, method = 'GET'): Promise<Response> {
  const cookie = cookieStore.getAll().map(({ name, value }) => `${name}=${encodeURIComponent(value)}`).join('; ');
  const request = new NextRequest(`${CMS}${path}`, { method, headers: { cookie } });
  const response = await updateSession(request);
  jar.clear();
  for (const { name, value } of request.cookies.getAll()) if (value !== '') jar.set(name, value);
  return response;
}

// The session cookie, as @supabase/ssr names it (supabase-js's storage key), and its chunks `.0`, `.1`.
const SESSION_COOKIE = `sb-${new URL(env.apiUrl).hostname.split('.')[0]}-auth-token`;
const chunkIndex = (name: string) => (name === SESSION_COOKIE ? -1 : Number(name.slice(SESSION_COOKIE.length + 1)));
const fromBase64url = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString());
const toBase64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/**
 * Makes the jar's session what it is an hour and more later: its access token past `exp` (re-encoded,
 * so no longer signed by Auth, which an expired token is never sent to anyway). The refresh token is
 * left as Auth issued it.
 */
function expireJarSession(): void {
  const names = [...jar.keys()].filter((name) => name === SESSION_COOKIE || name.startsWith(`${SESSION_COOKIE}.`)).sort((x, y) => chunkIndex(x) - chunkIndex(y));
  const value = names.map((name) => jar.get(name)).join('');
  const session = fromBase64url(value.slice('base64-'.length));
  const exp = Math.floor(Date.now() / 1000) - 60;
  const [header, payload, signature] = (session.access_token as string).split('.');
  session.access_token = [header, toBase64url({ ...fromBase64url(payload!), exp }), signature].join('.');
  session.expires_at = exp;
  for (const name of names) jar.delete(name);
  jar.set(SESSION_COOKIE, `base64-${toBase64url(session)}`);
}

/** The refresh requests this process (the CMS server) sent. */
const refreshes = (fetchSpy: { mock: { calls: unknown[][] } }) =>
  fetchSpy.mock.calls.filter(([input]) => new URL(input instanceof Request ? input.url : String(input)).searchParams.get('grant_type') === 'refresh_token');

/** Signs `user` in to the jar with a password, through the editor's cookie client. */
async function signInToJar(user: TestUser) {
  const { error } = await (await createEditorClient()).auth.signInWithPassword({ email: user.email, password: user.password! });
  expect(error).toBeNull();
  const session = await jarSession();
  expect(session?.user.id).toBe(user.id);
  return session!;
}

let a: TestUser;
beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', env.publishableKey);
  a = await newUser('m314-a');
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

// R7: the CMS server never refreshes a session; the browser does, from the visitor's own address.
// The confirm page sends a navigation with an expired session to /auth/refresh first, and keeps a
// signed-in visitor's session fresh while it is open (KeepSessionFresh), so the button's POST
// carries a fresh one and the question is asked. A POST that still carries an expired session
// counts as signed out, as without a session: the link signs in without a question.
describe('an expired session at the confirm page (C3 follow-up, R7)', () => {
  it('sends a navigation to the page to /auth/refresh first, so the browser refreshes it, and sends no refresh itself', async () => {
    await signInToJar(a);
    expireJarSession();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const response = await proxy('/auth/confirm?token_hash=abc&type=invite');
    expect(response.headers.get('location')).toBe(`${CMS}/auth/refresh?next=${encodeURIComponent('/auth/confirm?token_hash=abc&type=invite')}`);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(refreshes(fetchSpy)).toEqual([]);
  });

  it.each([
    ['one Auth would still refresh', false],
    ['one Auth has ended', true],
  ])('on the POST, %s is not refreshed: the proxy leaves the cookies to the browser, and the link signs in without a question', async (_case, ended) => {
    const old = await signInToJar(a);
    if (ended) {
      const out = await auth('/logout?scope=local', { token: old.access_token });
      expect(out.status, brief(out)).toBe(204);
    }
    const b = await invitation();
    expireJarSession();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const response = await proxyPost();
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.getSetCookie()).toEqual([]);
    await expect(confirmSignIn(form({ token_hash: b.tokenHash, type: 'invite' }))).rejects.toThrow(SET_PASSWORD);

    expect(refreshes(fetchSpy)).toEqual([]);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    expect((await jarSession())?.user.id).toBe(b.user.id);
  });
});

describe('an email change (spec §4.4, M5 finding 9)', () => {
  const addressOf = async (user: TestUser) => (await adminAuth(`/admin/users/${user.id}`, { method: 'GET' })).json.email as string;

  it('needs the POST of each address, and the second signs in with the new address', async () => {
    const user = await newUser('m503-change');
    const newAddress = `new-${user.email}`;
    const session = await passwordSession(user);
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

    const b = await invitation();
    await expect(confirmSignIn(form({ token_hash: b.tokenHash, type: 'invite', next: '/t/acme' }))).rejects.toThrow(QUESTION);
    // Only the pending cookie was added; the session cookies are as they were.
    expect([...jar].filter(([name]) => name !== PENDING_COOKIE)).toEqual([...before]);
    const held = JSON.parse(jar.get(PENDING_COOKIE)!) as { accessToken: string; next: string };
    expect(held.next).toBe('/t/acme');
    const user = await auth('/user', { method: 'GET', token: held.accessToken });
    expect(user.json.email).toBe(b.user.email);

    await expect(keepSession()).rejects.toThrow(HOME);
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    expect((await jarSession())?.user.id).toBe(a.id);
    expect(await accepted(own.access_token)).toBe(true);
    expect(await accepted(held.accessToken)).toBe(false);
  });

  it('a link for the account already signed in takes over without a question, revoking the old session', async () => {
    // An account of its own, because the email change moves its address.
    const user = await newUser('m314-own');
    const own = await signInToJar(user);
    const link = await ownLink(user, own.access_token);
    await expect(confirmSignIn(form({ token_hash: link, type: 'email_change', next: '/t/acme' }))).rejects.toThrow('REDIRECT /t/acme');
    expect(jar.has(PENDING_COOKIE)).toBe(false);
    const now = await jarSession();
    expect(now?.user.id).toBe(user.id);
    expect(now!.access_token).not.toBe(own.access_token);
    expect(await accepted(now!.access_token)).toBe(true);
    expect(await accepted(own.access_token)).toBe(false);
  });

  it('a used link changes nothing for a signed-in visitor', async () => {
    await signInToJar(a);
    const { tokenHash: hash } = await invitation();
    const used = await auth('/verify', { body: { type: 'invite', token_hash: hash } });
    expect(used.status, brief(used)).toBe(200);
    const before = new Map(jar);
    await expect(confirmSignIn(form({ token_hash: hash, type: 'invite' }))).rejects.toThrow('REDIRECT /login?error=link');
    expect(new Map(jar)).toEqual(before);
  });
});

// PW-03: the step stored by the confirm action names the session Auth issued for the link, and the
// proxy, reading the real tokens, keeps that session on the set-password page until the step ends.
describe('the set-password step (PW-03)', () => {
  it('keeps an invitation\'s session on the set-password page, and lets a later password sign-in through', async () => {
    const b = await invitation();
    await expect(confirmSignIn(form({ token_hash: b.tokenHash, type: 'invite', next: '/t/acme' }))).rejects.toThrow(SET_PASSWORD);
    const session = await jarSession();
    expect(session?.user.id).toBe(b.user.id);
    const stored = JSON.parse(jar.get(PASSWORD_STEP_COOKIE)!) as { sessionId: string; next: string };
    expect(stored).toEqual({ sessionId: JSON.parse(Buffer.from(session!.access_token.split('.')[1]!, 'base64url').toString()).session_id, next: '/t/acme' });

    for (const path of ['/', '/t/acme', '/console']) {
      expect((await proxy(path)).headers.get('location'), path).toBe(`${CMS}/auth/password`);
    }
    expect((await proxy('/auth/password')).headers.get('location')).toBeNull();
    expect((await proxy('/login')).headers.get('location')).toBeNull();

    // The invitee sets a password (as the browser does), then signs in with it: a new session, which
    // the step does not name, so the proxy removes it and lets the page through.
    const set = await auth('/user', { method: 'PUT', token: session!.access_token, body: { password: 'first password 7' } });
    expect(set.status, brief(set)).toBe(200);
    const { error } = await (await createEditorClient()).auth.signInWithPassword({ email: b.user.email, password: 'first password 7' });
    expect(error).toBeNull();
    const response = await proxy('/t/acme');
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${PASSWORD_STEP_COOKIE}=;`))).toBe(true);
  });

  it('an email change starts no step', async () => {
    const user = await newUser('pw03-change');
    const own = await signInToJar(user);
    const link = await ownLink(user, own.access_token);
    await expect(confirmSignIn(form({ token_hash: link, type: 'email_change' }))).rejects.toThrow(HOME);
    expect(jar.has(PASSWORD_STEP_COOKIE)).toBe(false);
  });
});

