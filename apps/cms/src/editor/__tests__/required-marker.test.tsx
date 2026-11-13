// @vitest-environment jsdom
// A10 (probe §14, 1): a required field is marked as required in the form, whatever its kind, so
// the editor does not find out at publish. The marker is visual (aria-hidden); the control's own
// `required` (or `aria-required`) is what assistive technology announces.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldDescriptor } from '../form/descriptors';

vi.mock('@/app/(editor)/t/[tenant]/reference-actions', () => ({ referenceOptionsAction: vi.fn(async () => ({ ok: true, options: [], truncated: false })) }));

const { FieldInput } = await import('../form/FieldInput');
const { EditorTenantProvider } = await import('../form/tenant-context');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme' };

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

async function render(field: FieldDescriptor) {
  await act(async () =>
    root.render(
      <EditorTenantProvider value={TENANT}>
        <FieldInput field={field} id={`field-${field.key}`} value={undefined} onChange={() => {}} />
      </EditorTenantProvider>,
    ),
  );
}

const markers = () => container.querySelectorAll('[data-required-marker]');

// Image fields are left out: ImageField belongs to the media-library slices (ENHANCEMENTS A10 scope).
const KINDS: FieldDescriptor[] = [
  { key: 'title', kind: 'text', label: 'Titill', required: true },
  { key: 'excerpt', kind: 'text', label: 'Inngangur', required: true, multiline: true },
  { key: 'date', kind: 'date', label: 'Dagsetning', required: true },
  { key: 'starts', kind: 'datetime', label: 'Hefst', required: true },
  { key: 'count', kind: 'number', label: 'Fjöldi', required: true },
  { key: 'yes', kind: 'boolean', label: 'Já eða nei', required: true },
  { key: 'pick', kind: 'select', label: 'Val', required: true, options: [{ value: 'a', label: 'A' }] },
  { key: 'url', kind: 'link', label: 'Tengill', required: true },
  { key: 'ref', kind: 'reference', label: 'Tengd færsla', required: true, to: ['news'] },
  { key: 'body', kind: 'richText', label: 'Meginmál', required: true },
  { key: 'tags', kind: 'list', label: 'Merki', required: true, of: { key: 'tags', kind: 'text', label: 'Merki', required: true } },
  { key: 'who', kind: 'group', label: 'Hver', required: true, fields: [{ key: 'name', kind: 'text', label: 'Nafn', required: false }] },
];

describe('the required marker', () => {
  for (const field of KINDS) {
    it(`marks a required ${field.kind}${field.multiline ? ' (multi-line)' : ''} field`, async () => {
      await render(field);
      const marker = markers()[0];
      expect(marker, field.kind).toBeDefined();
      expect(marker!.getAttribute('aria-hidden')).toBe('true');
      // The marker belongs to the field's own label, not to a nested one.
      expect(marker!.parentElement?.textContent).toContain(field.label);
    });

    it(`does not mark an optional ${field.kind}${field.multiline ? ' (multi-line)' : ''} field`, async () => {
      await render({ ...field, required: false });
      expect(markers()).toHaveLength(0);
    });
  }

  it('the rich-text box tells assistive technology that it is required', async () => {
    await render({ key: 'body', kind: 'richText', label: 'Meginmál', required: true });
    await act(async () => vi.waitFor(() => expect(container.querySelector('[role="textbox"]')).not.toBeNull()));
    expect(container.querySelector('[role="textbox"]')!.getAttribute('aria-required')).toBe('true');
  });
});
