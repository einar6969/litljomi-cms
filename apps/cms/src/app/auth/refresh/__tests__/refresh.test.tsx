// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const auth = vi.hoisted(() => ({ getSession: vi.fn(), refreshSession: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: vi.fn(() => ({ auth })) }));
const navigation = vi.hoisted(() => ({ goTo: vi.fn(), replaceTo: vi.fn() }));
vi.mock('@/app/login/navigate', () => navigation);

const { LOOP_WINDOW_MS, RefreshSession } = await import('../RefreshSession');
const { default: RefreshPage, metadata } = await import('../page');
const { createBrowserEditorClient } = await import('@/lib/supabase/browser');

/** An access token with the claim `exp` (seconds), as Auth signs it; only its payload is read here. */
const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
const inSeconds = (seconds: number) => Math.floor(Date.now() / 1000) + seconds;
const session = (exp: number) => ({ access_token: token(exp), refresh_token: 'r' });
let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  auth.getSession.mockResolvedValue({ data: { session: session(inSeconds(3600)) }, error: null });
  auth.refreshSession.mockResolvedValue({ data: { session: session(inSeconds(3600)) }, error: null });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

/** Renders the page's component as the server sent it at `serverTime` (by default, the browser's now). */
async function mount(next: string | undefined, serverTime = Date.now()): Promise<void> {
  await act(async () => root?.unmount());
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<RefreshSession next={next} serverTime={serverTime} />));
}

describe('the refresh page (R7)', () => {
  // Creating the browser client refreshes an expired session from the cookies (auth-js recovers the
  // session when it starts); getSession waits for that and gives the result, so the editor's address
  // sends one refresh, not two.
  it('goes back to the page it came from once the browser has the session refreshed', async () => {
    await mount('/t/acme/news?q=1');
    expect(createBrowserEditorClient).toHaveBeenCalledOnce();
    expect(auth.getSession).toHaveBeenCalledOnce();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/t/acme/news?q=1');
    expect(navigation.goTo).not.toHaveBeenCalled();
  });

  it.each([
    ['no session is left', { data: { session: null }, error: null }],
    ['Auth refused the refresh', { data: { session: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' } }],
  ])('goes to /login when %s', async (_case, result) => {
    auth.getSession.mockResolvedValue(result);
    await mount('/t/acme');
    expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it('goes to /login when the client fails', async () => {
    auth.getSession.mockRejectedValue(new Error('network failed'));
    await mount('/t/acme');
    expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/login');
  });

  it.each([
    ['another site', '//evil.example/x', '/'],
    ['an absolute URL', 'https://evil.example/', '/'],
    ['nothing', undefined, '/'],
  ])('never leaves the CMS: %s goes home', async (_case, next, to) => {
    await mount(next);
    expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith(to);
  });

  it('shows nothing, and does nothing while rendered on the server', () => {
    expect(renderToStaticMarkup(<RefreshSession next="/t/acme" serverTime={Date.now()} />)).toBe('');
    expect(createBrowserEditorClient).not.toHaveBeenCalled();
  });

  it('passes the page its `next`, and only a single one, and the server\'s time', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: 1_800_000_000_000 });
    expect(await RefreshPage({ searchParams: Promise.resolve({ next: '/t/acme' }) })).toEqual(<RefreshSession next="/t/acme" serverTime={1_800_000_000_000} />);
    expect(await RefreshPage({ searchParams: Promise.resolve({ next: ['/a', '/b'] }) })).toEqual(<RefreshSession next={undefined} serverTime={1_800_000_000_000} />);
  });

  // The proxy sent the browser here because the access token had expired by the server's clock. A
  // browser whose clock is behind (by more than auth-js's 90 s margin) takes the session for good,
  // and going back with it would only come back here: the page decides by the token's `exp` against
  // the server's time, and then refreshes it itself, once.
  describe('with the browser\'s clock behind the server\'s', () => {
    const SKEW_MS = 10 * 60_000;

    it('refreshes the session itself, once, and goes back with the fresh one', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session(inSeconds(300)) }, error: null });
      await mount('/t/acme', Date.now() + SKEW_MS);
      expect(auth.getSession).toHaveBeenCalledOnce();
      expect(auth.refreshSession).toHaveBeenCalledExactlyOnceWith();
      expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/t/acme');
    });

    it.each([
      ['Auth refuses it', { data: { session: null, user: null }, error: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' } }],
      ['no session comes back', { data: { session: null, user: null }, error: null }],
    ])('goes to /login when %s', async (_case, result) => {
      auth.getSession.mockResolvedValue({ data: { session: session(inSeconds(300)) }, error: null });
      auth.refreshSession.mockResolvedValue(result);
      await mount('/t/acme', Date.now() + SKEW_MS);
      expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/login');
    });

    it('does not refresh a session still good for a while by the server\'s clock', async () => {
      auth.getSession.mockResolvedValue({ data: { session: session(inSeconds(3600)) }, error: null });
      await mount('/t/acme', Date.now() + SKEW_MS);
      expect(auth.refreshSession).not.toHaveBeenCalled();
      expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/t/acme');
    });

    // The proxy reads it the same way, and lets such a session through to Auth (session-expiry.ts).
    it('takes a token it cannot read back as it is', async () => {
      auth.getSession.mockResolvedValue({ data: { session: { access_token: 'not-a-jwt', refresh_token: 'r' } }, error: null });
      await mount('/t/acme', Date.now() + SKEW_MS);
      expect(auth.refreshSession).not.toHaveBeenCalled();
      expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/t/acme');
    });
  });

  // Should the session it went back with be refused as expired again (another clock off, say), the
  // tab would go round through the proxy for ever. Coming back within a short while ends on /login.
  describe('the loop guard', () => {
    it('goes to /login, refreshing nothing, when the tab comes back here soon after going back', async () => {
      await mount('/t/acme');
      await mount('/t/acme');
      expect(auth.getSession).toHaveBeenCalledOnce();
      expect(navigation.replaceTo.mock.calls).toEqual([['/t/acme'], ['/login']]);
    });

    it('is not tripped by a refresh that failed, nor again once it has sent the tab to /login', async () => {
      auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
      await mount('/t/acme');
      await mount('/t/acme');
      await mount('/t/acme');
      await mount('/t/acme');
      expect(auth.getSession).toHaveBeenCalledTimes(3);
      expect(navigation.replaceTo.mock.calls).toEqual([['/login'], ['/t/acme'], ['/login'], ['/t/acme']]);
    });

    it('lets a later expiry refresh as usual', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      await mount('/t/acme');
      vi.setSystemTime(Date.now() + LOOP_WINDOW_MS + 1);
      await mount('/t/acme');
      expect(auth.getSession).toHaveBeenCalledTimes(2);
      expect(navigation.replaceTo.mock.calls).toEqual([['/t/acme'], ['/t/acme']]);
    });

    it('works without the tab\'s storage', async () => {
      const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('denied', 'SecurityError');
      });
      try {
        await mount('/t/acme');
        expect(navigation.replaceTo).toHaveBeenCalledExactlyOnceWith('/t/acme');
      } finally {
        getItem.mockRestore();
        setItem.mockRestore();
      }
    });
  });

  // `next` may be the confirm page's link with its token hash (M3-14).
  it('sends no Referer', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});
