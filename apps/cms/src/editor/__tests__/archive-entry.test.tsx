// @vitest-environment jsdom
// A6: archiving an entry that is not published, from its page, after a confirmation.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ archiveEntryAction: vi.fn() }));

const { ArchiveEntry } = await import('../form/ArchiveEntry');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
const LIST = '/t/acme/news';
const a = t.editor.archive;

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

const button = (name: string) => [...container.querySelectorAll('button')].find((b) => b.textContent === name);
const alert = () => container.querySelector('[role="alert"]')?.textContent;

type ArchiveProps = Parameters<typeof ArchiveEntry>[0];
async function render(props: Partial<ArchiveProps> = {}) {
  const archive = vi.fn<NonNullable<ArchiveProps['archive']>>(async () => ({ ok: true, listPath: LIST }));
  const onArchived = vi.fn();
  const beforeLeave = vi.fn();
  await act(async () => root.render(<ArchiveEntry entryId={ENTRY} archive={archive} onArchived={onArchived} beforeLeave={beforeLeave} {...props} />));
  return { archive, onArchived, beforeLeave };
}

describe('ArchiveEntry (A6)', () => {
  it('asks first, then archives and goes to the list', async () => {
    const { archive, onArchived, beforeLeave } = await render();
    await act(async () => button(a.button)!.click());
    expect(archive).not.toHaveBeenCalled();
    expect(container.textContent).toContain(a.confirm);
    await act(async () => button(a.confirmButton)!.click());
    expect(archive).toHaveBeenCalledExactlyOnceWith(ENTRY);
    expect(beforeLeave).toHaveBeenCalledOnce();
    expect(onArchived).toHaveBeenCalledExactlyOnceWith(LIST);
  });

  it('"Hætta við" archives nothing', async () => {
    const { archive } = await render();
    await act(async () => button(a.button)!.click());
    await act(async () => button(a.cancel)!.click());
    expect(button(a.confirmButton)).toBeUndefined();
    expect(button(a.button)).toBeDefined();
    expect(archive).not.toHaveBeenCalled();
  });

  it('says so when the entry is published, or the request fails, and stays on the page', async () => {
    const archive = vi.fn<NonNullable<ArchiveProps['archive']>>(async () => ({ ok: false, code: 'published' }));
    const { onArchived, beforeLeave } = await render({ archive });
    await act(async () => button(a.button)!.click());
    await act(async () => button(a.confirmButton)!.click());
    expect(alert()).toBe(a.published);
    archive.mockRejectedValueOnce(new Error('offline'));
    await act(async () => button(a.button)!.click());
    await act(async () => button(a.confirmButton)!.click());
    expect(alert()).toBe(a.failed);
    archive.mockResolvedValueOnce({ ok: false, code: 'auth' });
    await act(async () => button(a.button)!.click());
    await act(async () => button(a.confirmButton)!.click());
    expect(alert()).toBe(t.editor.signedOut);
    expect(onArchived).not.toHaveBeenCalled();
    expect(beforeLeave).not.toHaveBeenCalled();
  });

  it('cannot be used while the form is blocked', async () => {
    await render({ disabled: true });
    expect(button(a.button)!.disabled).toBe(true);
  });
});
