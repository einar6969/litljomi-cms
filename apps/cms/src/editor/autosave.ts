import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { loadDraftAction, SaveDraftResult } from '@/app/(editor)/t/[tenant]/actions';
import type { UnsavedStore } from './unsaved';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'signed_out' | 'error' | 'restored';

/** One save of the entry's draft: `saveDraftAction` with the form's user bound to it. */
export type SaveDraft = (entryId: string, expectedVersion: number, data: unknown) => Promise<SaveDraftResult>;

export type AutosaveOptions = {
  entryId: string;
  initialVersion: number;
  save: SaveDraft;
  debounceMs?: number;
  /**
   * Asked when a save throws instead of answering (a redirect to the sign-in page, a network
   * failure), and before `resume()` saves: false means the session is gone or belongs to another
   * user, so the editor is told to sign in again.
   */
  sessionIsValid?: () => Promise<boolean>;
  /** Reads the newer version after a conflict (M2-11), so the editor can compare and choose. */
  loadLatest?: typeof loadDraftAction;
  /**
   * The tab's copy of the unsaved changes (M2-17): written while a change waits to be saved,
   * removed once it is saved. A copy found when the form starts (the tab was reloaded while signed
   * out) is given to `onRestore` and waits in the `restored` state: nothing is saved until the
   * editor chooses `saveRestored()`, which saves it at the version it was made on, so a newer draft
   * meets M2-11's conflict flow instead of being overwritten, or `discardRestored()`.
   */
  store?: UnsavedStore;
  /** Shows a restored copy's data in the form. */
  onRestore?: (data: Record<string, unknown>) => void;
};

/** The newer version a conflict met, while the state is `conflict` and `loadLatest` is given. */
export type TheirVersion =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; version: number; data: Record<string, unknown> };

export type AutosaveSnapshot = { version: number; state: AutosaveState; theirs?: TheirVersion };

export const DEFAULT_DEBOUNCE_MS = 1500;

/** While signed out, how often the form checks whether the editor has signed in again (M2-17). */
export const RESUME_POLL_MS = 5000;

/**
 * The autosave state machine, without React. One save is in flight at a time; edits during a save
 * are sent after it, with the version it returned. The latest data stays pending until a save of
 * it succeeds: a conflict, a lost session or an error never discards it (spec §5.5), and an edit
 * after any of them is tried again except after a conflict. A conflict reads the newer version and
 * waits for the editor's choice (M2-11): `keepMine()` saves the pending data on top of it,
 * `takeTheirs()` drops the pending data and continues from it. Nothing is discarded otherwise.
 * The pending data is also kept in the tab's store (M2-17), and `resume()` saves it once the
 * editor has signed in again after the session expired. `close()` (sign-out) drops the pending
 * data and the copy for good: the controller saves and stores nothing afterwards, not even when a
 * save that was in flight answers.
 */
export class AutosaveController {
  private snapshot: AutosaveSnapshot;
  private pending: { data: unknown } | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private rerun = false;
  private disposed = false;
  private loadSeq = 0;
  private restoreChecked = false;
  private resuming = false;
  private closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly o: AutosaveOptions) {
    this.snapshot = { version: o.initialVersion, state: 'idle' };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): AutosaveSnapshot => this.snapshot;

  /** Records the latest complete data and saves it once the edits pause. */
  schedule(data: unknown): void {
    if (this.closed) return;
    this.pending = { data };
    this.seq += 1;
    this.persist();
    // A restored copy is saved only when the editor chooses to (saveRestored): edits are kept until then.
    if (this.snapshot.state === 'conflict' || this.snapshot.state === 'restored') return;
    if (this.snapshot.state === 'saved') this.set({ state: 'idle' });
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.o.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /**
   * Saves the pending data now (after a lost session or an error). After a conflict it saves
   * nothing: it reads the newer version again if that failed.
   */
  retry(): void {
    if (this.closed || this.snapshot.state === 'restored') return;
    if (this.snapshot.state === 'conflict') {
      if (this.snapshot.theirs?.status === 'failed') void this.loadTheirs();
      return;
    }
    this.clearTimer();
    void this.flush();
  }

  /** The data waiting to be saved, or null when everything is saved. */
  pendingData(): unknown {
    return this.pending?.data ?? null;
  }

  /** "Keep mine" (M2-11): a versioned save of the pending data on top of the newer version. */
  keepMine(): void {
    const theirs = this.snapshot.theirs;
    if (this.snapshot.state !== 'conflict' || theirs?.status !== 'ready') return;
    this.set({ version: theirs.version, state: 'idle', theirs: undefined });
    this.persist();
    this.clearTimer();
    void this.flush();
  }

  /**
   * "Reload theirs" (M2-11): returns the newer version's data for the form to show, drops the
   * pending data and continues from that version. Null (and no change) before it is loaded.
   */
  takeTheirs(): Record<string, unknown> | null {
    const theirs = this.snapshot.theirs;
    if (this.snapshot.state !== 'conflict' || theirs?.status !== 'ready') return null;
    this.clearTimer();
    this.pending = null;
    this.seq += 1;
    this.persist();
    this.set({ version: theirs.version, state: 'idle', theirs: undefined });
    return theirs.data;
  }

  /**
   * After a lost session (M2-17): if the editor has signed in again (in another tab, or on another
   * device through M1's cross-device sign-in), saves the pending data at the version it was made
   * on. A newer draft then meets M2-11's conflict flow. Does nothing while still signed out.
   */
  async resume(): Promise<void> {
    if (this.closed || this.snapshot.state !== 'signed_out' || this.resuming || !this.o.sessionIsValid) return;
    this.resuming = true;
    let valid: boolean;
    try {
      valid = await this.o.sessionIsValid();
    } catch {
      valid = false;
    } finally {
      this.resuming = false;
    }
    if (valid && this.snapshot.state === 'signed_out') this.retry();
  }

  /**
   * Called when the form mounts (and again if React remounts it in development). The first call
   * restores the tab's copy of unsaved changes, if there is one, into the `restored` state: the
   * form shows it and says so, and nothing is saved until the editor chooses.
   */
  start(): void {
    this.disposed = false;
    if (this.restoreChecked || this.closed) return;
    this.restoreChecked = true;
    const copy = this.o.store?.read(this.o.entryId);
    if (!copy) return;
    this.pending = { data: copy.data };
    this.seq += 1;
    this.set({ version: copy.version, state: 'restored' });
    this.o.onRestore?.(copy.data);
  }

  /** The editor chose to save a restored copy (with any edits since): saved at its version now. */
  saveRestored(): void {
    if (this.closed || this.snapshot.state !== 'restored') return;
    this.set({ state: 'idle' });
    this.clearTimer();
    void this.flush();
  }

  /**
   * The editor chose to drop a restored copy (with any edits since): the copy is removed and the
   * form goes back to the draft it loaded, at that draft's version. Nothing is saved.
   */
  discardRestored(): void {
    if (this.closed || this.snapshot.state !== 'restored') return;
    this.pending = null;
    this.seq += 1;
    this.set({ version: this.o.initialVersion, state: 'idle' });
    this.persist();
  }

  /**
   * Sign-out (M2-17): drops the pending data and the tab's copy, and from now on saves and stores
   * nothing. A save already in flight may still reach the server, but its answer writes no copy.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.pending = null;
    this.seq += 1;
    this.rerun = false;
    this.o.store?.clear(this.o.entryId);
    this.set({ state: 'signed_out', theirs: undefined });
  }

  /** Called when the form unmounts: edits still waiting for the debounce are sent once, now. */
  dispose(): void {
    const waiting = this.timer !== null;
    this.clearTimer();
    if (waiting) void this.flush();
    this.disposed = true;
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(next: Partial<AutosaveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  private async flush(): Promise<void> {
    this.timer = null;
    if (this.closed || this.disposed || this.pending === null || this.snapshot.state === 'conflict' || this.snapshot.state === 'restored') return;
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    const { data } = this.pending;
    const sent = this.seq;
    this.inFlight = true;
    this.set({ state: 'saving' });
    let next: Partial<AutosaveSnapshot>;
    let persistAfter = false;
    try {
      // One save is a server action that reads the session, the entry and its tenant before the
      // RPC, all with the editor's own session (Task 23 security design). Do not "optimise" it into
      // a save that trusts a tenant or type the browser sends.
      const result = await this.o.save(this.o.entryId, this.snapshot.version, data);
      if (result.ok) {
        const clean = sent === this.seq;
        if (clean) this.pending = null;
        next = { version: result.version, state: clean ? 'saved' : 'idle' };
        persistAfter = true;
      } else if (result.code === 'version_conflict') {
        next = { state: 'conflict' };
      } else if (result.code === 'auth') {
        next = { state: 'signed_out' };
      } else {
        next = { state: 'error' };
      }
    } catch {
      next = { state: (await this.sessionLost()) ? 'signed_out' : 'error' };
    }
    this.inFlight = false;
    // Signed out while the save was in flight: its answer changes nothing and stores nothing.
    if (this.closed) return;
    this.set(next);
    if (persistAfter) this.persist();
    if (next.state === 'conflict' && this.o.loadLatest) void this.loadTheirs();
    if (this.rerun) {
      this.rerun = false;
      if (next.state === 'saved' || next.state === 'idle') {
        this.clearTimer();
        void this.flush();
      }
    }
  }

  private async loadTheirs(): Promise<void> {
    const load = this.o.loadLatest;
    if (!load) return;
    const mine = ++this.loadSeq;
    this.set({ theirs: { status: 'loading' } });
    let theirs: TheirVersion;
    try {
      const result = await load(this.o.entryId);
      theirs = result.ok ? { status: 'ready', version: result.version, data: result.data } : { status: 'failed' };
    } catch {
      theirs = { status: 'failed' };
    }
    // A later load, or a choice already made, wins.
    if (mine === this.loadSeq && this.snapshot.state === 'conflict') this.set({ theirs });
  }

  /** Mirrors the pending data, with the version the next save expects, in the tab's store. */
  private persist(): void {
    const store = this.o.store;
    if (!store || this.closed) return;
    const data = this.pending?.data;
    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
      store.write(this.o.entryId, { version: this.snapshot.version, data: data as Record<string, unknown> });
    } else {
      store.clear(this.o.entryId);
    }
  }

  private async sessionLost(): Promise<boolean> {
    try {
      return this.o.sessionIsValid ? !(await this.o.sessionIsValid()) : false;
    } catch {
      return false;
    }
  }
}

/**
 * Autosave for one entry's form. `schedule(data)` takes the complete form data after each edit;
 * `retry()` saves again after `signed_out` or `error` (and, while signed out, the hook tries by
 * itself once the session is back); `saveRestored()` and `discardRestored()` answer a restored
 * copy; `close()` is sign-out; `keepMine()` and `takeTheirs()` resolve a
 * conflict. The version is the draft version the next
 * save will expect.
 */
export type AutosaveActions = {
  schedule: (data: unknown) => void;
  retry: () => void;
  saveRestored: () => void;
  discardRestored: () => void;
  close: () => void;
  keepMine: () => void;
  takeTheirs: () => Record<string, unknown> | null;
  pendingData: () => unknown;
};

export function useAutosave(o: AutosaveOptions): AutosaveSnapshot & AutosaveActions {
  const ref = useRef<AutosaveController | null>(null);
  ref.current ??= new AutosaveController(o);
  const controller = ref.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);
  // Signed out (M2-17): look again when the editor comes back to this tab, and every few seconds,
  // so the save goes through by itself once they have signed in elsewhere.
  const signedOut = snapshot.state === 'signed_out';
  useEffect(() => {
    if (!signedOut) return;
    const check = () => {
      if (document.visibilityState !== 'hidden') void controller.resume();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const timer = setInterval(check, RESUME_POLL_MS);
    return () => {
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(timer);
    };
  }, [controller, signedOut]);
  // Stable for the controller's lifetime, so a caller's useCallback([schedule]) stays stable too.
  const actions = useMemo<AutosaveActions>(
    () => ({
      schedule: (data) => controller.schedule(data),
      retry: () => controller.retry(),
      saveRestored: () => controller.saveRestored(),
      discardRestored: () => controller.discardRestored(),
      close: () => controller.close(),
      keepMine: () => controller.keepMine(),
      takeTheirs: () => controller.takeTheirs(),
      pendingData: () => controller.pendingData(),
    }),
    [controller],
  );
  return { ...snapshot, ...actions };
}
