import { combineChunks, stringFromBase64URL } from '@supabase/ssr';

/** The cookie @supabase/ssr keeps the session in: supabase-js's default storage key for the project URL. */
export const sessionCookieName = (supabaseUrl: string): string => `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;

type Cookie = { name: string; value: string };

/**
 * Whether the cookies carry a session whose access token has expired, by the token's `exp` (R7).
 * Read locally, with no call to Auth and no signature check: the proxy only decides from it that the
 * browser should refresh the session (lib/supabase/proxy.ts), never that anyone is signed in. False
 * when there is no session or it cannot be read; Auth then checks it, as for any other session.
 */
export async function sessionHasExpired(cookies: readonly Cookie[], supabaseUrl: string, now = Date.now()): Promise<boolean> {
  const value = await combineChunks(sessionCookieName(supabaseUrl), (name) => cookies.find((cookie) => cookie.name === name)?.value);
  const exp = value === null ? null : expiryOf(value);
  return exp !== null && exp * 1000 <= now;
}

const BASE64_PREFIX = 'base64-';

/** The `exp` of the access token in a session cookie's value, as @supabase/ssr writes it, or null. */
function expiryOf(value: string): number | null {
  try {
    const session: unknown = JSON.parse(value.startsWith(BASE64_PREFIX) ? stringFromBase64URL(value.slice(BASE64_PREFIX.length)) : value);
    const accessToken = (session as { access_token?: unknown } | null)?.access_token;
    if (typeof accessToken !== 'string') return null;
    const payload = accessToken.split('.')[1];
    if (!payload) return null;
    const { exp } = JSON.parse(stringFromBase64URL(payload)) as { exp?: unknown };
    return typeof exp === 'number' && Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}
