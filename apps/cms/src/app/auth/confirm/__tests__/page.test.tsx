import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), getUser: vi.fn(), admin: { signOut: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { createEditorClient } = await import('@/lib/supabase/server');
const { default: ConfirmPage, metadata } = await import('../page');
const { t } = await import('@/i18n/is');

const HASH = 'pkce_16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';

type Query = Record<string, string | string[] | undefined>;
const render = async (query: Query) => renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(query) }));
const hidden = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"/>`).exec(html)?.[1];

const SIGNED_OUT = { data: { user: null }, error: { status: 401, code: 'no_authorization', message: 'Auth session missing!' } };
const SIGNED_IN = { data: { user: { id: 'u1', email: 'someone@example.is' } }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(SIGNED_OUT);
});

describe('GET /auth/confirm', () => {
  // Email security scanners open links automatically: opening the link must not use it up.
  it('renders one "Halda áfram" button and verifies nothing', async () => {
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.admin.signOut).not.toHaveBeenCalled();
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

  it('says nothing about a session to a visitor without one', async () => {
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(createEditorClient).toHaveBeenCalledOnce();
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(html).not.toContain(t.confirm.signedIn);
  });

  // Decision 42.2 (Q1): a signed-in visitor is told so; the page itself changes nothing, and the one
  // button is still the only thing that uses the link (and then replaces that session).
  it('tells a signed-in visitor so, still with the one button, without showing the account', async () => {
    auth.getUser.mockResolvedValue(SIGNED_IN);
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(t.confirm.signedIn).toBe('Þú ert þegar skráð/ur inn');
    expect(html).toContain(`>${t.confirm.signedIn}<`);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`>${t.confirm.submit}</button>`);
    expect(html).not.toContain('someone@example.is');
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.admin.signOut).not.toHaveBeenCalled();
    expect(hidden(html, 'token_hash')).toBe(HASH);
  });

  it('shows no notice when the session cannot be checked', async () => {
    auth.getUser.mockRejectedValueOnce(new Error('network failed'));
    expect(await render({ token_hash: HASH, type: 'email' })).not.toContain(t.confirm.signedIn);
    vi.mocked(createEditorClient).mockRejectedValueOnce(new Error('NEXT_PUBLIC_SUPABASE_URL is not set'));
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(html).not.toContain(t.confirm.signedIn);
    expect(html).toContain(`>${t.confirm.submit}</button>`);
  });

  it('sends no referrer, so the token hash in the URL is not passed on', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});
