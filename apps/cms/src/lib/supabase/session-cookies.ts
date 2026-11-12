import type { CookieOptions } from '@supabase/ssr';

/**
 * Seconds a session cookie lasts without use (M5 finding 8). Every token refresh rewrites the
 * cookies, so with one-hour access tokens an editor at work keeps sliding this forward; a browser
 * unused for a week signs in again with the password, which loses no work (§4.4).
 * This bounds the copy in the browser only: Auth still honours the refresh token until it is used
 * or revoked.
 */
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

const LOCAL_HTTP = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/|$)/;

/**
 * On the server, whether session cookies are `Secure`: always, but for a CMS on local plain http.
 * NODE_ENV cannot tell, because the local browser tests run a production build on http; a missing
 * CMS_PUBLIC_URL counts as deployed.
 */
export const serverCookiesAreSecure = (): boolean => !LOCAL_HTTP.test(process.env.CMS_PUBLIC_URL ?? '');

/**
 * The options every session cookie is written with, for the three places that write them. Applied at
 * the write because @supabase/ssr overwrites `cookieOptions.maxAge` with its own 400 days.
 *
 * Not `httpOnly`: the browser client (lib/supabase/browser.ts) reads the session from
 * document.cookie for the autosave's session check, the publish panel's status and image uploads.
 */
export function sessionCookieOptions(options: CookieOptions, secure: boolean): CookieOptions {
  return { ...options, sameSite: 'lax', secure, maxAge: options.maxAge === 0 ? 0 : SESSION_MAX_AGE };
}

/** The cookies in a `document.cookie` string, decoded as @supabase/ssr's own reader decodes them. */
export function documentSessionCookies(cookie: string): Array<{ name: string; value: string }> {
  return cookie
    .split('; ')
    .filter((pair) => pair !== '')
    .map((pair) => {
      const separator = pair.indexOf('=');
      const value = pair.slice(separator + 1);
      try {
        return { name: pair.slice(0, separator), value: decodeURIComponent(value) };
      } catch {
        return { name: pair.slice(0, separator), value };
      }
    });
}

/** Writes one cookie to `document.cookie`. The options are those of sessionCookieOptions. */
export function writeDocumentCookie(name: string, value: string, { path, maxAge, secure }: CookieOptions): void {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path ?? '/'}`, `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (secure) parts.push('Secure');
  document.cookie = parts.join('; ');
}
