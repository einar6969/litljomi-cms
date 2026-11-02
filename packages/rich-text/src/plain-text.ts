import type { RichTextBlock, RichTextDoc, RichTextInline } from './doc-schema.ts';

const inline = (nodes: RichTextInline[] | undefined): string =>
  (nodes ?? []).map((n) => (n.type === 'text' ? n.text : '\n')).join('');

function block(b: RichTextBlock): string {
  switch (b.type) {
    case 'paragraph':
    case 'heading':
      return inline(b.content);
    case 'bulletList':
    case 'orderedList':
      return b.content.map((item) => blocks(item.content, '\n')).join('\n');
    case 'blockquote':
      return blocks(b.content, '\n\n');
    case 'image':
      return '';
  }
}

function blocks(bs: RichTextBlock[], sep: string): string {
  return bs.map(block).filter((s) => s !== '').join(sep);
}

/** Text of the document with blocks separated by a blank line; images contribute nothing. */
export function toPlainText(doc: RichTextDoc): string {
  return blocks(doc.content, '\n\n');
}
