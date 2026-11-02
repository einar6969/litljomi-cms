import { generateJSON } from '@tiptap/core';
import { expect, it } from 'vitest';
import { richTextDocSchema } from '../doc-schema.ts';
import { richTextExtensions } from '../tiptap.ts';

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

it('clamps pasted heading levels to 2 and 3', () => {
  const json = generateJSON('<h1>a</h1><h4>b</h4><h3>c</h3>', richTextExtensions());
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
