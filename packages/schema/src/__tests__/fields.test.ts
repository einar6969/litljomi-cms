import { describe, expect, it } from 'vitest';
import { date, link, text } from '../index.ts';

const id = '6f0d3c2e-8a41-4b7e-9c55-1d2e3f4a5b6c';

describe('text', () => {
  it('enforces max, required and single-line on publish', () => {
    const s = text({ label: 'L', required: true, max: 3 }).publishSchema();
    expect(s.safeParse('abc').success).toBe(true);
    expect(s.safeParse('abcd').success).toBe(false);
    expect(s.safeParse('').success).toBe(false);
    expect(s.safeParse(null).success).toBe(false);
    expect(text({ label: 'L' }).publishSchema().safeParse('a\nb').success).toBe(false);
    expect(text({ label: 'L', multiline: true }).publishSchema().safeParse('a\nb').success).toBe(true);
  });
  it('optional text accepts null on publish', () => {
    expect(text({ label: 'L' }).publishSchema().safeParse(null).success).toBe(true);
  });
});

describe('date', () => {
  const s = date({ label: 'D', required: true }).publishSchema();
  it('accepts real ISO dates only', () => {
    expect(s.safeParse('2025-02-28').success).toBe(true);
    expect(s.safeParse('2025-02-30').success).toBe(false);
    expect(s.safeParse('2025-2-3').success).toBe(false);
    expect(s.safeParse('2025-01-01T00:00:00Z').success).toBe(false);
  });
});

describe('link', () => {
  const s = link({ label: 'L' }).publishSchema();
  it('rejects javascript: URLs', () => {
    expect(s.safeParse({ href: 'javascript:alert(1)' }).success).toBe(false);
    expect(s.safeParse({ href: ' javascript:alert(1)' }).success).toBe(false);
    expect(s.safeParse({ href: 'data:text/html,x' }).success).toBe(false);
    expect(s.safeParse({ href: '/relative' }).success).toBe(false);
  });
  it('accepts https, http, mailto and entry references', () => {
    expect(s.safeParse({ href: 'https://example.is/a?b=1' }).success).toBe(true);
    expect(s.safeParse({ href: 'http://example.is' }).success).toBe(true);
    expect(s.safeParse({ href: 'mailto:a@example.is' }).success).toBe(true);
    expect(s.safeParse({ entry: { _ref: id, _kind: 'entry' } }).success).toBe(true);
  });
  it('rejects malformed references and mixed shapes', () => {
    expect(s.safeParse({ entry: { _ref: 'x', _kind: 'entry' } }).success).toBe(false);
    expect(s.safeParse({ entry: { _ref: id, _kind: 'asset' } }).success).toBe(false);
    expect(s.safeParse({ href: 'https://a.is', entry: { _ref: id, _kind: 'entry' } }).success).toBe(false);
  });
  it('required link rejects null on publish; draft accepts it', () => {
    const r = link({ label: 'L', required: true });
    expect(r.publishSchema().safeParse(null).success).toBe(false);
    expect(r.draftSchema().safeParse(null).success).toBe(true);
  });
});
