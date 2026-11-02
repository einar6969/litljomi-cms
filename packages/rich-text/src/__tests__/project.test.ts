import { expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';
import { projectRichText, type RichTextResolver } from '../project.ts';

const A = '11111111-1111-4111-8111-111111111111';
const E = '22222222-2222-4222-8222-222222222222';

const doc = richTextDocSchema.parse({
  type: 'doc',
  content: [
    { type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' }, alt: 'pic', caption: 'cap' } },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'see', marks: [{ type: 'link', attrs: { entry: { _ref: E, _kind: 'entry' } } }, { type: 'bold' }] },
      ],
    },
  ],
});

const resolver = (o: Partial<RichTextResolver>): RichTextResolver => ({
  asset: () => null,
  entryPath: () => null,
  ...o,
});

it('drops an image whose asset is null', () => {
  const out = projectRichText(doc, resolver({}));
  expect(out.content?.map((n) => n.type)).toEqual(['paragraph']);
});

it('unlinks an entry link whose path is null but keeps other marks', () => {
  const out = projectRichText(doc, resolver({}));
  const text = (out.content?.[0] as { content: { marks?: unknown[] }[] }).content[0]!;
  expect(text.marks).toEqual([{ type: 'bold' }]);
});

it('resolves images and entry links', () => {
  const out = projectRichText(
    doc,
    resolver({
      asset: () => ({ url: 'https://m.test/a.jpg', width: 10, height: 20 }),
      entryPath: (id) => (id === E ? '/frettir/x' : null),
    }),
  );
  expect(out.content?.[0]).toEqual({
    type: 'image',
    attrs: { src: 'https://m.test/a.jpg', width: 10, height: 20, alt: 'pic', caption: 'cap' },
  });
  const text = (out.content?.[1] as { content: { marks?: unknown[] }[] }).content[0]!;
  expect(text.marks).toEqual([{ type: 'link', attrs: { href: '/frettir/x' } }, { type: 'bold' }]);
});

it('keeps an ordered list start through projection', () => {
  const li = { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
  const d = richTextDocSchema.parse({
    type: 'doc',
    content: [{ type: 'orderedList', attrs: { start: 3, type: null }, content: [li] }],
  });
  const out = projectRichText(d, resolver({}));
  expect(out.content[0]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
});
