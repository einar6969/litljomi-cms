// @vitest-environment jsdom
// Media library L6 (docs/plans/media-library.md sections 6.3 and 6.4): the library in pick mode, a
// native dialog over the form. It lists the tenant's images newest first, searches them, selects
// one or many in the order chosen, uploads inside the dialog (the uploads arrive selected), and is
// worked with the keyboard: one tab stop, the arrow keys, Space to select, Enter to confirm.
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const mocks = vi.hoisted(() => ({
  pickerFilesAction: vi.fn(),
  registerAssetAction: vi.fn(),
  ensureThumbnailAction: vi.fn(),
  uploadWithProgress: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => mocks);
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('../upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../upload')>()), uploadWithProgress: mocks.uploadWithProgress }));

const { LibraryPicker } = await import('../media/LibraryPicker');
const { EditorTenantProvider } = await import('../form/tenant-context');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has the element but not its modal behaviour.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const file = (n: number, o: Record<string, unknown> = {}) => ({
  id: id(n),
  filename: `mynd-${n}.jpg`,
  defaultAlt: n === 2 ? 'Önnur mynd' : null,
  width: 800,
  height: 600,
  bytes: 61_952,
  thumbUrl: `http://127.0.0.1:54321/storage/v1/object/sign/media-private/t${n}?token=t`,
  ...o,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [file(1), file(2), file(3)], hasMore: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
});

const render = async (element: ReactElement) => act(async () => root.render(<EditorTenantProvider value={TENANT}>{element}</EditorTenantProvider>));
const until = (assertion: () => void) => act(async () => vi.waitFor(assertion));
// The dialog is rendered into document.body, outside the form.
const dialog = () => document.querySelector<HTMLDialogElement>('dialog')!;
const options = () => [...dialog().querySelectorAll<HTMLElement>('[role="option"]')];
const button = (name: string) => [...dialog().querySelectorAll('button')].find((b) => b.textContent === name || b.getAttribute('aria-label') === name);
const press = async (el: HTMLElement, key: string) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));

async function open(mode: 'one' | 'many', onPick = vi.fn(), onClose = vi.fn()) {
  await render(<LibraryPicker mode={mode} fieldLabel="Myndir" onPick={onPick} onClose={onClose} />);
  await until(() => expect(options()).toHaveLength(3));
  return { onPick, onClose };
}

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('LibraryPicker', () => {
  it("opens as a modal dialog outside the form, titled for its mode and naming the field, and lists the tenant's images", async () => {
    await open('many');
    expect(dialog().open).toBe(true);
    expect(container.contains(dialog())).toBe(false);
    const [titleId, fieldId] = dialog().getAttribute('aria-labelledby')!.split(' ');
    expect(document.getElementById(titleId!)!.textContent).toBe(t.picker.titleMany);
    expect(document.getElementById(fieldId!)!.textContent).toBe('Myndir');
    expect(mocks.pickerFilesAction).toHaveBeenCalledWith(TENANT.slug, '', 1);
    // Each file is an option named by its file name and alt text; its thumbnail is decorative.
    expect(options().map((o) => o.getAttribute('aria-label'))).toEqual(['mynd-1.jpg', 'mynd-2.jpg, Önnur mynd', 'mynd-3.jpg']);
    expect(options()[0]!.querySelector('img')!.getAttribute('alt')).toBe('');
    expect(dialog().querySelector('[role="listbox"]')!.getAttribute('aria-multiselectable')).toBe('true');
  });

  it('is titled for one image in one-file mode', async () => {
    await open('one');
    const [titleId] = dialog().getAttribute('aria-labelledby')!.split(' ');
    expect(document.getElementById(titleId!)!.textContent).toBe(t.picker.titleOne);
    expect(dialog().querySelector('[role="listbox"]')!.hasAttribute('aria-multiselectable')).toBe(false);
  });

  it('selects several in the order chosen, announces the count and hands them over in that order with their default alt text', async () => {
    const { onPick, onClose } = await open('many');
    const confirm = () => dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!;
    expect(confirm().disabled).toBe(true);
    for (const n of [3, 1, 2]) await act(async () => options()[n - 1]!.click());
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'true', 'true']);
    expect(dialog().querySelector('[data-testid="picker-count"]')!.textContent).toBe(t.picker.selectedMany.replace('{n}', '3'));
    expect(dialog().querySelector('[data-testid="picker-count"]')!.getAttribute('aria-live')).toBe('polite');
    expect(confirm().textContent).toBe(t.picker.confirmMany.replace('{n}', '3'));
    // Clicked again, a file leaves the selection.
    await act(async () => options()[0]!.click());
    expect(dialog().querySelector('[data-testid="picker-count"]')!.textContent).toBe(t.picker.selectedMany.replace('{n}', '2'));
    await act(async () => options()[0]!.click());
    await act(async () => confirm().click());
    expect(onPick).toHaveBeenCalledWith([
      { id: id(3), defaultAlt: null },
      { id: id(2), defaultAlt: 'Önnur mynd' },
      { id: id(1), defaultAlt: null },
    ]);
    expect(onClose).toHaveBeenCalled();
  });

  it('holds one file in one-file mode', async () => {
    const { onPick } = await open('one');
    await act(async () => options()[0]!.click());
    await act(async () => options()[1]!.click());
    expect(options().map((o) => o.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(dialog().querySelector('[data-testid="picker-confirm"]')!.textContent).toBe(t.picker.confirmOne);
    await act(async () => dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.click());
    expect(onPick).toHaveBeenCalledWith([{ id: id(2), defaultAlt: 'Önnur mynd' }]);
  });

  it('is one tab stop worked with the keyboard: arrows move, Space selects, Enter confirms', async () => {
    const { onPick } = await open('many');
    expect(options().map((o) => o.tabIndex)).toEqual([0, -1, -1]);
    options()[0]!.focus();
    await press(options()[0]!, 'ArrowRight');
    expect(document.activeElement).toBe(options()[1]);
    expect(options().map((o) => o.tabIndex)).toEqual([-1, 0, -1]);
    await press(options()[1]!, ' ');
    await press(options()[1]!, 'End');
    expect(document.activeElement).toBe(options()[2]);
    await press(options()[2]!, ' ');
    await press(options()[2]!, 'Enter');
    expect(onPick).toHaveBeenCalledWith([
      { id: id(2), defaultAlt: 'Önnur mynd' },
      { id: id(3), defaultAlt: null },
    ]);
  });

  it('picks the focused file with Enter in one-file mode', async () => {
    const { onPick } = await open('one');
    options()[0]!.focus();
    await press(options()[0]!, 'ArrowRight');
    await press(options()[1]!, 'Enter');
    expect(onPick).toHaveBeenCalledWith([{ id: id(2), defaultAlt: 'Önnur mynd' }]);
  });

  it('searches, says when nothing matches, and clears the search', async () => {
    await open('one');
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [], hasMore: false });
    const search = dialog().querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search.labels?.[0]?.textContent).toBe(t.library.search);
    await type(search, 'brauð');
    await act(async () => search.form!.requestSubmit());
    await until(() => expect(dialog().textContent).toContain(t.library.none));
    expect(mocks.pickerFilesAction).toHaveBeenLastCalledWith(TENANT.slug, 'brauð', 1);
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [file(1)], hasMore: false });
    await act(async () => button(t.entries.filter.clear)!.click());
    await until(() => expect(options()).toHaveLength(1));
    expect(mocks.pickerFilesAction).toHaveBeenLastCalledWith(TENANT.slug, '', 1);
  });

  it('shows the empty library with its sentence', async () => {
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [], hasMore: false });
    await render(<LibraryPicker mode="one" fieldLabel="Mynd" onPick={vi.fn()} onClose={vi.fn()} />);
    await until(() => expect(dialog().textContent).toContain(t.picker.empty));
  });

  it('loads the next page with "Sýna fleiri", keeping the selection', async () => {
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [file(1), file(2), file(3)], hasMore: true });
    await open('many');
    await act(async () => options()[1]!.click());
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [file(1), file(2), file(3), file(4)], hasMore: false });
    await act(async () => button(t.library.more)!.click());
    await until(() => expect(options()).toHaveLength(4));
    expect(mocks.pickerFilesAction).toHaveBeenLastCalledWith(TENANT.slug, '', 2);
    expect(options()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(button(t.library.more)).toBeUndefined();
  });

  it('says so when the files cannot be loaded, and tries again; a lost session is named as such', async () => {
    mocks.pickerFilesAction.mockResolvedValue({ ok: false, code: 'error' });
    await render(<LibraryPicker mode="one" fieldLabel="Mynd" onPick={vi.fn()} onClose={vi.fn()} />);
    await until(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(t.picker.loadError));
    mocks.pickerFilesAction.mockResolvedValue({ ok: false, code: 'auth' });
    await act(async () => button(t.editor.retry)!.click());
    await until(() => expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(t.editor.signedOut));
    mocks.pickerFilesAction.mockResolvedValue({ ok: true, files: [file(1)], hasMore: false });
    await act(async () => button(t.editor.retry)!.click());
    await until(() => expect(options()).toHaveLength(1));
  });

  it('uploads inside the dialog: the files arrive selected, in the order chosen, and the list shows them', async () => {
    const { onPick } = await open('many');
    await act(async () => options()[0]!.click());
    mocks.uploadWithProgress.mockResolvedValue('ok');
    // The second file's registration answers first: the selection still follows the order chosen.
    let releaseFirst: () => void = () => {};
    mocks.registerAssetAction.mockImplementation(
      (_slug: string, assetId: string, _path: string, filename: string) =>
        new Promise((resolve) => {
          if (filename === 'fyrri.png') releaseFirst = () => resolve({ ok: true, assetId });
          else resolve({ ok: true, assetId });
        }),
    );
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    const png = (name: string) => new File([new Uint8Array(64)], name, { type: 'image/png' });
    Object.defineProperty(input, 'files', { configurable: true, value: [png('Fyrri.png'), png('Seinni.png')] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => expect(mocks.registerAssetAction).toHaveBeenCalledTimes(2));
    mocks.pickerFilesAction.mockClear();
    await act(async () => releaseFirst());
    await until(() => expect(mocks.pickerFilesAction).toHaveBeenCalledWith(TENANT.slug, '', 1));
    expect(dialog().querySelector('[data-testid="upload-summary"]')!.textContent).toBe(t.upload.resultMany.replace('{n}', '2'));
    const [first, second] = mocks.registerAssetAction.mock.calls.map((c) => c[1] as string);
    await act(async () => dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.click());
    expect(onPick).toHaveBeenCalledWith([
      { id: id(1), defaultAlt: null },
      { id: first, defaultAlt: null },
      { id: second, defaultAlt: null },
    ]);
  });

  it('takes one file to upload in one-file mode, and selects it', async () => {
    const { onPick } = await open('one');
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.multiple).toBe(false);
    mocks.uploadWithProgress.mockResolvedValue('ok');
    mocks.registerAssetAction.mockImplementation(async (_slug: string, assetId: string) => ({ ok: true, assetId }));
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(64)], 'a.png', { type: 'image/png' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => expect(mocks.registerAssetAction).toHaveBeenCalledTimes(1));
    await until(() => expect(dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.disabled).toBe(false));
    await act(async () => dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.click());
    expect(onPick).toHaveBeenCalledWith([{ id: mocks.registerAssetAction.mock.calls[0]![1], defaultAlt: null }]);
  });

  it('names a refused upload on its row and selects nothing for it', async () => {
    await open('many');
    const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new File([new Uint8Array(8)], 'a.heic', { type: 'image/heic' })] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => expect(dialog().querySelector('li[data-state="failed"] [role="alert"]')?.textContent).toBe(t.editor.image.type));
    expect(dialog().querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.disabled).toBe(true);
  });

  it('closes from its close button, and the dialog closing (Escape) closes it too', async () => {
    const { onClose, onPick } = await open('one');
    await act(async () => button(t.library.detail.close)!.click());
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => void dialog().dispatchEvent(new Event('close')));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onPick).not.toHaveBeenCalled();
  });

  it('gives focus back to the button that opened it', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    await open('one');
    expect(document.activeElement).toBe(dialog().querySelector('input[type="search"]'));
    await act(async () => root.render(<EditorTenantProvider value={TENANT}>{null}</EditorTenantProvider>));
    expect(document.activeElement).toBe(opener);
  });
});
