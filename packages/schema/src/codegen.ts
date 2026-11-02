import type { AnyFieldKind, ContentType } from './define-type.ts';

const TYPE_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

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
  focal: { x: number; y: number } | null;
}

export interface EntrySummary {
  id: string;
  type: string;
  slug: string | null;
  title: string | null;
  path: string | null;
}
`;

/**
 * TypeScript declarations of the delivered (projected) shape: one `<Name>Entry` interface per
 * type, each field typed by its `tsType()`. Entry references are `EntrySummary | null` (null when
 * the target is not published).
 */
export function generateDeliveryTypes(types: ContentType[]): string {
  const blocks = types.map((t) => {
    if (!TYPE_NAME.test(t.name)) throw new Error(`generateDeliveryTypes: type name "${t.name}" is not a lower-case kebab name`);
    const lines = Object.entries<AnyFieldKind>(t.fields).map(([key, field]) => {
      const prop = IDENTIFIER.test(key) ? key : JSON.stringify(key);
      return `  ${prop}: ${field.tsType()};`;
    });
    return `export interface ${pascal(t.name)}Entry {\n${lines.join('\n')}\n}\n`;
  });
  return [PRELUDE, ...blocks].join('\n');
}
