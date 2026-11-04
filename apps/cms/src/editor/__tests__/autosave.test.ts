// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController, RESUME_POLL_MS, useAutosave } from '../autosave';
import type { UnsavedCopy, UnsavedStore } from '../unsaved';

type Save = Parameters<typeof useAutosave>[0]['save'];
type Result = Awaited<ReturnType<Save>>;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const DEBOUNCE = 1500;

/** A save that answers with the queued results, one per call. */
const saveAnswering = (...results: Result[]) => {
  const queue = [...results];
  return vi.fn<Save>(async () => queue.shift() ?? { ok: false, code: 'error' });
};
const controllerFor = (save: Save, extra: Partial<ConstructorParameters<typeof AutosaveController>[0]> = {}) =>
  new AutosaveController({ entryId: ENTRY, initialVersion: 3, save, ...extra });
const pause = (ms = DEBOUNCE) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the autosave controller', () => {
  it('saves once per debounce window, with the latest data and the current version', async () => {
    const save = saveAnswering({ ok: true, version: 4 });
    const c = controllerFor(save);
    c.schedule({ title: 'B' });
    await pause(1000);
    c.schedule({ title: 'Br' });
    await pause(1000);
    c.schedule({ title: 'Brauð' });
    await pause(1499);
    expect(save).not.toHaveBeenCalled();
    await pause(1);
    expect(save).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Brauð' });
    expect(c.getSnapshot()).toEqual({ version: 4, state: 'saved' });
  });

  it('goes through saving and ends in saved; typing again makes it idle', async () => {
    let finish!: (r: Result) => void;
    const save = vi.fn<Save>(() => new Promise<Result>((resolve) => (finish = resolve)));
    const c = controllerFor(save);
    c.schedule({ a: 1 });
    await pause();
    expect(c.getSnapshot().state).toBe('saving');
    finish({ ok: true, version: 4 });
    await pause(0);
    expect(c.getSnapshot()).toEqual({ version: 4, state: 'saved' });
    c.schedule({ a: 2 });
    expect(c.getSnapshot().state).toBe('idle');
  });

  it('sends an edit made during a save afterwards, with the version the save returned', async () => {
    let finish!: (r: Result) => void;
    const save = vi.fn<Save>().mockImplementationOnce(() => new Promise<Result>((resolve) => (finish = resolve)));
    save.mockResolvedValueOnce({ ok: true, version: 5 });
    const c = controllerFor(save);
    c.schedule({ n: 1 });
    await pause();
    c.schedule({ n: 2 });
    await pause(); // the second window ends while the first save is still in flight
    expect(save).toHaveBeenCalledTimes(1);
    finish({ ok: true, version: 4 });
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 4, { n: 2 });
    expect(c.getSnapshot()).toEqual({ version: 5, state: 'saved' });
  });

  it('a conflict sets state conflict, keeps the version and sends nothing more, even after more edits', async () => {
    const save = saveAnswering({ ok: false, code: 'version_conflict' });
    const c = controllerFor(save);
    c.schedule({ title: 'Mitt' });
    await pause();
    expect(c.getSnapshot()).toEqual({ version: 3, state: 'conflict' });
    c.schedule({ title: 'Mitt, lengra' });
    c.retry();
    await pause();
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().state).toBe('conflict');
  });

  it('review focus 1: an auth answer sets signed_out and the data is sent again on retry, unchanged', async () => {
    const save = saveAnswering({ ok: false, code: 'auth' }, { ok: true, version: 4 });
    const c = controllerFor(save);
    c.schedule({ title: 'Ekki glatað' });
    await pause();
    expect(c.getSnapshot()).toEqual({ version: 3, state: 'signed_out' });
    c.retry();
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 3, { title: 'Ekki glatað' });
    expect(c.getSnapshot()).toEqual({ version: 4, state: 'saved' });
  });

  it('an edit after signed_out is tried again by itself', async () => {
    const save = saveAnswering({ ok: false, code: 'auth' }, { ok: true, version: 4 });
    const c = controllerFor(save);
    c.schedule({ a: 1 });
    await pause();
    c.schedule({ a: 2 });
    await pause();
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 3, { a: 2 });
    expect(c.getSnapshot().state).toBe('saved');
  });

  it('a save that throws is an error, or signed_out when the session is gone', async () => {
    const throwing = vi.fn<Save>().mockRejectedValue(new Error('Failed to fetch'));
    const a = controllerFor(throwing, { sessionIsValid: async () => true });
    a.schedule({ a: 1 });
    await pause();
    expect(a.getSnapshot().state).toBe('error');

    const b = controllerFor(throwing, { sessionIsValid: async () => false });
    b.schedule({ a: 1 });
    await pause();
    expect(b.getSnapshot().state).toBe('signed_out');
  });

  it('invalid data and a generic failure are an error and keep the data for the next try', async () => {
    const save = saveAnswering({ ok: false, code: 'invalid', issues: [] }, { ok: true, version: 4 });
    const c = controllerFor(save);
    c.schedule({ a: 1 });
    await pause();
    expect(c.getSnapshot().state).toBe('error');
    c.retry();
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 3, { a: 1 });
  });

  it('sends edits still waiting when the form unmounts', async () => {
    const save = saveAnswering({ ok: true, version: 4 });
    const c = controllerFor(save);
    c.schedule({ a: 1 });
    c.dispose();
    await pause(0);
    expect(save).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { a: 1 });
  });
});

describe('conflict resolution (M2-11)', () => {
  type Load = NonNullable<ConstructorParameters<typeof AutosaveController>[0]['loadLatest']>;
  const THEIRS = { version: 6, data: { title: 'Þeirra' } };
  const loadAnswering = (...results: Awaited<ReturnType<Load>>[]) => {
    const queue = [...results];
    return vi.fn<Load>(async () => queue.shift() ?? { ok: false, code: 'error' });
  };

  const inConflict = async (load: Load, ...after: Result[]) => {
    const save = saveAnswering({ ok: false, code: 'version_conflict' }, ...after);
    const c = controllerFor(save, { loadLatest: load });
    c.schedule({ title: 'Mitt' });
    await pause();
    return { c, save };
  };

  it('a conflict loads the newer version and holds it next to the pending data', async () => {
    const load = loadAnswering({ ok: true, ...THEIRS });
    const { c } = await inConflict(load);
    expect(load).toHaveBeenCalledExactlyOnceWith(ENTRY);
    expect(c.getSnapshot()).toEqual({ version: 3, state: 'conflict', theirs: { status: 'ready', ...THEIRS } });
    expect(c.pendingData()).toEqual({ title: 'Mitt' });
  });

  it('shows loading while the newer version is read', async () => {
    let finish!: (r: Awaited<ReturnType<Load>>) => void;
    const load = vi.fn<Load>(() => new Promise((resolve) => (finish = resolve)));
    const { c } = await inConflict(load);
    expect(c.getSnapshot().theirs).toEqual({ status: 'loading' });
    finish({ ok: true, ...THEIRS });
    await pause(0);
    expect(c.getSnapshot().theirs).toEqual({ status: 'ready', ...THEIRS });
  });

  it('"keep mine" saves the latest local data at the newer version and clears the conflict', async () => {
    const load = loadAnswering({ ok: true, ...THEIRS });
    const { c, save } = await inConflict(load, { ok: true, version: 7 });
    c.schedule({ title: 'Mitt, lengra' }); // edits during the conflict are kept, not sent
    await pause();
    expect(save).toHaveBeenCalledTimes(1);
    c.keepMine();
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 6, { title: 'Mitt, lengra' });
    expect(c.getSnapshot()).toEqual({ version: 7, state: 'saved', theirs: undefined });
  });

  it('"keep mine" that meets a yet newer version is a new conflict with that version', async () => {
    const load = loadAnswering({ ok: true, ...THEIRS }, { ok: true, version: 8, data: { title: 'Þriðja' } });
    const { c, save } = await inConflict(load, { ok: false, code: 'version_conflict' });
    c.keepMine();
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 6, { title: 'Mitt' });
    expect(c.getSnapshot()).toEqual({ version: 6, state: 'conflict', theirs: { status: 'ready', version: 8, data: { title: 'Þriðja' } } });
  });

  it('"reload theirs" returns their data, drops the pending data and continues from their version', async () => {
    const load = loadAnswering({ ok: true, ...THEIRS });
    const { c, save } = await inConflict(load, { ok: true, version: 7 });
    expect(c.takeTheirs()).toEqual(THEIRS.data);
    expect(c.getSnapshot()).toEqual({ version: 6, state: 'idle', theirs: undefined });
    expect(c.pendingData()).toBeNull();
    c.schedule({ title: 'Þeirra, breytt' });
    await pause();
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 6, { title: 'Þeirra, breytt' });
  });

  it('neither choice does anything before the newer version is loaded', async () => {
    const load = loadAnswering({ ok: false, code: 'error' });
    const { c, save } = await inConflict(load);
    expect(c.getSnapshot().theirs).toEqual({ status: 'failed' });
    expect(c.takeTheirs()).toBeNull();
    c.keepMine();
    await pause(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().state).toBe('conflict');
    expect(c.pendingData()).toEqual({ title: 'Mitt' });
  });

  it('retry after a failed load reads the newer version again, and still saves nothing', async () => {
    const load = loadAnswering({ ok: false, code: 'error' }, { ok: true, ...THEIRS });
    const { c, save } = await inConflict(load);
    c.retry();
    await pause(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(c.getSnapshot().theirs).toEqual({ status: 'ready', ...THEIRS });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a load that throws is a failed load', async () => {
    const load = vi.fn<Load>().mockRejectedValue(new Error('Failed to fetch'));
    const { c } = await inConflict(load);
    expect(c.getSnapshot().theirs).toEqual({ status: 'failed' });
  });
});

describe('useAutosave', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it('returns the version and state, and a schedule that saves after the debounce', async () => {
    const save = saveAnswering({ ok: true, version: 4 });
    let seen: ReturnType<typeof useAutosave> | undefined;
    const Probe = (): ReactElement => {
      seen = useAutosave({ entryId: ENTRY, initialVersion: 3, save });
      return createElement('p', null, `${seen.state} ${seen.version}`);
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    expect(host.textContent).toBe('idle 3');
    await act(async () => seen!.schedule({ title: 'x' }));
    await act(async () => {
      await pause();
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'x' });
    expect(host.textContent).toBe('saved 4');
    await act(async () => root.unmount());
  });
});

describe('session expiry loses no work (M2-17)', () => {
  /** A store over a Map, so a test sees exactly what the controller kept. */
  const memoryStore = () => {
    const copies = new Map<string, UnsavedCopy>();
    const store: UnsavedStore = {
      read: (id) => copies.get(id) ?? null,
      write: (id, copy) => void copies.set(id, copy),
      clear: (id) => void copies.delete(id),
    };
    return { store, copies };
  };

  it('keeps the pending data in the tab while it waits, and removes it once saved', async () => {
    const { store, copies } = memoryStore();
    const c = controllerFor(saveAnswering({ ok: true, version: 4 }), { store });
    c.schedule({ title: 'Óvistað' });
    expect(copies.get(ENTRY)).toEqual({ version: 3, data: { title: 'Óvistað' } });
    await pause();
    expect(c.getSnapshot()).toEqual({ version: 4, state: 'saved' });
    expect(copies.has(ENTRY)).toBe(false);
  });

  it('after an expired-session answer keeps every later edit in the tab, at the version they were made on', async () => {
    const { store, copies } = memoryStore();
    const c = controllerFor(saveAnswering({ ok: false, code: 'auth' }, { ok: false, code: 'auth' }), { store });
    c.schedule({ title: 'A' });
    await pause();
    expect(c.getSnapshot().state).toBe('signed_out');
    c.schedule({ title: 'A', excerpt: 'B' });
    await pause();
    expect(c.getSnapshot().state).toBe('signed_out');
    expect(copies.get(ENTRY)).toEqual({ version: 3, data: { title: 'A', excerpt: 'B' } });
    expect(c.pendingData()).toEqual({ title: 'A', excerpt: 'B' });
  });

  it('an edit made during a save is kept at the version that save returned', async () => {
    const { store, copies } = memoryStore();
    let finish!: (r: Result) => void;
    const save = vi.fn<Save>().mockImplementationOnce(() => new Promise<Result>((resolve) => (finish = resolve)));
    save.mockResolvedValueOnce({ ok: false, code: 'auth' });
    const c = controllerFor(save, { store });
    c.schedule({ n: 1 });
    await pause();
    c.schedule({ n: 2 });
    finish({ ok: true, version: 4 });
    await pause(0);
    expect(copies.get(ENTRY)).toEqual({ version: 4, data: { n: 2 } });
  });

  it('a conflict keeps the copy; "keep mine" moves it to the newer version; "reload theirs" removes it', async () => {
    const { store, copies } = memoryStore();
    const loadLatest = vi.fn(async () => ({ ok: true as const, version: 5, data: { title: 'Þeirra' } }));
    const a = controllerFor(saveAnswering({ ok: false, code: 'version_conflict' }, { ok: false, code: 'auth' }), { store, loadLatest });
    a.schedule({ title: 'Mitt' });
    await pause();
    expect(copies.get(ENTRY)).toEqual({ version: 3, data: { title: 'Mitt' } });
    a.keepMine();
    expect(copies.get(ENTRY)).toEqual({ version: 5, data: { title: 'Mitt' } });

    const b = controllerFor(saveAnswering({ ok: false, code: 'version_conflict' }), { store, loadLatest });
    b.schedule({ title: 'Mitt' });
    await pause();
    expect(b.takeTheirs()).toEqual({ title: 'Þeirra' });
    expect(copies.has(ENTRY)).toBe(false);
  });

  it('on start, restores the tab\'s copy into the form and saves nothing until the editor chooses to', async () => {
    const { store, copies } = memoryStore();
    copies.set(ENTRY, { version: 2, data: { title: 'Frá því áðan' } });
    const onRestore = vi.fn();
    const sessionIsValid = vi.fn(async () => true);
    const save = saveAnswering({ ok: true, version: 3 });
    const c = controllerFor(save, { store, onRestore, sessionIsValid });
    c.start();
    expect(onRestore).toHaveBeenCalledExactlyOnceWith({ title: 'Frá því áðan' });
    expect(c.getSnapshot()).toEqual({ version: 2, state: 'restored' });
    // Neither time, an edit, retry() nor resume() saves it.
    await pause(DEBOUNCE * 4);
    c.schedule({ title: 'Frá því áðan, breytt' });
    await pause();
    c.retry();
    await c.resume();
    await pause(0);
    expect(save).not.toHaveBeenCalled();
    expect(c.getSnapshot()).toEqual({ version: 2, state: 'restored' });
    expect(copies.get(ENTRY)).toEqual({ version: 2, data: { title: 'Frá því áðan, breytt' } });
    // The editor chooses to save it: at the version it was made on.
    c.saveRestored();
    await pause(0);
    expect(save).toHaveBeenCalledExactlyOnceWith(ENTRY, 2, { title: 'Frá því áðan, breytt' });
    expect(c.getSnapshot()).toEqual({ version: 3, state: 'saved' });
    expect(copies.has(ENTRY)).toBe(false);
    // A second start (React remounting in development) restores nothing more.
    c.start();
    await pause(0);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('a restored copy is not sent when the form unmounts before the editor chooses', async () => {
    const { store, copies } = memoryStore();
    copies.set(ENTRY, { version: 2, data: { title: 'Frá því áðan' } });
    const save = saveAnswering({ ok: true, version: 3 });
    const c = controllerFor(save, { store });
    c.start();
    c.schedule({ title: 'Frá því áðan, breytt' });
    c.dispose();
    await pause(DEBOUNCE * 2);
    expect(save).not.toHaveBeenCalled();
    expect(copies.get(ENTRY)).toEqual({ version: 2, data: { title: 'Frá því áðan, breytt' } });
  });

  it('dropping a restored copy removes it and goes back to the loaded version, saving nothing', async () => {
    const { store, copies } = memoryStore();
    copies.set(ENTRY, { version: 2, data: { title: 'Frá því áðan' } });
    const save = saveAnswering({ ok: true, version: 4 });
    const c = controllerFor(save, { store });
    c.start();
    c.discardRestored();
    expect(c.getSnapshot()).toEqual({ version: 3, state: 'idle' });
    expect(c.pendingData()).toBeNull();
    expect(copies.has(ENTRY)).toBe(false);
    await pause(DEBOUNCE * 2);
    expect(save).not.toHaveBeenCalled();
    c.schedule({ title: 'Nýtt' });
    await pause();
    expect(save).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Nýtt' });
  });

  it('a restored copy older than the draft, once saved, goes through the conflict flow, not over the newer draft', async () => {
    const { store, copies } = memoryStore();
    copies.set(ENTRY, { version: 2, data: { title: 'Gamalt' } });
    const loadLatest = vi.fn(async () => ({ ok: true as const, version: 3, data: { title: 'Nýrra' } }));
    const c = controllerFor(saveAnswering({ ok: false, code: 'version_conflict' }), { store, loadLatest });
    c.start();
    c.saveRestored();
    await pause(0);
    expect(c.getSnapshot()).toEqual({ version: 2, state: 'conflict', theirs: { status: 'ready', version: 3, data: { title: 'Nýrra' } } });
    expect(c.pendingData()).toEqual({ title: 'Gamalt' });
    expect(copies.get(ENTRY)).toEqual({ version: 2, data: { title: 'Gamalt' } });
  });

  it('close() (sign-out) removes the copy and the pending data; afterwards nothing is saved or stored', async () => {
    const { store, copies } = memoryStore();
    const sessionIsValid = vi.fn(async () => true);
    const save = saveAnswering({ ok: false, code: 'auth' }, { ok: true, version: 4 });
    const c = controllerFor(save, { store, sessionIsValid });
    c.schedule({ title: 'Óvistað' });
    await pause();
    expect(copies.has(ENTRY)).toBe(true);
    c.close();
    expect(copies.has(ENTRY)).toBe(false);
    expect(c.pendingData()).toBeNull();
    expect(c.getSnapshot().state).toBe('signed_out');
    c.schedule({ title: 'Eftir útskráningu' });
    c.retry();
    await c.resume();
    c.dispose();
    await pause(DEBOUNCE * 2);
    expect(save).toHaveBeenCalledTimes(1);
    expect(copies.has(ENTRY)).toBe(false);
    expect(sessionIsValid).not.toHaveBeenCalled();
  });

  it('a save in flight at sign-out cannot re-create the copy, whatever it answers', async () => {
    for (const answer of [{ ok: true, version: 4 }, { ok: false, code: 'auth' }, { ok: false, code: 'error' }] as Result[]) {
      const { store, copies } = memoryStore();
      let finish!: (r: Result) => void;
      const save = vi.fn<Save>().mockImplementationOnce(() => new Promise<Result>((resolve) => (finish = resolve)));
      const c = controllerFor(save, { store });
      c.schedule({ n: 1 });
      await pause();
      // An edit during the save: without close() the answer would keep it as the next copy.
      c.schedule({ n: 2 });
      c.close();
      finish(answer);
      await pause(DEBOUNCE * 2);
      expect(copies.has(ENTRY)).toBe(false);
      expect(save).toHaveBeenCalledTimes(1);
      expect(c.getSnapshot().state).toBe('signed_out');
    }
  });

  it('a restored copy is dropped by close() too, and saveRestored() then does nothing', async () => {
    const { store, copies } = memoryStore();
    copies.set(ENTRY, { version: 2, data: { title: 'Frá því áðan' } });
    const save = saveAnswering({ ok: true, version: 3 });
    const c = controllerFor(save, { store });
    c.start();
    c.close();
    c.saveRestored();
    await pause(0);
    expect(save).not.toHaveBeenCalled();
    expect(copies.has(ENTRY)).toBe(false);
  });

  it('resume() saves the pending data only once the session is valid again', async () => {
    let valid = false;
    const save = saveAnswering({ ok: false, code: 'auth' }, { ok: true, version: 4 });
    const c = controllerFor(save, { sessionIsValid: async () => valid });
    c.schedule({ title: 'Allt' });
    await pause();
    expect(c.getSnapshot().state).toBe('signed_out');
    await c.resume();
    await pause(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(c.getSnapshot().state).toBe('signed_out');
    valid = true;
    await c.resume();
    await pause(0);
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 3, { title: 'Allt' });
    expect(c.getSnapshot()).toEqual({ version: 4, state: 'saved' });
  });

  it('resume() does nothing unless signed out', async () => {
    const sessionIsValid = vi.fn(async () => true);
    const save = saveAnswering({ ok: false, code: 'error' });
    const c = controllerFor(save, { sessionIsValid });
    c.schedule({ a: 1 });
    await pause();
    expect(c.getSnapshot().state).toBe('error');
    await c.resume();
    expect(sessionIsValid).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('the hook checks again every few seconds and when the tab gets focus, while signed out only', async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    let valid = false;
    const sessionIsValid = vi.fn(async () => valid);
    const save = saveAnswering({ ok: false, code: 'auth' }, { ok: true, version: 4 });
    let seen: ReturnType<typeof useAutosave> | undefined;
    const Probe = (): ReactElement => {
      seen = useAutosave({ entryId: ENTRY, initialVersion: 3, save, sessionIsValid });
      return createElement('p', null, seen.state);
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => root.render(createElement(Probe)));
    await act(async () => seen!.schedule({ title: 'Allt' }));
    await act(async () => {
      await pause();
    });
    expect(host.textContent).toBe('signed_out');
    await act(async () => {
      await pause(RESUME_POLL_MS);
    });
    expect(sessionIsValid).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);

    valid = true;
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await pause(0);
    });
    expect(save).toHaveBeenNthCalledWith(2, ENTRY, 3, { title: 'Allt' });
    expect(host.textContent).toBe('saved');
    // Saved: no more checks.
    await act(async () => {
      await pause(RESUME_POLL_MS * 3);
    });
    expect(sessionIsValid).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });
});
