import { describe, expect, it } from 'vitest';
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

describe('pruning containers emptied by dropped images', () => {
  const img = { type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' }, alt: 'x' } };
  const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const li = (...content: unknown[]) => ({ type: 'listItem', content });
  const project = (...content: unknown[]) =>
    projectRichText(richTextDocSchema.parse({ type: 'doc', content }), resolver({}));

  it('drops a blockquote, list item and list that become empty; keeps the rest', () => {
    const out = project(
      { type: 'blockquote', content: [img] },
      { type: 'bulletList', content: [li(img), li(para('keep'))] },
      { type: 'orderedList', content: [li(img)] },
      { type: 'blockquote', content: [{ type: 'blockquote', content: [img] }] },
      para('end'),
    );
    expect(out.content.map((b) => b.type)).toEqual(['bulletList', 'paragraph']);
    expect((out.content[0] as { content: unknown[] }).content).toHaveLength(1);
  });

  it('keeps empty paragraphs and may return an empty document', () => {
    expect(project({ type: 'paragraph' }).content).toEqual([{ type: 'paragraph' }]);
    expect(project({ type: 'blockquote', content: [img] }).content).toEqual([]);
  });
});

describe('resolver output is checked', () => {
  const linked = richTextDocSchema.parse({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { entry: { _ref: E, _kind: 'entry' } } }] }] },
      { type: 'image', attrs: { asset: { _ref: A, _kind: 'asset' }, alt: 'a' } },
    ],
  });
  const marksOf = (d: ReturnType<typeof projectRichText>) =>
    (d.content[0] as { content: { marks?: unknown[] }[] }).content[0]!.marks;

  it.each(['//evil.com', '/\\evil.com', '/\t/evil.com', 'https://evil.com', 'javascript:alert(1)', 'frettir/x', '', '/a b'])(
    'treats entry path %j as unresolved',
    (path) => {
      expect(marksOf(projectRichText(linked, resolver({ entryPath: () => path })))).toBeUndefined();
    },
  );
  it('accepts root-relative paths', () => {
    for (const path of ['/', '/frettir/x', '/a?b=1#c']) {
      expect(marksOf(projectRichText(linked, resolver({ entryPath: () => path })))).toEqual([
        { type: 'link', attrs: { href: path } },
      ]);
    }
  });
  it.each(['data:image/png;base64,AA', 'javascript:alert(1)', 'http://m.test/a.jpg', '//m.test/a.jpg', '/a.jpg', 'https://', ' https://m.test/a.jpg'])(
    'drops an image whose asset url is %j',
    (url) => {
      const out = projectRichText(linked, resolver({ asset: () => ({ url, width: 1, height: 1 }) }));
      expect(out.content.map((b) => b.type)).toEqual(['paragraph']);
    },
  );
  it('keeps an https asset url', () => {
    const out = projectRichText(linked, resolver({ asset: () => ({ url: 'https://m.test/a.jpg', width: 1, height: 1 }) }));
    expect(out.content.map((b) => b.type)).toEqual(['paragraph', 'image']);
  });
  it('drops an image whose asset url carries credentials', () => {
    const out = projectRichText(linked, resolver({ asset: () => ({ url: 'https://u:p@m.test/a.jpg', width: 1, height: 1 }) }));
    expect(out.content.map((b) => b.type)).toEqual(['paragraph']);
  });
  it('delivers the asset url in its canonical form', () => {
    const out = projectRichText(linked, resolver({ asset: () => ({ url: 'https:m.test/a.jpg', width: 1, height: 1 }) }));
    expect((out.content[1] as { attrs: { src: string } }).attrs.src).toBe('https://m.test/a.jpg');
  });
});
