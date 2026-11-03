import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { loadDraftAction, saveDraftAction } from '@/app/(editor)/t/[tenant]/actions';

export type AutosaveState = 'idle' | 'saving' | 'saved' | 'conflict' | 'signed_out' | 'error';

export type AutosaveOptions = {
  entryId: string;
  initialVersion: number;
  save: typeof saveDraftAction;
  debounceMs?: number;
  /**
   * Asked when a save throws instead of answering (a redirect to the sign-in page, a network
   * failure): false means the session is gone, so the editor is told to sign in again.
   */
  sessionIsValid?: () => Promise<boolean>;
  /** Reads the newer version after a conflict (M2-11), so the editor can compare and choose. */
  loadLatest?: typeof loadDraftAction;
};

/** The newer version a conflict met, while the state is `conflict` and `loadLatest` is given. */
export type TheirVersion =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; version: number; data: Record<string, unknown> };

export type AutosaveSnapshot = { version: number; state: AutosaveState; theirs?: TheirVersion };

export const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * The autosave state machine, without React. One save is in flight at a time; edits during a save
 * are sent after it, with the version it returned. The latest data stays pending until a save of
 * it succeeds: a conflict, a lost session or an error never discards it (spec §5.5), and an edit
 * after any of them is tried again except after a conflict. A conflict reads the newer version and
 * waits for the editor's choice (M2-11): `keepMine()` saves the pending data on top of it,
 * `takeTheirs()` drops the pending data and continues from it. Nothing is discarded otherwise.
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
    this.pending = { data };
    this.seq += 1;
    if (this.snapshot.state === 'conflict') return;
    if (this.snapshot.state === 'saved') this.set({ state: 'idle' });
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.o.debounceMs ?? DEFAULT_DEBOUNCE_MS);
  }

  /**
   * Saves the pending data now (after a lost session or an error). After a conflict it saves
   * nothing: it reads the newer version again if that failed.
   */
  retry(): void {
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
    this.set({ version: theirs.version, state: 'idle', theirs: undefined });
    return theirs.data;
  }

  /** Called when the form mounts (and again if React remounts it in development). */
  start(): void {
    this.disposed = false;
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
    if (this.disposed || this.pending === null || this.snapshot.state === 'conflict') return;
    if (this.inFlight) {
      this.rerun = true;
      return;
    }
    const { data } = this.pending;
    const sent = this.seq;
    this.inFlight = true;
    this.set({ state: 'saving' });
    let next: Partial<AutosaveSnapshot>;
    try {
      // One save is a server action that reads the session, the entry and its tenant before the
      // RPC, all with the editor's own session (Task 23 security design). Do not "optimise" it into
      // a save that trusts a tenant or type the browser sends.
      const result = await this.o.save(this.o.entryId, this.snapshot.version, data);
      if (result.ok) {
        const clean = sent === this.seq;
        if (clean) this.pending = null;
        next = { version: result.version, state: clean ? 'saved' : 'idle' };
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
    this.set(next);
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
 * `retry()` saves again after `signed_out` or `error`; `keepMine()` and `takeTheirs()` resolve a
 * conflict. The version is the draft version the next
 * save will expect.
 */
export type AutosaveActions = {
  schedule: (data: unknown) => void;
  retry: () => void;
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
  // Stable for the controller's lifetime, so a caller's useCallback([schedule]) stays stable too.
  const actions = useMemo<AutosaveActions>(
    () => ({
      schedule: (data) => controller.schedule(data),
      retry: () => controller.retry(),
      keepMine: () => controller.keepMine(),
      takeTheirs: () => controller.takeTheirs(),
      pendingData: () => controller.pendingData(),
    }),
    [controller],
  );
  return { ...snapshot, ...actions };
}
