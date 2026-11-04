// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

const referenceOptionsAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(editor)/t/[tenant]/reference-actions', () => ({ referenceOptionsAction }));
vi.mock('@/lib/supabase/browser', () => ({ createBrowserEditorClient: () => ({}) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ saveDraftAction: vi.fn(), loadDraftAction: vi.fn(), setSlugAction: vi.fn(), restoreRevisionAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/asset-actions', () => ({ registerAssetAction: vi.fn(), assetPreviewAction: vi.fn(), updateAssetAction: vi.fn() }));
vi.mock('@/app/(editor)/t/[tenant]/publish-actions', () => ({ requestPublishAction: vi.fn(), requestUnpublishAction: vi.fn() }));

const { ReferenceField } = await import('../form/fields/ReferenceField');
const { EditorTenantProvider } = await import('../form/tenant-context');
const { EntryForm } = await import('../form/EntryForm');
const { describeFields } = await import('../form/descriptors');
const { getType } = await import('@/modules/registry');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };
const ENTRY = '00000000-0000-4000-8000-0000000000e1';
/** The signed-in editor the page was rendered for (M2-17). */
const USER = '00000000-0000-4000-8000-0000000000b1';
const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000a2';
const GONE = '00000000-0000-4000-8000-0000000000a9';
const OPTIONS = [
  { id: A, type: 'event', title: 'Tónleikar', status: 'published' },
  { id: B, type: 'event', title: null, status: 'draft' },
];

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  // Unsaved copies stay in the tab (M2-17); each test starts with an empty one.
  sessionStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.clearAllMocks();
  referenceOptionsAction.mockResolvedValue({ ok: true, options: OPTIONS, truncated: false });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (element: ReactElement) => act(async () => root.render(<EditorTenantProvider value={TENANT}>{element}</EditorTenantProvider>));
const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector);
const until = (assertion: () => void) => act(async () => vi.waitFor(assertion));
const select = () => $<HTMLSelectElement>('#field-x')!;
const optionTexts = () => [...select().options].map((o) => o.textContent);
const describedText = () =>
  (select().getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent);

async function choose(value: string) {
  await act(async () => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
  });
}

const field = { id: 'field-x', label: 'Tengdur viðburður', required: false, to: ['event'] as const };

describe('ReferenceField', () => {
  it("lists the allowed types' entries of the form's tenant with their title and status", async () => {
    await render(<ReferenceField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(referenceOptionsAction).toHaveBeenCalledWith('acme', ['event']);
    expect(optionTexts()).toEqual([t.editor.reference.none, 'Tónleikar (Birt)', `${t.entries.untitled} (Uppkast)`]);
    expect(select().value).toBe('');
    expect($('label[for="field-x"]')?.textContent).toContain('Tengdur viðburður');
  });

  it('is disabled and says so while the list loads', async () => {
    referenceOptionsAction.mockReturnValue(new Promise(() => {}));
    await render(<ReferenceField {...field} value={undefined} onChange={vi.fn()} />);
    expect(select().disabled).toBe(true);
    expect(describedText()).toEqual([t.editor.reference.loading]);
  });

  it('stores the chosen entry as { _ref, _kind: "entry" } and clears the field when none is chosen', async () => {
    const onChange = vi.fn();
    await render(<ReferenceField {...field} value={undefined} onChange={onChange} />);
    await until(() => expect(select().disabled).toBe(false));
    await choose(A);
    expect(onChange).toHaveBeenLastCalledWith({ _ref: A, _kind: 'entry' });
    await choose('');
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  it('shows a stored reference as chosen, with no hint when the target is published', async () => {
    await render(<ReferenceField {...field} value={{ _ref: A, _kind: 'entry' }} onChange={vi.fn()} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(select().value).toBe(A);
    expect(select().getAttribute('aria-describedby')).toBeNull();
  });

  it('hints that an unpublished target must be published first', async () => {
    await render(<ReferenceField {...field} value={{ _ref: B, _kind: 'entry' }} onChange={vi.fn()} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(select().value).toBe(B);
    expect(describedText()).toEqual([t.editor.reference.unpublished]);
  });

  it('keeps a stored reference the list does not hold, shown as missing, until another is chosen', async () => {
    const onChange = vi.fn();
    await render(<ReferenceField {...field} value={{ _ref: GONE, _kind: 'entry' }} onChange={onChange} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(select().value).toBe(GONE);
    expect(select().selectedOptions[0]?.textContent).toBe(t.editor.reference.missing);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('says when the list is cut short, and keeps a stored reference past the limit as chosen', async () => {
    referenceOptionsAction.mockResolvedValue({ ok: true, options: OPTIONS, truncated: true });
    await render(<ReferenceField {...field} value={{ _ref: GONE, _kind: 'entry' }} onChange={vi.fn()} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(describedText()).toEqual([t.editor.reference.truncated]);
    expect(select().value).toBe(GONE);
    expect(select().selectedOptions[0]?.textContent).toBe(t.editor.reference.notListed);
  });

  it('shows a failed load as an alert with a retry that loads again', async () => {
    referenceOptionsAction.mockResolvedValueOnce({ ok: false, code: 'error' });
    await render(<ReferenceField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect($('[role="alert"]')?.textContent).toBe(t.editor.reference.loadError));
    expect(select().disabled).toBe(true);
    expect(describedText()).toEqual([t.editor.reference.loadError]);
    const retry = [...container.querySelectorAll('button')].find((b) => b.textContent === t.editor.retry)!;
    await act(async () => retry.click());
    await until(() => expect(select().disabled).toBe(false));
    expect(referenceOptionsAction).toHaveBeenCalledTimes(2);
    expect($('[role="alert"]')).toBeNull();
  });

  it('says the session expired when the action answers auth, and when it throws, the generic error', async () => {
    referenceOptionsAction.mockResolvedValueOnce({ ok: false, code: 'auth' });
    await render(<ReferenceField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect($('[role="alert"]')?.textContent).toBe(t.editor.signedOut));
    await act(async () => root.unmount());
    root = createRoot(container);
    referenceOptionsAction.mockRejectedValueOnce(new Error('network'));
    await render(<ReferenceField {...field} value={undefined} onChange={vi.fn()} />);
    await until(() => expect($('[role="alert"]')?.textContent).toBe(t.editor.reference.loadError));
  });

  // A native <select> keeps the browser's keyboard operation (arrows, type-ahead); jsdom does not
  // implement it, so this checks the control is that native, focusable select.
  it('marks a required field and is a native, focusable select', async () => {
    const onChange = vi.fn();
    await render(<ReferenceField {...field} required value={undefined} onChange={onChange} />);
    await until(() => expect(select().disabled).toBe(false));
    expect(select().required).toBe(true);
    expect(select().tagName).toBe('SELECT');
    select().focus();
    expect(document.activeElement).toBe(select());
    expect(select().tabIndex).toBe(0);
  });
});

describe('EntryForm with a reference field', () => {
  it("renders the demo event's related field as a picker over events (describeFields passes `to`)", async () => {
    const fields = describeFields(getType('demo', 'event')!);
    expect(fields.find((f) => f.key === 'related')).toMatchObject({ kind: 'reference', to: ['event'] });
    await render(
      <EntryForm
        tenant={TENANT}
        userId={USER}
        entryId={ENTRY}
        fields={fields}
        titleKey="title"
        initialData={{ title: 'a', related: { _ref: A, _kind: 'entry' } }}
        initialVersion={1}
        initialSlug={null}
        slugLocked={false}
      />,
    );
    await until(() => expect($<HTMLSelectElement>('#field-related')?.disabled).toBe(false));
    expect(referenceOptionsAction).toHaveBeenCalledWith('acme', ['event']);
    expect($<HTMLSelectElement>('#field-related')?.value).toBe(A);
  });

  it('passes no `to` for other kinds', () => {
    expect(describeFields(getType('demo', 'event')!).filter((f) => f.kind !== 'reference').every((f) => !('to' in f))).toBe(true);
  });
});
