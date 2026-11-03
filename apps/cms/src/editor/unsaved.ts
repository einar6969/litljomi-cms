/**
 * The tab's copy of an entry's unsaved changes (M2-17, spec §4.4: "a failed save keeps local state
 * until re-authentication"). It lives in `sessionStorage`, so it belongs to this tab only and ends
 * with it; never `localStorage`, which would outlive the tab and reach every other tab of the
 * browser. The copy is written while a change waits to be saved, removed once it is saved, and
 * every copy is removed when the editor signs out.
 *
 * A storage that is missing or refuses (a private window, a full quota) is no storage: the form
 * still holds the values on the screen, so nothing here may throw.
 */

/** The changes, and the draft version they were made on: the version the save will expect. */
export type UnsavedCopy = { version: number; data: Record<string, unknown> };

export type UnsavedStore = {
  read: (entryId: string) => UnsavedCopy | null;
  write: (entryId: string, copy: UnsavedCopy) => void;
  clear: (entryId: string) => void;
};

/** Every key this module writes starts with this, so sign-out can remove them all and nothing else. */
export const UNSAVED_KEY_PREFIX = 'litljomi-cms:unsaved:';

const keyOf = (entryId: string) => `${UNSAVED_KEY_PREFIX}${entryId}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The tab's `sessionStorage`, or null where there is none or reading it throws. */
function tabStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function parse(raw: string | null): UnsavedCopy | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isObject(value) || !isObject(value.data)) return null;
    const { version } = value;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return null;
    return { version, data: value.data };
  } catch {
    return null;
  }
}

/**
 * The store over a `Storage` (the tab's `sessionStorage` by default). A copy that does not read
 * back as one (another shape, broken JSON) is removed and reads as none.
 */
export function unsavedStore(storage: Storage | null = tabStorage()): UnsavedStore {
  return {
    read(entryId) {
      try {
        const raw = storage?.getItem(keyOf(entryId)) ?? null;
        const copy = parse(raw);
        if (raw !== null && copy === null) storage?.removeItem(keyOf(entryId));
        return copy;
      } catch {
        return null;
      }
    },
    write(entryId, copy) {
      try {
        storage?.setItem(keyOf(entryId), JSON.stringify(copy));
      } catch {
        // Quota or a refusing storage: the values stay on the screen.
      }
    },
    clear(entryId) {
      try {
        storage?.removeItem(keyOf(entryId));
      } catch {
        // Nothing to do.
      }
    },
  };
}

/** Removes every unsaved copy in the tab (sign-out). Other keys are left alone. */
export function clearUnsavedCopies(storage: Storage | null = tabStorage()): void {
  try {
    if (!storage) return;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(UNSAVED_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch {
    // Nothing to do.
  }
}
