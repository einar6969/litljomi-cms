// @vitest-environment jsdom
// An outdated draft in the editor (plan M2-14; spec §5.3): a clear notice, an update (upcast and
// versioned save, on the server), and no form or publish until the draft is at the current version.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import type { UpdateDraftSchemaResult } from '@/app/(editor)/t/[tenant]/actions';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ updateDraftSchemaAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));

const { OutdatedDraft } = await import('../form/OutdatedDraft');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  router.refresh.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const text = () => container.textContent ?? '';

async function render(update: (id: string, version: number) => Promise<UpdateDraftSchemaResult>, published = false) {
  const spy = vi.fn(update);
  await act(async () =>
    root.render(<OutdatedDraft entryId={ENTRY} version={5} published={published} fieldLabels={{ title: 'Titill' }} update={spy} loadStatus={async () => null} />),
  );
  return spy;
}

/** Resolves when told to: lets the test see the state while the update is in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('OutdatedDraft', () => {
  it('shows a clear notice and an update button, and no publish while the draft is outdated', async () => {
    await render(async () => ({ ok: true, version: 6 }));
    const notice = container.querySelector('[role="alert"]');
    expect(notice?.textContent).toContain(t.editor.outdated.title);
    expect(notice?.textContent).toContain(t.editor.outdated.body);
    expect(button(t.editor.outdated.update)).toBeDefined();
    expect(button(t.publish.publish)!.disabled).toBe(true);
    // No field of the form is shown: an edit at the old version could not be saved correctly.
    expect(container.querySelector('input, textarea, [contenteditable]')).toBeNull();
  });

  it('updates the draft at the version the editor saw, then reloads the page data', async () => {
    const pending = deferred<UpdateDraftSchemaResult>();
    const update = await render(() => pending.promise);
    await act(async () => button(t.editor.outdated.update)!.click());
    expect(update).toHaveBeenCalledWith(ENTRY, 5);
    expect(button(t.editor.outdated.updating)!.disabled).toBe(true);
    expect(router.refresh).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ ok: true, version: 6 }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    // Stays disabled until the refreshed page replaces this one.
    expect(button(t.editor.outdated.updating)!.disabled).toBe(true);
  });

  it('a version conflict says someone else changed the entry and offers a reload', async () => {
    await render(async () => ({ ok: false, code: 'version_conflict' }));
    await act(async () => button(t.editor.outdated.update)!.click());
    expect(text()).toContain(t.editor.conflict);
    expect(button(t.editor.reload)).toBeDefined();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('a lost session asks the editor to sign in again, and the update can be tried again', async () => {
    const answers: UpdateDraftSchemaResult[] = [{ ok: false, code: 'auth' }, { ok: true, version: 6 }];
    await render(async () => answers.shift()!);
    await act(async () => button(t.editor.outdated.update)!.click());
    expect(text()).toContain(t.editor.signedOut);
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
    await act(async () => button(t.editor.outdated.update)!.click());
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it('a generic failure, or a thrown action, can be tried again', async () => {
    await render(async () => {
      throw new Error('network');
    });
    await act(async () => button(t.editor.outdated.update)!.click());
    expect([...container.querySelectorAll('[role="alert"]')].map((a) => a.textContent)).toContain(t.editor.outdated.failed);
    expect(button(t.editor.outdated.update)!.disabled).toBe(false);
  });

  it.each(['upcast_failed', 'invalid'] as const)('a draft that cannot be updated automatically (%s) says so and offers no retry', async (code) => {
    await render(async () => ({ ok: false, code }));
    await act(async () => button(t.editor.outdated.update)!.click());
    expect(text()).toContain(t.editor.outdated.cannotUpdate);
    expect(button(t.editor.outdated.update)).toBeUndefined();
  });

  it('a published entry can still be taken down while its draft is outdated', async () => {
    await render(async () => ({ ok: true, version: 6 }), true);
    expect(button(t.publish.unpublish)!.disabled).toBe(false);
  });
});
