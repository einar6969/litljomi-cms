// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MAX_AGE, documentSessionCookies, serverCookiesAreSecure, sessionCookieOptions, writeDocumentCookie } from '../session-cookies';

// What @supabase/ssr 0.12 passes to setAll, whatever `cookieOptions` asks for.
const LIBRARY_DEFAULTS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 * 24 * 60 * 60 } as const;

afterEach(() => {
  vi.unstubAllEnvs();
  for (const name of document.cookie.split('; ').map((pair) => pair.split('=')[0])) document.cookie = `${name}=; Max-Age=0; Path=/`;
});

describe('sessionCookieOptions', () => {
  it('bounds the 400 days @supabase/ssr always asks for, whatever cookieOptions says', () => {
    expect(sessionCookieOptions(LIBRARY_DEFAULTS, true).maxAge).toBe(SESSION_MAX_AGE);
    expect(SESSION_MAX_AGE).toBe(7 * 24 * 60 * 60);
  });

  it('is same-site lax and secure as asked, and keeps the path', () => {
    expect(sessionCookieOptions({ path: '/', sameSite: 'strict' }, true)).toMatchObject({ path: '/', sameSite: 'lax', secure: true });
    expect(sessionCookieOptions({ path: '/' }, false)).toMatchObject({ path: '/', sameSite: 'lax', secure: false });
  });

  it('keeps a removal a removal', () => {
    expect(sessionCookieOptions({ ...LIBRARY_DEFAULTS, maxAge: 0 }, true).maxAge).toBe(0);
  });

  // lib/supabase/browser.ts reads the session from document.cookie for autosave, the publish panel
  // and uploads, so httpOnly would sign the browser client out.
  it('stays readable by the browser client', () => {
    expect(sessionCookieOptions(LIBRARY_DEFAULTS, true).httpOnly).toBe(false);
  });
});

describe('serverCookiesAreSecure', () => {
  it.each(['https://vefstjorn.is', 'https://cms.litljomi.is/', '', 'http://cms.litljomi.is', 'http://localhost.evil.example', 'http://localhost@evil.example'])(
    'is true for CMS_PUBLIC_URL=%j',
    (url) => {
      vi.stubEnv('CMS_PUBLIC_URL', url);
      expect(serverCookiesAreSecure()).toBe(true);
    },
  );

  it('is true when CMS_PUBLIC_URL is not set', () => {
    vi.stubEnv('CMS_PUBLIC_URL', undefined as unknown as string);
    expect(serverCookiesAreSecure()).toBe(true);
  });

  // `next start` is a production build on plain http in the local browser tests, so NODE_ENV cannot tell.
  it.each(['http://localhost:3100', 'http://localhost:3100/', 'http://127.0.0.1:3100', 'http://localhost'])('is false for the local %s', (url) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CMS_PUBLIC_URL', url);
    expect(serverCookiesAreSecure()).toBe(false);
  });
});

describe('the browser client\'s cookies', () => {
  it('reads what is in document.cookie, decoded', () => {
    document.cookie = 'sb-x-auth-token.0=base64-abc%3D; Path=/';
    document.cookie = 'plain=a=b; Path=/';
    expect(documentSessionCookies(document.cookie)).toEqual(
      expect.arrayContaining([
        { name: 'sb-x-auth-token.0', value: 'base64-abc=' },
        { name: 'plain', value: 'a=b' },
      ]),
    );
  });

  it('reads an empty document.cookie as no cookies, and leaves a value that does not decode as it is', () => {
    expect(documentSessionCookies('')).toEqual([]);
    expect(documentSessionCookies('a=%E0%A4%A')).toEqual([{ name: 'a', value: '%E0%A4%A' }]);
  });

  it('writes a value with the given attributes, encoded', () => {
    const set = vi.spyOn(document, 'cookie', 'set');
    writeDocumentCookie('sb-x-auth-token', 'a b', { path: '/', sameSite: 'lax', secure: true, maxAge: SESSION_MAX_AGE });
    expect(set).toHaveBeenCalledExactlyOnceWith(`sb-x-auth-token=a%20b; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax; Secure`);
    set.mockRestore();
  });

  it('writes a removal without Secure on plain http, and it takes effect', () => {
    document.cookie = 'gone=1; Path=/';
    writeDocumentCookie('gone', '', { path: '/', sameSite: 'lax', secure: false, maxAge: 0 });
    expect(document.cookie).not.toContain('gone');
  });
});
