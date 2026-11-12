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

/** A video field's stored value (A11): exactly `{ url, title, still }`. */
const isVideo = (value: Record<string, unknown>): value is { url: string; title: string; still: Record<string, unknown> | null } =>
  Object.keys(value).length === 3 &&
  typeof value.url === 'string' &&
  typeof value.title === 'string' &&
  (value.still === null || isObject(value.still));

const shortId = (ref: unknown) => (typeof ref === 'string' ? ref.slice(0, 8) : '');

function describe(value: unknown): string {
  if (value === undefined || value === null || value === '') return t.editor.resolve.empty;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? t.editor.resolve.yes : t.editor.resolve.no;
  if (Array.isArray(value)) return value.length === 0 ? t.editor.resolve.empty : value.map(describe).join('; ');
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
  if (isVideo(value)) {
    const parts = [value.title, value.url].filter((s) => s !== '');
    if (value.still !== null) parts.push(describe(value.still));
    return `${t.editor.resolve.video}: ${parts.length === 0 ? t.editor.resolve.empty : parts.join(', ')}`;
  }
  if (typeof value.href === 'string') return value.href;
  if (isObject(value.entry)) return describe(value.entry);
  const parts = Object.values(value).filter((v) => v !== undefined);
  return parts.length === 0 ? t.editor.resolve.empty : parts.map(describe).join('; ');
}

/**
 * A short, readable text of a field value for the conflict view: rich text by its text, an image by
 * its asset (first eight characters of its id) and alt, a video by its title, address and still, a
 * list or group by its values.
 */
export function describeValue(value: unknown): string {
  const text = describe(value);
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH)}…` : text;
}

/**
 * The form's fields whose values differ between `mine` and `theirs`, in the form's order. Every
 * such field is shown, whoever changed it, so "keep mine" overwrites nothing the editor has not seen.
 */
export function changedFields(fields: FieldDescriptor[], mine: Record<string, unknown>, theirs: Record<string, unknown>): ChangedField[] {
  return fields
    .filter((f) => canonical(mine[f.key]) !== canonical(theirs[f.key]))
    .map((f) => ({ key: f.key, label: f.label, mine: describeValue(mine[f.key]), theirs: describeValue(theirs[f.key]) }));
}
