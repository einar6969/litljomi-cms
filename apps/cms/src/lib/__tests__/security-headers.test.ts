import { describe, expect, it } from 'vitest';
import nextConfig from '../../../next.config';
import { CMS_PAGES_SOURCE, contentSecurityPolicy, newNonce } from '../security-headers';

const NONCE = 'bm9uY2Utb2YtdGhlLXRlc3Q=';
const SUPABASE = 'https://abcdefghijklmnopqrst.supabase.co';

/** The policy as a map from directive to its sources. */
const directives = (policy: string): Map<string, string[]> =>
  new Map(
    policy.split(';').map((part) => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name!, sources];
    }),
  );

describe('contentSecurityPolicy', () => {
  const policy = directives(contentSecurityPolicy(NONCE, SUPABASE));

  it('refuses framing, a changed base, forms sent elsewhere and plugins', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    expect(policy.get('base-uri')).toEqual(["'self'"]);
    expect(policy.get('form-action')).toEqual(["'self'"]);
    expect(policy.get('object-src')).toEqual(["'none'"]);
    expect(policy.get('default-src')).toEqual(["'self'"]);
  });

  it('runs this origin\'s scripts and inline scripts with the nonce only: no unsafe-inline, no unsafe-eval', () => {
    expect(policy.get('script-src')).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(contentSecurityPolicy(NONCE, SUPABASE)).not.toContain('unsafe-eval');
  });

  it('allows inline styles (Tiptap\'s style element and server-rendered style attributes), and fonts from this origin', () => {
    expect(policy.get('style-src')).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get('font-src')).toEqual(["'self'"]);
  });

  it('reaches Supabase for the session, the status poll, uploads and signed media, and shows the QR data image', () => {
    expect(policy.get('connect-src')).toEqual(["'self'", SUPABASE]);
    expect(policy.get('img-src')).toEqual(["'self'", 'data:', SUPABASE]);
  });

  it('names the origin of the Supabase URL, without a path or a trailing slash', () => {
    const local = directives(contentSecurityPolicy(NONCE, 'http://127.0.0.1:54321/'));
    expect(local.get('connect-src')).toEqual(["'self'", 'http://127.0.0.1:54321']);
    expect(directives(contentSecurityPolicy(NONCE, `${SUPABASE}/rest/v1`)).get('img-src')).toEqual(["'self'", 'data:', SUPABASE]);
  });
});

describe('newNonce', () => {
  it('is 128 random bits in base64, new each time', () => {
    const nonce = newNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(nonce);
  });
});

describe('next.config headers', () => {
  const pages = (path: string) => new RegExp(`^${CMS_PAGES_SOURCE}$`).test(path);

  it('sends nosniff, the referrer policy and HSTS on CMS paths', async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0]!.source).toBe(CMS_PAGES_SOURCE);
    expect(Object.fromEntries(rules[0]!.headers.map(({ key, value }) => [key, value]))).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
      'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    });
  });

  it.each(['/', '/login', '/auth/confirm', '/t/labak/news/1', '/console/mfa', '/_next/static/chunks/a.js', '/apiary'])('covers %s', (path) => {
    expect(pages(path)).toBe(true);
  });

  // The preview endpoint, the preview token route, the worker and the cron answer machines and
  // sites: they keep their own headers (§7.5).
  it.each(['/api/preview/labak', '/api/preview-token', '/api/internal/worker', '/api/cron/sweep'])('leaves %s alone', (path) => {
    expect(pages(path)).toBe(false);
  });

  it('leaves the policy to the proxy: a second one here would be enforced too, without a nonce', async () => {
    const rules = await nextConfig.headers!();
    expect(rules.flatMap((rule) => rule.headers).map(({ key }) => key.toLowerCase())).not.toContain('content-security-policy');
  });
});
