import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const auth = vi.hoisted(() => ({ exchangeCodeForSession: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { GET } = await import('../route');

const ORIGIN = 'http://localhost:3100';
const callback = (query: string) => GET(new NextRequest(`${ORIGIN}/auth/callback${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  auth.exchangeCodeForSession.mockResolvedValue({ data: { session: {} }, error: null });
});

describe('GET /auth/callback', () => {
  it('exchanges the code and redirects to the editor home', async () => {
    const response = await callback('?code=abc');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('abc');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
  });

  it('redirects to a same-origin `next` path', async () => {
    const response = await callback(`?code=abc&next=${encodeURIComponent('/t/acme?x=1')}`);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/t/acme?x=1`);
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example/', '/\t/evil.example', 'javascript:alert(1)'])(
    'never redirects off the origin: next=%j goes to /',
    async (next) => {
      const response = await callback(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(response.headers.get('location')).toBe(`${ORIGIN}/`);
    },
  );

  it('sends a missing code back to the sign-in page without calling Auth', async () => {
    const response = await callback('');
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=link`);
  });

  it.each([
    ['answers an error', () => auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { status: 403, code: 'flow_state_not_found' } })],
    ['throws', () => auth.exchangeCodeForSession.mockRejectedValue(new Error('network'))],
  ])('sends the editor back to the sign-in page when the exchange %s', async (_case, arrange) => {
    arrange();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await callback(`?code=abc&next=${encodeURIComponent('/t/acme')}`);
    expect(response.headers.get('location')).toBe(`${ORIGIN}/login?error=link`);
  });
});
