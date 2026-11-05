import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ verifyOtp: vi.fn(), getUser: vi.fn(), admin: { signOut: vi.fn() } }));
const detached = vi.hoisted(() => ({ verifyOtp: vi.fn(), getUser: vi.fn(), admin: { signOut: vi.fn() } }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })), createDetachedClient: vi.fn(() => ({ auth: detached })) }));
const pending = vi.hoisted(() => ({ readPending: vi.fn() }));
vi.mock('../pending', () => pending);

const { createEditorClient } = await import('@/lib/supabase/server');
const { default: ConfirmPage, metadata } = await import('../page');
const { t } = await import('@/i18n/is');

const HASH = 'pkce_16b012167d533434e7798fb52bd2c600ea40eac016b347f9d5dd10f3';

type Query = Record<string, string | string[] | undefined>;
const render = async (query: Query) => renderToStaticMarkup(await ConfirmPage({ searchParams: Promise.resolve(query) }));
const hidden = (html: string, name: string) => new RegExp(`<input type="hidden" name="${name}" value="([^"]*)"/>`).exec(html)?.[1];

const SIGNED_OUT = { data: { user: null }, error: { status: 401, code: 'no_authorization', message: 'Auth session missing!' } };
const SIGNED_IN = { data: { user: { id: 'u1', email: 'someone@example.is' } }, error: null };

const PENDING = { accessToken: 'eyJpending.access.token', refreshToken: 'pending-refresh', next: '/t/labak' };
const LINK_ACCOUNT = { data: { user: { id: 'u2', email: 'link-owner@example.is' } }, error: null };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(SIGNED_OUT);
  detached.getUser.mockResolvedValue(LINK_ACCOUNT);
  pending.readPending.mockResolvedValue(null);
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

  // Both addresses' links land here (spec §4.4): a scanner opening either confirms nothing.
  it('asks for the email change link\'s POST in its own words, verifying nothing', async () => {
    auth.getUser.mockResolvedValue(SIGNED_IN);
    const html = await render({ token_hash: HASH, type: 'email_change' });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(detached.verifyOtp).not.toHaveBeenCalled();
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(t.confirm.emailChangeTitle);
    expect(html).toContain(t.confirm.emailChangeIntro);
    expect(html).not.toContain(t.confirm.title);
    expect(html).not.toContain(t.confirm.signedIn);
    expect(hidden(html, 'token_hash')).toBe(HASH);
    expect(hidden(html, 'type')).toBe('email_change');
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
    expect(html).toContain(`>${t.confirm.signedIn}</span> ${t.confirm.signedInDetail}<`);
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

// M3-14: a signed-in visitor whose link is for another account comes back here, without a query,
// with that link's session held aside; the page names the link's account and asks.
describe('GET /auth/confirm with a pending link session (M3-14)', () => {
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

  it('names the account the link signs in to, as Auth reports it, and asks before replacing', async () => {
    pending.readPending.mockResolvedValue(PENDING);
    auth.getUser.mockResolvedValue(SIGNED_IN);
    const html = await render({});
    expect(detached.getUser).toHaveBeenCalledExactlyOnceWith(PENDING.accessToken);
    expect(html).toContain(`<h1>${t.confirm.replaceTitle}</h1>`);
    expect(html).toContain(`${t.confirm.replaceAccount} <strong>link-owner@example.is</strong>.`);
    expect(html).toContain(t.confirm.replaceDetail);
    expect(buttons(html)).toEqual([t.confirm.replace, t.confirm.keep]);
    // The visitor's own account is not named, and nothing is verified, revoked or carried in the page.
    expect(html).not.toContain('someone@example.is');
    expect(html).not.toContain(PENDING.accessToken);
    expect(html).not.toContain(PENDING.refreshToken);
    expect(html).not.toContain('type="hidden"');
    for (const client of [auth, detached]) {
      expect(client.verifyOtp).not.toHaveBeenCalled();
      expect(client.admin.signOut).not.toHaveBeenCalled();
    }
  });

  it('escapes the account it names', async () => {
    pending.readPending.mockResolvedValue(PENDING);
    detached.getUser.mockResolvedValue({ data: { user: { id: 'u2', email: '<b>x</b>@example.is' } }, error: null });
    const html = await render({});
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;@example.is</strong>');
  });

  it.each([
    ['Auth refuses the pending session', () => detached.getUser.mockResolvedValue(SIGNED_OUT)],
    ['Auth throws', () => detached.getUser.mockRejectedValue(new Error('network failed'))],
    ['the account has no email', () => detached.getUser.mockResolvedValue({ data: { user: { id: 'u2', email: '' } }, error: null })],
    ['the cookie cannot be read', () => pending.readPending.mockRejectedValue(new Error('cookies() outside a request'))],
  ])('asks nothing when %s: the plain confirm page instead', async (_case, arrange) => {
    pending.readPending.mockResolvedValue(PENDING);
    arrange();
    const html = await render({});
    expect(html).toContain(`<h1>${t.confirm.title}</h1>`);
    expect(buttons(html)).toEqual([t.confirm.submit]);
    expect(html).not.toContain(t.confirm.replaceTitle);
  });

  it('shows a newly opened link\'s page, not the question, when the address has a token hash', async () => {
    pending.readPending.mockResolvedValue(PENDING);
    const html = await render({ token_hash: HASH, type: 'email' });
    expect(pending.readPending).not.toHaveBeenCalled();
    expect(buttons(html)).toEqual([t.confirm.submit]);
    expect(hidden(html, 'token_hash')).toBe(HASH);
  });

  it('asks nothing without a pending session', async () => {
    const html = await render({});
    expect(detached.getUser).not.toHaveBeenCalled();
    expect(buttons(html)).toEqual([t.confirm.submit]);
  });
});
