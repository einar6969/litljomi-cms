// @vitest-environment jsdom
// M2-07: the editor inputs for the scalar kinds (number, boolean, select, datetime): value
// round-trip, required marker, error display and keyboard operation per input, and the typed
// values in the autosave request.
import { datetime } from '@litljomi/cms-schema/src/fields/datetime.ts';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import { fieldErrorId, fieldHelpId } from '@/ui/Field';

const saveDraftAction = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction, loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
// The event form's reference field (M2-08) lists its options on mount; none are needed here.
vi.mock('@/app/(editor)/t/[tenant]/reference-actions', () => ({ referenceOptionsAction: vi.fn(async () => ({ ok: true, options: [], truncated: false })) }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: vi.fn(), assetPreviewAction: vi.fn(), updateAssetAction: vi.fn() }));

const { NumberField, numberHelp, parseNumber } = await import('../form/fields/NumberField');
const { BooleanField } = await import('../form/fields/BooleanField');
const { SelectField } = await import('../form/fields/SelectField');
const { DateTimeField, fromLocalInput, toLocalInput } = await import('../form/fields/DateTimeField');
const { EntryForm } = await import('../form/EntryForm');
const { describeFields } = await import('../form/descriptors');
const { fieldRegistry } = await import('../form/field-registry');
const { getType } = await import('@/modules/registry');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'demo' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';

let container: HTMLDivElement;
let root: Root;
const originalTz = process.env.TZ;
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
  process.env.TZ = originalTz;
});

const render = async (element: ReactElement) => act(async () => root.render(element));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);

/** Types into a React-controlled input the way a user does (the native setter, then `input`). */
async function type(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function press(input: HTMLElement, key: string) {
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
}

const field = { id: 'field-x', label: 'Reitur', required: false };
const marker = () => $('[data-required-marker]');
const alertText = () => $('[role="alert"]')?.textContent ?? null;

/** The required marker is visual only: it sits next to the label text and is hidden from the accessible name. */
function expectMarker(required: boolean) {
  if (!required) {
    expect(marker()).toBeNull();
    return;
  }
  expect(marker()?.getAttribute('aria-hidden')).toBe('true');
  expect(marker()?.textContent).toBe('*');
}

describe('the field registry', () => {
  it('has a component for each scalar kind', () => {
    expect(fieldRegistry.number).toBe(NumberField);
    expect(fieldRegistry.boolean).toBe(BooleanField);
    expect(fieldRegistry.select).toBe(SelectField);
    expect(fieldRegistry.datetime).toBe(DateTimeField);
  });

  it("describes the demo event's scalar fields with their options", () => {
    const fields = Object.fromEntries(describeFields(getType('demo', 'event')!).map((f) => [f.key, f]));
    expect(fields.capacity).toEqual({ key: 'capacity', kind: 'number', label: 'Capacity', required: false, min: 0, integer: true });
    expect(fields.freeEntry).toEqual({ key: 'freeEntry', kind: 'boolean', label: 'Free entry', required: false });
    expect(fields.category?.options).toEqual([
      { value: 'concert', label: 'Concert' },
      { value: 'workshop', label: 'Workshop' },
      { value: 'talk', label: 'Talk' },
    ]);
    expect(Object.isFrozen(fields.category?.options?.[0])).toBe(false);
    expect(fields.doorsOpen).toEqual({ key: 'doorsOpen', kind: 'datetime', label: 'Doors open', required: false });
  });
});

describe('NumberField', () => {
  it('shows the stored number, saves typed numbers as numbers and clears when emptied', async () => {
    const onChange = vi.fn();
    await render(<NumberField {...field} value={1.5} onChange={onChange} />);
    const input = $<HTMLInputElement>('#field-x')!;
    expect(input.value).toBe('1,5');
    await type(input, '12');
    await type(input, '2,25');
    await type(input, '-3.5');
    await type(input, '');
    expect(onChange.mock.calls).toEqual([[12], [2.25], [-3.5], [undefined]]);
  });

  it('marks a required field and passes required to the input', async () => {
    await render(<NumberField {...field} required value={undefined} onChange={vi.fn()} />);
    expectMarker(true);
    expect($<HTMLInputElement>('#field-x')!.required).toBe(true);
    expect($('label')?.textContent).toBe('Reitur*');
  });

  it('has no marker when optional', async () => {
    await render(<NumberField {...field} value={undefined} onChange={vi.fn()} />);
    expectMarker(false);
    expect($<HTMLInputElement>('#field-x')!.required).toBe(false);
  });

  it.each([
    ['a fraction in a whole-number field', '1,5'],
    ['a value below the minimum', '-1'],
    ['a value above the maximum', '101'],
    ['text', 'abc'],
    ['an exponent', '1e3'],
  ])('never saves %s, and shows the error until a valid number is typed', async (_, text) => {
    const onChange = vi.fn();
    await render(<NumberField {...field} value={undefined} onChange={onChange} min={0} max={100} integer />);
    const input = $<HTMLInputElement>('#field-x')!;
    await type(input, text);
    expect(onChange).not.toHaveBeenCalled();
    expect(alertText()).toBe(t.editor.number.invalid);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(`${fieldHelpId('field-x')} ${fieldErrorId('field-x')}`);
    // The error describes the input without becoming part of its name (Task 31 spec-quality r1).
    expect(input.closest('label')?.textContent).not.toContain(t.editor.number.invalid);
    await type(input, '7');
    expect(onChange).toHaveBeenLastCalledWith(7);
    expect(alertText()).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBe(fieldHelpId('field-x'));
  });

  it('states the rule in its help text', async () => {
    await render(<NumberField {...field} value={undefined} onChange={vi.fn()} min={0} integer />);
    expect($(`#${fieldHelpId('field-x')}`)?.textContent).toBe('Heil tala, minnst 0.');
    expect(numberHelp({ min: 0.5, max: 10 })).toBe(`${t.editor.number.decimal}, frá 0,5 til 10.`);
    expect(numberHelp({ max: 3, integer: true })).toBe('Heil tala, mest 3.');
    expect(numberHelp({})).toBe(`${t.editor.number.decimal}.`);
  });

  it('names a stored value that is not a number in an error, and saves nothing until a number is typed', async () => {
    const onChange = vi.fn();
    await render(<NumberField {...field} value="fimm" onChange={onChange} />);
    expect(alertText()).toBe(t.editor.invalidStored);
    expect($<HTMLInputElement>('#field-x')!.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    await type($<HTMLInputElement>('#field-x')!, '5');
    expect(onChange).toHaveBeenLastCalledWith(5);
    expect(alertText()).toBeNull();
  });

  it('steps by one with the arrow keys, within the range', async () => {
    const onChange = vi.fn();
    await render(<NumberField {...field} value={undefined} onChange={onChange} min={0} max={2} integer />);
    const input = $<HTMLInputElement>('#field-x')!;
    await press(input, 'ArrowUp'); // empty: starts at the minimum
    await press(input, 'ArrowUp');
    await press(input, 'ArrowUp');
    await press(input, 'ArrowUp'); // stays at the maximum
    await press(input, 'ArrowDown');
    expect(onChange.mock.calls).toEqual([[0], [1], [2], [2], [1]]);
    expect(input.value).toBe('1');
  });

  it('parses digits with one decimal comma or point and nothing else', () => {
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('+1,25')).toBe(1.25);
    for (const bad of ['', '1 000', '1.000,5', '0x10', '1e3', ',5', 'Infinity']) expect(parseNumber(bad)).toBeNaN();
  });
});

describe('BooleanField', () => {
  const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
  const labelled = (text: string) => radios().find((r) => r.closest('label')?.textContent === text)!;

  it('shows the stored answer and saves Já, Nei and "not specified"', async () => {
    const onChange = vi.fn();
    await render(<BooleanField {...field} value={true} onChange={onChange} />);
    expect(labelled(t.editor.boolean.yes).checked).toBe(true);
    await act(async () => labelled(t.editor.boolean.no).click());
    await act(async () => labelled(t.editor.boolean.unset).click());
    expect(onChange.mock.calls).toEqual([[false], [undefined]]);
  });

  it('shows false as Nei, and an empty optional field as "not specified"', async () => {
    await render(<BooleanField {...field} value={false} onChange={vi.fn()} />);
    expect(labelled(t.editor.boolean.no).checked).toBe(true);
    await render(<BooleanField {...field} value={undefined} onChange={vi.fn()} />);
    expect(labelled(t.editor.boolean.unset).checked).toBe(true);
  });

  it('is one radio group named by the field label, so the arrow keys move between its choices', async () => {
    await render(<BooleanField {...field} value={undefined} onChange={vi.fn()} />);
    const group = $<HTMLFieldSetElement>('fieldset#field-x')!;
    expect(group.querySelector('legend')?.textContent).toBe('Reitur');
    expect(new Set(radios().map((r) => r.name))).toEqual(new Set(['field-x']));
    expect(radios().every((r) => r.tabIndex === 0 && !r.disabled)).toBe(true);
  });

  it('marks a required field: no "not specified" choice, nothing chosen until answered', async () => {
    const onChange = vi.fn();
    await render(<BooleanField {...field} required value={undefined} onChange={onChange} />);
    expectMarker(true);
    expect(radios().map((r) => r.closest('label')?.textContent)).toEqual([t.editor.boolean.yes, t.editor.boolean.no]);
    expect(radios().every((r) => r.required && !r.checked)).toBe(true);
    await act(async () => labelled(t.editor.boolean.no).click());
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('names a stored value that is not a boolean in an error and chooses nothing', async () => {
    await render(<BooleanField {...field} value="já" onChange={vi.fn()} />);
    expect(alertText()).toBe(t.editor.invalidStored);
    expect(radios().some((r) => r.checked)).toBe(false);
    expect($('fieldset')?.getAttribute('aria-describedby')).toBe(fieldErrorId('field-x'));
    expect($('legend')?.textContent).not.toContain(t.editor.invalidStored);
  });
});

describe('SelectField', () => {
  const options = [
    { value: 'concert', label: 'Tónleikar' },
    { value: 'talk', label: 'Fyrirlestur' },
  ];
  const labels = () => [...container.querySelectorAll('option')].map((o) => o.textContent);

  it('lists an empty choice and the options, shows the stored value and saves the chosen one', async () => {
    const onChange = vi.fn();
    await render(<SelectField {...field} value="talk" onChange={onChange} options={options} />);
    const select = $<HTMLSelectElement>('select#field-x')!;
    expect(labels()).toEqual([t.editor.select.placeholder, 'Tónleikar', 'Fyrirlestur']);
    expect(select.value).toBe('talk');
    await choose(select, 'concert');
    await choose(select, '');
    expect(onChange.mock.calls).toEqual([['concert'], [undefined]]);
  });

  it('marks a required field', async () => {
    await render(<SelectField {...field} required value={undefined} onChange={vi.fn()} options={options} />);
    expectMarker(true);
    expect($<HTMLSelectElement>('select')!.required).toBe(true);
    expect($<HTMLSelectElement>('select')!.value).toBe('');
  });

  it('keeps a stored value that is no longer a choice, and names it in an error', async () => {
    const onChange = vi.fn();
    await render(<SelectField {...field} value="workshop" onChange={onChange} options={options} />);
    const select = $<HTMLSelectElement>('select')!;
    expect(select.value).toBe('workshop');
    expect(alertText()).toBe('Gildið „workshop“ er ekki lengur í boði. Veldu annað.');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe(fieldErrorId('field-x'));
    expect(onChange).not.toHaveBeenCalled();
    // The old value cannot be chosen again once another is.
    expect(container.querySelector<HTMLOptionElement>('option[value="workshop"]')?.disabled).toBe(true);
  });

  it('is a native select, so the keyboard and screen readers operate it', async () => {
    await render(<SelectField {...field} value={undefined} onChange={vi.fn()} options={options} />);
    const select = $<HTMLSelectElement>('select')!;
    expect(select.tabIndex).toBe(0);
    expect(select.labels?.[0]?.textContent).toContain('Reitur');
  });
});

describe('DateTimeField', () => {
  const kind = datetime({ label: '' }).draftSchema();

  it('shows a stored datetime in the browser time zone and saves an edit with that zone\'s offset', async () => {
    process.env.TZ = 'Atlantic/Reykjavik';
    const onChange = vi.fn();
    await render(<DateTimeField {...field} value="2026-11-14T21:00+01:00" onChange={onChange} />);
    const input = $<HTMLInputElement>('input#field-x')!;
    expect(input.type).toBe('datetime-local');
    expect(input.value).toBe('2026-11-14T20:00');
    await type(input, '2026-11-15T09:30');
    await type(input, '');
    expect(onChange.mock.calls).toEqual([['2026-11-15T09:30+00:00'], [undefined]]);
    expect(kind.safeParse(onChange.mock.calls[0]![0]).success).toBe(true);
  });

  it('names the browser time zone in its help text', async () => {
    process.env.TZ = 'Atlantic/Reykjavik';
    await render(<DateTimeField {...field} value={undefined} onChange={vi.fn()} />);
    const help = $(`#${fieldHelpId('field-x')}`)!;
    expect(help.textContent).toBe(t.editor.datetime.help.replace('{zone}', Intl.DateTimeFormat().resolvedOptions().timeZone));
    expect($('input')?.getAttribute('aria-describedby')).toBe(help.id);
  });

  it('marks a required field', async () => {
    await render(<DateTimeField {...field} required value={undefined} onChange={vi.fn()} />);
    expectMarker(true);
    expect($<HTMLInputElement>('input')!.required).toBe(true);
  });

  it('names a stored value it cannot read in an error', async () => {
    await render(<DateTimeField {...field} value="á morgun" onChange={vi.fn()} />);
    expect(alertText()).toBe(t.editor.invalidStored);
    expect($('input')?.getAttribute('aria-invalid')).toBe('true');
    expect($('input')?.getAttribute('aria-describedby')).toBe(`${fieldHelpId('field-x')} ${fieldErrorId('field-x')}`);
  });

  it('is a native datetime-local input, so the keyboard operates its segments', async () => {
    await render(<DateTimeField {...field} value={undefined} onChange={vi.fn()} />);
    const input = $<HTMLInputElement>('input')!;
    expect(input.disabled).toBe(false);
    expect(input.tabIndex).toBe(0);
  });

  it('renders empty and disabled on the server, whose time zone is not the browser\'s', () => {
    const html = renderToStaticMarkup(<DateTimeField {...field} value="2026-11-14T20:00Z" onChange={() => {}} />);
    expect(html).toMatch(/<input type="datetime-local"[^>]* disabled=""[^>]* value=""/);
  });

  it.each([
    ['Atlantic/Reykjavik', '2026-07-01T12:00', '2026-07-01T12:00+00:00'],
    ['Europe/Berlin', '2026-01-10T08:15', '2026-01-10T08:15+01:00'],
    ['Europe/Berlin', '2026-07-10T08:15', '2026-07-10T08:15+02:00'],
    // Inside the spring-forward gap the browser moves the time on; time and offset still agree.
    ['Europe/Berlin', '2026-03-29T02:30', '2026-03-29T03:30+02:00'],
    ['America/St_Johns', '2026-01-10T08:15', '2026-01-10T08:15-03:30'],
  ])('in %s, %s is stored as %s, a valid datetime that reads back the same', (tz, local, stored) => {
    process.env.TZ = tz;
    expect(fromLocalInput(local)).toBe(stored);
    expect(kind.safeParse(stored).success).toBe(true);
    expect(toLocalInput(stored)).toBe(stored.slice(0, 16));
  });

  it('reads nothing from an empty or malformed input', () => {
    expect(fromLocalInput('')).toBeUndefined();
    expect(fromLocalInput('2026-11-14')).toBeUndefined();
    expect(toLocalInput(undefined)).toBe('');
    expect(toLocalInput(42)).toBe('');
  });
});

describe('EntryForm with the scalar kinds', () => {
  it('autosaves the typed values with their types', async () => {
    process.env.TZ = 'Atlantic/Reykjavik';
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
    await type($<HTMLInputElement>('#field-capacity')!, '120');
    await act(async () => [...container.querySelectorAll<HTMLInputElement>('input[name="field-freeEntry"]')].find((r) => r.value === 'no')!.click());
    await choose($<HTMLSelectElement>('#field-category')!, 'workshop');
    await type($<HTMLInputElement>('#field-doorsOpen')!, '2026-11-14T19:30');
    await act(async () => vi.advanceTimersByTime(1500));
    expect(saveDraftAction).toHaveBeenCalledTimes(1);
    expect(saveDraftAction).toHaveBeenCalledWith(ENTRY, 1, {
      title: 'Tónleikar',
      capacity: 120,
      freeEntry: false,
      category: 'workshop',
      doorsOpen: '2026-11-14T19:30+00:00',
    }, USER);
    // The event type's own draft validator accepts exactly what was sent.
    expect(getType('demo', 'event')!.draftValidator().safeParse(saveDraftAction.mock.calls[0]![2]).success).toBe(true);
  });
});
