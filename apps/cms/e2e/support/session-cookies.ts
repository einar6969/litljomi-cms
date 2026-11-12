// The browser's session cookies on the local CMS, as @supabase/ssr writes them: reading their
// tokens, making the session expired as it is an hour later, and checking that a session's refresh
// token no longer refreshes (R7).
import { expect, type BrowserContext, type Cookie, type Page } from '@playwright/test';
import { CMS_URL, SUPABASE_URL } from './local';

// The session cookie, as @supabase/ssr names it (supabase-js's storage key), and its chunks `.0`, `.1`.
const SESSION_COOKIE = `sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`;
const SESSION_CHUNKS = new RegExp(`^${SESSION_COOKIE}(?:\\.\\d+)?$`);
// @supabase/ssr's chunk size (MAX_CHUNK_SIZE); a browser keeps no cookie over 4 KB.
const CHUNK = 3180;
const chunkIndex = (name: string) => (name === SESSION_COOKIE ? -1 : Number(name.slice(SESSION_COOKIE.length + 1)));
const fromBase64url = (value: string) => JSON.parse(Buffer.from(value, 'base64url').toString());
const toBase64url = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** The session cookies of the browser, in chunk order. */
export async function sessionCookies(context: BrowserContext): Promise<Cookie[]> {
  return (await context.cookies(CMS_URL)).filter(({ name }) => SESSION_CHUNKS.test(name)).sort((x, y) => chunkIndex(x.name) - chunkIndex(y.name));
}

type Session = { access_token: string; refresh_token: string; expires_at: number };

const sessionOf = (chunks: Cookie[]): Session => fromBase64url(chunks.map(({ value }) => value).join('').slice('base64-'.length)) as Session;

/** The access token of the browser's session, from its cookies. */
export async function accessToken(context: BrowserContext): Promise<string> {
  return sessionOf(await sessionCookies(context)).access_token;
}

/**
 * Makes the browser's session what it is an hour and more later: its access token past `exp`
 * (re-encoded, so no longer signed by Auth, which an expired token is never sent to). The refresh
 * token is left as Auth issued it.
 */
export async function expireSession(context: BrowserContext): Promise<void> {
  const chunks = await sessionCookies(context);
  const session = sessionOf(chunks);
  const exp = Math.floor(Date.now() / 1000) - 60;
  const [header, payload, signature] = session.access_token.split('.');
  session.access_token = [header, toBase64url({ ...fromBase64url(payload!), exp }), signature].join('.');
  session.expires_at = exp;
  const value = `base64-${toBase64url(session)}`;
  const pieces = value.length <= CHUNK ? [value] : (value.match(new RegExp(`.{1,${CHUNK}}`, 'g')) ?? []);
  await context.clearCookies({ name: SESSION_CHUNKS });
  const { name: _name, value: _value, ...attributes } = chunks[0]!;
  await context.addCookies(pieces.map((piece, i) => ({ ...attributes, name: pieces.length === 1 ? SESSION_COOKIE : `${SESSION_COOKIE}.${i}`, value: piece })));
}

export const expOf = (token: string) => fromBase64url(token.split('.')[1]!).exp as number;

/**
 * Puts the session `cookies` back in the browser and opens `path`, so the browser tries their
 * refresh token (the access token in them has expired; /auth/refresh): Auth refuses it, and the
 * page ends on /login. The cookies of a session that was ended in Auth, not only on this device.
 */
export async function expectRefreshRefused(page: Page, cookies: Cookie[], path: string): Promise<void> {
  await page.context().addCookies(cookies);
  const refresh = page.waitForResponse((response) => new URL(response.url()).searchParams.get('grant_type') === 'refresh_token');
  await page.goto(path);
  expect((await refresh).status()).toBe(400);
  await expect(page).toHaveURL(`${CMS_URL}/login`);
}
