import { Fragment, type ReactNode } from 'react';
import type { ProjectedBlock, ProjectedInline, ProjectedMark, ProjectedRichTextDoc } from './project.ts';

// A pure node-to-element mapping. Text goes through React's escaping; there is no raw HTML path.

// Decided from the parsed protocol, so `HTTPS:`, `Mailto:` and hrefs with stray tabs still count.
// Relative paths (resolved entry links) do not parse and are internal.
function isExternal(href: string): boolean {
  try {
    return ['https:', 'http:', 'mailto:'].includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

function mark(m: ProjectedMark, children: ReactNode): ReactNode {
  switch (m.type) {
    case 'bold':
      return <strong>{children}</strong>;
    case 'italic':
      return <em>{children}</em>;
    case 'link':
      return isExternal(m.attrs.href) ? (
        <a href={m.attrs.href} rel="noopener noreferrer">
          {children}
        </a>
      ) : (
        <a href={m.attrs.href}>{children}</a>
      );
  }
}

function inline(n: ProjectedInline, key: number): ReactNode {
  if (n.type === 'hardBreak') return <br key={key} />;
  // The first mark is outermost.
  const node = (n.marks ?? []).reduceRight<ReactNode>((acc, m) => mark(m, acc), n.text);
  return <Fragment key={key}>{node}</Fragment>;
}

function block(b: ProjectedBlock, key: number): ReactNode {
  switch (b.type) {
    case 'paragraph':
      return <p key={key}>{b.content?.map(inline)}</p>;
    case 'heading':
      return b.attrs.level === 2 ? <h2 key={key}>{b.content?.map(inline)}</h2> : <h3 key={key}>{b.content?.map(inline)}</h3>;
    case 'bulletList':
      return <ul key={key}>{b.content.map((i, k) => <li key={k}>{i.content.map(block)}</li>)}</ul>;
    case 'orderedList':
      return <ol key={key}>{b.content.map((i, k) => <li key={k}>{i.content.map(block)}</li>)}</ol>;
    case 'blockquote':
      return <blockquote key={key}>{b.content.map(block)}</blockquote>;
    case 'image':
      return (
        <figure key={key}>
          <img src={b.attrs.src} alt={b.attrs.alt} width={b.attrs.width} height={b.attrs.height} />
          {b.attrs.caption ? <figcaption>{b.attrs.caption}</figcaption> : null}
        </figure>
      );
  }
}

export function RichText({ doc }: { doc: ProjectedRichTextDoc }) {
  return <>{doc.content.map(block)}</>;
}
