import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`REDIRECT ${to}`);
  }),
}));
const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
// A client component with its own tests (ui/__tests__/keep-session-fresh.test.tsx).
vi.mock('@/ui/KeepSessionFresh', () => ({ KeepSessionFresh: () => <i data-keep-session-fresh="" /> }));

const { default: EditorLayout } = await import('../layout');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the editor layout', () => {
  // R7: the browser keeps the session fresh in every open editor tab, from the editor's own address.
  it('renders its children for a signed-in editor, keeping the session fresh', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    expect(renderToStaticMarkup(await EditorLayout({ children: 'child' }))).toBe('<i data-keep-session-fresh=""></i>child');
  });

  it('sends a visitor without a session to the sign-in page', async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401, code: 'no_authorization' } });
    await expect(EditorLayout({ children: 'child' })).rejects.toThrow('REDIRECT /login');
  });
});
