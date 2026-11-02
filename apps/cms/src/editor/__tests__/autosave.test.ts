// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveController, useAutosave } from '../autosave';

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
