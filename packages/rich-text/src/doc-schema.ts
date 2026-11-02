import { z } from 'zod';

// v1 rich-text document (spec §5.4). References inside JSON are `{ _ref, _kind }` (§4.3).
// The shapes are strict: an unknown node, mark or attribute is rejected, never stripped.

export type RichTextMark =
  | { type: 'bold' }
  | { type: 'italic' }
  | {
      type: 'link';
      attrs: { href: string; entry?: undefined } | { entry: { _ref: string; _kind: 'entry' }; href?: undefined };
    };

export type RichTextInline =
  | { type: 'text'; text: string; marks?: RichTextMark[] }
  | { type: 'hardBreak' };

export type RichTextBlock =
  | { type: 'paragraph'; content?: RichTextInline[] }
  | { type: 'heading'; attrs: { level: 2 | 3 }; content?: RichTextInline[] }
  | { type: 'bulletList'; content: RichTextListItem[] }
  | { type: 'orderedList'; attrs?: { start?: number | undefined; type?: null | undefined }; content: RichTextListItem[] }
  | { type: 'blockquote'; content: RichTextBlock[] }
  | {
      type: 'image';
      attrs: { asset: { _ref: string; _kind: 'asset' }; alt: string; caption?: string | undefined };
    };

export interface RichTextListItem {
  type: 'listItem';
  content: RichTextBlock[];
}

export interface RichTextDoc {
  type: 'doc';
  content: RichTextBlock[];
}

// Same rule as the schema package's link field (packages/schema/src/fields/link.ts); keep the two
// copies identical, because §3.1 forbids rich-text from depending on schema.
// https:, http: and mailto: only. Valid hrefs are stored in canonical form, new URL(s).href, so
// consumers can classify them by prefix (upper-case schemes, tabs and newlines are removed).
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

export function isSafeHref(s: string): boolean {
  if (s !== s.trim()) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(s).protocol);
  } catch {
    return false;
  }
}

const canonicalHref = (s: string) => new URL(s).href;

const ref = <K extends 'entry' | 'asset'>(kind: K) =>
  z.strictObject({ _ref: z.guid(), _kind: z.literal(kind) });

// Tiptap's JSON carries unset attributes as `undefined`; they vanish when serialised.
const unset = z.undefined().optional();

const markSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('bold') }),
  z.strictObject({ type: z.literal('italic') }),
  z.strictObject({
    type: z.literal('link'),
    attrs: z.union([
      z.strictObject({ href: z.string().refine(isSafeHref, 'href must be https:, http: or mailto:').transform(canonicalHref), entry: unset }),
      z.strictObject({ entry: ref('entry'), href: unset }),
    ]),
  }),
]);

const inlineSchema = z.union([
  z.strictObject({ type: z.literal('text'), text: z.string().min(1), marks: z.array(markSchema).optional() }),
  z.strictObject({ type: z.literal('hardBreak') }),
]);

const blockSchema: z.ZodType<RichTextBlock> = z.lazy(() =>
  z.union([
    z.strictObject({ type: z.literal('paragraph'), content: z.array(inlineSchema).optional() }),
    z.strictObject({
      type: z.literal('heading'),
      attrs: z.strictObject({ level: z.union([z.literal(2), z.literal(3)]) }),
      content: z.array(inlineSchema).optional(),
    }),
    z.strictObject({ type: z.literal('bulletList'), content: z.array(listItemSchema).min(1) }),
    // Tiptap's orderedList always emits `attrs: { start, type }`; `type` is always null here.
    z.strictObject({
      type: z.literal('orderedList'),
      attrs: z
        .strictObject({ start: z.number().int().positive().optional(), type: z.null().optional() })
        .optional(),
      content: z.array(listItemSchema).min(1),
    }),
    z.strictObject({ type: z.literal('blockquote'), content: z.array(blockSchema).min(1) }),
    z.strictObject({
      type: z.literal('image'),
      attrs: z.strictObject({
        asset: ref('asset'),
        alt: z.string(),
        caption: z.string().optional(),
      }),
    }),
  ]),
) as z.ZodType<RichTextBlock>;

const listItemSchema: z.ZodType<RichTextListItem> = z.lazy(() =>
  z.strictObject({ type: z.literal('listItem'), content: z.array(blockSchema).min(1) }),
) as z.ZodType<RichTextListItem>;

export const richTextDocSchema: z.ZodType<RichTextDoc> = z.strictObject({
  type: z.literal('doc'),
  content: z.array(blockSchema).min(1),
}) as unknown as z.ZodType<RichTextDoc>;
