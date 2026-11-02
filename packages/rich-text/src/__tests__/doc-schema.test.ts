import { describe, expect, it } from 'vitest';
import { RICH_TEXT_MAX_DEPTH, isSafeHref, richTextDocSchema } from '../doc-schema.ts';

const A = '11111111-1111-4111-8111-111111111111';
const p = (text: string, marks?: unknown[]) => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const doc = (...content: unknown[]) => ({ type: 'doc', content });

describe('richTextDocSchema', () => {
  it('accepts the v1 node and mark set', () => {
    const ok = doc(
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] },
      p('b', [{ type: 'bold' }, { type: 'italic' }]),
      p('l', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
      p('m', [{ type: 'link', attrs: { href: 'mailto:a@b.is' } }]),
      p('e', [{ type: 'link', attrs: { entry: { _ref: A, _kind: 'entry' } } }]),
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('x')] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [p('y')] }] },
      { type: 'blockquote', content: [p('q')] },
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
      { type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' }, alt: 'an image', caption: 'c' } },
    );
    expect(richTextDocSchema.safeParse(ok).success).toBe(true);
  });

  it('rejects a table', () => {
    expect(richTextDocSchema.safeParse(doc({ type: 'table', content: [] })).success).toBe(false);
  });

  it('rejects heading level 1', () => {
    const d = doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'h' }] });
    expect(richTextDocSchema.safeParse(d).success).toBe(false);
  });

  it('rejects a javascript: link', () => {
    const d = doc(p('x', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]));
    expect(richTextDocSchema.safeParse(d).success).toBe(false);
  });

  it.each(['https://labak.is@evil.com', 'https://u:p@x.is', 'http://user@x.is/a', 'https://:secret@x.is', 'HTTPS://U@X.IS'])(
    'rejects a link with credentials: %s (decision 32)',
    (href) => {
      expect(isSafeHref(href)).toBe(false);
      const d = doc(p('x', [{ type: 'link', attrs: { href } }]));
      expect(richTextDocSchema.safeParse(d).success).toBe(false);
    },
  );

  it('accepts an empty userinfo and mailto addresses (no credentials)', () => {
    expect(isSafeHref('https://@x.is')).toBe(true);
    expect(isSafeHref('mailto:u:p@x.is')).toBe(true);
  });

  it('rejects an image without alt', () => {
    const d = doc({ type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' } } });
    expect(richTextDocSchema.safeParse(d).success).toBe(false);
  });

  it('rejects unknown marks and extra attributes', () => {
    expect(richTextDocSchema.safeParse(doc(p('x', [{ type: 'strike' }]))).success).toBe(false);
    expect(
      richTextDocSchema.safeParse(doc(p('x', [{ type: 'bold', attrs: { style: 'color:red' } }]))).success,
    ).toBe(false);
    expect(
      richTextDocSchema.safeParse(doc({ type: 'paragraph', attrs: { style: 'color:red' } })).success,
    ).toBe(false);
  });

  it('stores link hrefs in canonical form (new URL(s).href)', () => {
    const cases: [string, string][] = [
      ['HTTPS://Example.com', 'https://example.com/'],
      ['Mailto:a@b.is', 'mailto:a@b.is'],
      ['ht\ttps://example.com', 'https://example.com/'],
      ['https://exa\nmple.com/a', 'https://example.com/a'],
      ['\u0001https://example.com', 'https://example.com/'],
    ];
    for (const [input, expected] of cases) {
      const r = richTextDocSchema.safeParse(doc(p('t', [{ type: 'link', attrs: { href: input } }])));
      expect(r.success).toBe(true);
      expect(JSON.stringify(r.data)).toContain(`"href":"${expected}"`);
    }
  });

  it('accepts ordered lists as the editor emits them', () => {
    const li = { type: 'listItem', content: [{ type: 'paragraph' }] };
    for (const attrs of [{ start: 1, type: null }, { start: 3 }, undefined]) {
      const ol = { type: 'orderedList', ...(attrs ? { attrs } : {}), content: [li] };
      expect(richTextDocSchema.safeParse(doc(ol)).success).toBe(true);
    }
    const bad = { type: 'orderedList', attrs: { start: 0 }, content: [li] };
    expect(richTextDocSchema.safeParse(doc(bad)).success).toBe(false);
    expect(richTextDocSchema.safeParse(doc({ ...bad, attrs: { start: 1, type: 'a' } })).success).toBe(false);
  });
});

describe('nesting depth cap', () => {
  const nest = (n: number) => {
    let node: unknown = p('x');
    for (let i = 0; i < n; i++) node = { type: 'blockquote', content: [node] };
    return doc(node);
  };
  it('accepts nesting up to the cap and rejects deeper nesting without throwing', () => {
    expect(RICH_TEXT_MAX_DEPTH).toBe(50);
    // doc + n blockquotes + paragraph + text node = n + 3 levels
    expect(richTextDocSchema.safeParse(nest(RICH_TEXT_MAX_DEPTH - 3)).success).toBe(true);
    expect(richTextDocSchema.safeParse(nest(RICH_TEXT_MAX_DEPTH - 2)).success).toBe(false);
  });
  it('returns success: false for 3,000 nested blockquotes instead of throwing', () => {
    const r = richTextDocSchema.safeParse(nest(3000));
    expect(r.success).toBe(false);
  });
  it('counts list nesting too', () => {
    let node: unknown = p('x');
    for (let i = 0; i < 30; i++) node = { type: 'bulletList', content: [{ type: 'listItem', content: [node] }] };
    expect(richTextDocSchema.safeParse(doc(node)).success).toBe(false);
  });
});

describe('canonical lowercase UUID references (decision 25)', () => {
  const GOOD = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
  const withRef = (v: unknown) =>
    doc({ type: 'image', attrs: { asset: { _ref: v, _kind: 'asset' }, alt: 'a' } }, p('e', [{ type: 'link', attrs: { entry: { _ref: v, _kind: 'entry' } } }]));
  it('accepts the lowercase hyphenated form', () => {
    expect(richTextDocSchema.safeParse(withRef(GOOD)).success).toBe(true);
  });
  it.each([
    ['upper case', GOOD.toUpperCase()],
    ['braces', `{${GOOD}}`],
    ['unhyphenated', GOOD.replaceAll('-', '')],
    ['null', null],
  ])('rejects %s', (_n, v) => {
    expect(richTextDocSchema.safeParse(withRef(v)).success).toBe(false);
    expect(richTextDocSchema.safeParse(doc({ type: 'image', attrs: { asset: { _ref: v, _kind: 'asset' }, alt: 'a' } })).success).toBe(false);
  });
});
