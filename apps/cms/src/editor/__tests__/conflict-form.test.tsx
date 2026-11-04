// @vitest-environment jsdom
// M2-11: the form's conflict view (spec §5.5). A stale save keeps the editor's values, shows the
// newer version's differing fields next to them, and offers "reload theirs" and "keep mine".
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => actions);
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: vi.fn(), assetPreviewAction: vi.fn(), updateAssetAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u' } }, error: null }) } }) }));

const { EntryForm } = await import('../form/EntryForm');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';
const FIELDS = [
  { key: 'title', kind: 'text', label: 'Titill', required: true },
  { key: 'excerpt', kind: 'text', label: 'Inngangur', required: false, multiline: true },
];
const r = t.editor.resolve;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // Unsaved copies stay in the tab (M2-17); each test starts with an empty one.
  sessionStorage.clear();
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const alert = () => container.querySelector<HTMLElement>('[role="alert"]');
const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const pause = (ms = 1500) => act(async () => vi.advanceTimersByTimeAsync(ms));

async function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const REVISION = { id: '00000000-0000-4000-8000-0000000000d1', committedAt: '2026-11-01T09:05:00Z', mine: true, current: true };

async function renderInConflict(theirs: Record<string, unknown> = { title: 'Þeirra titill', excerpt: 'Inngangur' }) {
  actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'version_conflict' });
  actions.loadDraftAction.mockResolvedValue({ ok: true, version: 5, data: theirs });
  await act(async () =>
    root.render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={FIELDS}
        titleKey="title"
        initialData={{ title: 'Upphaf', excerpt: 'Inngangur' }}
        initialVersion={3}
        initialSlug={null}
        slugLocked={false}
        revisions={[REVISION]}
      />,
    ),
  );
  await type($<HTMLInputElement>('#field-title')!, 'Minn titill');
  await pause();
}

describe('the conflict view (M2-11)', () => {
  it('keeps the editor\'s values and shows only the differing fields, theirs next to mine', async () => {
    await renderInConflict();
    expect(actions.saveDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY, 3, { title: 'Minn titill', excerpt: 'Inngangur' }, USER);
    expect(actions.loadDraftAction).toHaveBeenCalledExactlyOnceWith(ENTRY);
    expect(alert()?.textContent).toContain(t.editor.conflict);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Minn titill');
    const rows = [...container.querySelectorAll('[data-testid="conflict-field"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Titill');
    expect(rows[0]!.querySelector('[data-side="theirs"]')?.textContent).toContain('Þeirra titill');
    expect(rows[0]!.querySelector('[data-side="mine"]')?.textContent).toContain('Minn titill');
    expect(button(r.reloadTheirs)).toBeDefined();
    expect(button(r.keepMine)).toBeDefined();
  });

  it('the comparison follows edits made during the conflict, which are not saved yet', async () => {
    await renderInConflict();
    await type($<HTMLTextAreaElement>('#field-excerpt')!, 'Nýr inngangur');
    await pause();
    expect(actions.saveDraftAction).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid="conflict-field"]')).toHaveLength(2);
  });

  it('"keep mine" saves the editor\'s values at the newer version and clears the notice', async () => {
    await renderInConflict();
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 6 });
    await act(async () => button(r.keepMine)!.click());
    await pause(0);
    expect(actions.saveDraftAction).toHaveBeenLastCalledWith(ENTRY, 5, { title: 'Minn titill', excerpt: 'Inngangur' }, USER);
    expect(alert()).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t.editor.saved);
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Minn titill');
  });

  it('"reload theirs" puts their values in the form and continues from their version', async () => {
    await renderInConflict();
    await act(async () => button(r.reloadTheirs)!.click());
    expect(alert()).toBeNull();
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Þeirra titill');
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 6 });
    await type($<HTMLInputElement>('#field-title')!, 'Þeirra titill, breytt');
    await pause();
    expect(actions.saveDraftAction).toHaveBeenLastCalledWith(ENTRY, 5, { title: 'Þeirra titill, breytt', excerpt: 'Inngangur' }, USER);
  });

  it('says when the versions are the same in every field', async () => {
    await renderInConflict({ title: 'Minn titill', excerpt: 'Inngangur' });
    expect(alert()?.textContent).toContain(r.same);
    expect(container.querySelectorAll('[data-testid="conflict-field"]')).toHaveLength(0);
  });

  it('when the newer version cannot be read, offers to try again and to reload the page, and keeps the values', async () => {
    actions.loadDraftAction.mockReset();
    actions.saveDraftAction.mockResolvedValueOnce({ ok: false, code: 'version_conflict' });
    actions.loadDraftAction.mockResolvedValueOnce({ ok: false, code: 'error' }).mockResolvedValueOnce({ ok: true, version: 5, data: { title: 'Þeirra titill' } });
    await act(async () =>
      root.render(<EntryForm tenant={TENANT} userId={USER} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={3} initialSlug={null} slugLocked={false} />),
    );
    await type($<HTMLInputElement>('#field-title')!, 'Minn titill');
    await pause();
    expect(alert()?.textContent).toContain(r.loadError);
    expect(button(t.editor.reload)).toBeDefined();
    expect(button(r.keepMine)).toBeUndefined();
    expect($<HTMLInputElement>('#field-title')!.value).toBe('Minn titill');
    await act(async () => button(t.editor.retry)!.click());
    await pause(0);
    expect(button(r.keepMine)).toBeDefined();
  });

  it('the publish panel stays disabled until the conflict is resolved', async () => {
    await renderInConflict();
    const publish = () => [...container.querySelectorAll('button')].find((b) => b.textContent === t.publish.publish);
    expect(publish()?.disabled).toBe(true);
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 6 });
    await act(async () => button(r.keepMine)!.click());
    await pause(0);
    expect(publish()?.disabled).toBe(false);
  });
});

// M2-16: restore follows the form's version and state like publishing does.
describe('restore in the form (M2-16)', () => {
  it('restore is disabled during the conflict, then restores at the version the form continues from', async () => {
    await renderInConflict();
    const h = t.editor.history;
    expect(button(h.restore)?.disabled).toBe(true);
    actions.saveDraftAction.mockResolvedValueOnce({ ok: true, version: 6 });
    await act(async () => button(r.keepMine)!.click());
    await pause(0);
    expect(button(h.restore)?.disabled).toBe(false);
    actions.restoreRevisionAction.mockReturnValueOnce(new Promise(() => {}));
    await act(async () => button(h.restore)!.click());
    await act(async () => button(h.confirmRestore)!.click());
    expect(actions.restoreRevisionAction).toHaveBeenCalledExactlyOnceWith(ENTRY, REVISION.id, 6);
  });

  it('restore waits while an edit is not saved yet', async () => {
    await act(async () =>
      root.render(<EntryForm tenant={TENANT} userId={USER} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={3} initialSlug={null} slugLocked={false} revisions={[REVISION]} />),
    );
    await type($<HTMLInputElement>('#field-title')!, 'Óvistað');
    await act(async () => button(t.editor.history.restore)!.click());
    expect(container.textContent).toContain(t.editor.history.unsaved);
    expect(actions.restoreRevisionAction).not.toHaveBeenCalled();
  });

  it('says once that an older publication was restored, when the page was opened after a restore', async () => {
    await act(async () =>
      root.render(<EntryForm tenant={TENANT} userId={USER} entryId={ENTRY} fields={FIELDS} titleKey="title" initialData={{ title: 'Upphaf' }} initialVersion={4} initialSlug={null} slugLocked={false} restored />),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(t.editor.history.restored);
  });
});
