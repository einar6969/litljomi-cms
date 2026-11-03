// @vitest-environment jsdom
// M2-17: the tab's copy of unsaved changes (spec §4.4). It is in sessionStorage only, reads back
// only what it wrote, never throws, and sign-out removes every copy and nothing else.
import { beforeEach, describe, expect, it } from 'vitest';
import { clearUnsavedCopies, UNSAVED_KEY_PREFIX, unsavedStore } from '../unsaved';

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const OTHER = '00000000-0000-4000-8000-0000000000e2';

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe('the unsaved store', () => {
  it('writes, reads back and clears one entry\'s copy in sessionStorage, never localStorage', () => {
    const store = unsavedStore();
    store.write(ENTRY, { version: 4, data: { title: 'Óvistað' } });
    expect(store.read(ENTRY)).toEqual({ version: 4, data: { title: 'Óvistað' } });
    expect(store.read(OTHER)).toBeNull();
    expect(sessionStorage.getItem(`${UNSAVED_KEY_PREFIX}${ENTRY}`)).not.toBeNull();
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
    sessionStorage.setItem(`${UNSAVED_KEY_PREFIX}${ENTRY}`, raw);
    expect(unsavedStore().read(ENTRY)).toBeNull();
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
    const store = unsavedStore(refusing);
    expect(() => store.write(ENTRY, { version: 1, data: {} })).not.toThrow();
    expect(store.read(ENTRY)).toBeNull();
    expect(() => store.clear(ENTRY)).not.toThrow();
    expect(() => clearUnsavedCopies(refusing)).not.toThrow();

    const none = unsavedStore(null);
    none.write(ENTRY, { version: 1, data: {} });
    expect(none.read(ENTRY)).toBeNull();
  });
});

describe('clearUnsavedCopies (sign-out)', () => {
  it('removes every unsaved copy in the tab and leaves other keys', () => {
    const store = unsavedStore();
    store.write(ENTRY, { version: 1, data: { a: 1 } });
    store.write(OTHER, { version: 7, data: { b: 2 } });
    sessionStorage.setItem('something-else', 'kept');
    clearUnsavedCopies();
    expect(store.read(ENTRY)).toBeNull();
    expect(store.read(OTHER)).toBeNull();
    expect(sessionStorage.getItem('something-else')).toBe('kept');
    expect(sessionStorage.length).toBe(1);
  });
});
