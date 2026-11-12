import { expect, it } from 'vitest';
import { is } from '../is';

/** Every leaf of the text tree, with its dotted key. */
function leaves(node: unknown, key = ''): [string, unknown][] {
  if (typeof node !== 'object' || node === null) return [[key, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, key ? `${key}.${k}` : k));
}

it('is non-empty text for every key', () => {
  for (const [key, value] of leaves(is)) {
    expect(typeof value, key).toBe('string');
    expect((value as string).trim(), key).not.toBe('');
  }
});
