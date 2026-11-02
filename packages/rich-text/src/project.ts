import type { RichTextBlock, RichTextDoc, RichTextInline, RichTextListItem } from './doc-schema.ts';

export interface RichTextResolver {
  asset(id: string): { url: string; width: number; height: number } | null;
  entryPath(id: string): string | null;
}

export type ProjectedMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | { type: 'link'; attrs: { href: string } };

export type ProjectedInline =
  | { type: 'text'; text: string; marks?: ProjectedMark[] }
  | { type: 'hardBreak' };

export type ProjectedBlock =
  | { type: 'paragraph'; content?: ProjectedInline[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: ProjectedInline[] }
  | { type: 'bulletList'; content: ProjectedListItem[] }
  | { type: 'orderedList'; attrs?: { start: number }; content: ProjectedListItem[] }
  | { type: 'blockquote'; content: ProjectedBlock[] }
  | {
      type: 'image';
      attrs: { src: string; width: number; height: number; alt: string; caption?: string | undefined };
    };

export interface ProjectedListItem {
  type: 'listItem';
  content: ProjectedBlock[];
}

export interface ProjectedRichTextDoc {
  type: 'doc';
  content: ProjectedBlock[];
}

function projectInline(n: RichTextInline, r: RichTextResolver): ProjectedInline {
  if (n.type === 'hardBreak') return n;
  if (!n.marks) return { type: 'text', text: n.text };
  const marks: ProjectedMark[] = [];
  for (const m of n.marks) {
    if (m.type !== 'link') {
      marks.push(m);
    } else if (m.attrs.href !== undefined) {
      marks.push({ type: 'link', attrs: { href: m.attrs.href } });
    } else {
      const path = r.entryPath(m.attrs.entry._ref);
      if (path !== null) marks.push({ type: 'link', attrs: { href: path } });
    }
  }
  return marks.length > 0 ? { type: 'text', text: n.text, marks } : { type: 'text', text: n.text };
}

function projectBlock(b: RichTextBlock, r: RichTextResolver): ProjectedBlock | null {
  switch (b.type) {
    case 'paragraph':
      return b.content ? { type: 'paragraph', content: b.content.map((n) => projectInline(n, r)) } : { type: 'paragraph' };
    case 'heading':
      return b.content
        ? { type: 'heading', attrs: b.attrs, content: b.content.map((n) => projectInline(n, r)) }
        : { type: 'heading', attrs: b.attrs };
    case 'bulletList':
      return { type: 'bulletList', content: b.content.map((i) => projectItem(i, r)) };
    case 'orderedList': {
      // `start` is kept whenever present (even 1); `type` is always null and is dropped.
      const content = b.content.map((i) => projectItem(i, r));
      return b.attrs?.start !== undefined
        ? { type: 'orderedList', attrs: { start: b.attrs.start }, content }
        : { type: 'orderedList', content };
    }
    case 'blockquote':
      return { type: 'blockquote', content: projectBlocks(b.content, r) };
    case 'image': {
      const asset = r.asset(b.attrs.asset._ref);
      if (asset === null) return null;
      return {
        type: 'image',
        attrs: { src: asset.url, width: asset.width, height: asset.height, alt: b.attrs.alt, caption: b.attrs.caption },
      };
    }
  }
}

const projectBlocks = (bs: RichTextBlock[], r: RichTextResolver): ProjectedBlock[] =>
  bs.flatMap((b) => projectBlock(b, r) ?? []);

const projectItem = (i: RichTextListItem, r: RichTextResolver): ProjectedListItem => ({
  type: 'listItem',
  content: projectBlocks(i.content, r),
});

/**
 * Resolves references: images get their delivery URL and size (or are dropped when the asset is
 * missing); entry links become path links (or lose the link mark when the entry has no path).
 */
export function projectRichText(doc: RichTextDoc, r: RichTextResolver): ProjectedRichTextDoc {
  return { type: 'doc', content: projectBlocks(doc.content, r) };
}
