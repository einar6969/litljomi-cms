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

// Decision 37.4: the sign-in form shows this one neutral message for success, an unknown address
// and a rate limit alike; the login action tests check that every outcome lands on it.
it('keeps the neutral sign-in message of decision 37.4', () => {
  expect(is.login.sent).toBe('Ef netfangið er skráð færðu tölvupóst');
});
