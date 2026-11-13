// @vitest-environment jsdom
// A10 (probe: "paste from Word: lists become paragraphs with typed bullets; H1 becomes a paragraph;
// no notice"; §14, 9): pasted HTML is tidied before the v1 parser reads it.
import { richTextDocSchema } from '@litljomi/rich-text';
import { richTextExtensions } from '@litljomi/rich-text/editor';
import { generateJSON } from '@tiptap/react';
import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { droppedNotice, normalizePastedHtml } from '../form/paste';

type Node = { type: string; attrs?: Record<string, unknown>; content?: Node[]; text?: string };

/** The document the editor would hold after the paste. */
function pasted(html: string): Node {
  const doc = generateJSON(normalizePastedHtml(html).html, richTextExtensions()) as Node;
  expect(richTextDocSchema.safeParse(doc).success).toBe(true);
  return doc;
}

const textOf = (node: Node): string => node.text ?? (node.content ?? []).map(textOf).join('');
/** The block structure as a compact outline: list → its items' texts. */
function outline(node: Node): unknown {
  if (node.type === 'bulletList' || node.type === 'orderedList') return { [node.type]: (node.content ?? []).map(outline) };
  if (node.type === 'listItem') {
    const blocks = node.content ?? [];
    const nested = blocks.filter((b) => b.type !== 'paragraph').map(outline);
    const text = blocks.filter((b) => b.type === 'paragraph').map(textOf).join(' ');
    return nested.length > 0 ? [text, ...nested] : text;
  }
  if (node.type === 'heading') return { [`h${String(node.attrs?.level)}`]: textOf(node) };
  return textOf(node);
}
const blocks = (html: string) => (pasted(html).content ?? []).map(outline);

// Word's clipboard HTML for a list, as Word for Windows writes it (shortened): each item is a
// paragraph with `mso-list`, and its bullet or number is typed text in a `mso-list:Ignore` span,
// inside a conditional comment.
const wordItem = (marker: string, text: string, list = 'l0', level = 1) =>
  `<p class=MsoListParagraphCxSpMiddle style='text-indent:-18.0pt;mso-list:${list} level${level} lfo1'><![if !supportLists]><span style='font-family:Symbol'><span style='mso-list:Ignore'>${marker}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>${text}<o:p></o:p></p>`;

describe('normalizePastedHtml: Word lists', () => {
  it('turns a Word bullet list into a bullet list, without the typed bullets', () => {
    const html = `<p class=MsoNormal>Inngangur</p>\n${wordItem('·', 'Brauð')}\n${wordItem('·', 'Kaka')}\n<p class=MsoNormal>Eftir</p>`;
    expect(blocks(html)).toEqual(['Inngangur', { bulletList: ['Brauð', 'Kaka'] }, 'Eftir']);
    expect(JSON.stringify(pasted(html))).not.toContain('·');
  });

  it('turns a Word numbered list into a numbered list, keeping where it starts', () => {
    const html = `${wordItem('3.', 'Þriðja')}${wordItem('4.', 'Fjórða')}`;
    const doc = pasted(html);
    expect((doc.content ?? []).map(outline)).toEqual([{ orderedList: ['Þriðja', 'Fjórða'] }]);
    expect(doc.content?.[0]?.attrs?.start).toBe(3);
    expect(JSON.stringify(doc)).not.toMatch(/"[34]\./);
  });

  it('keeps a nested level as a nested list, and a letter or roman marker as numbered', () => {
    const html = `${wordItem('1.', 'Fyrst')}${wordItem('a.', 'Undir', 'l0', 2)}${wordItem('b.', 'Undir 2', 'l0', 2)}${wordItem('2.', 'Næst')}`;
    expect(blocks(html)).toEqual([{ orderedList: [['Fyrst', { orderedList: ['Undir', 'Undir 2'] }], 'Næst'] }]);
    expect(blocks(`${wordItem('i.', 'Eitt')}${wordItem('ii.', 'Tvö')}`)).toEqual([{ orderedList: ['Eitt', 'Tvö'] }]);
  });

  it('finds the list paragraphs inside Word\'s section wrapper', () => {
    const html = `<html><body><!--StartFragment--><div class=WordSection1>${wordItem('o', 'Eitt')}${wordItem('o', 'Tvö')}</div><!--EndFragment--></body></html>`;
    expect(blocks(html)).toEqual([{ bulletList: ['Eitt', 'Tvö'] }]);
  });

  it('turns paragraphs that start with a typed bullet into a bullet list', () => {
    expect(blocks('<p>•&nbsp;Eitt</p><p>• Tvö</p><p>Ekki listi</p>')).toEqual([{ bulletList: ['Eitt', 'Tvö'] }, 'Ekki listi']);
  });

  it('leaves real HTML lists as they are', () => {
    expect(blocks('<ul><li><p>a</p></li><li>b</li></ul><ol start="2"><li>c</li></ol>')).toEqual([{ bulletList: ['a', 'b'] }, { orderedList: ['c'] }]);
  });
});

describe('normalizePastedHtml: headings', () => {
  it('turns a level-1 heading into a level-2 heading, and keeps levels 2 and 3', () => {
    expect(blocks('<h1>Stór</h1><h2>Miðja</h2><h3>Lítil</h3>')).toEqual([{ h2: 'Stór' }, { h2: 'Miðja' }, { h3: 'Lítil' }]);
  });
});

describe('normalizePastedHtml: images and tables', () => {
  it('reports pasted images, which are left out', () => {
    const result = normalizePastedHtml('<p>Texti</p><p><img src="file:///C:/mynd.png"></p>');
    expect(result.dropped).toEqual({ images: true, tables: false });
    expect(blocks('<p>Texti</p><p><img src="file:///C:/mynd.png"></p>')).toEqual(['Texti']);
  });

  it('reports a pasted table and keeps each cell\'s text as its own paragraph, not run together (§14, 9)', () => {
    const html = '<table><tr><td>CellA1</td><td>CellB1</td></tr><tr><td>CellA2</td><td><p>CellB2</p></td></tr></table>';
    expect(normalizePastedHtml(html).dropped).toEqual({ images: false, tables: true });
    expect(blocks(html)).toEqual(['CellA1', 'CellB1', 'CellA2', 'CellB2']);
  });

  it('reports nothing for plain formatted text', () => {
    expect(normalizePastedHtml('<p><strong>a</strong> b</p>').dropped).toEqual({ images: false, tables: false });
  });
});

describe('droppedNotice', () => {
  it('is one line for what was left out, and nothing when nothing was', () => {
    expect(droppedNotice({ images: true, tables: false })).toBe(t.editor.richText.droppedImages);
    expect(droppedNotice({ images: false, tables: true })).toBe(t.editor.richText.droppedTables);
    expect(droppedNotice({ images: true, tables: true })).toBe(t.editor.richText.droppedBoth);
    expect(droppedNotice({ images: false, tables: false })).toBeNull();
  });
});
