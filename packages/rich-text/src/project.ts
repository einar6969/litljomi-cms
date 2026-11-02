import { canonicalHttpsUrl, isRootRelativePath } from './safe-url.ts';
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
      if (path !== null && isRootRelativePath(path)) marks.push({ type: 'link', attrs: { href: path } });
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
    case 'bulletList': {
      const content = projectItems(b.content, r);
      return content.length > 0 ? { type: 'bulletList', content } : null;
    }
    case 'orderedList': {
      // `start` is kept whenever present (even 1); `type` is always null and is dropped.
      const content = projectItems(b.content, r);
      if (content.length === 0) return null;
      return b.attrs?.start !== undefined
        ? { type: 'orderedList', attrs: { start: b.attrs.start }, content }
        : { type: 'orderedList', content };
    }
    case 'blockquote': {
      const content = projectBlocks(b.content, r);
      return content.length > 0 ? { type: 'blockquote', content } : null;
    }
    case 'image': {
      const asset = r.asset(b.attrs.asset._ref);
      const src = asset === null ? null : canonicalHttpsUrl(asset.url);
      if (asset === null || src === null) return null;
      return {
        type: 'image',
        attrs: { src, width: asset.width, height: asset.height, alt: b.attrs.alt, caption: b.attrs.caption },
      };
    }
  }
}

const projectBlocks = (bs: RichTextBlock[], r: RichTextResolver): ProjectedBlock[] =>
  bs.flatMap((b) => projectBlock(b, r) ?? []);

const projectItems = (items: RichTextListItem[], r: RichTextResolver): ProjectedListItem[] =>
  items.flatMap((i) => {
    const content = projectBlocks(i.content, r);
    return content.length > 0 ? [{ type: 'listItem' as const, content }] : [];
  });

/**
 * Resolves references: images get their delivery URL and size; entry links become path links.
 *
 * Resolver output is checked, not trusted: an entry path must be root-relative (`/x`, not `//x`
 * or `/\x`) and an asset URL must be `https:`. Anything else counts as unresolved: the image is
 * dropped, the link mark is removed.
 *
 * Pruning rule: a container left with no content after that (a list item, a list, a blockquote,
 * including ones emptied by a dropped child) is removed too, so the output never holds an empty
 * `listItem`, list or `blockquote`. Paragraphs and headings may stay empty, as in the source. A
 * document that loses all its blocks projects to `{ type: 'doc', content: [] }`.
 */
export function projectRichText(doc: RichTextDoc, r: RichTextResolver): ProjectedRichTextDoc {
  return { type: 'doc', content: projectBlocks(doc.content, r) };
}
