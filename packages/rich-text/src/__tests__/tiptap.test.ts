import { Editor, generateJSON } from '@tiptap/core';
import { expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';
import { richTextExtensions } from '../tiptap.ts';

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
