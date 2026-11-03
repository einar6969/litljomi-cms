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
  orderBy: keyof F & string;
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
   * string and null otherwise, so a non-string field (a number, an image) yields null.
   */
  queryColumns(data: unknown): { title: string | null; sortAt: string | null };
  /**
   * Data written at `fromVersion`, brought to `version` through the transforms in order (§5.3).
   * The given data is never modified. Throws `UpcastError` on a gap, a newer version or a failing
   * transform.
   */
  upcast(data: unknown, fromVersion: number): unknown;
}

export function defineType<F extends Record<string, AnyFieldKind>>(d: TypeDefinition<F>): ContentType<F> {
  assertFields('defineType', d.fields);
  assertVersioning(d);
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
    // ordered by another kind (the demo `notice`, by title) saves none, rather than a text value
    // the database refuses.
    queryColumns: (data) => ({ title: column(data, d.preview.title), sortAt: datedOrderBy ? column(data, d.orderBy) : null }),
    upcast: (data, fromVersion) => upcast(d, data, fromVersion),
  };
}
