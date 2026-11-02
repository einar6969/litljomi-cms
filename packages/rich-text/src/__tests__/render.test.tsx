import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { RichText } from '../render.tsx';
import type { ProjectedRichTextDoc } from '../project.ts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function html(doc: ProjectedRichTextDoc): Promise<string> {
  const container = document.createElement('div');
  await act(async () => {
    createRoot(container).render(<RichText doc={doc} />);
  });
  return container.innerHTML;
}

it('escapes text such as <script>', async () => {
  const out = await html({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] }],
  });
  expect(out).toContain('&lt;script&gt;');
  expect(out).not.toContain('<script>');
});

it('maps nodes and marks to elements', async () => {
  const out = await html({
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'H' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'b', marks: [{ type: 'bold' }, { type: 'italic' }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'ext', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'text', text: 'int', marks: [{ type: 'link', attrs: { href: '/frettir/x' } }] },
        ],
      },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'li' }] }] }] },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
      { type: 'image', attrs: { src: 'https://m.test/a.jpg', width: 10, height: 20, alt: 'pic', caption: 'cap' } },
    ],
  });
  expect(out).toContain('<h2>H</h2>');
  expect(out).toContain('<strong><em>b</em></strong>');
  expect(out).toContain('<br>');
  expect(out).toContain('<a href="https://example.com" rel="noopener noreferrer">ext</a>');
  expect(out).toContain('<a href="/frettir/x">int</a>');
  expect(out).toContain('<ul><li><p>li</p></li></ul>');
  expect(out).toContain('<blockquote>');
  const img = new DOMParser().parseFromString(out, 'text/html').querySelector('figure > img');
  expect(img?.getAttribute('src')).toBe('https://m.test/a.jpg');
  expect(img?.getAttribute('alt')).toBe('pic');
  expect(img?.getAttribute('width')).toBe('10');
  expect(img?.getAttribute('height')).toBe('20');
  expect(out).toContain('<figcaption>cap</figcaption>');
});

it('adds rel to every external link, whatever the scheme case or stray characters', async () => {
  for (const href of ['https://example.com', 'HTTPS://example.com', 'Mailto:a@b.is', 'ht\ttps://example.com', 'http://a.is']) {
    const out = await html({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 't', marks: [{ type: 'link', attrs: { href } }] }] }],
    });
    expect(out, href).toContain('rel="noopener noreferrer"');
  }
  const internal = await html({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 't', marks: [{ type: 'link', attrs: { href: '/a/b' } }] }] }],
  });
  expect(internal).not.toContain('rel=');
});

it('renders an ordered list start as <ol start>', async () => {
  const out = await html({
    type: 'doc',
    content: [
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] }],
      },
    ],
  });
  expect(out).toContain('<ol start="3">');
});
