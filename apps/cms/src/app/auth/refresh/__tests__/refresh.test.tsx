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

const { RefreshSession } = await import('../RefreshSession');
const { default: RefreshPage, metadata } = await import('../page');
const { createBrowserEditorClient } = await import('@/lib/supabase/browser');

const SESSION = { access_token: 'a', refresh_token: 'r' };
let root: Root | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: SESSION }, error: null });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.innerHTML = '';
});

async function mount(next: string | undefined): Promise<void> {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root!.render(<RefreshSession next={next} />));
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
    expect(renderToStaticMarkup(<RefreshSession next="/t/acme" />)).toBe('');
    expect(createBrowserEditorClient).not.toHaveBeenCalled();
  });

  it('passes the page its `next`, and only a single one', async () => {
    expect(await RefreshPage({ searchParams: Promise.resolve({ next: '/t/acme' }) })).toEqual(<RefreshSession next="/t/acme" />);
    expect(await RefreshPage({ searchParams: Promise.resolve({ next: ['/a', '/b'] }) })).toEqual(<RefreshSession next={undefined} />);
  });

  // `next` may be the confirm page's link with its token hash (M3-14).
  it('sends no Referer', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});
