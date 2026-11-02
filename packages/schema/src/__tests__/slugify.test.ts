import { describe, expect, it } from 'vitest';
import { slugify } from '../index.ts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe('slugify', () => {
  it('transliterates Icelandic', () => {
    expect(slugify('Brauð ársins 2025')).toBe('braud-arsins-2025');
    expect(slugify('Þjóðhátíð – Æfing!')).toBe('thjodhatid-aefing');
    expect(slugify('ÖÁÉÍÓÚÝ öáéíóúý')).toBe('oaeiouy-oaeiouy');
  });
  it('collapses separators, trims, and strips other diacritics', () => {
    expect(slugify('  --Café   au__lait--  ')).toBe('cafe-au-lait');
    expect(slugify('!!!')).toBe('');
  });
  it('produces valid slugs', () => {
    for (const s of ['Hæ þú!', 'a  b', '2025/11/01', 'Ólafur Ragnar']) expect(slugify(s)).toMatch(SLUG);
  });
});
