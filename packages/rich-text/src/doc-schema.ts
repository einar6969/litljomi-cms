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

/**
 * A reference id: the canonical lowercase hyphenated UUID (8-4-4-4-12), nothing else, so every
 * layer (database, packages/schema, packages/rich-text) rejects the same references (decision 25).
 * Upper case, braces, unhyphenated forms and non-strings are rejected.
 */
export const canonicalUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

const ref = <K extends 'entry' | 'asset'>(kind: K) =>
  z.strictObject({ _ref: canonicalUuid, _kind: z.literal(kind) });

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

/**
 * Maximum nesting depth of a document: the `doc` node is level 1, each `content` level adds one.
 * Real documents stay below about 10; Zod's recursive parser overflows the stack at a few
 * thousand levels, so deeper documents are rejected up front instead of throwing.
 */
export const RICH_TEXT_MAX_DEPTH = 50;

/** Iterative (no recursion), so it is safe on arbitrarily deep input. */
function exceedsMaxDepth(root: unknown): boolean {
  const stack: Array<[unknown, number]> = [[root, 1]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    if (typeof node !== 'object' || node === null) continue;
    if (depth > RICH_TEXT_MAX_DEPTH) return true;
    const content = (node as { content?: unknown }).content;
    if (Array.isArray(content)) for (const child of content) stack.push([child, depth + 1]);
  }
  return false;
}

const docShape = z.strictObject({
  type: z.literal('doc'),
  content: z.array(blockSchema).min(1),
});

export const richTextDocSchema: z.ZodType<RichTextDoc> = z
  .unknown()
  .refine((v) => !exceedsMaxDepth(v), `nesting deeper than ${RICH_TEXT_MAX_DEPTH} levels`)
  .pipe(docShape) as unknown as z.ZodType<RichTextDoc>;
