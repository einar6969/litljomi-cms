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

  // A10 (probe §14, 8): a list is shown by its items' values, one numbered line each, never by the
  // items' keys.
  it('describes a list field by its items\' values, one numbered line each, without the item keys', () => {
    const list = [
      { _key: 'k1a2b3c4', value: 'Fyrsta' },
      { _key: 'k5d6e7f8', value: { name: 'Anna', role: 'Bakari' } },
      { _key: 'k9g0h1i2', value: { _ref: ASSET, _kind: 'asset', alt: 'Brauð' } },
      { _key: 'k3j4k5l6', value: null },
    ];
    const text = describeValue(list);
    expect(text).toBe(`1. Fyrsta\n2. Anna; Bakari\n3. ${r.image} 1a2b3c4d: Brauð\n4. ${r.empty}`);
    for (const key of ['k1a2b3c4', 'k5d6e7f8', 'k9g0h1i2', 'k3j4k5l6']) expect(text).not.toContain(key);
  });

  it('leaves a nested list\'s keys out too', () => {
    const group = { name: 'Anna', links: [{ _key: 'kk11', value: 'a' }, { _key: 'kk22', value: 'b' }] };
    const text = describeValue([{ _key: 'top1', value: group }]);
    expect(text).not.toMatch(/kk11|kk22|top1/);
    expect(text).toContain('Anna');
    expect(text).toContain('a');
  });

  // Probe §14, 8: two long values that differ past the cut must not read the same.
  it('shows where two long values differ when the cut would make them read the same', () => {
    const fields = [{ key: 'body', kind: 'text', label: 'Meginmál', required: false }];
    const same = 'x'.repeat(400);
    const [field] = changedFields(fields, { body: `${same}MITT` }, { body: `${same}ÞEIRRA` });
    expect(field!.mine).not.toBe(field!.theirs);
    expect(field!.mine).toContain('MITT');
    expect(field!.theirs).toContain('ÞEIRRA');
    expect(field!.mine.startsWith('…')).toBe(true);
    expect(field!.mine.length).toBeLessThanOrEqual(302);
  });

  it('describes a group by its values, and shortens a long value', () => {
    expect(describeValue({ name: 'Anna', role: 'Bakari' })).toBe('Anna; Bakari');
    const long = describeValue('x'.repeat(500));
    expect(long).toHaveLength(301);
    expect(long.endsWith('…')).toBe(true);
  });
});
