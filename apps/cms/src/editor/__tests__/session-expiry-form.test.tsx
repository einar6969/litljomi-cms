// @vitest-environment jsdom
// M2-17: the form when the session expires mid-edit (spec §4.4, §13.2 "session expiry loses no
// work"). An expired-session answer keeps the values on the screen and in the tab, shows the
// sign-in prompt, and once the same editor has signed in elsewhere the save goes through with every
// edit; another account's session never saves them. A reload of the tab brings the values back with
// a notice, saved only when the editor chooses; signing out, here or in another tab, removes them.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
// The account the browser's session belongs to, or null when there is none.
const browser = vi.hoisted(() => ({ user: null as string | null }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => actions);
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: vi.fn(), assetPreviewAction: vi.fn(), updateAssetAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({
  createBrowserEditorClient: () => ({
    auth: {
      getUser: async () =>
        browser.user !== null
          ? { data: { user: { id: browser.user } }, error: null }
          : { data: { user: null }, error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError', status: 400 }) },
    },
  }),
}));

const { EntryForm } = await import('../form/EntryForm');
const { SignOutForm } = await import('@/ui/SignOutForm');
const { RESUME_POLL_MS } = await import('../autosave');
const { SIGN_OUT_CHANNEL, UNSAVED_KEY_PREFIX, unsavedKey } = await import('../unsaved');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000b2';
const KEY = unsavedKey(USER, ENTRY);
const FIELDS = [
  { key: 'title', kind: 'text', label: 'Titill', required: true },
  { key: 'excerpt', kind: 'text', label: 'Inngangur', required: false, multiline: true },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  sessionStorage.clear();
  browser.user = null;
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

async function click(label: string) {
  const button = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!button) throw new Error(`no button ${label}`);
  await act(async () => {
    button.click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

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
      <EntryForm tenant={TENANT} userId={USER} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={initialVersion} initialSlug={null} slugLocked={false} />,
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

  it('a refused save with a good session (the editor was removed, M4-01) keeps the values on the screen and in the tab, and asks for no sign-in', async () => {
    browser.user = USER;
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'error' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    expect(alert()?.textContent).toContain(t.editor.error);
    expect(alert()?.textContent).not.toContain(t.editor.signedOut);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Nýr titill');
    expect(stored()).toEqual({ version: 3, data: { title: 'Nýr titill' } });

    // Editing goes on, and every edit is kept.
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Inngangur');
    await pause();
    expect(stored()).toEqual({ version: 3, data: { title: 'Nýr titill', excerpt: 'Inngangur' } });
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

    browser.user = USER;
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await pause(RESUME_POLL_MS);
    expect(actions.saveDraftAction).toHaveBeenLastCalledWith(ENTRY, 3, { title: 'Nýr titill', excerpt: 'Inngangur' }, USER);
    expect(alert()).toBeNull();
    expect(status()?.textContent).toBe(t.editor.saved);
    expect(stored()).toBeNull();
  });

  it('coming back to the tab after signing in saves at once', async () => {
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'auth' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    browser.user = USER;
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(2);
    expect(status()?.textContent).toBe(t.editor.saved);
  });

  it('another account signed in elsewhere never saves the editor\'s edits', async () => {
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'auth' });
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    expect(alert()?.textContent).toContain(t.editor.signedOut);

    browser.user = OTHER_USER;
    await pause(RESUME_POLL_MS * 2);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await vi.advanceTimersByTimeAsync(0);
    });
    // Only the first, refused save: the check never lets another account's session save them.
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
    expect(alert()?.textContent).toContain(t.editor.signedOut);
    expect(stored()).toEqual({ version: 3, data: { title: 'Nýr titill' } });
    // Every save names the editor the page was rendered for, so the server refuses it for another account.
    expect(actions.saveDraftAction).toHaveBeenCalledWith(ENTRY, 3, { title: 'Nýr titill' }, USER);
  });

  it('keeps each editor\'s copy under their own key: another user\'s copy is never shown or saved', async () => {
    sessionStorage.setItem(unsavedKey(OTHER_USER, ENTRY), JSON.stringify({ version: 3, data: { title: 'Annars manns' } }));
    sessionStorage.setItem(`${UNSAVED_KEY_PREFIX}${ENTRY}`, JSON.stringify({ version: 3, data: { title: 'Án notanda' } }));
    await renderForm(3);
    await pause(0);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Upphaf');
    expect(alert()).toBeNull();
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'auth' });
    await type($<HTMLInputElement>('#field-title')!, 'Mitt');
    await pause();
    expect(stored()).toEqual({ version: 3, data: { title: 'Mitt' } });
    expect(JSON.parse(sessionStorage.getItem(unsavedKey(OTHER_USER, ENTRY))!)).toEqual({ version: 3, data: { title: 'Annars manns' } });
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Mitt' }, USER);
  });

  it('a reload of the tab brings the values back with a notice, and saves nothing until the editor chooses to', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 3, data: { title: 'Frá því áðan', excerpt: 'Óvistað' } }));
    await renderForm(3);
    await pause(0);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Frá því áðan');
    expect($<HTMLTextAreaElement>('#field-excerpt')!.value).toBe('Óvistað');
    expect(alert()?.textContent).toContain(t.editor.restoredCopy);
    expect(alert()?.textContent).toContain(t.editor.restoredCopyBody);
    // Nothing is saved by itself, not even after an edit or a long wait.
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Óvistað, meira');
    await pause(RESUME_POLL_MS * 2);
    expect(actions.saveDraftAction).not.toHaveBeenCalled();
    expect(stored()).toEqual({ version: 3, data: { title: 'Frá því áðan', excerpt: 'Óvistað, meira' } });
    // Publishing waits for the choice too: it would publish the saved draft, not what is on the screen.
    const publish = [...container.querySelectorAll('button')].find((b) => b.textContent === t.publish.publish);
    expect(publish?.disabled).toBe(true);

    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await click(t.editor.restoredCopySave);
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Frá því áðan', excerpt: 'Óvistað, meira' }, USER);
    expect(status()?.textContent).toBe(t.editor.saved);
    expect(alert()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('dropping a restored copy brings back the saved draft and removes the copy, saving nothing', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 2, data: { title: 'Frá því áðan' } }));
    await renderForm(3);
    await pause(0);
    await click(t.editor.restoredCopyDiscard);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Upphaf');
    expect(alert()).toBeNull();
    expect(stored()).toBeNull();
    // The next edit is saved at the loaded draft's version.
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 4 });
    await type($<HTMLInputElement>('#field-title')!, 'Nýtt');
    await pause();
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Nýtt' }, USER);
  });

  it('a restored copy older than the draft, once the editor saves it, opens the conflict view instead of overwriting it', async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ version: 3, data: { title: 'Frá því áðan' } }));
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'version_conflict' });
    actions.loadDraftAction.mockResolvedValue({ ok: true, version: 5, data: { title: 'Annar breytti' } });
    await renderForm(5);
    await pause(0);
    expect(actions.saveDraftAction).not.toHaveBeenCalled();
    await click(t.editor.restoredCopySave);
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Frá því áðan' }, USER);
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

  it('a sign-out in another tab removes this tab\'s copies and the form\'s unsaved changes', async () => {
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'auth' });
    sessionStorage.setItem(unsavedKey(USER, '00000000-0000-4000-8000-0000000000e9'), JSON.stringify({ version: 1, data: { title: 'Önnur færsla' } }));
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    expect(stored()).not.toBeNull();

    const otherTab = new BroadcastChannel(SIGN_OUT_CHANNEL);
    otherTab.postMessage('signed-out');
    otherTab.close();
    await act(async () => vi.waitFor(() => expect(sessionStorage.length).toBe(0)));
    expect(alert()?.textContent).toContain(t.editor.signedOut);

    // Editing after the sign-out keeps nothing in the tab, and the form saves nothing more.
    browser.user = USER;
    await type($<HTMLInputElement>('#field-title')!, 'Eftir útskráningu');
    await pause(RESUME_POLL_MS * 2);
    expect(stored()).toBeNull();
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
  });

  it('signing out in this tab tells the browser\'s other tabs, and the form drops its changes', async () => {
    const received: unknown[] = [];
    const otherTab = new BroadcastChannel(SIGN_OUT_CHANNEL);
    otherTab.onmessage = (event: MessageEvent) => received.push(event.data);
    actions.saveDraftAction.mockResolvedValue({ ok: false, code: 'auth' });
    const signOut = vi.fn(async () => {});
    await act(async () =>
      root.render(
        <>
          <SignOutForm signOut={signOut} />
          <EntryForm tenant={TENANT} userId={USER} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={3} initialSlug={null} slugLocked={false} />
        </>,
      ),
    );
    await type($<HTMLInputElement>('#field-title')!, 'Nýr titill');
    await pause();
    expect(stored()).not.toBeNull();
    await act(async () => {
      [...container.querySelectorAll('form')].find((f) => f.textContent === t.app.signOut)!.requestSubmit();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(stored()).toBeNull();
    await act(async () => vi.waitFor(() => expect(received).toEqual(['signed-out'])));
    otherTab.close();
    browser.user = USER;
    await pause(RESUME_POLL_MS * 2);
    expect(stored()).toBeNull();
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
  });

  it('a save in flight when the editor signs out does not bring the copy back', async () => {
    let finish!: (result: { ok: true; version: number }) => void;
    actions.saveDraftAction.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    await renderForm();
    await type($<HTMLInputElement>('#field-title')!, 'Á leiðinni');
    await pause();
    expect(status()?.textContent).toBe(t.editor.saving);
    // An edit during the save: without the sign-out, the answer would store it as the next copy.
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Skrifað á meðan');
    const { announceSignOut } = await import('../unsaved');
    await act(async () => announceSignOut());
    expect(stored()).toBeNull();
    await act(async () => {
      finish({ ok: true, version: 4 });
      await vi.advanceTimersByTimeAsync(0);
    });
    await pause(RESUME_POLL_MS);
    expect(stored()).toBeNull();
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
  });
});
