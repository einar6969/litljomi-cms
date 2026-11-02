import { z } from 'zod';
import type { FieldKind } from './field-kind.ts';

export type AnyFieldKind = FieldKind<any, any>;

export interface TypeDefinition<F extends Record<string, AnyFieldKind>> {
  name: string;
  version: number;
  label: string;
  fields: F;
  preview: { title: keyof F & string; media?: keyof F & string };
  orderBy: keyof F & string;
  transforms?: Record<number, (data: unknown) => unknown>;
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
}

export function defineType<F extends Record<string, AnyFieldKind>>(d: TypeDefinition<F>): ContentType<F> {
  const draftShape: Record<string, z.ZodType> = {};
  const publishShape: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(d.fields)) {
    draftShape[key] = field.draftSchema().optional();
    publishShape[key] = field.publishSchema();
  }
  const column = (data: unknown, key: string): string | null => {
    if (typeof data !== 'object' || data === null) return null;
    const v = (data as Record<string, unknown>)[key];
    return typeof v === 'string' && v !== '' ? v : null;
  };
  return {
    ...d,
    draftValidator: () => z.object(draftShape),
    publishValidator: () => z.object(publishShape),
    queryColumns: (data) => ({ title: column(data, d.preview.title), sortAt: column(data, d.orderBy) }),
  };
}
