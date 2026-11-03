import type { z } from 'zod';
import type { AnyFieldKind } from './define-type.ts';

/**
 * A field key starts with a letter and continues with letters, digits or underscores (no `-`, `.`,
 * `$`, spaces), at most 64 characters: the database refuses longer object keys (decision 29).
 */
const FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Names that would reach the prototype chain of the validator shapes and projected records. */
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertFieldKey(where: string, key: string): void {
  if (RESERVED_KEYS.has(key) || !FIELD_KEY.test(key) || key in Object.prototype) {
    throw new Error(`${where}: invalid field key "${key}" (letters, digits and underscores, starting with a letter, at most 64 characters; not a reserved name)`);
  }
}

/**
 * Checks a set of fields as `defineType` and `group` take it: a plain object whose keys are all
 * valid field keys. `where` names the caller in the error message.
 */
export function assertFields(where: string, fields: Record<string, AnyFieldKind>): void {
  // A literal `__proto__:` key in an object literal sets the prototype and is silently dropped.
  const proto: unknown = Object.getPrototypeOf(fields);
  if (proto !== Object.prototype && proto !== null) {
    throw new Error(`${where}: fields must be a plain object (its prototype is not Object.prototype or null; a literal "__proto__" key sets it)`);
  }
  for (const key of Object.keys(fields)) assertFieldKey(where, key);
}

/**
 * The zod shapes of a set of fields: in the draft shape every field is optional and lenient, in
 * the publish shape each field's own publish schema decides. `defineType` and `group` build their
 * object validators from these (`z.object`, so unknown keys are stripped).
 */
export function fieldShapes(fields: Record<string, AnyFieldKind>): { draft: Record<string, z.ZodType>; publish: Record<string, z.ZodType> } {
  const draft: Record<string, z.ZodType> = {};
  const publish: Record<string, z.ZodType> = {};
  for (const [key, field] of Object.entries(fields)) {
    draft[key] = field.draftSchema().optional();
    publish[key] = field.publishSchema();
  }
  return { draft, publish };
}
