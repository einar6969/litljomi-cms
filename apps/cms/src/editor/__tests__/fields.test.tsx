// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({
  registerAssetAction: vi.fn(),
  assetPreviewAction: vi.fn(),
  updateAssetAction: vi.fn(),
  pickerFilesAction: vi.fn(),
  ensureThumbnailAction: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);
// The browser client is only passed to uploadOriginal, which is replaced below.
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
// The form's publish panel (Task 25) is tested in publish-panel.test.tsx.
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
const uploadOriginal = vi.hoisted(() => vi.fn());
vi.mock('../upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../upload')>()), uploadOriginal }));

const { TextField } = await import('../form/fields/TextField');
const { DateField } = await import('../form/fields/DateField');
const { LinkField } = await import('../form/fields/LinkField');
const { ImageField } = await import('../form/fields/ImageField');
const { RichTextField } = await import('../form/fields/RichTextField');
const { EditorTenantProvider } = await import('../form/tenant-context');
const { EntryForm } = await import('../form/EntryForm');
const { describeFields } = await import('../form/descriptors');
const { getType } = await import('@/modules/registry');
const { richTextDocSchema } = await import('@litljomi/rich-text');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has the element but not its modal behaviour (the library picker, media library L6).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // Unsaved copies stay in the tab (M2-17); each test starts with an empty one.
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (element: ReactElement) => act(async () => root.render(<EditorTenantProvider value={TENANT}>{element}</EditorTenantProvider>));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
/** Waits, inside act, until the assertion passes (vi.waitFor's default 1 s timeout). */
const until = (assertion: () => void) => act(async () => vi.waitFor(assertion));

/** Types into a React-controlled input the way a user does (the native setter, then `input`). */
async function type(input: HTMLInputElement | HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
  // The picker is disabled while an upload is in progress; a file refused before upload never disables it.
  await until(() => expect(input.disabled).toBe(false));
}

const field = { id: 'field-x', label: 'Reitur', required: false };

describe('TextField and DateField', () => {
  it('saves the typed text and clears the field when emptied', async () => {
    const onChange = vi.fn();
    await render(<TextField {...field} value="a" onChange={onChange} max={10} />);
    const input = $<HTMLInputElement>('#field-x')!;
    expect(input.maxLength).toBe(10);
    await type(input, 'abc');
    await type(input, '');
    expect(onChange.mock.calls).toEqual([['abc'], [undefined]]);
  });

  it('is a textarea when multiline', async () => {
    await render(<TextField {...field} value={undefined} onChange={() => {}} multiline />);
    expect($('textarea#field-x')).not.toBeNull();
  });

  it('saves an ISO date and clears it', async () => {
    const onChange = vi.fn();
    await render(<DateField {...field} value="2025-01-02" onChange={onChange} />);
    const input = $<HTMLInputElement>('#field-x')!;
    expect(input.value).toBe('2025-01-02');
    await type(input, '2025-03-04');
    await type(input, '');
    expect(onChange.mock.calls).toEqual([['2025-03-04'], [undefined]]);
  });
});

describe('LinkField', () => {
  it('never saves an invalid address, and saves a valid one in canonical form', async () => {
    const onChange = vi.fn();
    await render(<LinkField {...field} value={undefined} onChange={onChange} />);
    const input = $<HTMLInputElement>('#field-x')!;
    await type(input, 'javascript:alert(1)');
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.editor.invalidUrl);
    // The error describes the input without becoming part of its name (Task 31 spec-quality r1).
    expect(input.getAttribute('aria-describedby')).toBe(container.querySelector('[role="alert"]')?.id);
    expect(input.closest('label')?.textContent).not.toContain(t.editor.invalidUrl);
    await type(input, 'HTTPS://Example.com');
    expect(onChange).toHaveBeenLastCalledWith({ href: 'https://example.com/' });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  });

  it('shows an entry link as a notice and leaves it alone', async () => {
    await render(<LinkField {...field} value={{ entry: { _ref: ENTRY, _kind: 'entry' } }} onChange={() => {}} />);
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.editor.entryLink);
    expect($('input')).toBeNull();
  });
});

describe('ImageField', () => {
  const png = () => new File([new Uint8Array(1024)], 'Brauð.png', { type: 'image/png' });

  it('rejects a HEIC or a PDF before upload, with its message', async () => {
    await render(<ImageField {...field} value={undefined} onChange={vi.fn()} />);
    await chooseFile($<HTMLInputElement>('#field-x')!, new File([new Uint8Array(10)], 'a.heic', { type: 'image/heic' }));
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.type);
    await chooseFile($<HTMLInputElement>('#field-x')!, new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' }));
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.type);
    expect(uploadOriginal).not.toHaveBeenCalled();
    expect(actions.registerAssetAction).not.toHaveBeenCalled();
  });

  it('uploads to the tenant path, has the server register it, and stores the reference with an empty alt', async () => {
    uploadOriginal.mockResolvedValue(true);
    actions.registerAssetAction.mockImplementation(async (_slug: string, assetId: string) => ({ ok: true, assetId }));
    const onChange = vi.fn();
    await render(<ImageField {...field} value={undefined} onChange={onChange} />);
    await chooseFile($<HTMLInputElement>('#field-x')!, png());
    const [, path, file] = uploadOriginal.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${TENANT.id}/[0-9a-f-]{36}/braud\\.png$`));
    expect((file as File).name).toBe('Brauð.png');
    const assetId = (path as string).split('/')[1];
    expect(actions.registerAssetAction).toHaveBeenCalledWith(TENANT.slug, assetId, path, 'braud.png');
    expect(onChange).toHaveBeenCalledWith({ _ref: assetId, _kind: 'asset', alt: '' });
  });

  it.each([
    ['type', t.editor.image.type],
    ['size', t.editor.image.size],
    ['auth', t.editor.signedOut],
    ['error', t.editor.image.uploadError],
  ])('shows the message for a server refusal %s and stores nothing', async (code, text) => {
    uploadOriginal.mockResolvedValue(true);
    actions.registerAssetAction.mockResolvedValue({ ok: false, code });
    const onChange = vi.fn();
    await render(<ImageField {...field} value={undefined} onChange={onChange} />);
    await chooseFile($<HTMLInputElement>('#field-x')!, png());
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(text);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores nothing when the upload itself fails', async () => {
    uploadOriginal.mockResolvedValue(false);
    const onChange = vi.fn();
    await render(<ImageField {...field} value={undefined} onChange={onChange} />);
    await chooseFile($<HTMLInputElement>('#field-x')!, png());
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.uploadError);
    expect(actions.registerAssetAction).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('previews the stored asset through a signed URL, and edits the alt text of this use', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/p?token=t', defaultAlt: null, focalX: null, focalY: null });
    const onChange = vi.fn();
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={onChange} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    expect(actions.assetPreviewAction).toHaveBeenCalledWith(ASSET);
    const img = $<HTMLImageElement>('[data-testid="field-x-preview"]')!;
    expect(img.src).toContain('/object/sign/media-private/');
    expect(img.alt).toBe('Brauð');
    await type($<HTMLInputElement>('#field-x-alt')!, 'Brauð á borði');
    expect(onChange).toHaveBeenLastCalledWith({ _ref: ASSET, _kind: 'asset', alt: 'Brauð á borði' });
  });

  it('saves this alt text as the asset default through updateAssetAction, leaving the focal point as stored', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: 0.2, focalY: 0.3 });
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={vi.fn()} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.saveDefaultAlt)!;
    await act(async () => button.click());
    expect(actions.updateAssetAction).toHaveBeenCalledWith(ASSET, { defaultAlt: 'Brauð' });
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.defaultAltSaved);
  });

  it(`signs the preview again when it fails to load, at most ${3} times, then says so instead of stopping silently`, async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: null, focalY: null });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: '' }} onChange={vi.fn()} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    for (let attempt = 1; attempt <= 3; attempt++) {
      await act(async () => $('[data-testid="field-x-preview"]')!.dispatchEvent(new Event('error')));
      await until(() => expect(actions.assetPreviewAction).toHaveBeenCalledTimes(1 + attempt));
      await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
      expect($('[data-testid="field-x-notice"]')).toBeNull();
    }
    await act(async () => $('[data-testid="field-x-preview"]')!.dispatchEvent(new Event('error')));
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.previewError);
    expect($('[data-testid="field-x-notice"]')?.getAttribute('role')).toBe('alert');
    expect(actions.assetPreviewAction).toHaveBeenCalledTimes(4);
  });

  it.each([
    ['auth', t.editor.signedOut],
    ['error', t.editor.image.updateError],
    ['invalid', t.editor.image.updateError],
  ])('shows the message for an update refusal %s', async (code, text) => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: null, focalY: null });
    actions.updateAssetAction.mockResolvedValue({ ok: false, code });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={vi.fn()} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.saveDefaultAlt)!;
    await act(async () => button.click());
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(text);
    expect($('[data-testid="field-x-notice"]')?.getAttribute('role')).toBe('alert');
  });

  it('announces a saved change politely, as a success', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: null, focalY: null });
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={vi.fn()} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.saveDefaultAlt)!;
    await act(async () => button.click());
    const notice = $('[data-testid="field-x-notice"]')!;
    expect(notice.getAttribute('aria-live')).toBe('polite');
    expect(notice.hasAttribute('role')).toBe(false);
  });

  it('saves a clicked focal point, and removes it, as changes of the focal point only', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: 'Brauð', focalX: null, focalY: null });
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={vi.fn()} />);
    await until(() => expect($('[data-testid="field-x-preview"]')).not.toBeNull());
    const picker = $<HTMLButtonElement>('#field-x-focal')!;
    picker.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 }) as DOMRect;
    await act(async () => picker.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: 60, clientY: 95 })));
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { focal: { x: 0.25, y: 0.75 } });
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.focalSaved);
    expect($('[data-testid="field-x-focal-marker"]')?.getAttribute('style')).toContain('left: 25%');
    const clear = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.clearFocal)!;
    await act(async () => clear.click());
    expect(actions.updateAssetAction).toHaveBeenLastCalledWith(ASSET, { focal: null });
    expect($('[data-testid="field-x-focal-marker"]')).toBeNull();
  });

  it("links to the asset's detail page in a new tab", async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: null, focalY: null });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: '' }} onChange={vi.fn()} />);
    const link = [...container.querySelectorAll('a')].find((a) => a.textContent === t.editor.image.details)!;
    expect(link.getAttribute('href')).toBe(`/t/${TENANT.slug}/assets/${ASSET}`);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener');
  });

  it('names its upload button apart from the library button: "Hlaða upp mynd" when empty, "Skipta um mynd" when set', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    await render(<ImageField {...field} value={undefined} onChange={vi.fn()} />);
    expect($('label[for="field-x"]')?.textContent).toBe(t.editor.image.choose);
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toContain(t.editor.image.fromLibrary);
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: '' }} onChange={vi.fn()} />);
    expect($('label[for="field-x"]')?.textContent).toBe(t.editor.image.replace);
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toContain(t.editor.image.fromLibrary);
  });

  it('takes no focus when it renders, only when a picker it opened has closed', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    (document.activeElement as HTMLElement | null)?.blur();
    await render(<ImageField {...field} value={undefined} onChange={vi.fn()} />);
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the alt text of this use when the image is replaced by an upload (probe section 14, item 5)', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: null, focalY: null });
    uploadOriginal.mockResolvedValue(true);
    actions.registerAssetAction.mockImplementation(async (_slug: string, assetId: string) => ({ ok: true, assetId }));
    const onChange = vi.fn();
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð á borði' }} onChange={onChange} />);
    await chooseFile($<HTMLInputElement>('#field-x')!, png());
    const assetId = (uploadOriginal.mock.calls[0]![1] as string).split('/')[1];
    expect(onChange).toHaveBeenCalledWith({ _ref: assetId, _kind: 'asset', alt: 'Brauð á borði' });
  });

  it("chooses from the library: an empty field takes the file with its default alt text, a replaced one keeps its own", async () => {
    const OTHER = '00000000-0000-4000-8000-0000000000a2';
    actions.pickerFilesAction.mockResolvedValue({
      ok: true,
      hasMore: false,
      files: [{ id: OTHER, filename: 'kaka.jpg', defaultAlt: 'Kaka á diski', width: 10, height: 10, bytes: 10, thumbUrl: null }],
    });
    actions.ensureThumbnailAction.mockResolvedValue({ ok: false, code: 'error' });
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    const choose = async () => {
      const opener = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.fromLibrary)!;
      await act(async () => opener.click());
      const dialog = document.querySelector('dialog')!;
      expect(document.getElementById(dialog.getAttribute('aria-labelledby')!.split(' ')[1]!)!.textContent).toBe('Reitur');
      await until(() => expect(dialog.querySelector('[role="option"]')).not.toBeNull());
      await act(async () => dialog.querySelector<HTMLElement>('[role="option"]')!.click());
      await act(async () => dialog.querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!.click());
      expect(document.querySelector('dialog')).toBeNull();
    };
    const onChange = vi.fn();
    await render(<ImageField {...field} value={undefined} onChange={onChange} />);
    await choose();
    expect(actions.pickerFilesAction).toHaveBeenCalledWith(TENANT.slug, '', 1);
    expect(onChange).toHaveBeenLastCalledWith({ _ref: OTHER, _kind: 'asset', alt: 'Kaka á diski' });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Minn texti' }} onChange={onChange} />);
    await choose();
    expect(onChange).toHaveBeenLastCalledWith({ _ref: OTHER, _kind: 'asset', alt: 'Minn texti' });
  });

  it('takes a file dropped on the dashed box, and leaves a drag without files alone (probe section 14, item 12)', async () => {
    uploadOriginal.mockResolvedValue(true);
    actions.registerAssetAction.mockImplementation(async (_slug: string, assetId: string) => ({ ok: true, assetId }));
    const onChange = vi.fn();
    await render(<ImageField {...field} value={undefined} onChange={onChange} />);
    const box = $('.drop')!;
    const drag = (type: string, types: string[], files: File[] = []) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { types, files, dropEffect: 'none' } });
      return event;
    };
    const text = drag('dragover', ['text/plain']);
    await act(async () => void box.dispatchEvent(text));
    expect(text.defaultPrevented).toBe(false);
    const over = drag('dragover', ['Files']);
    await act(async () => void box.dispatchEvent(over));
    expect(over.defaultPrevented).toBe(true);
    expect(box.hasAttribute('data-over')).toBe(true);
    const drop = drag('drop', ['Files'], [png()]);
    await act(async () => void box.dispatchEvent(drop));
    expect(drop.defaultPrevented).toBe(true);
    await until(() => expect(onChange).toHaveBeenCalled());
    const [, path] = uploadOriginal.mock.calls[0]!;
    expect(path).toMatch(new RegExp(`^${TENANT.id}/[0-9a-f-]{36}/braud\\.png$`));
    expect(onChange).toHaveBeenCalledWith({ _ref: (path as string).split('/')[1], _kind: 'asset', alt: '' });
  });

  it('refuses a dropped file of the wrong type with its message', async () => {
    await render(<ImageField {...field} value={undefined} onChange={vi.fn()} />);
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: ['Files'], files: [new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })] } });
    await act(async () => void $('.drop')!.dispatchEvent(drop));
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.type);
    expect(uploadOriginal).not.toHaveBeenCalled();
  });

  it('removes the image', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    const onChange = vi.fn();
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: '' }} onChange={onChange} />);
    await until(() => expect($('[data-testid="field-x-notice"]')).not.toBeNull());
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.previewError);
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.remove)!;
    await act(async () => button.click());
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});

describe('RichTextField', () => {
  const WORD_LIKE = '<table><tr><td>x</td></tr></table><p style="color:red"><s>y</s></p>';

  /** A paste event as ProseMirror reads it (jsdom has no ClipboardEvent). */
  function paste(target: Element, html: string) {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    const data: Record<string, string> = { 'text/html': html, 'text/plain': 'x y' };
    Object.defineProperty(event, 'clipboardData', { value: { types: Object.keys(data), getData: (k: string) => data[k] ?? '' } });
    target.dispatchEvent(event);
  }

  it('has a toolbar for the v1 marks and nodes and no image button (M2)', async () => {
    await render(<RichTextField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect(container.querySelector('[role="toolbar"]')).not.toBeNull());
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const labels = [...toolbar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
    const r = t.editor.richText;
    expect(labels).toEqual([r.bold, r.italic, r.heading2, r.heading3, r.bulletList, r.orderedList, r.blockquote, r.hardBreak, r.link]);
    expect(container.querySelector('[role="textbox"]')?.getAttribute('aria-labelledby')).toBe('field-x-label');
  });

  it('gives the contenteditable its field label as its accessible name (decision 39.3)', async () => {
    await render(<RichTextField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect(container.querySelector('[role="textbox"]')).not.toBeNull());
    const textbox = container.querySelector('[role="textbox"]')!;
    expect(textbox.getAttribute('contenteditable')).toBe('true');
    // aria-labelledby names it in browsers; aria-label carries the same text for tools that only
    // read the element's own attributes.
    expect(container.querySelector(`#${textbox.getAttribute('aria-labelledby')}`)?.textContent).toBe('Reitur');
    expect(textbox.getAttribute('aria-label')).toBe('Reitur');
  });

  it('cleans pasted Word-like HTML and saves a document that validates (review focus 2)', async () => {
    const onChange = vi.fn();
    await render(<RichTextField {...field} value={undefined} onChange={onChange} />);
    await until(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    await act(async () => paste(container.querySelector('.ProseMirror')!, WORD_LIKE));
    const saved = onChange.mock.lastCall?.[0];
    expect(richTextDocSchema.safeParse(saved).success).toBe(true);
    const text = JSON.stringify(saved);
    for (const bad of ['table', 'strike', 'style', 'color']) expect(text).not.toContain(bad);
    expect(text).toContain('"x"');
    expect(text).toContain('"y"');
  });

  // A10: a pasted Word list arrives as a list, and a paste that left a table out says so in one line.
  it('keeps a pasted Word list as a list, and says in one line that a table was left out', async () => {
    const onChange = vi.fn();
    await render(<RichTextField {...field} value={undefined} onChange={onChange} />);
    await until(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    const item = (text: string) => `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>·<span> </span></span>${text}</p>`;
    await act(async () => paste(container.querySelector('.ProseMirror')!, `${item('Brauð')}${item('Kaka')}`));
    const saved = JSON.stringify(onChange.mock.lastCall?.[0]);
    expect(saved).toContain('"bulletList"');
    expect(saved).not.toContain('·');
    expect(container.querySelector('[data-testid="field-x-paste-note"]')).toBeNull();

    await act(async () => paste(container.querySelector('.ProseMirror')!, WORD_LIKE));
    expect(container.querySelector('[data-testid="field-x-paste-note"]')?.textContent).toBe(t.editor.richText.droppedTables);
    // The next paste that leaves nothing out clears the line.
    await act(async () => paste(container.querySelector('.ProseMirror')!, '<p>z</p>'));
    expect(container.querySelector('[data-testid="field-x-paste-note"]')).toBeNull();
  });

  it('keeps the stored value unchanged while the document does not validate, and says so (Task 24 quality r1)', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halló' }] }] };
    const onChange = vi.fn();
    await render(<RichTextField {...field} value={doc} onChange={onChange} />);
    await until(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    // Tiptap keeps its instance on the editor element. An image node without an asset is outside
    // the v1 schema (only the media picker inserts images, always with one).
    const editor = (container.querySelector('.ProseMirror') as HTMLElement & { editor: import('@tiptap/react').Editor }).editor;
    await act(async () => editor.commands.insertContent({ type: 'image', attrs: { alt: '' } }));
    expect(richTextDocSchema.safeParse(editor.getJSON()).success).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(t.editor.richText.invalid);
  });

  it('loads a stored document', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halló', marks: [{ type: 'bold' }] }] }] };
    await render(<RichTextField {...field} value={doc} onChange={vi.fn()} />);
    await until(() => expect(container.querySelector('.ProseMirror strong')?.textContent).toBe('Halló'));
  });

  it('shows a stored document it cannot load as a notice, without an editor', async () => {
    await render(<RichTextField {...field} value={{ type: 'doc', content: [{ type: 'table' }] }} onChange={vi.fn()} />);
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.editor.richText.unreadable);
    expect(container.querySelector('.ProseMirror')).toBeNull();
  });
});

describe('EntryForm', () => {
  it('shows a field kind without a component as a notice, next to the fields that have one (decision 37.6)', async () => {
    await render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={[
          { key: 'title', kind: 'text', label: 'Titill', required: true },
          { key: 'gallery', kind: 'gallery', label: 'Myndasafn', required: false },
        ]}
        titleKey="title"
        initialData={{ title: 'a', gallery: [1, 2] }}
        initialVersion={1}
      />,
    );
    expect($<HTMLInputElement>('#field-title')?.value).toBe('a');
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.editor.unsupportedField);
    expect($('#field-gallery')).toBeNull();
  });

  it("renders labak's news form with the sourceLabel text field, generated from the type (decision 42.2, Q2)", async () => {
    await render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={describeFields(getType('labak', 'news')!)}
        titleKey="title"
        initialData={{ title: 'a', sourceLabel: 'Lesa fréttina' }}
        initialVersion={1}
      />,
    );
    const input = $<HTMLInputElement>('#field-sourceLabel');
    expect(input?.type).toBe('text');
    expect(input?.value).toBe('Lesa fréttina');
    expect(input?.maxLength).toBe(80);
    expect(input?.required).toBe(false);
    expect($('label[for="field-sourceLabel"]')?.textContent).toContain('Texti á heimildahnappi');
  });
});
