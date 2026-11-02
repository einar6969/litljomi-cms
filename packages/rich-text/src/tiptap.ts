import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import StarterKit from '@tiptap/starter-kit';
import { isSafeHref } from './doc-schema.ts';

// Editor configuration for the v1 node set. Anything the schema does not allow is switched off,
// so pasted tables, colours, strike-through and the like are dropped by the parser (§5.4).

// `entry` is set by the editor's link dialog, never parsed from pasted HTML.
const HubLink = Link.extend({
  addAttributes() {
    return {
      href: { default: undefined },
      entry: { default: undefined, parseHTML: () => undefined, renderHTML: () => ({}) },
    };
  },
});

// Images are inserted through the editor's media picker (attrs `asset`, `alt`, `caption`); a
// pasted <img> is never parsed into a node, because it has no asset to point at.
const HubImage = Image.extend({
  name: 'image',
  addAttributes() {
    return {
      asset: { default: undefined },
      alt: { default: '' },
      caption: { default: undefined },
    };
  },
  parseHTML() {
    return [];
  },
  renderHTML({ node }) {
    const asset = node.attrs.asset as { _ref: string } | undefined;
    return ['img', { 'data-asset': asset?._ref ?? '', alt: node.attrs.alt as string }];
  },
});

export function richTextExtensions(): Extensions {
  return [
    StarterKit.configure({
      code: false,
      codeBlock: false,
      horizontalRule: false,
      strike: false,
      underline: false,
      link: false,
      heading: { levels: [2, 3] },
    }),
    HubLink.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      defaultProtocol: 'https',
      isAllowedUri: (url) => isSafeHref(url),
      HTMLAttributes: {},
    }),
    HubImage,
  ];
}
