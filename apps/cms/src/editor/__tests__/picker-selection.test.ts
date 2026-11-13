// Media library L6 (docs/plans/media-library.md section 6.3): the picker's selection order, a
// list's `max`, and the alt text a new use of a file gets.
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { appendImages, confirmLabel, imageValueOf, noRoomLine, selectedLine, selectUploaded, toggleSelection } from '../media/picker-selection';

const keys = () => {
  let n = 0;
  return () => `new${++n}`;
};

describe('toggleSelection', () => {
  it('keeps the order files were chosen in, and takes one out without moving the rest', () => {
    let selected: string[] = [];
    for (const id of ['c', 'a', 'b']) selected = toggleSelection(selected, id, 'many');
    expect(selected).toEqual(['c', 'a', 'b']);
    selected = toggleSelection(selected, 'a', 'many');
    expect(selected).toEqual(['c', 'b']);
    // Chosen again, it goes to the end.
    expect(toggleSelection(selected, 'a', 'many')).toEqual(['c', 'b', 'a']);
  });

  it('holds one file at most in one-file mode, and none when the chosen one is clicked again', () => {
    expect(toggleSelection([], 'a', 'one')).toEqual(['a']);
    expect(toggleSelection(['a'], 'b', 'one')).toEqual(['b']);
    expect(toggleSelection(['b'], 'b', 'one')).toEqual([]);
  });
});

describe('selectUploaded', () => {
  it('appends uploaded files after the ones already selected, in their order, once each', () => {
    expect(selectUploaded(['a'], ['u1', 'u2', 'a', 'u1'], 'many')).toEqual(['a', 'u1', 'u2']);
    expect(selectUploaded(['a'], [], 'many')).toEqual(['a']);
  });

  it('selects the last upload alone in one-file mode', () => {
    expect(selectUploaded(['a'], ['u1', 'u2'], 'one')).toEqual(['u2']);
    expect(selectUploaded(['a'], [], 'one')).toEqual(['a']);
  });
});

describe('imageValueOf', () => {
  it("copies the file's default alt text into the new use", () => {
    expect(imageValueOf({ id: 'f1', defaultAlt: 'Brauð á borði' })).toEqual({ _ref: 'f1', _kind: 'asset', alt: 'Brauð á borði' });
    expect(imageValueOf({ id: 'f1', defaultAlt: null })).toEqual({ _ref: 'f1', _kind: 'asset', alt: '' });
  });

  it('keeps the alt text this use already has when an image is replaced', () => {
    expect(imageValueOf({ id: 'f2', defaultAlt: 'Sjálfgefinn' }, 'Minn texti')).toEqual({ _ref: 'f2', _kind: 'asset', alt: 'Minn texti' });
    // An empty or blank one is not kept: the default fills it.
    expect(imageValueOf({ id: 'f2', defaultAlt: 'Sjálfgefinn' }, '  ')).toEqual({ _ref: 'f2', _kind: 'asset', alt: 'Sjálfgefinn' });
  });
});

describe('appendImages', () => {
  const files = ['a', 'b', 'c', 'd'].map((id) => ({ id, defaultAlt: id === 'b' ? 'Bé' : null }));
  const existing = [{ _key: 'k1', value: { _ref: 'x', _kind: 'asset', alt: 'X' } }];

  it('appends every chosen file in order, each a new item with its default alt text', () => {
    const result = appendImages(existing, files, undefined, keys());
    expect(result.items).toEqual([
      existing[0],
      { _key: 'new1', value: { _ref: 'a', _kind: 'asset', alt: '' } },
      { _key: 'new2', value: { _ref: 'b', _kind: 'asset', alt: 'Bé' } },
      { _key: 'new3', value: { _ref: 'c', _kind: 'asset', alt: '' } },
      { _key: 'new4', value: { _ref: 'd', _kind: 'asset', alt: '' } },
    ]);
    expect(result.added).toEqual(['new1', 'new2', 'new3', 'new4']);
    expect(result.left).toBe(0);
  });

  it("takes what fits under the list's max, first chosen first, and counts the rest", () => {
    const result = appendImages(existing, files, 3, keys());
    expect(result.items.map((i) => (i.value as { _ref: string })._ref)).toEqual(['x', 'a', 'b']);
    expect(result.added).toHaveLength(2);
    expect(result.left).toBe(2);
  });

  it('adds nothing to a full list', () => {
    const result = appendImages(existing, files, 1, keys());
    expect(result.items).toEqual(existing);
    expect(result).toMatchObject({ added: [], left: 4 });
  });

  it('gives every new item a fresh key by default', () => {
    const { added } = appendImages([], files);
    expect(new Set(added).size).toBe(4);
  });
});

describe('the words', () => {
  it('counts a selection in the singular for numbers ending in 1, except 11', () => {
    expect(selectedLine(1)).toBe(t.picker.selectedOne.replace('{n}', '1'));
    expect(selectedLine(21)).toBe(t.picker.selectedOne.replace('{n}', '21'));
    expect(selectedLine(11)).toBe(t.picker.selectedMany.replace('{n}', '11'));
    expect(selectedLine(3)).toBe(t.picker.selectedMany.replace('{n}', '3'));
  });

  it('names the confirm button for one file, or for the number chosen', () => {
    expect(confirmLabel(1, 'one')).toBe(t.picker.confirmOne);
    expect(confirmLabel(1, 'many')).toBe(t.picker.confirmOne);
    expect(confirmLabel(12, 'many')).toBe(t.picker.confirmMany.replace('{n}', '12'));
  });

  it('says how many there was room for', () => {
    expect(noRoomLine(2)).toBe(t.editor.list.noRoom.replace('{n}', '2'));
  });
});
