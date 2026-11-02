import { describe, expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';

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
});
