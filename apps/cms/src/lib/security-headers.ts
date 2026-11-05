// The CMS's response headers (spec §8.1; M5 finding 8). Pure, so next.config.ts can load it too.

/** Every path but /api: the preview, worker and cron routes answer machines and keep their own headers. */
export const CMS_PAGES_SOURCE = '/((?!api/).*)';

/**
 * Sent by next.config.ts. The referrer policy keeps entry paths out of requests to other origins.
 * No `preload`: HSTS covers this host and anything under it, not the rest of litljomi.is.
 */
export const STATIC_SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

/** 128 random bits for one response's policy. */
export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The page policy, sent by src/proxy.ts because the nonce is new for every response. Next.js puts
 * the nonce on its own inline scripts, which every page needs to hydrate, so injected inline script
 * does not run; no `unsafe-inline` and no `unsafe-eval` for scripts. No `strict-dynamic`: scripts
 * load from this origin only, whatever loads them.
 *
 * Styles keep `unsafe-inline`: Tiptap adds a <style> element from the browser and React renders
 * `style` attributes on the server (the focal point marker), and neither carries a nonce. Inline CSS
 * runs no script.
 *
 * `supabaseUrl` is reached from the browser for the session, the publish panel's status and uploads,
 * and serves signed media. `data:` is the QR of /console/mfa, which Auth returns as a data image.
 */
export function contentSecurityPolicy(nonce: string, supabaseUrl: string): string {
  const supabase = new URL(supabaseUrl).origin;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: ${supabase}`,
    `connect-src 'self' ${supabase}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}
