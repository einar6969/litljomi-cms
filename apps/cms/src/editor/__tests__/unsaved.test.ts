// @vitest-environment jsdom
// M2-17: the tab's copy of unsaved changes (spec §4.4). It is in sessionStorage only, under the
// user's own key, reads back only what it wrote, never throws, and sign-out (in this tab or another)
// removes every copy and nothing else.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { announceSignOut, clearUnsavedCopies, onSignOut, SIGN_OUT_CHANNEL, UNSAVED_KEY_PREFIX, unsavedKey, unsavedStore } from '../unsaved';

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';
const USER = '00000000-0000-4000-8000-0000000000b1';
const OTHER_USER = '00000000-0000-4000-8000-0000000000b2';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('the unsaved store', () => {
  it('writes, reads back and clears one entry\'s copy in sessionStorage, never localStorage', () => {
    const store = unsavedStore(USER);
    store.write(ENTRY, { version: 4, data: { title: 'Óvistað' } });
    expect(store.read(ENTRY)).toEqual({ version: 4, data: { title: 'Óvistað' } });
    expect(store.read(OTHER)).toBeNull();
    expect(sessionStorage.getItem(unsavedKey(USER, ENTRY))).not.toBeNull();
    expect(localStorage.length).toBe(0);
    store.clear(ENTRY);
    expect(store.read(ENTRY)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    ['broken JSON', '{'],
    ['no data', JSON.stringify({ version: 2 })],
    ['data that is not an object', JSON.stringify({ version: 2, data: ['x'] })],
    ['a version that is not a positive integer', JSON.stringify({ version: 0, data: {} })],
    ['a version that is a string', JSON.stringify({ version: '2', data: {} })],
  ])('reads %s as no copy and removes it', (_name, raw) => {
    sessionStorage.setItem(unsavedKey(USER, ENTRY), raw);
    expect(unsavedStore(USER).read(ENTRY)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('never throws when the storage refuses, and reads nothing from a missing one', () => {
    const refusing = {
      get length(): number {
        throw new Error('SecurityError');
      },
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
      key: () => null,
      clear: () => undefined,
    } as Storage;
    const store = unsavedStore(USER, refusing);
    expect(() => store.write(ENTRY, { version: 1, data: {} })).not.toThrow();
    expect(store.read(ENTRY)).toBeNull();
    expect(() => store.clear(ENTRY)).not.toThrow();
    expect(() => clearUnsavedCopies(refusing)).not.toThrow();

    const none = unsavedStore(USER, null);
    none.write(ENTRY, { version: 1, data: {} });
    expect(none.read(ENTRY)).toBeNull();
  });
});

describe('one user\'s copies', () => {
  it('are kept under a key with the user\'s ID and never read by another user', () => {
    unsavedStore(USER).write(ENTRY, { version: 4, data: { title: 'Mitt' } });
    expect(sessionStorage.getItem(`${UNSAVED_KEY_PREFIX}${USER}:${ENTRY}`)).not.toBeNull();
    expect(sessionStorage.getItem(`${UNSAVED_KEY_PREFIX}${ENTRY}`)).toBeNull();
    expect(unsavedStore(OTHER_USER).read(ENTRY)).toBeNull();
    unsavedStore(OTHER_USER).clear(ENTRY);
    expect(unsavedStore(USER).read(ENTRY)).toEqual({ version: 4, data: { title: 'Mitt' } });
  });

  it('a copy without a user in its key (as before M2-17 was fixed) is never read', () => {
    sessionStorage.setItem(`${UNSAVED_KEY_PREFIX}${ENTRY}`, JSON.stringify({ version: 1, data: { title: 'Hvers?' } }));
    expect(unsavedStore(USER).read(ENTRY)).toBeNull();
  });

  it('without a user ID there is no store', () => {
    const store = unsavedStore('');
    store.write(ENTRY, { version: 1, data: {} });
    expect(sessionStorage.length).toBe(0);
    expect(store.read(ENTRY)).toBeNull();
  });
});

describe('clearUnsavedCopies (sign-out)', () => {
  it('removes every unsaved copy in the tab and leaves other keys', () => {
    const store = unsavedStore(USER);
    store.write(ENTRY, { version: 1, data: { a: 1 } });
    store.write(OTHER, { version: 7, data: { b: 2 } });
    unsavedStore(OTHER_USER).write(ENTRY, { version: 2, data: { c: 3 } });
    sessionStorage.setItem('something-else', 'kept');
    clearUnsavedCopies();
    expect(store.read(ENTRY)).toBeNull();
    expect(store.read(OTHER)).toBeNull();
    expect(sessionStorage.getItem('something-else')).toBe('kept');
    expect(sessionStorage.length).toBe(1);
  });
});

describe('sign-out across the browser\'s tabs', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it('a sign-out announced in another tab removes this tab\'s copies and tells its listeners', async () => {
    unsavedStore(USER).write(ENTRY, { version: 1, data: { a: 1 } });
    sessionStorage.setItem('something-else', 'kept');
    const listener = vi.fn();
    cleanups.push(onSignOut(listener));
    const otherTab = new BroadcastChannel(SIGN_OUT_CHANNEL);
    otherTab.postMessage('signed-out');
    otherTab.close();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    expect(unsavedStore(USER).read(ENTRY)).toBeNull();
    expect(sessionStorage.getItem('something-else')).toBe('kept');
  });

  it('a message that is not a sign-out changes nothing', async () => {
    unsavedStore(USER).write(ENTRY, { version: 1, data: { a: 1 } });
    const listener = vi.fn();
    cleanups.push(onSignOut(listener));
    const otherTab = new BroadcastChannel(SIGN_OUT_CHANNEL);
    otherTab.postMessage({ type: 'signed-out' });
    otherTab.postMessage('signed-out');
    otherTab.close();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
  });

  it('announceSignOut removes the tab\'s copies, tells this tab\'s listeners once and the other tabs', async () => {
    unsavedStore(USER).write(ENTRY, { version: 1, data: { a: 1 } });
    const listener = vi.fn();
    cleanups.push(onSignOut(listener));
    const received: unknown[] = [];
    const otherTab = new BroadcastChannel(SIGN_OUT_CHANNEL);
    otherTab.onmessage = (event: MessageEvent) => received.push(event.data);
    cleanups.push(() => otherTab.close());
    announceSignOut();
    expect(sessionStorage.length).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(received).toEqual(['signed-out']));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a removed listener is not called', async () => {
    const listener = vi.fn();
    onSignOut(listener)();
    announceSignOut();
    expect(listener).not.toHaveBeenCalled();
  });
});
