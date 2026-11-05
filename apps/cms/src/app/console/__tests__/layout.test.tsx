import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const access = vi.hoisted(() => ({ consoleAccess: vi.fn() }));
vi.mock('@/lib/console-access', () => access);
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));

const { default: ConsoleLayout } = await import('../layout');
const { default: GatedLayout } = await import('../(gated)/layout');
const { default: ConsolePage } = await import('../(gated)/page');

const SIGNED_IN = { data: { user: { id: 'u1' } }, error: null };
const SIGNED_OUT = { data: { user: null }, error: { status: 401, code: 'no_authorization' } };

beforeEach(() => {
  vi.clearAllMocks();
  auth.getUser.mockResolvedValue(SIGNED_IN);
});

describe('the console layout', () => {
  it('answers 404 for someone who is not a platform admin', async () => {
    access.consoleAccess.mockResolvedValue('none');
    await expect(ConsoleLayout({ children: 'child' })).rejects.toThrow('NOT_FOUND');
  });

  it('sends a visitor without a session to the sign-in page, without asking for access', async () => {
    auth.getUser.mockResolvedValue(SIGNED_OUT);
    await expect(ConsoleLayout({ children: 'child' })).rejects.toThrow('REDIRECT /login');
    expect(access.consoleAccess).not.toHaveBeenCalled();
  });

  it.each(['needs_mfa', 'ok'])('renders its children for %s, marked as English', async (level) => {
    access.consoleAccess.mockResolvedValue(level);
    const html = renderToStaticMarkup(await ConsoleLayout({ children: 'child' }));
    expect(html).toBe('<div lang="en">child</div>');
  });
});

describe('the gated layout', () => {
  it('sends an admin at aal1 to /console/mfa', async () => {
    access.consoleAccess.mockResolvedValue('needs_mfa');
    await expect(GatedLayout({ children: 'child' })).rejects.toThrow('REDIRECT /console/mfa');
  });

  it('renders its children at aal2', async () => {
    access.consoleAccess.mockResolvedValue('ok');
    expect(renderToStaticMarkup(await GatedLayout({ children: 'child' }))).toBe('child');
  });

  it('does not redirect for none: the console layout answers 404', async () => {
    access.consoleAccess.mockResolvedValue('none');
    await expect(GatedLayout({ children: 'child' })).resolves.toBeDefined();
  });
});

describe('the console page', () => {
  it('is a heading until M4-05 fills it in', () => {
    expect(renderToStaticMarkup(ConsolePage())).toContain('<h1>Console</h1>');
  });
});
