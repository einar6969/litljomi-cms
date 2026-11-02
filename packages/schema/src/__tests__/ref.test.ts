import { describe, expect, it } from 'vitest';
import { image, refSchema } from '../index.ts';

const GOOD = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const BAD: Array<[string, unknown]> = [
  ['upper case', GOOD.toUpperCase()],
  ['braces', `{${GOOD}}`],
  ['unhyphenated', GOOD.replaceAll('-', '')],
  ['null', null],
  ['trailing newline', `${GOOD}\n`],
  ['urn prefix', `urn:uuid:${GOOD}`],
];

describe('canonical lowercase UUID references (decision 25)', () => {
  it.each(['entry', 'asset'] as const)('refSchema(%s) accepts the lowercase form', (kind) => {
    expect(refSchema(kind).safeParse({ _ref: GOOD, _kind: kind }).success).toBe(true);
  });
  it.each(BAD)('refSchema rejects %s', (_n, v) => {
    expect(refSchema('entry').safeParse({ _ref: v, _kind: 'entry' }).success).toBe(false);
  });
  it('the image field uses the same rule', () => {
    const f = image({ label: 'I' }).draftSchema();
    expect(f.safeParse({ _ref: GOOD, _kind: 'asset', alt: '' }).success).toBe(true);
    for (const [, v] of BAD) expect(f.safeParse({ _ref: v, _kind: 'asset', alt: '' }).success).toBe(false);
  });
});
