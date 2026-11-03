// @vitest-environment jsdom
// M2-17: the form when the session expires mid-edit (spec §4.4, §13.2 "session expiry loses no
// work"). An expired-session answer keeps the values on the screen and in the tab, shows the
// sign-in prompt, and once the editor has signed in elsewhere the save goes through with every
// edit. A reload of the tab brings the values back; signing out removes them from the tab.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn() }));
const browser = vi.hoisted(() => ({ signedIn: false }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => actions);
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: vi.fn(), assetPreviewAction: vi.fn(), updateAssetAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserEditorClient: () => ({
    auth: {
      getUser: async () =>
        browser.signedIn
          ? { data: { user: { id: 'u' } }, error: null }
          : { data: { user: null }, error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }) },
    },
  }),
}));

const { EntryForm } = await import('../form/EntryForm');
const { SignOutForm } = await import('@/ui/SignOutForm');
const { RESUME_POLL_MS } = await import('../autosave');
const { UNSAVED_KEY_PREFIX } = await import('../unsaved');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const KEY = `${UNSAVED_KEY_PREFIX}${ENTRY}`;
const FIELDS = [
  { key: 'title', kind: 'text', label: 'Titill', required: true },
  { key: 'excerpt', kind: 'text', label: 'Inngangur', required: false, multiline: true },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  sessionStorage.clear();
  browser.signedIn = false;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const alert = () => container.querySelector<HTMLElement>('[role="alert"]');
const status = () => container.querySelector<HTMLElement>('[role="status"]');
const pause = (ms = 1500) => act(async () => vi.advanceTimersByTimeAsync(ms));
const stored = () => {
  const raw = sessionStorage.getItem(KEY);
  return raw === null ? null : (JSON.parse(raw) as unknown);
};

async function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function renderForm(initialVersion = 3) {
  await act(async () =>
    root.render(
      <EntryForm tenant={TENANT} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={initialVersion} initialSlug={null} slugLocked={false} />,
    ),
  );
}

describe('session expiry in the form (M2-17)', () => {
  it('an expired-session answer keeps the values on the screen and in the tab, and shows the sign-in prompt', async () => {
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'auth' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    expect(alert()?.textContent).toContain(t.editor.signedOut);
    expect(alert()?.textContent).toContain(t.editor.signedOutBody);
    const signIn = [...container.querySelectorAll('a')].find((a) => a.textContent === t.editor.signIn);
    expect(signIn?.getAttribute('href')).toBe('/login');
    expect(signIn?.getAttribute('target')).toBe('_blank');
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Nýr titill');
    expect(stored()).toEqual({ version: 3, data: { title: 'Nýr titill' } });

    // Editing goes on while signed out; every edit is kept.
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Inngangur');
    await pause();
    expect(stored()).toEqual({ version: 3, data: { title: 'Nýr titill', excerpt: 'Inngangur' } });
    expect(localStorage.length).toBe(0);
  });

  it('after signing in in another tab, the save goes through by itself with every edit and the tab\'s copy is removed', async () => {
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'auth' }).mockResolvedValueOnce({ ok: false, code: 'auth' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Inngangur');
    await pause();
    expect(alert()?.textContent).toContain(t.editor.signedOut);

    // Still signed out: the periodic check saves nothing.
    await pause(RESUME_POLL_MS);
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(2);

    browser.signedIn = true;
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await pause(RESUME_POLL_MS);
    expect(actions.saveDraftAction).toHaveBeenLastCalledWith(ENTRY, 3, { title: 'Nýr titill', excerpt: 'Inngangur' });
    expect(alert()).toBeNull();
    expect(status()?.textContent).toBe(t.editor.saved);
    expect(stored()).toBeNull();
  });

  it('coming back to the tab after signing in saves at once', async () => {
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'auth' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    browser.signedIn = true;
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(2);
    expect(status()?.textContent).toBe(t.editor.saved);
  });

  it('a reload of the tab brings the values back and saves them at the version they were made on', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 3, data: { title: 'Frá því áðan', excerpt: 'Óvistað' } }));
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await renderForm(3);
    await pause(0);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Frá því áðan');
    expect($<HTMLTextAreaElement>('#field-excerpt')!.value).toBe('Óvistað');
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Frá því áðan', excerpt: 'Óvistað' });
    expect(stored()).toBeNull();
  });

  it('a restored copy older than the draft opens the conflict view instead of overwriting it', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 3, data: { title: 'Frá því áðan' } }));
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'version_conflict' });
    actions.loadDraftAction.mockResolvedValue({ ok: true, version: 5, data: { title: 'Annar breytti' } });
    await renderForm(5);
    await pause(0);
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Frá því áðan' });
    expect(alert()?.textContent).toContain(t.editor.conflict);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Frá því áðan');
    expect(stored()).toEqual({ version: 3, data: { title: 'Frá því áðan' } });
  });
});

describe('signing out (M2-17)', () => {
  it('removes every unsaved copy from the tab before the sign-out action runs', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 3, data: { title: 'Óvistað' } }));
    sessionStorage.setItem('other', 'kept');
    let storedWhenSignedOut: string | null = 'not called';
    const signOut = vi.fn(async () => {
      storedWhenSignedOut = sessionStorage.getItem(KEY);
    });
    await act(async () => root.render(<SignOutForm signOut={signOut} />));
    await act(async () => {
      $<HTMLFormElement>('form')!.requestSubmit();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(storedWhenSignedOut).toBeNull();
    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(sessionStorage.getItem('other')).toBe('kept');
  });
});
