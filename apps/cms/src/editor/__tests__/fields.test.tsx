// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const actions = vi.hoisted(() => ({
  registerAssetAction: vi.fn(),
  assetPreviewAction: vi.fn(),
  updateAssetAction: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);
// The browser client is only passed to uploadOriginal, which is replaced below.
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction: vi.fn(), setSlugAction: vi.fn() }));
const uploadOriginal = vi.hoisted(() => vi.fn());
vi.mock('../upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../upload')>()), uploadOriginal }));

const { TextField } = await import('../form/fields/TextField');
const { DateField } = await import('../form/fields/DateField');
const { LinkField } = await import('../form/fields/LinkField');
const { ImageField } = await import('../form/fields/ImageField');
const { RichTextField } = await import('../form/fields/RichTextField');
const { SlugField } = await import('../form/SlugField');
const { EditorTenantProvider } = await import('../form/tenant-context');
const { EntryForm } = await import('../form/EntryForm');
const { richTextDocSchema } = await import('@litljomi/rich-text');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const ENTRY = '00000000-0000-4000-8000-0000000000e1';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
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
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

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
  await flush();
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
    await type(input, 'HTTPS://Example.com');
    expect(onChange).toHaveBeenLastCalledWith({ href: 'https://example.com/' });
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows an entry link as a notice and leaves it alone', async () => {
    await render(<LinkField {...field} value={{ entry: { _ref: ENTRY, _kind: 'entry' } }} onChange={() => {}} />);
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.editor.entryLink);
    expect($('input')).toBeNull();
  });
});

describe('SlugField', () => {
  it.each([
    [{ ok: false, code: 'slug_taken' }, t.editor.slug.taken],
    [{ ok: false, code: 'slug_locked' }, t.editor.slug.locked],
    [{ ok: false, code: 'invalid' }, t.editor.slug.invalid],
    [{ ok: false, code: 'auth' }, t.editor.signedOut],
    [{ ok: false, code: 'error' }, t.editor.slug.error],
    [{ ok: true, slug: 'braud-arsins-2025' }, t.editor.slug.saved],
  ])('shows the notice for %j', async (answer, text) => {
    const setSlug = vi.fn(async () => answer as never);
    await render(<SlugField entryId={ENTRY} initialSlug={null} title="Brauð ársins 2025" locked={false} setSlug={setSlug} />);
    expect($('[data-testid="slug-suggestion"]')?.textContent).toContain('braud-arsins-2025');
    await act(async () => $<HTMLButtonElement>('button')!.click());
    expect(setSlug).toHaveBeenCalledWith(ENTRY, 'braud-arsins-2025');
    expect($('[data-testid="slug-notice"]')?.textContent).toBe(text);
  });

  it('shows the generic error when the action throws', async () => {
    const setSlug = vi.fn(async () => {
      throw new Error('network');
    });
    await render(<SlugField entryId={ENTRY} initialSlug={null} title="a" locked={false} setSlug={setSlug} />);
    await act(async () => $<HTMLButtonElement>('button')!.click());
    expect($('[data-testid="slug-notice"]')?.textContent).toBe(t.editor.slug.error);
  });

  it('is disabled with the locked notice once published', async () => {
    await render(<SlugField entryId={ENTRY} initialSlug="a" title="a" locked setSlug={vi.fn()} />);
    expect($<HTMLInputElement>('#slug')!.disabled).toBe(true);
    expect(container.textContent).toContain(t.editor.slug.locked);
    expect($('button')).toBeNull();
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
    await flush();
    expect(actions.assetPreviewAction).toHaveBeenCalledWith(ASSET);
    const img = $<HTMLImageElement>('[data-testid="field-x-preview"]')!;
    expect(img.src).toContain('/object/sign/media-private/');
    expect(img.alt).toBe('Brauð');
    await type($<HTMLInputElement>('#field-x-alt')!, 'Brauð á borði');
    expect(onChange).toHaveBeenLastCalledWith({ _ref: ASSET, _kind: 'asset', alt: 'Brauð á borði' });
  });

  it('saves this alt text as the asset default through updateAssetAction, keeping the focal point', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/x', defaultAlt: null, focalX: 0.2, focalY: 0.3 });
    actions.updateAssetAction.mockResolvedValue({ ok: true });
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: 'Brauð' }} onChange={vi.fn()} />);
    await flush();
    const button = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.saveDefaultAlt)!;
    await act(async () => button.click());
    expect(actions.updateAssetAction).toHaveBeenCalledWith(ASSET, 0.2, 0.3, 'Brauð');
    expect($('[data-testid="field-x-notice"]')?.textContent).toBe(t.editor.image.defaultAltSaved);
  });

  it('removes the image', async () => {
    actions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    const onChange = vi.fn();
    await render(<ImageField {...field} value={{ _ref: ASSET, _kind: 'asset', alt: '' }} onChange={onChange} />);
    await flush();
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
    await flush();
    const toolbar = container.querySelector('[role="toolbar"]')!;
    const labels = [...toolbar.querySelectorAll('button')].map((b) => b.textContent);
    const r = t.editor.richText;
    expect(labels).toEqual([r.bold, r.italic, r.heading2, r.heading3, r.bulletList, r.orderedList, r.blockquote, r.hardBreak, r.link]);
    expect(container.querySelector('[role="textbox"]')?.getAttribute('aria-labelledby')).toBe('field-x-label');
  });

  it('cleans pasted Word-like HTML and saves a document that validates (review focus 2)', async () => {
    const onChange = vi.fn();
    await render(<RichTextField {...field} value={undefined} onChange={onChange} />);
    await flush();
    await act(async () => paste(container.querySelector('.ProseMirror')!, WORD_LIKE));
    const saved = onChange.mock.lastCall?.[0];
    expect(richTextDocSchema.safeParse(saved).success).toBe(true);
    const text = JSON.stringify(saved);
    for (const bad of ['table', 'strike', 'style', 'color']) expect(text).not.toContain(bad);
    expect(text).toContain('"x"');
    expect(text).toContain('"y"');
  });

  it('loads a stored document', async () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halló', marks: [{ type: 'bold' }] }] }] };
    await render(<RichTextField {...field} value={doc} onChange={vi.fn()} />);
    await flush();
    expect(container.querySelector('.ProseMirror strong')?.textContent).toBe('Halló');
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
        entryId={ENTRY}
        fields={[
          { key: 'title', kind: 'text', label: 'Titill', required: true },
          { key: 'gallery', kind: 'gallery', label: 'Myndasafn', required: false },
        ]}
        titleKey="title"
        initialData={{ title: 'a', gallery: [1, 2] }}
        initialVersion={1}
        initialSlug={null}
        slugLocked={false}
      />,
    );
    expect($<HTMLInputElement>('#field-title')?.value).toBe('a');
    expect(container.querySelector('[role="note"]')?.textContent).toBe(t.editor.unsupportedField);
    expect($('#field-gallery')).toBeNull();
  });
});
