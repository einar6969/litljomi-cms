// @vitest-environment jsdom
// A11: the editor input for the `video` field kind (spec §5.2): one address input that takes a
// pasted address with or without https:// and normalises it, a line saying what was recognised or a
// plain error, the title, and the still through the image field's own component; inside a list and
// inside a group too.
import { video } from '@litljomi/cms-schema/src/fields/video.ts';
import { list } from '@litljomi/cms-schema/src/fields/list.ts';
import { act, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import { fieldErrorId, fieldHelpId } from '@/ui/Field';
import type { FieldDescriptor } from '../form/descriptors';

const actions = vi.hoisted(() => ({
  registerAssetAction: vi.fn(),
  assetPreviewAction: vi.fn(),
  updateAssetAction: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => actions);
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/reference-actions', () => ({ referenceOptionsAction: vi.fn(async () => ({ ok: true, options: [], truncated: false })) }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
const uploadOriginal = vi.hoisted(() => vi.fn());
vi.mock('../upload', async (importOriginal) => ({ ...(await importOriginal<typeof import('../upload')>()), uploadOriginal }));

const { VideoField } = await import('../form/fields/VideoField');
const { ListField } = await import('../form/fields/ListField');
const { GroupField } = await import('../form/fields/GroupField');
const { fieldRegistry } = await import('../form/field-registry');
const { describeFields } = await import('../form/descriptors');
const { EditorTenantProvider } = await import('../form/tenant-context');
const { getType } = await import('@/modules/registry');
const { defineType } = await import('@litljomi/cms-schema/src/define-type.ts');
const { group } = await import('@litljomi/cms-schema/src/fields/group.ts');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const YT = 'dQw4w9WgXcQ';
const v = t.editor.video;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  actions.assetPreviewAction.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/p?token=t', defaultAlt: null, focalX: null, focalY: null });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const until = (assertion: () => void) => act(async () => vi.waitFor(assertion));

async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const descriptor = (o: Partial<FieldDescriptor> = {}): FieldDescriptor => ({ key: 'clip', kind: 'video', label: 'Myndband', required: false, still: 'optional', ...o });

/** A component that keeps its value as the form does, and records every change. */
async function renderControlled(element: (value: unknown, onChange: (v: unknown) => void) => ReactElement, initial: unknown) {
  const changes: unknown[] = [];
  let current: unknown = initial;
  function Harness() {
    const [value, setValue] = useState<unknown>(initial);
    return element(value, (next) => {
      changes.push(next);
      current = next;
      setValue(next);
    });
  }
  await act(async () => root.render(<EditorTenantProvider value={TENANT}>{<Harness />}</EditorTenantProvider>));
  return { changes, value: () => current };
}

const renderVideo = (initial: unknown, o: { required?: boolean; still?: 'required' | 'optional' } = {}) =>
  renderControlled((value, onChange) => <VideoField id="field-clip" label="Myndband" required={o.required ?? false} still={o.still ?? 'optional'} value={value} onChange={onChange} />, initial);

describe('the registry and the descriptor', () => {
  it('has the video input', () => {
    expect(fieldRegistry.video).toBe(VideoField);
  });

  it('describes the still option, at the top level, in a list and in a group', () => {
    const type = defineType({
      name: 'clipboard',
      version: 1,
      label: 'C',
      fields: {
        clip: video({ label: 'Myndband', required: true, still: 'required' }),
        clips: list(video({ label: 'Myndband' }), { label: 'Myndbönd', max: 6 }),
        media: group({ label: 'Miðlar', fields: { trailer: video({ label: 'Stikla', still: 'required' }) } }),
      },
      preview: { title: 'clip' },
      orderBy: 'clip',
    });
    const fields = describeFields(type);
    expect(fields).toEqual([
      { key: 'clip', kind: 'video', label: 'Myndband', required: true, still: 'required' },
      { key: 'clips', kind: 'list', label: 'Myndbönd', required: false, max: 6, of: { key: 'clips', kind: 'video', label: 'Myndband', required: true, still: 'optional' } },
      { key: 'media', kind: 'group', label: 'Miðlar', required: false, fields: [{ key: 'trailer', kind: 'video', label: 'Stikla', required: false, still: 'required' }] },
    ]);
    expect(JSON.parse(JSON.stringify(fields))).toEqual(fields);
  });

  it("describes the demo event's list of videos inside its program group", () => {
    const program = describeFields(getType('demo', 'event')!).find((f) => f.key === 'program');
    expect(program?.fields?.find((f) => f.key === 'videos')).toEqual({
      key: 'videos',
      kind: 'list',
      label: 'Videos',
      required: false,
      max: 3,
      of: { key: 'videos', kind: 'video', label: 'Video', required: true, still: 'optional' },
    });
  });
});

describe('VideoField', () => {
  it('normalises a pasted address without https://, says what it recognised, and stores the whole value', async () => {
    const { changes } = await renderVideo(undefined);
    const url = $<HTMLInputElement>('#field-clip-url')!;
    expect($(`#${fieldHelpId('field-clip-url')}`)?.textContent).toBe(v.help);
    await type(url, `  youtu.be/${YT} `);
    expect(changes.at(-1)).toEqual({ url: `https://youtu.be/${YT}`, title: '', still: null });
    // The input keeps what was typed; the line under it says what was recognised.
    expect(url.value).toBe(`  youtu.be/${YT} `);
    const line = $(`#${fieldHelpId('field-clip-url')}`)!;
    expect(line.textContent).toBe(v.recognised.replace('{provider}', v.providers.youtube).replace('{id}', YT));
    expect(url.getAttribute('aria-describedby')).toBe(line.id);
    expect(url.getAttribute('aria-invalid')).toBe('false');
  });

  it('recognises Vimeo, and raises http to https', async () => {
    const { changes } = await renderVideo(undefined);
    await type($<HTMLInputElement>('#field-clip-url')!, 'http://vimeo.com/76979871');
    expect(changes.at(-1)).toEqual({ url: 'https://vimeo.com/76979871', title: '', still: null });
    expect($(`#${fieldHelpId('field-clip-url')}`)?.textContent).toBe(v.recognised.replace('{provider}', v.providers.vimeo).replace('{id}', '76979871'));
  });

  it('shows a plain error for an address it does not know, and stores it as typed so the error stays after a reload', async () => {
    const { changes } = await renderVideo(undefined);
    const url = $<HTMLInputElement>('#field-clip-url')!;
    await type(url, 'example.com/myndband');
    const error = $('[role="alert"]')!;
    expect(error.textContent).toBe(v.unknown);
    expect(error.id).toBe(fieldErrorId('field-clip-url'));
    expect(url.getAttribute('aria-invalid')).toBe('true');
    expect(url.getAttribute('aria-describedby')).toBe(error.id);
    expect(url.closest('label')?.textContent).not.toContain(v.unknown);
    expect(changes.at(-1)).toEqual({ url: 'https://example.com/myndband', title: '', still: null });

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderVideo({ url: 'https://example.com/myndband', title: '', still: null });
    expect($<HTMLInputElement>('#field-clip-url')!.value).toBe('https://example.com/myndband');
    expect($('[role="alert"]')?.textContent).toBe(v.unknown);
  });

  it('stores the title, limited to 200 characters', async () => {
    const { changes } = await renderVideo(undefined);
    const title = $<HTMLInputElement>('#field-clip-title')!;
    expect(title.maxLength).toBe(200);
    await type($<HTMLInputElement>('#field-clip-url')!, `https://www.youtube.com/watch?v=${YT}`);
    await type(title, 'Opnunin');
    expect(changes.at(-1)).toEqual({ url: `https://www.youtube.com/watch?v=${YT}`, title: 'Opnunin', still: null });
  });

  it('loads a stored value, and clears the field when everything is emptied', async () => {
    const { changes } = await renderVideo({ url: 'https://vimeo.com/76979871', title: 'Opnunin', still: null });
    const url = $<HTMLInputElement>('#field-clip-url')!;
    expect(url.value).toBe('https://vimeo.com/76979871');
    expect($<HTMLInputElement>('#field-clip-title')!.value).toBe('Opnunin');
    await type(url, '');
    expect(changes.at(-1)).toEqual({ url: '', title: 'Opnunin', still: null });
    expect($('[role="alert"]')).toBeNull();
    await type($<HTMLInputElement>('#field-clip-title')!, '');
    expect(changes.at(-1)).toBeUndefined();
  });

  it('shows the still through the image field, and removing it keeps the rest of the value', async () => {
    const stored = { url: 'https://vimeo.com/76979871', title: 'Opnunin', still: { _ref: ASSET, _kind: 'asset', alt: 'Kyrrmynd' } };
    const { changes } = await renderVideo(stored);
    expect($('fieldset#field-clip > legend')?.textContent).toBe('Myndband');
    expect(container.querySelector('#field-clip fieldset legend')?.textContent).toBe(v.still);
    await until(() => expect($('[data-testid="field-clip-still-preview"]')).not.toBeNull());
    expect(actions.assetPreviewAction).toHaveBeenCalledWith(ASSET);
    await type($<HTMLInputElement>('#field-clip-still-alt')!, 'Dansarar á sviði');
    expect(changes.at(-1)).toEqual({ ...stored, still: { ...stored.still, alt: 'Dansarar á sviði' } });
    const remove = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.image.remove)!;
    await act(async () => remove.click());
    expect(changes.at(-1)).toEqual({ url: stored.url, title: stored.title, still: null });
  });

  it('stores an uploaded still with an empty alt text, keeping what was typed meanwhile', async () => {
    uploadOriginal.mockResolvedValue(true);
    actions.registerAssetAction.mockImplementation(async (_slug: string, assetId: string) => ({ ok: true, assetId }));
    const { changes } = await renderVideo(undefined);
    await type($<HTMLInputElement>('#field-clip-url')!, `youtu.be/${YT}`);
    const file = $<HTMLInputElement>('#field-clip-still')!;
    Object.defineProperty(file, 'files', { configurable: true, value: [new File([new Uint8Array(64)], 'kyrr.png', { type: 'image/png' })] });
    await act(async () => file.dispatchEvent(new Event('change', { bubbles: true })));
    await until(() => expect((changes.at(-1) as { still: unknown }).still).not.toBeNull());
    const assetId = (uploadOriginal.mock.calls[0]![1] as string).split('/')[1];
    expect(changes.at(-1)).toEqual({ url: `https://youtu.be/${YT}`, title: '', still: { _ref: assetId, _kind: 'asset', alt: '' } });
  });

  it('marks the parts required when the field is, the still only when its option says so', async () => {
    await renderVideo(undefined, { required: true, still: 'required' });
    expect($<HTMLInputElement>('#field-clip-url')!.required).toBe(true);
    expect($<HTMLInputElement>('#field-clip-title')!.required).toBe(true);
    expect($<HTMLInputElement>('#field-clip-still')!.required).toBe(true);
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderVideo(undefined, { required: true });
    expect($<HTMLInputElement>('#field-clip-still')!.required).toBe(false);
  });

  it('an optional field asks for its parts only once something is filled in', async () => {
    await renderVideo(undefined, { still: 'required' });
    expect($<HTMLInputElement>('#field-clip-title')!.required).toBe(false);
    expect($<HTMLInputElement>('#field-clip-still')!.required).toBe(false);
    await type($<HTMLInputElement>('#field-clip-url')!, `youtu.be/${YT}`);
    expect($<HTMLInputElement>('#field-clip-title')!.required).toBe(true);
    expect($<HTMLInputElement>('#field-clip-still')!.required).toBe(true);
  });

  it('names a stored value of the wrong shape, and replaces it only when the editor types', async () => {
    const { changes } = await renderVideo('https://youtu.be/' + YT);
    expect($(`#${fieldErrorId('field-clip')}`)?.textContent).toBe(t.editor.invalidStored);
    expect($<HTMLInputElement>('#field-clip-url')!.value).toBe('');
    expect(changes).toEqual([]);
    await type($<HTMLInputElement>('#field-clip-title')!, 'Nýtt');
    expect(changes.at(-1)).toEqual({ url: '', title: 'Nýtt', still: null });
    expect($(`#${fieldErrorId('field-clip')}`)).toBeNull();
  });

  it('follows a value replaced from outside (a reloaded version)', async () => {
    let replace: (v: unknown) => void = () => {};
    function Outer() {
      const [value, setValue] = useState<unknown>({ url: 'https://vimeo.com/1', title: 'A', still: null });
      replace = setValue;
      return <VideoField id="field-clip" label="Myndband" required={false} still="optional" value={value} onChange={setValue} />;
    }
    await act(async () => root.render(<EditorTenantProvider value={TENANT}><Outer /></EditorTenantProvider>));
    await act(async () => replace({ url: 'https://vimeo.com/2', title: 'B', still: null }));
    expect($<HTMLInputElement>('#field-clip-url')!.value).toBe('https://vimeo.com/2');
    expect($<HTMLInputElement>('#field-clip-title')!.value).toBe('B');
  });
});

describe('inside a list and a group', () => {
  it('a list of videos: a new item is an empty video whose address takes focus, then fills in', async () => {
    const of = descriptor({ required: true });
    const { changes } = await renderControlled((value, onChange) => <ListField id="field-clips" label="Myndbönd" required={false} of={of} max={6} value={value} onChange={onChange} />, undefined);
    const add = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.list.add)!;
    await act(async () => add.click());
    const key = (changes.at(-1) as Array<{ _key: string }>)[0]!._key;
    const url = $<HTMLInputElement>(`#field-clips-${key}-url`)!;
    expect(document.activeElement).toBe(url);
    expect($(`fieldset#field-clips-${key} > legend`)?.textContent).toContain(t.editor.list.item.replace('{label}', 'Myndband').replace('{n}', '1'));
    await type(url, 'vimeo.com/76979871');
    await type($<HTMLInputElement>(`#field-clips-${key}-title`)!, 'Fyrsta');
    expect(changes.at(-1)).toEqual([{ _key: key, value: { url: 'https://vimeo.com/76979871', title: 'Fyrsta', still: null } }]);
  });

  it('a video in a group is stored under its key, and the group keeps its other values', async () => {
    const fields: FieldDescriptor[] = [{ key: 'intro', kind: 'text', label: 'Inngangur', required: false }, descriptor({ key: 'trailer', label: 'Stikla' })];
    const { changes } = await renderControlled((value, onChange) => <GroupField id="field-media" label="Miðlar" required={false} fields={fields} value={value} onChange={onChange} />, { intro: 'Halló' });
    await type($<HTMLInputElement>('#field-media-trailer-url')!, `www.youtube.com/shorts/${YT}`);
    expect(changes.at(-1)).toEqual({ intro: 'Halló', trailer: { url: `https://www.youtube.com/shorts/${YT}`, title: '', still: null } });
    expect($(`#${fieldHelpId('field-media-trailer-url')}`)?.textContent).toBe(v.recognised.replace('{provider}', v.providers.youtube).replace('{id}', YT));
  });
});
