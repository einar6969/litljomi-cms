import type { AnyFieldKind, ContentType } from './define-type.ts';

const TYPE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// Field keys are already identifiers (FIELD_KEY in define-type.ts); the quoted fallback below only
// keeps the output valid if that rule is ever widened.
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** One `key: type;` declaration per field, in field order. */
function propertyLines(fields: Record<string, AnyFieldKind>): string[] {
  return Object.entries<AnyFieldKind>(fields).map(([key, field]) => {
    const prop = IDENTIFIER.test(key) ? key : JSON.stringify(key);
    return `${prop}: ${field.tsType()};`;
  });
}

/** The delivered shape of a field set as an inline object type, `{ a: X; b: Y }` (used by `group`). */
export function objectTsType(fields: Record<string, AnyFieldKind>): string {
  const lines = propertyLines(fields);
  return lines.length === 0 ? '{}' : `{ ${lines.join(' ')} }`;
}

const pascal = (name: string) =>
  name
    .split('-')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');

const PRELUDE = `import type { ProjectedRichTextDoc } from '@litljomi/rich-text';

export interface PublicAsset {
  id: string;
  url: string;
  width: number;
  height: number;
  mime: string;
  alt: string;
  /** Null when none is set; absent in a bundle written before focal points were delivered. */
  focal?: { x: number; y: number } | null;
  /** The file's caption, the same with every use; null when it has none, absent in an older bundle. */
  caption?: string | null;
  /** The file's credit (photographer or source); null when it has none, absent in an older bundle. */
  credit?: string | null;
}

export interface EntrySummary {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  path: string | null;
}

/** A video field's value: a link to the video on its provider, with a title and a still image. */
export interface PublicVideo {
  provider: 'youtube' | 'vimeo';
  id: string;
  url: string;
  title: string;
  still: PublicAsset | null;
}
`;

/**
 * TypeScript declarations of the delivered (projected) shape: one `<Name>Entry` interface per
 * type, each field typed by its `tsType()`. Entry references are `EntrySummary | null` (null when
 * the target is not published).
 */
export function generateDeliveryTypes(types: ContentType[]): string {
  const seen = new Set<string>();
  const blocks = types.map((t) => {
    if (seen.has(t.name)) throw new Error(`generateDeliveryTypes: duplicate type name "${t.name}"`);
    seen.add(t.name);
    if (!TYPE_NAME.test(t.name)) throw new Error(`generateDeliveryTypes: type name "${t.name}" is not a lower-case kebab name`);
    const lines = propertyLines(t.fields).map((l) => `  ${l}`);
    return `export interface ${pascal(t.name)}Entry {\n${lines.join('\n')}\n}\n`;
  });
  return [PRELUDE, ...blocks].join('\n');
}
