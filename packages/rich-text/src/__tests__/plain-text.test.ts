import { expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';
import { toPlainText } from '../plain-text.ts';

const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });

it('joins two paragraphs with a blank line', () => {
  const doc = richTextDocSchema.parse({ type: 'doc', content: [para('a'), para('b')] });
  expect(toPlainText(doc)).toBe('a\n\nb');
});

it('renders hard breaks as newlines and ignores images', () => {
  const doc = richTextDocSchema.parse({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
      { type: 'image', attrs: { asset: { _ref: '11111111-1111-4111-8111-111111111111', _kind: 'asset' }, alt: 'x' } },
      para('c'),
    ],
  });
  expect(toPlainText(doc)).toBe('a\nb\n\nc');
});
