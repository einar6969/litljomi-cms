import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => ({ auth })) }));
const step = vi.hoisted(() => ({ readPasswordStep: vi.fn(), clearPasswordStep: vi.fn() }));
vi.mock('../step', () => step);

const { finishPasswordStep } = await import('../actions');

const TOKEN = 'eyJlink.access.token';

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: { access_token: TOKEN } }, error: null });
  // As the real one: a step only for the session's access token.
  step.readPasswordStep.mockImplementation(async (token?: string) => (token === TOKEN ? { sessionId: 's', next: '/t/acme/news' } : null));
  step.clearPasswordStep.mockResolvedValue(undefined);
});

describe('finishPasswordStep (PW-03)', () => {
  it('ends the step of the session and gives where the editor was going', async () => {
    await expect(finishPasswordStep()).resolves.toBe('/t/acme/news');
    expect(step.readPasswordStep).toHaveBeenCalledExactlyOnceWith(TOKEN);
    expect(step.clearPasswordStep).toHaveBeenCalledOnce();
  });

  it('re-checks the stored path', async () => {
    step.readPasswordStep.mockResolvedValue({ sessionId: 's', next: '//evil.example' });
    await expect(finishPasswordStep()).resolves.toBe('/');
  });

  it.each([
    ['there is no step for the session', () => step.readPasswordStep.mockResolvedValue(null)],
    ['there is no session', () => auth.getSession.mockResolvedValue({ data: { session: null }, error: null })],
  ])('gives / and still ends any step when %s', async (_case, arrange) => {
    arrange();
    await expect(finishPasswordStep()).resolves.toBe('/');
    expect(step.clearPasswordStep).toHaveBeenCalledOnce();
  });

  it('takes nothing: the password never reaches the CMS', () => {
    expect(finishPasswordStep.length).toBe(0);
  });
});
