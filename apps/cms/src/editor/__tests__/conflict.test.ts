import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { changedFields, describeValue } from '../form/conflict';

const ASSET = '1a2b3c4d-0000-4000-8000-0000000000a1';
const ENTRY = '5e6f7a8b-0000-4000-8000-0000000000e1';
const fields = [
  { key: 'title', kind: 'text', label: 'Titill', required: true },
  { key: 'image', kind: 'image', label: 'Mynd', required: false },
  { key: 'body', kind: 'richText', label: 'Meginmál', required: false },
];
const r = t.editor.resolve;

describe('changedFields', () => {
  it('lists, in the form\'s order, every field whose value differs between the two versions', () => {
    const mine = { title: 'Mitt', image: { _ref: ASSET, _kind: 'asset', alt: 'A' } };
    const theirs = { title: 'Þeirra', image: { alt: 'A', _kind: 'asset', _ref: ASSET } };
    expect(changedFields(fields, mine, theirs)).toEqual([{ key: 'title', label: 'Titill', mine: 'Mitt', theirs: 'Þeirra' }]);
  });

  it('counts a field only one side has as changed, and an absent field as equal to an absent one', () => {
    expect(changedFields(fields, { title: 'x' }, { title: 'x', body: { type: 'doc', content: [] } }).map((f) => f.key)).toEqual(['body']);
    expect(changedFields(fields, { title: 'x' }, { title: 'x' })).toEqual([]);
  });

  it('ignores keys the form has no field for', () => {
    expect(changedFields(fields, { title: 'x', extra: 1 }, { title: 'x', extra: 2 })).toEqual([]);
  });
});

describe('describeValue', () => {
  it('describes scalars, empty values and lists', () => {
    expect(describeValue('Brauð')).toBe('Brauð');
    expect(describeValue(undefined)).toBe(r.empty);
    expect(describeValue(null)).toBe(r.empty);
    expect(describeValue('')).toBe(r.empty);
    expect(describeValue(12.5)).toBe('12.5');
    expect(describeValue(true)).toBe(r.yes);
    expect(describeValue(false)).toBe(r.no);
    expect(describeValue([])).toBe(r.empty);
    expect(describeValue(['a', 'b'])).toBe('a; b');
  });

  it('describes rich text by its text, an image by its asset and alt, links and references', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Halló' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'heimur' }] }] };
    expect(describeValue(doc)).toBe('Halló\n\nheimur');
    expect(describeValue({ _ref: ASSET, _kind: 'asset', alt: 'Brauð' })).toBe(`${r.image} 1a2b3c4d: Brauð`);
    expect(describeValue({ _ref: ASSET, _kind: 'asset', alt: '' })).toBe(`${r.image} 1a2b3c4d`);
    expect(describeValue({ _ref: ENTRY, _kind: 'entry' })).toBe(`${r.entry} 5e6f7a8b`);
    expect(describeValue({ href: 'https://labak.is/' })).toBe('https://labak.is/');
    expect(describeValue({ entry: { _ref: ENTRY, _kind: 'entry' } })).toBe(`${r.entry} 5e6f7a8b`);
  });

  it('describes a video by its title, address and still (A11)', () => {
    const clip = { url: 'https://vimeo.com/76979871', title: 'Opnunin', still: { _ref: ASSET, _kind: 'asset', alt: 'Dans' } };
    expect(describeValue(clip)).toBe(`${r.video}: Opnunin, https://vimeo.com/76979871, ${r.image} 1a2b3c4d: Dans`);
    expect(describeValue({ ...clip, still: null })).toBe(`${r.video}: Opnunin, https://vimeo.com/76979871`);
    expect(describeValue({ url: '', title: '', still: null })).toBe(`${r.video}: ${r.empty}`);
    // Two videos that differ only in the still are told apart.
    expect(describeValue(clip)).not.toBe(describeValue({ ...clip, still: { ...clip.still, _ref: ENTRY } }));
  });

  it('describes a group by its values, and shortens a long value', () => {
    expect(describeValue({ name: 'Anna', role: 'Bakari' })).toBe('Anna; Bakari');
    const long = describeValue('x'.repeat(500));
    expect(long).toHaveLength(301);
    expect(long.endsWith('…')).toBe(true);
  });
});
