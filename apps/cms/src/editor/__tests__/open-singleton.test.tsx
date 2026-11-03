// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const replace = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
const openSingletonAction = vi.fn();
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ openSingletonAction: (...a: unknown[]) => openSingletonAction(...a) }));

const { OpenSingleton } = await import('../OpenSingleton');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  replace.mockReset();
  openSingletonAction.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = async () => {
  await act(async () => root.render(<OpenSingleton tenantSlug="acme" type="settings" />));
};

describe('OpenSingleton (M2-09; spec §10.1)', () => {
  it('opens the type\'s one entry and replaces the page with its form', async () => {
    openSingletonAction.mockResolvedValue({ ok: true, entryId: ENTRY });
    await mount();
    expect(openSingletonAction).toHaveBeenCalledWith('acme', 'settings');
    expect(replace).toHaveBeenCalledWith(`/t/acme/settings/${ENTRY}`);
  });

  it('shows a status while opening', async () => {
    openSingletonAction.mockReturnValue(new Promise(() => {}));
    await mount();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t.singleton.opening);
  });

  it('shows an error and retries on request', async () => {
    openSingletonAction.mockResolvedValueOnce({ ok: false, code: 'error' }).mockResolvedValueOnce({ ok: true, entryId: ENTRY });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.singleton.openFailed);
    expect(replace).not.toHaveBeenCalled();
    const retry = container.querySelector('button')!;
    expect(retry.textContent).toBe(t.editor.retry);
    await act(async () => retry.click());
    expect(openSingletonAction).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledWith(`/t/acme/settings/${ENTRY}`);
  });

  it('says the session expired on auth, and treats a thrown action as the generic error', async () => {
    openSingletonAction.mockResolvedValueOnce({ ok: false, code: 'auth' });
    await mount();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.editor.signedOut);
    openSingletonAction.mockRejectedValueOnce(new Error('network'));
    await act(async () => container.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.singleton.openFailed);
  });
});
