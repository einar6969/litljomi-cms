import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const session = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock('@/lib/supabase/proxy', () => session);

const { config, proxy } = await import('../proxy');

const SUPABASE = 'http://127.0.0.1:54321';
const request = (path = '/t/labak') => new NextRequest(`http://localhost:3100${path}`);
const nonceOf = (policy: string | null) => /'nonce-([^']+)'/.exec(policy ?? '')?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE);
  session.updateSession.mockImplementation(async (req: NextRequest) => NextResponse.next({ request: req }));
});

describe('proxy', () => {
  it('puts the policy on the response and on the request Next.js renders, with the same nonce', async () => {
    const req = request();
    const response = await proxy(req);
    const policy = response.headers.get('content-security-policy');
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain(`connect-src 'self' ${SUPABASE}`);
    expect(nonceOf(policy)).toBeDefined();
    // Next.js takes the nonce for its own scripts from the request's policy; the override reaches the page.
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(req.headers.get('content-security-policy')).toBe(policy);
  });

  it('uses a new nonce for every request', async () => {
    const first = await proxy(request());
    const second = await proxy(request());
    expect(nonceOf(first.headers.get('content-security-policy'))).not.toBe(nonceOf(second.headers.get('content-security-policy')));
  });

  it('puts the policy on a redirect to sign in as well', async () => {
    session.updateSession.mockResolvedValue(NextResponse.redirect('http://localhost:3100/login'));
    const response = await proxy(request());
    expect(response.status).toBe(307);
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('is not matched on /api routes: they keep their own headers', () => {
    const [source] = config.matcher;
    expect(source!.startsWith('/((?!api/|')).toBe(true);
  });
});
