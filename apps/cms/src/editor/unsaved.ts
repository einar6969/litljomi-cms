/**
 * The tab's copy of an entry's unsaved changes (M2-17, spec §4.4: "a failed save keeps local state
 * until re-authentication"). It lives in `sessionStorage`, so it belongs to this tab only and ends
 * with it; never `localStorage`, which would outlive the tab and reach every other tab of the
 * browser. The copy is written while a change waits to be saved, removed once it is saved, and
 * every copy is removed when the editor signs out, in this tab and in the browser's other tabs.
 *
 * A copy belongs to one user: its key holds the user's ID, so a copy made by one account is never
 * read back, restored or saved while another account is signed in.
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

/** The key of one user's copy of one entry: the prefix, the user's ID, then the entry's ID. */
export const unsavedKey = (userId: string, entryId: string) => `${UNSAVED_KEY_PREFIX}${userId}:${entryId}`;

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
 * `userId`'s store over a `Storage` (the tab's `sessionStorage` by default). A copy that does not
 * read back as one (another shape, broken JSON) is removed and reads as none. Without a user ID
 * there is no store: nothing is written or read.
 */
export function unsavedStore(userId: string, storage: Storage | null = tabStorage()): UnsavedStore {
  if (userId === '') storage = null;
  const keyOf = (entryId: string) => unsavedKey(userId, entryId);
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

/** Removes every unsaved copy in the tab, of every user (sign-out). Other keys are left alone. */
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

/** The channel the browser's tabs of this origin tell each other about a sign-out on. */
export const SIGN_OUT_CHANNEL = 'litljomi-cms:sign-out';
const SIGNED_OUT = 'signed-out';

const signOutListeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;

function notifySignedOut(): void {
  clearUnsavedCopies();
  for (const listener of [...signOutListeners]) {
    try {
      listener();
    } catch {
      // One listener's failure does not keep the others from running.
    }
  }
}

function openChannel(): void {
  if (channel !== null || typeof BroadcastChannel === 'undefined') return;
  try {
    channel = new BroadcastChannel(SIGN_OUT_CHANNEL);
    channel.onmessage = (event: MessageEvent) => {
      if (event.data === SIGNED_OUT) notifySignedOut();
    };
  } catch {
    channel = null;
  }
}

function closeChannel(): void {
  if (signOutListeners.size > 0 || channel === null) return;
  try {
    channel.close();
  } catch {
    // Nothing to do.
  }
  channel = null;
}

/**
 * Calls `listener` when the editor signs out, in this tab or in another tab of the browser; the
 * tab's copies are removed first. While any listener is registered the tab listens to the others.
 * Returns the function that removes the listener.
 */
export function onSignOut(listener: () => void): () => void {
  signOutListeners.add(listener);
  openChannel();
  return () => {
    signOutListeners.delete(listener);
    closeChannel();
  };
}

/**
 * Sign-out in this tab: removes the tab's copies, tells this tab's forms to drop their unsaved
 * changes, and tells the browser's other tabs to do the same. The message carries no content.
 */
export function announceSignOut(): void {
  notifySignedOut();
  if (typeof BroadcastChannel === 'undefined') return;
  // The tab's own channel is used when it is open: a channel does not receive its own messages.
  const own = channel;
  let sender: BroadcastChannel | null = null;
  try {
    sender = own ?? new BroadcastChannel(SIGN_OUT_CHANNEL);
    sender.postMessage(SIGNED_OUT);
  } catch {
    // No other tab is told; their copies end with them.
  } finally {
    try {
      if (sender !== own) sender?.close();
    } catch {
      // Nothing to do.
    }
  }
}
