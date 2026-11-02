import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { saveDraftAction } from '@/app/(editor)/t/[tenant]/actions';

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
};

export type AutosaveSnapshot = { version: number; state: AutosaveState };

export const DEFAULT_DEBOUNCE_MS = 1500;

/**
 * The autosave state machine, without React. One save is in flight at a time; edits during a save
 * are sent after it, with the version it returned. The latest data stays pending until a save of
 * it succeeds: a conflict, a lost session or an error never discards it (spec §5.5), and an edit
 * after any of them is tried again except after a conflict, which only a reload resolves.
 */
export class AutosaveController {
  private snapshot: AutosaveSnapshot;
  private pending: { data: unknown } | null = null;
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private rerun = false;
  private disposed = false;
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

  /** Saves the pending data now (after a lost session or an error); no effect after a conflict. */
  retry(): void {
    this.clearTimer();
    void this.flush();
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
    if (this.rerun) {
      this.rerun = false;
      if (next.state === 'saved' || next.state === 'idle') {
        this.clearTimer();
        void this.flush();
      }
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
 * `retry()` saves again after `signed_out` or `error`. The version is the draft version the next
 * save will expect.
 */
export function useAutosave(o: AutosaveOptions): AutosaveSnapshot & { schedule: (data: unknown) => void; retry: () => void } {
  const ref = useRef<AutosaveController | null>(null);
  ref.current ??= new AutosaveController(o);
  const controller = ref.current;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);
  return { ...snapshot, schedule: (data) => controller.schedule(data), retry: () => controller.retry() };
}
