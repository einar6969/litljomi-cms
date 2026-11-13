import { z } from 'zod';
import type { FieldKind } from './field-kind.ts';
import { assertFields, fieldShapes } from './field-set.ts';
import { assertVersioning, upcast, type Transform } from './upcast.ts';

export type AnyFieldKind = FieldKind<any, any>;

export interface TypeDefinition<F extends Record<string, AnyFieldKind>> {
  name: string;
  version: number;
  label: string;
  fields: F;
  preview: { title: keyof F & string; media?: keyof F & string };
  /**
   * How the type's entries are listed: by a field (a date or datetime field also fills `sort_at`,
   * §4.3), or `'manual'`, in the order editors give them in the entry list (§5.1; A12). A manually
   * ordered type may not have a field named `manual`.
   */
  orderBy: (keyof F & string) | typeof MANUAL_ORDER;
  /** Keyed n: turns data written at version n into data at version n+1 (§5.3). */
  transforms?: Record<number, Transform>;
}

// F defaults to `any`, not `Record<string, AnyFieldKind>`: `keyof F` in `preview` and `orderBy` makes
// F invariant, so a type built with specific field names would not be assignable to the bare
// `ContentType` that projectEntry, generateDeliveryTypes and module manifests take.
export interface ContentType<F extends Record<string, AnyFieldKind> = any> extends TypeDefinition<F> {
  /** Every field optional, types checked, unknown keys stripped. */
  draftValidator(): z.ZodObject<any>;
  /** Required fields enforced, unknown keys stripped. */
  publishValidator(): z.ZodObject<any>;
  /**
   * The `title` and `sort_at` columns. Each is the named field's value when it is a non-empty
   * string and null otherwise, so a non-string field (a number, an image) yields null. `title` is
   * cut to the column's limit (§4.3).
   */
  queryColumns(data: unknown): { title: string | null; sortAt: string | null };
  /**
   * Data written at `fromVersion`, brought to `version` through the transforms in order (§5.3).
   * The given data is never modified. Throws `UpcastError` on a gap, a newer version or a failing
   * transform.
   */
  upcast(data: unknown, fromVersion: number): unknown;
}

/** `orderBy` of a type whose entries editors put in order (§5.1). */
export const MANUAL_ORDER = 'manual';

/** True when editors put the type's entries in order (`orderBy: 'manual'`, §5.1). */
export const isManuallyOrdered = (type: Pick<TypeDefinition<any>, 'orderBy'>): boolean => type.orderBy === MANUAL_ORDER;

// The limit of drafts.title and revisions.title (§4.3), in characters as the database counts them:
// a list label, so a longer heading is cut here rather than refused on every save and at publish.
const MAX_TITLE_LENGTH = 500;

const cutTitle = (title: string | null): string | null =>
  title !== null && title.length > MAX_TITLE_LENGTH ? Array.from(title).slice(0, MAX_TITLE_LENGTH).join('') : title;

export function defineType<F extends Record<string, AnyFieldKind>>(d: TypeDefinition<F>): ContentType<F> {
  assertFields('defineType', d.fields);
  assertVersioning(d);
  if (d.orderBy === MANUAL_ORDER && Object.hasOwn(d.fields, MANUAL_ORDER)) {
    throw new Error(`defineType: type "${d.name}" is ordered manually and has a field named "${MANUAL_ORDER}"`);
  }
  const shapes = fieldShapes(d.fields);
  const column = (data: unknown, key: string): string | null => {
    if (typeof data !== 'object' || data === null) return null;
    const v = (data as Record<string, unknown>)[key];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  const orderKind = (d.fields[d.orderBy] as { kind?: string } | undefined)?.kind;
  const datedOrderBy = orderKind === 'date' || orderKind === 'datetime';
  return {
    ...d,
    draftValidator: () => z.object(shapes.draft),
    publishValidator: () => z.object(shapes.publish),
    // `sort_at` is a timestamp column (§4.3): only a date or datetime field can fill it. A type
    // ordered by another kind (the demo `site-info`, by title) saves none, rather than a text value
    // the database refuses, and so does a manually ordered type, whose order is not in the document.
    queryColumns: (data) => ({ title: cutTitle(column(data, d.preview.title)), sortAt: datedOrderBy ? column(data, d.orderBy) : null }),
    upcast: (data, fromVersion) => upcast(d, data, fromVersion),
  };
}
