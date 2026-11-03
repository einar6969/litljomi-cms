// @vitest-environment jsdom
// The entry's revision history and restore (plan M2-16; spec §5.5): published revisions newest
// first with when and who, the one on the site marked; restore asks first, waits for unsaved
// edits, sends the version the editor saw, and reopens the page after a restore.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import type { RestoreRevisionResult } from '@/app/(editor)/t/[tenant]/actions';
import type { RevisionSummary } from '../revisions';

vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ restoreRevisionAction: vi.fn() }));

const { RevisionHistory } = await import('../form/RevisionHistory');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = t.editor.history;
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const NEWER: RevisionSummary = { id: '00000000-0000-4000-8000-0000000000d2', committedAt: '2026-11-02T14:30:00Z', mine: false, current: true };
const OLDER: RevisionSummary = { id: '00000000-0000-4000-8000-0000000000d1', committedAt: '2026-11-01T09:05:00Z', mine: true, current: false };

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const buttons = (name: string) => [...container.querySelectorAll('button')].filter((b) => b.textContent === name);
const items = () => [...container.querySelectorAll('[data-testid="revision"]')];
const text = () => container.textContent ?? '';

type Options = { revisions?: RevisionSummary[]; unsaved?: boolean; disabled?: boolean };

async function render(restore: (entryId: string, revisionId: string, version: number) => Promise<RestoreRevisionResult>, o: Options = {}) {
  const spy = vi.fn(restore);
  const onRestored = vi.fn();
  const unsaved = { value: o.unsaved ?? false };
  await act(async () =>
    root.render(
      <RevisionHistory
        entryId={ENTRY}
        revisions={o.revisions ?? [NEWER, OLDER]}
        version={7}
        disabled={o.disabled ?? false}
        hasUnsaved={() => unsaved.value}
        restore={spy}
        onRestored={onRestored}
      />,
    ),
  );
  return { restore: spy, onRestored, unsaved };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Clicks "restore" on the older revision, then confirms. */
async function restoreOlder() {
  await act(async () => items()[1]!.querySelector('button')!.click());
  await act(async () => buttons(h.confirmRestore)[0]!.click());
}

describe('RevisionHistory', () => {
  it('lists the published revisions newest first, with when, who, and the one on the site', async () => {
    await render(async () => ({ ok: true, version: 8 }));
    expect(container.querySelector('h2')?.textContent).toBe(h.title);
    const [first, second] = items();
    expect(first!.textContent).toContain(h.byOther);
    expect(first!.textContent).toContain(h.current);
    expect(first!.querySelector('time')!.getAttribute('dateTime')).toBe(NEWER.committedAt);
    expect(second!.textContent).toContain(h.byMe);
    expect(second!.textContent).not.toContain(h.current);
    // Reykjavik time, Icelandic format.
    expect(second!.querySelector('time')!.textContent).toBe(new Date(OLDER.committedAt).toLocaleString('is-IS', { timeZone: 'Atlantic/Reykjavik', dateStyle: 'medium', timeStyle: 'short' }));
    expect(buttons(h.restore)).toHaveLength(2);
  });

  it('says so when the entry has never been published', async () => {
    await render(async () => ({ ok: true, version: 8 }), { revisions: [] });
    expect(text()).toContain(h.empty);
    expect(items()).toHaveLength(0);
  });

  it('asks before restoring; cancel restores nothing', async () => {
    const { restore } = await render(async () => ({ ok: true, version: 8 }));
    await act(async () => items()[1]!.querySelector('button')!.click());
    expect(text()).toContain(h.confirm);
    expect(restore).not.toHaveBeenCalled();
    await act(async () => buttons(h.cancel)[0]!.click());
    expect(text()).not.toContain(h.confirm);
    expect(restore).not.toHaveBeenCalled();
  });

  it('restores the chosen revision at the version the editor saw, then reopens the page', async () => {
    const pending = deferred<RestoreRevisionResult>();
    const { restore, onRestored } = await render(() => pending.promise);
    await restoreOlder();
    expect(restore).toHaveBeenCalledWith(ENTRY, OLDER.id, 7);
    expect(buttons(h.restoring)).toHaveLength(1);
    expect(buttons(h.restore).every((b) => b.disabled)).toBe(true);
    expect(onRestored).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, version: 8 }));
    expect(onRestored).toHaveBeenCalledTimes(1);
    expect(buttons(h.restore).every((b) => b.disabled)).toBe(true);
  });

  it('waits for unsaved edits: no restore while an edit is not saved yet', async () => {
    const { restore, unsaved } = await render(async () => ({ ok: true, version: 8 }), { unsaved: true });
    await act(async () => items()[1]!.querySelector('button')!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(h.unsaved);
    expect(restore).not.toHaveBeenCalled();
    // An edit made after the question was asked is caught at the confirm too.
    unsaved.value = false;
    await act(async () => items()[1]!.querySelector('button')!.click());
    unsaved.value = true;
    await act(async () => buttons(h.confirmRestore)[0]!.click());
    expect(restore).not.toHaveBeenCalled();
    expect(text()).toContain(h.unsaved);
  });

  it('is disabled while the form is in a conflict or signed out', async () => {
    await render(async () => ({ ok: true, version: 8 }), { disabled: true });
    expect(buttons(h.restore).every((b) => b.disabled)).toBe(true);
  });

  it.each([
    ['version_conflict', t.editor.conflict],
    ['auth', t.editor.signedOut],
    ['upcast_failed', h.cannot],
    ['invalid', h.cannot],
    ['error', h.failed],
  ] as const)('a %s answer shows its message and does not reopen the page', async (code, message) => {
    const { onRestored } = await render(async () => ({ ok: false, code }));
    await restoreOlder();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('a thrown action is the generic failure', async () => {
    await render(async () => {
      throw new Error('network');
    });
    await restoreOlder();
    expect(text()).toContain(h.failed);
  });
});
