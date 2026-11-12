import { richTextDocSchema, toPlainText } from '@litljomi/rich-text';
import { t } from '@/i18n/is';
import type { FieldDescriptor } from './descriptors';

/** One field whose value differs between the editor's version and the newer one (M2-11). */
export type ChangedField = { key: string; label: string; mine: string; theirs: string };

const MAX_LENGTH = 300;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** JSON with object keys sorted, so two values compare equal whatever their key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v,
  ) ?? 'undefined';
}

const shortId = (ref: unknown) => (typeof ref === 'string' ? ref.slice(0, 8) : '');

/** A list field's stored items, `[{ _key, value }]` (M2-15): the key is the form's, never the editor's. */
const isListItems = (value: unknown[]): value is { _key: string; value: unknown }[] =>
  value.every((item) => isObject(item) && typeof item._key === 'string' && 'value' in item);

/**
 * `nested`: the value is inside a list item or a group, where a list is one line ("a; b"); a list
 * field of its own has a numbered line per item.
 */
function describe(value: unknown, nested = false): string {
  if (value === undefined || value === null || value === '') return t.editor.resolve.empty;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? t.editor.resolve.yes : t.editor.resolve.no;
  if (Array.isArray(value)) {
    if (value.length === 0) return t.editor.resolve.empty;
    if (isListItems(value)) {
      const items = value.map((item) => describe(item.value, true));
      return nested ? items.join('; ') : items.map((text, i) => `${i + 1}. ${text}`).join('\n');
    }
    return value.map((v) => describe(v, true)).join('; ');
  }
  if (!isObject(value)) return t.editor.resolve.empty;
  if (value.type === 'doc') {
    const doc = richTextDocSchema.safeParse(value);
    return doc.success ? toPlainText(doc.data) || t.editor.resolve.empty : canonical(value);
  }
  if (value._kind === 'asset') {
    const image = `${t.editor.resolve.image} ${shortId(value._ref)}`;
    return typeof value.alt === 'string' && value.alt !== '' ? `${image}: ${value.alt}` : image;
  }
  if (value._kind === 'entry') return `${t.editor.resolve.entry} ${shortId(value._ref)}`;
  if (typeof value.href === 'string') return value.href;
  if (isObject(value.entry)) return describe(value.entry, true);
  const parts = Object.entries(value)
    .filter(([key, v]) => key !== '_key' && v !== undefined)
    .map(([, v]) => v);
  return parts.length === 0 ? t.editor.resolve.empty : parts.map((v) => describe(v, true)).join('; ');
}

const cut = (text: string, from: number): string => {
  if (text.length <= MAX_LENGTH) return text;
  if (from === 0) return `${text.slice(0, MAX_LENGTH)}…`;
  const part = text.slice(from, from + MAX_LENGTH);
  return `…${part}${from + MAX_LENGTH < text.length ? '…' : ''}`;
};

/**
 * A short, readable text of a field value for the conflict view: rich text by its text, an image by
 * its asset (first eight characters of its id) and alt, a group by its values, a list by its items'
 * values, one numbered line each.
 */
export function describeValue(value: unknown): string {
  return cut(describe(value), 0);
}

/**
 * Both sides' texts, each cut to MAX_LENGTH characters. When the cut would make two different texts
 * read the same, both are cut from a little before the first place they differ (probe §14, 8).
 */
function describePair(mine: unknown, theirs: unknown): { mine: string; theirs: string } {
  const a = describe(mine);
  const b = describe(theirs);
  if (cut(a, 0) !== cut(b, 0) || a === b) return { mine: cut(a, 0), theirs: cut(b, 0) };
  let first = 0;
  while (first < a.length && first < b.length && a[first] === b[first]) first += 1;
  const from = Math.max(0, first - 40);
  return { mine: cut(a, from), theirs: cut(b, from) };
}

/**
 * The form's fields whose values differ between `mine` and `theirs`, in the form's order. Every
 * such field is shown, whoever changed it, so "keep mine" overwrites nothing the editor has not seen.
 */
export function changedFields(fields: FieldDescriptor[], mine: Record<string, unknown>, theirs: Record<string, unknown>): ChangedField[] {
  return fields
    .filter((f) => canonical(mine[f.key]) !== canonical(theirs[f.key]))
    .map((f) => ({ key: f.key, label: f.label, ...describePair(mine[f.key], theirs[f.key]) }));
}
