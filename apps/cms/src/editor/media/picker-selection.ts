// What the library picker chooses, and what a form makes of it (docs/plans/media-library.md section
// 6.3, slice L6), with no I/O. An image field takes one file; a list of images takes many, appended
// in the order they were chosen, as far as the list's `max` allows. Each new use of a file gets the
// file's default alt text, so the editor does not type it again and can still change it there.
import { newItemKey, type ListItem } from '@litljomi/cms-schema/src/fields/list.ts';
import { t } from '@/i18n/is';

/** The stored value of an image field: an asset reference with this use's alt text (§5.2). */
export type ImageValue = { _ref: string; _kind: 'asset'; alt: string };

/** A file as the picker hands it to a form: its id and its default alt text. */
export type PickedFile = { id: string; defaultAlt: string | null };

/** One file for an image field, or several for a list of images. */
export type PickMode = 'one' | 'many';

/**
 * The selection after a file is clicked or Space is pressed on it. In 'one' it is that file alone,
 * or nothing when it was the one selected. In 'many' the file goes to the end, or leaves; the
 * others keep their order, which is the order the list receives them in.
 */
export function toggleSelection(selected: readonly string[], id: string, mode: PickMode): string[] {
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  return mode === 'one' ? [id] : [...selected, id];
}

/**
 * The selection once files uploaded inside the picker have arrived: they come selected. In 'many'
 * they follow the files already selected, in the order given; in 'one' the last of them alone.
 */
export function selectUploaded(selected: readonly string[], ids: readonly string[], mode: PickMode): string[] {
  if (ids.length === 0) return [...selected];
  if (mode === 'one') return [ids[ids.length - 1]!];
  return [...selected, ...ids.filter((id, i) => !selected.includes(id) && ids.indexOf(id) === i)];
}

/**
 * An image field's value for a chosen file. Its alt text is the file's default, unless the field
 * already has its own: replacing an image keeps the alt text the editor wrote for this use.
 */
export function imageValueOf(file: PickedFile, currentAlt = ''): ImageValue {
  return { _ref: file.id, _kind: 'asset', alt: currentAlt.trim() !== '' ? currentAlt : (file.defaultAlt ?? '') };
}

/**
 * A list's items with the chosen files appended in order, each as a new item holding the file
 * (`imageValueOf`), as far as `max` allows. `added` is the new items' keys; `left` is how many
 * files did not fit.
 */
export function appendImages(
  items: readonly ListItem[],
  files: readonly PickedFile[],
  max?: number,
  key: () => string = newItemKey,
): { items: ListItem[]; added: string[]; left: number } {
  const room = max === undefined ? files.length : Math.max(0, max - items.length);
  const fitting = files.slice(0, room);
  const appended = fitting.map((file) => ({ _key: key(), value: imageValueOf(file) }));
  return { items: [...items, ...appended], added: appended.map((item) => item._key), left: files.length - fitting.length };
}

const isSingular = (n: number): boolean => n % 10 === 1 && n % 100 !== 11;

/** The announced count of a selection: "3 myndir valdar". */
export const selectedLine = (n: number): string => (isSingular(n) ? t.picker.selectedOne : t.picker.selectedMany).replace('{n}', String(n));

/** The confirm button: "Velja mynd" for one file, "Velja 12 myndir" for several. */
export const confirmLabel = (n: number, mode: PickMode): string =>
  mode === 'one' || n === 1 ? t.picker.confirmOne : t.picker.confirmMany.replace('{n}', String(n));

/** What a list says when its `max` left files out: how many there was room for. */
export const noRoomLine = (added: number): string => t.editor.list.noRoom.replace('{n}', String(added));
