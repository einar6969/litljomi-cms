// @vitest-environment jsdom
// M2-15: the editor inputs for `list` and `group` (spec §5.2): add, remove and reorder (keyboard,
// move buttons and drag), nested fields rendered through the registry, nested validation messages
// that point at the right item, and the autosave of a reordered list.
import { list } from '@litljomi/cms-schema/src/fields/list.ts';
import { text } from '@litljomi/cms-schema/src/fields/text.ts';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import { fieldErrorId } from '@/ui/Field';
import type { FieldDescriptor } from '../form/descriptors';

const saveDraftAction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction, loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/reference-actions', () => ({ referenceOptionsAction: vi.fn(async () => ({ ok: true, options: [], truncated: false })) }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
const assetActions = vi.hoisted(() => ({
  registerAssetAction: vi.fn(),
  assetPreviewAction: vi.fn(),
  updateAssetAction: vi.fn(),
  pickerFilesAction: vi.fn(),
  ensureThumbnailAction: vi.fn(),
}));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => assetActions);

const { ListField, listHelp, moveItem } = await import('../form/fields/ListField');
const { GroupField } = await import('../form/fields/GroupField');
const { EntryForm } = await import('../form/EntryForm');
const { describeFields } = await import('../form/descriptors');
const { fieldRegistry } = await import('../form/field-registry');
const { EditorTenantProvider } = await import('../form/tenant-context');
const { getType } = await import('@/modules/registry');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has the element but not its modal behaviour (the library picker, media library L6).
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'demo' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';

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
  vi.useRealTimers();
});

const render = async (element: ReactElement) => act(async () => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...container.querySelectorAll<T>(selector)];

async function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const press = async (el: HTMLElement, key: string) =>
  act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
const click = async (el: HTMLElement) => act(async () => el.click());
const fire = async (el: HTMLElement, type: string) => act(async () => void el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })));

const textItem: FieldDescriptor = { key: 'tags', kind: 'text', label: 'Merki', required: true };
const numberItem: FieldDescriptor = { key: 'scores', kind: 'number', label: 'Stig', required: true, integer: true };
const items = (...values: string[]) => values.map((value, i) => ({ _key: `k${i}`, value }));

/** A list field that keeps its value, as the form does, and records every change. */
function Harness({ initial, onChange, ...props }: { initial: unknown; onChange: (v: unknown) => void } & Partial<Parameters<typeof ListField>[0]>) {
  return (
    <EditorTenantProvider value={TENANT}>
      <ListField id="field-tags" label="Merki" required={false} of={textItem} value={initial} onChange={onChange} {...props} />
    </EditorTenantProvider>
  );
}

/** Renders a controlled ListField whose value follows its own changes. */
async function renderList(initial: unknown, props: Partial<Parameters<typeof ListField>[0]> = {}) {
  const changes: unknown[] = [];
  let value = initial;
  const draw = () =>
    root.render(
      <Harness
        initial={value}
        onChange={(v) => {
          changes.push(v);
          value = v;
          draw();
        }}
        {...props}
      />,
    );
  await act(async () => draw());
  return { changes, value: () => value };
}

const itemEls = () => $$<HTMLLIElement>('li[data-item-key]');
const itemKeys = () => itemEls().map((li) => li.dataset.itemKey);
const handleOf = (li: HTMLElement) => li.querySelector<HTMLButtonElement>('[data-handle]')!;
const buttonNamed = (name: string) => $$<HTMLButtonElement>('button').find((b) => (b.getAttribute('aria-label') ?? b.textContent) === name);
const itemName = (n: number, label = 'Merki') => t.editor.list.item.replace('{label}', label).replace('{n}', String(n));

describe('the field registry', () => {
  it('has the list and group inputs', () => {
    expect(fieldRegistry.list).toBe(ListField);
    expect(fieldRegistry.group).toBe(GroupField);
  });

  it("describes the demo event's program group with its nested lists of references, videos and images", () => {
    const program = describeFields(getType('demo', 'event')!).find((f) => f.key === 'program');
    expect(program).toEqual({
      key: 'program',
      kind: 'group',
      label: 'Program',
      required: false,
      fields: [
        { key: 'intro', kind: 'text', label: 'Introduction', required: false, multiline: true },
        {
          key: 'highlights',
          kind: 'list',
          label: 'Highlights',
          required: false,
          max: 10,
          // Publish refuses an empty item, so each item is marked required.
          of: { key: 'highlights', kind: 'reference', label: 'Event', required: true, to: ['event'] },
        },
        // A11: the video kind inside a list inside a group.
        { key: 'videos', kind: 'list', label: 'Videos', required: false, max: 3, of: { key: 'videos', kind: 'video', label: 'Video', required: true, still: 'optional' } },
        // Media library L6: a list of images, the bulk add's case.
        { key: 'gallery', kind: 'list', label: 'Gallery', required: false, max: 12, of: { key: 'gallery', kind: 'image', label: 'Photo', required: true } },
      ],
    });
    // Only plain data crosses to the client.
    expect(JSON.parse(JSON.stringify(program))).toEqual(program);
  });
});

describe('ListField', () => {
  it('shows the items in order, each through the registry with its own id and label', async () => {
    await renderList(items('rautt', 'grænt'));
    expect(itemKeys()).toEqual(['k0', 'k1']);
    expect($<HTMLInputElement>('#field-tags-k0')?.value).toBe('rautt');
    expect($<HTMLInputElement>('#field-tags-k1')?.value).toBe('grænt');
    // An item is required on publish, so its label carries the (aria-hidden) required marker (A10).
    expect($('label[for="field-tags-k1"]')?.textContent).toBe(`${itemName(2)}*`);
    expect($('label[for="field-tags-k1"] [data-required-marker]')?.getAttribute('aria-hidden')).toBe('true');
    expect($('legend')?.textContent).toBe('Merki');
  });

  it('adds an empty item with a fresh key and focuses its control; typing fills it in', async () => {
    const { changes, value } = await renderList(items('rautt'));
    await click(buttonNamed(t.editor.list.add)!);
    const added = (changes.at(-1) as { _key: string; value: unknown }[])[1]!;
    expect(added.value).toBeNull();
    expect(added._key).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(added._key).not.toBe('k0');
    expect(document.activeElement?.id).toBe(`field-tags-${added._key}`);
    await type($<HTMLInputElement>(`#field-tags-${added._key}`)!, 'blátt');
    expect(value()).toEqual([{ _key: 'k0', value: 'rautt' }, { _key: added._key, value: 'blátt' }]);
    // The schema's own draft rule accepts it.
    expect(list(text({ label: 'Merki' }), { label: 'Merki' }).draftSchema().safeParse(value()).success).toBe(true);
  });

  it("focuses a new item's handle when its control cannot take focus yet (a reference picker loading its options)", async () => {
    await renderList([], { of: { key: 'h', kind: 'reference', label: 'Event', required: true, to: ['event'] }, label: 'Highlights' });
    await click(buttonNamed(t.editor.list.add)!);
    expect(document.activeElement).toBe(handleOf(itemEls()[0]!));
  });

  it('stores a cleared item as null, so the item keeps its place', async () => {
    const { value } = await renderList(items('rautt', 'grænt'));
    await type($<HTMLInputElement>('#field-tags-k0')!, '');
    expect(value()).toEqual([{ _key: 'k0', value: null }, { _key: 'k1', value: 'grænt' }]);
  });

  it('removes an item, announces it and focuses the next one; removing the last clears the field', async () => {
    const { value } = await renderList(items('rautt', 'grænt'));
    await click(buttonNamed(t.editor.list.remove.replace('{item}', itemName(1)))!);
    expect(value()).toEqual([{ _key: 'k1', value: 'grænt' }]);
    expect($('[data-testid="list-announcement"]')?.textContent).toBe(t.editor.list.removed.replace('{item}', itemName(1)));
    expect(document.activeElement).toBe(handleOf(itemEls()[0]!));
    await click(buttonNamed(t.editor.list.remove.replace('{item}', itemName(1)))!);
    expect(value()).toBeUndefined();
    expect(container.textContent).toContain(t.editor.list.empty);
    expect(document.activeElement?.textContent).toBe(t.editor.list.add);
  });

  it('reorders by keyboard: the arrow keys on the handle move the item, focus stays on it, and the move is announced', async () => {
    const { value } = await renderList(items('a', 'b', 'c'));
    const first = handleOf(itemEls()[0]!);
    first.focus();
    await press(first, 'ArrowDown');
    expect(itemKeys()).toEqual(['k1', 'k0', 'k2']);
    expect(value()).toEqual([{ _key: 'k1', value: 'b' }, { _key: 'k0', value: 'a' }, { _key: 'k2', value: 'c' }]);
    expect(document.activeElement).toBe(handleOf(itemEls()[1]!));
    expect($('[data-testid="list-announcement"]')?.textContent).toBe(t.editor.list.moved.replace('{item}', itemName(1)).replace('{n}', '2').replace('{total}', '3'));
    await press(document.activeElement as HTMLElement, 'ArrowDown');
    expect(itemKeys()).toEqual(['k1', 'k2', 'k0']);
    // At the end, a further move does nothing.
    await press(document.activeElement as HTMLElement, 'ArrowDown');
    expect(itemKeys()).toEqual(['k1', 'k2', 'k0']);
    await press(document.activeElement as HTMLElement, 'ArrowUp');
    expect(itemKeys()).toEqual(['k1', 'k0', 'k2']);
    expect(document.activeElement).toBe(handleOf(itemEls()[1]!));
  });

  it('names the handle and the move buttons by the item, and offers no move past either end', async () => {
    await renderList(items('a', 'b'));
    expect(handleOf(itemEls()[0]!).getAttribute('aria-label')).toBe(t.editor.list.handle.replace('{item}', itemName(1)));
    expect(buttonNamed(t.editor.list.moveUp.replace('{item}', itemName(1)))).toBeUndefined();
    expect(buttonNamed(t.editor.list.moveDown.replace('{item}', itemName(2)))).toBeUndefined();
    await click(buttonNamed(t.editor.list.moveDown.replace('{item}', itemName(1)))!);
    expect(itemKeys()).toEqual(['k1', 'k0']);
    await click(buttonNamed(t.editor.list.moveUp.replace('{item}', itemName(2)))!);
    expect(itemKeys()).toEqual(['k0', 'k1']);
  });

  it('reorders by dragging an item by its handle and dropping it on another', async () => {
    const { value } = await renderList(items('a', 'b', 'c'));
    // An item is draggable only once the pointer is down on its handle, so its inputs stay selectable.
    expect(itemEls()[2]!.draggable).toBe(false);
    await fire(handleOf(itemEls()[2]!), 'pointerdown');
    expect(itemEls()[2]!.draggable).toBe(true);
    await fire(itemEls()[2]!, 'dragstart');
    await fire(itemEls()[0]!, 'dragover');
    await fire(itemEls()[0]!, 'drop');
    expect(itemKeys()).toEqual(['k2', 'k0', 'k1']);
    expect((value() as { _key: string }[]).map((i) => i._key)).toEqual(['k2', 'k0', 'k1']);
    expect(itemEls().every((li) => !li.draggable)).toBe(true);
  });

  it('stops adding at max and states the rule in its help text', async () => {
    await renderList(items('a', 'b'), { max: 2, min: 1 });
    expect(buttonNamed(t.editor.list.add)?.disabled).toBe(true);
    expect($('#field-tags-help')?.textContent).toBe('Minnst 1 og mest 2 atriði.');
    expect(listHelp({ max: 10 })).toBe('Mest 10 atriði.');
    expect(listHelp({ min: 2 })).toBe('Minnst 2 atriði.');
    expect(listHelp({})).toBeNull();
  });

  it('names a stored value that is not a list in an error, and replaces it only when an item is added', async () => {
    const { changes } = await renderList('ekki listi');
    expect($(`#${fieldErrorId('field-tags')}`)?.textContent).toBe(t.editor.invalidStored);
    expect(changes).toEqual([]);
    await click(buttonNamed(t.editor.list.add)!);
    expect($(`#${fieldErrorId('field-tags')}`)).toBeNull();
    expect((changes[0] as unknown[]).length).toBe(1);
  });

  it('treats items with duplicate or malformed keys as an invalid stored value', async () => {
    await renderList([{ _key: 'a', value: 'x' }, { _key: 'a', value: 'y' }]);
    expect($(`#${fieldErrorId('field-tags')}`)?.textContent).toBe(t.editor.invalidStored);
    expect(itemEls()).toHaveLength(0);
  });

  it('moves a nested field with its item: its typed text and validation message stay with it', async () => {
    await renderList([{ _key: 'k0', value: 1 }, { _key: 'k1', value: 2 }], { of: numberItem, label: 'Stig' });
    await type($<HTMLInputElement>('#field-tags-k1')!, 'abc');
    // The message belongs to the second item only, and that item's input points at it.
    const error = $(`#${fieldErrorId('field-tags-k1')}`)!;
    expect(error.textContent).toBe(t.editor.number.invalid);
    expect(itemEls()[1]!.contains(error)).toBe(true);
    expect($('#field-tags-k1')?.getAttribute('aria-describedby')).toContain(fieldErrorId('field-tags-k1'));
    expect($('#field-tags-k1')?.getAttribute('aria-invalid')).toBe('true');
    expect($(`#${fieldErrorId('field-tags-k0')}`)).toBeNull();
    expect($('#field-tags-k0')?.getAttribute('aria-invalid')).toBe('false');
    // Moved to the top, the item keeps its text and its message.
    await press(handleOf(itemEls()[1]!), 'ArrowUp');
    expect(itemKeys()).toEqual(['k1', 'k0']);
    expect(itemEls()[0]!.contains($(`#${fieldErrorId('field-tags-k1')}`))).toBe(true);
    expect($<HTMLInputElement>('#field-tags-k1')?.value).toBe('abc');
    // Renumbered by its new place; the marker follows the label text.
    expect($('label[for="field-tags-k1"]')?.textContent).toBe(`${itemName(1, 'Stig')}*`);
  });
});

describe('a list of images (media library L6)', () => {
  const imageItem: FieldDescriptor = { key: 'gallery', kind: 'image', label: 'Mynd', required: true };
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const libraryFile = (n: number) => ({ id: id(n), filename: `m${n}.jpg`, defaultAlt: n === 2 ? 'Önnur' : null, width: 4, height: 3, bytes: 9, thumbUrl: null });
  const stored = (n: number, alt = '') => ({ _key: `k${n}`, value: { _ref: id(n), _kind: 'asset', alt } });
  const dialog = () => document.querySelector<HTMLDialogElement>('dialog');

  beforeEach(() => {
    assetActions.assetPreviewAction.mockResolvedValue({ ok: false, code: 'error' });
    assetActions.ensureThumbnailAction.mockResolvedValue({ ok: false, code: 'error' });
    assetActions.pickerFilesAction.mockResolvedValue({ ok: true, hasMore: false, files: [1, 2, 3, 4].map(libraryFile) });
  });

  /** Opens "Bæta við úr safni", selects the library's files by number in that order and confirms. */
  async function pick(...numbers: number[]) {
    await click(buttonNamed(t.editor.list.addFromLibrary)!);
    expect(dialog()).not.toBeNull();
    await act(async () => vi.waitFor(() => expect(dialog()!.querySelectorAll('[role="option"]')).toHaveLength(4)));
    const options = [...dialog()!.querySelectorAll<HTMLElement>('[role="option"]')];
    for (const n of numbers) await click(options[n - 1]!);
    await click(dialog()!.querySelector<HTMLButtonElement>('[data-testid="picker-confirm"]')!);
    expect(dialog()).toBeNull();
  }

  it('offers "Bæta við úr safni" beside "Bæta við" for a list of images only', async () => {
    await renderList([], { of: imageItem, label: 'Myndir' });
    expect(buttonNamed(t.editor.list.add)).toBeDefined();
    expect(buttonNamed(t.editor.list.addFromLibrary)).toBeDefined();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderList(items('a'));
    expect(buttonNamed(t.editor.list.addFromLibrary)).toBeUndefined();
  });

  it('appends the chosen files in the order chosen, each a new item with its default alt text', async () => {
    const { value } = await renderList([stored(9, 'Fyrir')], { of: imageItem, label: 'Myndir' });
    await pick(3, 2, 1);
    const list = value() as { _key: string; value: unknown }[];
    expect(list.map((i) => i.value)).toEqual([
      { _ref: id(9), _kind: 'asset', alt: 'Fyrir' },
      { _ref: id(3), _kind: 'asset', alt: '' },
      { _ref: id(2), _kind: 'asset', alt: 'Önnur' },
      { _ref: id(1), _kind: 'asset', alt: '' },
    ]);
    expect(new Set(list.map((i) => i._key)).size).toBe(4);
    expect(assetActions.pickerFilesAction).toHaveBeenCalledWith(TENANT.slug, '', 1);
    // The dialog was a list's, for several files.
    expect($('[data-testid="list-no-room"]')).toBeNull();
  });

  it("takes what fits under the list's max and says how many there was room for", async () => {
    const { value } = await renderList([stored(9)], { of: imageItem, label: 'Myndir', max: 3 });
    await pick(1, 2, 3, 4);
    expect((value() as { value: { _ref: string } }[]).map((i) => i.value._ref)).toEqual([id(9), id(1), id(2)]);
    const said = t.editor.list.noRoom.replace('{n}', '2');
    expect($('[data-testid="list-no-room"]')?.textContent).toBe(said);
    expect($('[data-testid="list-announcement"]')?.textContent).toBe(said);
    // Full now: neither way of adding is offered.
    expect(buttonNamed(t.editor.list.addFromLibrary)?.disabled).toBe(true);
    expect(buttonNamed(t.editor.list.add)?.disabled).toBe(true);
  });

  it('removes the item when its image is removed, instead of leaving an empty item (probe section 14, item 6)', async () => {
    const { value } = await renderList([stored(1), stored(2)], { of: imageItem, label: 'Myndir' });
    const removeImage = $$<HTMLButtonElement>('button').filter((b) => b.textContent === t.editor.image.remove);
    expect(removeImage).toHaveLength(2);
    await click(removeImage[0]!);
    expect(value()).toEqual([stored(2)]);
    expect($('[data-testid="list-announcement"]')?.textContent).toBe(t.editor.list.removed.replace('{item}', 'Mynd 1'));
    expect(document.activeElement).toBe(handleOf(itemEls()[0]!));
    await click($$<HTMLButtonElement>('button').find((b) => b.textContent === t.editor.image.remove)!);
    expect(value()).toBeUndefined();
  });
});

describe('GroupField', () => {
  const fields: FieldDescriptor[] = [
    { key: 'phone', kind: 'text', label: 'Sími', required: false },
    { key: 'seats', kind: 'number', label: 'Sæti', required: false, integer: true },
  ];

  async function renderGroup(initial: unknown) {
    let value = initial;
    const draw = () =>
      root.render(
        <GroupField
          id="field-info"
          label="Upplýsingar"
          required={false}
          fields={fields}
          value={value}
          onChange={(v) => {
            value = v;
            draw();
          }}
        />,
      );
    await act(async () => draw());
    return () => value;
  }

  it('renders its nested fields through the registry under one legend, with ids from its own', async () => {
    await renderGroup({ phone: '555 1234' });
    expect($('fieldset#field-info > legend')?.textContent).toBe('Upplýsingar');
    expect($<HTMLInputElement>('#field-info-phone')?.value).toBe('555 1234');
    expect($('label[for="field-info-seats"]')?.textContent).toBe('Sæti');
  });

  it('writes nested values into one object, keeps keys it does not describe, and clears when emptied', async () => {
    const value = await renderGroup({ phone: '1', legacy: 'x' });
    await type($<HTMLInputElement>('#field-info-seats')!, '40');
    expect(value()).toEqual({ phone: '1', legacy: 'x', seats: 40 });
    await type($<HTMLInputElement>('#field-info-phone')!, '');
    expect(value()).toEqual({ legacy: 'x', seats: 40 });

    const empty = await renderGroup({ phone: '1' });
    await type($<HTMLInputElement>('#field-info-phone')!, '');
    expect(empty()).toBeUndefined();
  });

  it("puts a nested field's validation message on that field", async () => {
    await renderGroup({});
    await type($<HTMLInputElement>('#field-info-seats')!, '1,5');
    expect($(`#${fieldErrorId('field-info-seats')}`)?.textContent).toBe(t.editor.number.invalid);
    expect($('#field-info-seats')?.getAttribute('aria-describedby')).toContain(fieldErrorId('field-info-seats'));
    expect($(`#${fieldErrorId('field-info-phone')}`)).toBeNull();
    expect($(`#${fieldErrorId('field-info')}`)).toBeNull();
  });

  it('names a stored value that is not an object in an error', async () => {
    await renderGroup(['x']);
    expect($(`#${fieldErrorId('field-info')}`)?.textContent).toBe(t.editor.invalidStored);
    expect($('#field-info')?.getAttribute('aria-describedby')).toBe(fieldErrorId('field-info'));
  });
});

describe('a list of groups', () => {
  const slide: FieldDescriptor = {
    key: 'slides',
    kind: 'group',
    label: 'Skyggna',
    required: true,
    fields: [
      { key: 'caption', kind: 'text', label: 'Texti', required: true },
      { key: 'order', kind: 'number', label: 'Röð', required: false, integer: true },
    ],
  };

  it("points a nested validation message at the right item's nested field", async () => {
    const { value } = await renderList(
      [
        { _key: 's0', value: { caption: 'Fyrsta' } },
        { _key: 's1', value: { caption: 'Önnur' } },
      ],
      { of: slide, label: 'Skyggnur' },
    );
    // Each item is required on publish, so its legend carries the marker.
    expect($('fieldset#field-tags-s1 > legend')?.textContent).toBe(`${itemName(2, 'Skyggna')}*`);
    await type($<HTMLInputElement>('#field-tags-s1-order')!, 'x');
    const error = $(`#${fieldErrorId('field-tags-s1-order')}`)!;
    expect(error.textContent).toBe(t.editor.number.invalid);
    expect(itemEls()[1]!.contains(error)).toBe(true);
    expect($(`#${fieldErrorId('field-tags-s0-order')}`)).toBeNull();
    await type($<HTMLInputElement>('#field-tags-s0-order')!, '3');
    expect(value()).toEqual([
      { _key: 's0', value: { caption: 'Fyrsta', order: 3 } },
      { _key: 's1', value: { caption: 'Önnur' } },
    ]);
  });
});

describe('EntryForm with a list', () => {
  it('autosaves a list reordered by keyboard, in its new order', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    saveDraftAction.mockResolvedValue({ ok: true, version: 2 });
    await render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={[
          { key: 'title', kind: 'text', label: 'Titill', required: true },
          { key: 'tags', kind: 'list', label: 'Merki', required: false, of: textItem },
        ]}
        titleKey="title"
        initialData={{ title: 'Tónleikar', tags: items('a', 'b', 'c') }}
        initialVersion={1}
      />,
    );
    await press(handleOf(itemEls()[2]!), 'ArrowUp');
    await press(handleOf(itemEls()[1]!), 'ArrowUp');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveDraftAction).toHaveBeenCalledTimes(1);
    const reordered = [{ _key: 'k2', value: 'c' }, { _key: 'k0', value: 'a' }, { _key: 'k1', value: 'b' }];
    expect(saveDraftAction).toHaveBeenCalledWith(ENTRY, 1, { title: 'Tónleikar', tags: reordered }, USER);
    expect(list(text({ label: 'Merki' }), { label: 'Merki' }).draftSchema().safeParse(reordered).success).toBe(true);
  });

  it("autosaves an edit inside the demo event's program group", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    saveDraftAction.mockResolvedValue({ ok: true, version: 2 });
    await render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={describeFields(getType('demo', 'event')!)}
        titleKey="title"
        initialData={{ title: 'Tónleikar' }}
        initialVersion={1}
      />,
    );
    // Every demo event field has an input now.
    expect(container.textContent).not.toContain(t.editor.unsupportedField);
    const intro = $<HTMLTextAreaElement>('#field-program-intro')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(intro, 'Dagskráin');
      intro.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => vi.advanceTimersByTime(1500));
    const sent = saveDraftAction.mock.calls[0]![2];
    expect(sent).toEqual({ title: 'Tónleikar', program: { intro: 'Dagskráin' } });
    expect(getType('demo', 'event')!.draftValidator().safeParse(sent).success).toBe(true);
  });
});

describe('moveItem', () => {
  it('moves one item and keeps the rest in order', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
});
