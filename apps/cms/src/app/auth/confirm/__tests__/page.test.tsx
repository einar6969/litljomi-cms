import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { createEditorClient } = await import('@/lib/supabase/server');
const { default: ConfirmPage, metadata } = await import('../page');
const { t } = await import('@/i18n/is');

const HASH = 'pkce_16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';

type Query = Record<string, string | string[] | undefined>;
const render = async (query: Query) => renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(query) }));
const hidden = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"/>`).exec(html)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /auth/confirm', () => {
  // Email security scanners open links automatically: opening the link must not use it up.
  it('renders one "Halda áfram" button and verifies nothing', async () => {
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(createEditorClient).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`>${t.confirm.submit}</button>`);
    expect(t.confirm.submit).toBe('Halda áfram');
    expect(html).toContain(t.confirm.title);
  });

  it('carries the link\'s token hash, type and next path to the action as hidden fields', async () => {
    const html = await render({ token_hash: HASH, type: 'invite', next: '/t/acme' });
    expect(hidden(html, 'token_hash')).toBe(HASH);
    expect(hidden(html, 'type')).toBe('invite');
    expect(hidden(html, 'next')).toBe('/t/acme');
  });

  it('uses the first value of a repeated parameter and empty fields for missing ones', async () => {
    const html = await render({ token_hash: [HASH, 'other'] });
    expect(hidden(html, 'token_hash')).toBe(HASH);
    expect(hidden(html, 'type')).toBe('');
    expect(hidden(html, 'next')).toBe('');
  });

  it('escapes what the link carries', async () => {
    const html = await render({ token_hash: '"><script>x</script>', type: 'email' });
    expect(html).not.toContain('<script>x');
    expect(hidden(html, 'token_hash')).toBe('&quot;&gt;&lt;script&gt;x&lt;/script&gt;');
  });

  it('sends no referrer, so the token hash in the URL is not passed on', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});
