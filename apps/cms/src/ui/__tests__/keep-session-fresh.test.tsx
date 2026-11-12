// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// React's act() warns unless the environment says it is a test.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: vi.fn(() => ({ auth: {} })) }));

const { KeepSessionFresh } = await import('../KeepSessionFresh');
const { createBrowserEditorClient } = await import('@/lib/supabase/browser');

let root: Root | undefined;
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
});

describe('KeepSessionFresh (R7)', () => {
  // The browser client refreshes the session itself while the tab is open (auth-js), from the
  // editor's own address. @supabase/ssr keeps one browser client per tab.
  it('starts the browser client once when the page mounts, not on every render', async () => {
    root = createRoot(document.createElement('div'));
    await act(async () => root!.render(<KeepSessionFresh />));
    await act(async () => root!.render(<KeepSessionFresh />));
    await act(async () => root!.render(<KeepSessionFresh />));
    expect(createBrowserEditorClient).toHaveBeenCalledOnce();
  });

  it('shows nothing, and starts nothing on the server', () => {
    expect(renderToStaticMarkup(<KeepSessionFresh />)).toBe('');
    expect(createBrowserEditorClient).not.toHaveBeenCalled();
  });
});
