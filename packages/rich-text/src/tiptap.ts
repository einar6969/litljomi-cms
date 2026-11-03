import type { Extensions } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { OrderedList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';
import { isSafeHref } from './doc-schema.ts';

// Editor configuration for the v1 node set. Anything the schema does not allow is switched off,
// so pasted tables, colours, strike-through and the like are dropped by the parser (§5.4).

/** A link mark's target: an external `href` or an `entry` reference (§5.4). */
/**
 * Tiptap Link's `isAllowedUri`: asked for every href it parses, sets or renders. An entry link has
 * no href, and Tiptap's renderHTML still asks about it, so `undefined` is allowed (no href attribute
 * is rendered). Anything else must be a safe string: a non-string href from schema-invalid data is
 * refused without throwing, so the editor still mounts and renders href="" (Task 14 r2 security).
 */
export const isAllowedUri = (url: unknown): boolean => url === undefined || (typeof url === 'string' && isSafeHref(url));

const hasTarget = (attrs: unknown): boolean => {
  const { href, entry } = (attrs ?? {}) as { href?: unknown; entry?: unknown };
  return (typeof href === 'string' && href !== '') || (typeof entry === 'object' && entry !== null);
};

// `entry` is set by the editor's link dialog, never parsed from pasted HTML. `setLink` and
// `toggleLink` refuse a new link with neither target: the schema would reject it on save
// (Task 14 security r2). `toggleLink` without one still removes an existing link.
const HubLink = Link.extend({
  addAttributes() {
    return {
      href: { default: undefined },
      entry: { default: undefined, parseHTML: () => undefined, renderHTML: () => ({}) },
    };
  },
  addCommands() {
    const parent = this.parent?.() ?? {};
    const { setLink, toggleLink } = parent;
    if (!setLink || !toggleLink) throw new Error('HubLink: the Link extension has no setLink/toggleLink');
    return {
      ...parent,
      setLink: (attrs) => (props) => hasTarget(attrs) && setLink(attrs)(props),
      toggleLink: (attrs) => (props) => (hasTarget(attrs) || props.editor.isActive(this.name)) && toggleLink(attrs)(props),
    };
  },
});

// Pasted list numbering: Tiptap parses `start` with parseInt and copies `type`, so `<ol start="0">`,
// a negative or non-numeric start, or `<ol type="a">` would give attributes the v1 schema rejects,
// and the whole pasted document with them (Task 14 r2). A start that is not a positive safe
// integer becomes 1; the list type (letters, Roman numerals) is not part of v1 and is dropped.
const HubOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      start: {
        default: 1,
        parseHTML: (element: HTMLElement) => {
          const start = Number(element.getAttribute('start') ?? '1');
          return Number.isSafeInteger(start) && start >= 1 ? start : 1;
        },
      },
      type: { default: null, parseHTML: () => null, renderHTML: () => ({}) },
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
      orderedList: false,
      heading: { levels: [2, 3] },
    }),
    HubLink.configure({
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      defaultProtocol: 'https',
      isAllowedUri,
      HTMLAttributes: {},
    }),
    HubOrderedList,
    HubImage,
  ];
}
