import { z } from 'zod';
import type { FieldKind } from './field-kind.ts';
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

/**
 * A field key starts with a letter and continues with letters, digits or underscores (no `-`, `.`,
 * `$`, spaces), at most 64 characters: the database refuses longer object keys (decision 29).
 */
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Names that would reach the prototype chain of the validator shapes and projected records. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertFieldKey(key: string): void {
  if (RESERVED_KEYS.has(key) || !FIELD_KEY.test(key) || key in Object.prototype) {
    throw new Error(`defineType: invalid field key "${key}" (letters, digits and underscores, starting with a letter, at most 64 characters; not a reserved name)`);
  }
}

export function defineType<F extends Record<string, AnyFieldKind>>(d: TypeDefinition<F>): ContentType<F> {
  // A literal `__proto__:` key in an object literal sets the prototype and is silently dropped.
  const fieldsProto: unknown = Object.getPrototypeOf(d.fields);
  if (fieldsProto !== Object.prototype && fieldsProto !== null) {
    throw new Error('defineType: fields must be a plain object (its prototype is not Object.prototype or null; a literal "__proto__" key sets it)');
  }
  for (const key of Object.keys(d.fields)) assertFieldKey(key);
  assertVersioning(d);
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
    upcast: (data, fromVersion) => upcast(d, data, fromVersion),
  };
}
