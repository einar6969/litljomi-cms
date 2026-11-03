import { Editor, generateJSON } from '@tiptap/core';
import { expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';
import { isAllowedUri, richTextExtensions } from '../tiptap.ts';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const names = (extensions: { name: string }[]) => extensions.map((e) => e.name);

it('leaves out code, codeBlock, horizontalRule and strike', () => {
  const html = '<pre><code>c</code></pre><hr><p><code>d</code><s>e</s></p>';
  const json = JSON.stringify(generateJSON(html, richTextExtensions()));
  for (const bad of ['"code"', '"codeBlock"', '"horizontalRule"', '"strike"']) expect(json).not.toContain(bad);
  expect(names(richTextExtensions())).toEqual(expect.arrayContaining(['link', 'image']));
});

it('strips pasted tables, colours and strike-through (review focus 2)', () => {
  const html = '<table><tr><td>x</td></tr></table><p style="color:red"><s>y</s></p>';
  const json = generateJSON(html, richTextExtensions());
  const text = JSON.stringify(json);
  expect(text).not.toContain('table');
  expect(text).not.toContain('strike');
  expect(text).not.toContain('style');
  expect(text).not.toContain('color');
  expect(text).toContain('"x"');
  expect(text).toContain('"y"');
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
});

it('clamps pasted heading levels to 2 and 3, keeping the text and level 3', () => {
  const json = generateJSON('<h1>a</h1><h4>b</h4><h3>c</h3>', richTextExtensions());
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
  const text = JSON.stringify(json);
  for (const t of ['"a"', '"b"', '"c"']) expect(text).toContain(t);
  const h3 = (json.content as { type: string; attrs?: { level: number }; content?: { text: string }[] }[]).find(
    (n) => n.type === 'heading' && n.content?.[0]?.text === 'c',
  );
  expect(h3?.attrs?.level).toBe(3);
});

it('an ordered list from the editor or a paste validates', () => {
  const json = generateJSON('<ol><li><p>x</p></li></ol>', richTextExtensions());
  expect(JSON.stringify(json)).toContain('orderedList');
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
  const started = generateJSON('<ol start="3"><li><p>x</p></li></ol>', richTextExtensions());
  expect(richTextDocSchema.safeParse(started).success).toBe(true);
});

it('normalizes a pasted upper-case scheme link to a canonical href', () => {
  const json = generateJSON('<p><a href="HTTPS://Example.com">t</a></p>', richTextExtensions());
  const parsed = richTextDocSchema.safeParse(json);
  expect(parsed.success).toBe(true);
  expect(JSON.stringify(parsed.data)).toContain('"href":"https://example.com/"');
});

it('round-trips entry links and images through the extensions against the schema', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'see', marks: [{ type: 'link', attrs: { entry: { _ref: A, _kind: 'entry' } } }] }],
      },
      { type: 'image', attrs: { asset: { _ref: B, _kind: 'asset' }, alt: 'An alt', caption: 'A caption' } },
    ],
  };
  expect(richTextDocSchema.safeParse(doc).success).toBe(true);
  const editor = new Editor({ extensions: richTextExtensions(), content: doc, element: document.createElement('div') });
  const out = editor.getJSON();
  editor.destroy();
  expect(richTextDocSchema.safeParse(out).success).toBe(true);
  const text = JSON.stringify(out);
  expect(text).toContain(A);
  expect(text).toContain(B);
  expect(text).toContain('An alt');
  expect(text).toContain('A caption');
});

it('drops a pasted link with credentials (decision 32)', () => {
  const json = generateJSON('<p><a href="https://labak.is@evil.com/x">bad</a></p>', richTextExtensions());
  const text = JSON.stringify(json);
  expect(text).not.toContain('evil.com');
  expect(text).not.toContain('"link"');
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
});

it('drops a pasted <img>', () => {
  const json = generateJSON('<p>a</p><img src="https://example.com/x.png" alt="x">', richTextExtensions());
  expect(JSON.stringify(json)).not.toContain('"image"');
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
});

it('keeps safe pasted links, drops javascript: links, and round-trips through JSON', () => {
  const html = '<p><a href="https://example.com/a" target="_blank" class="x">ok</a> <a href="javascript:alert(1)">bad</a></p>';
  const json = generateJSON(html, richTextExtensions());
  const text = JSON.stringify(json);
  expect(text).toContain('https://example.com/a');
  expect(text).not.toContain('javascript');
  expect(text).not.toContain('target');
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
  expect(richTextDocSchema.safeParse(JSON.parse(text)).success).toBe(true);
});

// Deferred Task 14 rows (owner Task 24): a pasted list's own numbering must not make the whole
// pasted document invalid, and odd link attributes must not break or bypass the editor.
it.each([
  ['start="0"', '<ol start="0"><li><p>x</p></li></ol>', 1],
  ['start="-3"', '<ol start="-3"><li><p>x</p></li></ol>', 1],
  ['start="abc"', '<ol start="abc"><li><p>x</p></li></ol>', 1],
  ['start="1e30"', '<ol start="99999999999999999999999999999"><li><p>x</p></li></ol>', 1],
  ['type="a" start="4"', '<ol type="a" start="4"><li><p>x</p></li></ol>', 4],
])('a pasted <ol %s> keeps the list and validates', (_name, html, start) => {
  const json = generateJSON(html, richTextExtensions());
  const list = (json.content as { type: string; attrs?: { start?: number; type?: unknown } }[])[0]!;
  expect(list.type).toBe('orderedList');
  expect(list.attrs?.start).toBe(start);
  expect(list.attrs?.type ?? null).toBeNull();
  expect(richTextDocSchema.safeParse(json).success).toBe(true);
});

it('a pasted <ol start="0"> into a live editor validates (the paste path, not only generateJSON)', () => {
  // jsdom has no ClipboardEvent; ProseMirror's pasteHTML only needs the event object.
  globalThis.ClipboardEvent ??= class extends Event {
    clipboardData = null;
  } as unknown as typeof ClipboardEvent;
  const editor = new Editor({ extensions: richTextExtensions(), element: document.createElement('div') });
  editor.view.pasteHTML('<ol type="i" start="0"><li><p>x</p></li></ol>');
  const out = editor.getJSON();
  editor.destroy();
  expect(JSON.stringify(out)).toContain('orderedList');
  expect(richTextDocSchema.safeParse(out).success).toBe(true);
});

it.each([null, 5, ['javascript:alert(1)'], { href: 'x' }])('an editor loaded with a non-string href %j mounts and renders no href', (href) => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 't', marks: [{ type: 'link', attrs: { href } }] }] }] };
  const element = document.createElement('div');
  const editor = new Editor({ extensions: richTextExtensions(), content: doc, element });
  const anchor = element.querySelector('a');
  editor.destroy();
  expect(anchor?.getAttribute('href') ?? '').toBe('');
});

it('setLink and toggleLink refuse a link with neither href nor entry', () => {
  const editor = new Editor({
    extensions: richTextExtensions(),
    content: '<p>text</p>',
    element: document.createElement('div'),
  });
  editor.commands.selectAll();
  expect(editor.commands.setLink({} as { href: string })).toBe(false);
  expect(editor.commands.toggleLink({} as { href: string })).toBe(false);
  expect(editor.commands.setLink({ href: 'javascript:alert(1)' })).toBe(false);
  expect(JSON.stringify(editor.getJSON())).not.toContain('"link"');
  expect(editor.commands.setLink({ href: 'https://example.com/' })).toBe(true);
  expect(JSON.stringify(editor.getJSON())).toContain('https://example.com/');
  editor.destroy();
});

// M2-01 acceptance (Task 14 r2 security): the link rule fails closed on any non-string href
// without throwing; an entry link (no href) is allowed and renders no href.
it.each([5, 0, null, true, ['https://example.com/'], { href: 'https://example.com/' }, Number.NaN])('isAllowedUri(%j) is false and does not throw', (href) => {
  expect(isAllowedUri(href)).toBe(false);
});

it('isAllowedUri allows an entry link (undefined) and safe strings only', () => {
  expect(isAllowedUri(undefined)).toBe(true);
  expect(isAllowedUri('https://example.com/')).toBe(true);
  expect(isAllowedUri('mailto:a@b.is')).toBe(true);
  expect(isAllowedUri('javascript:alert(1)')).toBe(false);
  expect(isAllowedUri('')).toBe(false);
});

it('a pasted <ol start="abc"> between paragraphs keeps the rest of the document', () => {
  const html = '<h2>Fyrirsögn</h2><p>Á undan</p><ol start="abc"><li><p>a</p></li><li><p>b</p></li></ol><p>Á eftir</p>';
  const json = generateJSON(html, richTextExtensions());
  const parsed = richTextDocSchema.safeParse(json);
  expect(parsed.success).toBe(true);
  const content = json.content as { type: string; attrs?: { start?: number } }[];
  expect(content.map((n) => n.type)).toEqual(['heading', 'paragraph', 'orderedList', 'paragraph']);
  expect(content[2]!.attrs?.start).toBe(1);
  const text = JSON.stringify(json);
  for (const kept of ['Fyrirsögn', 'Á undan', '"a"', '"b"', 'Á eftir']) expect(text).toContain(kept);
});
