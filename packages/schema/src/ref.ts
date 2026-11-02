import { z } from 'zod';
import { canonicalUuid } from '@litljomi/rich-text';

export type RefKind = 'entry' | 'asset';
export type Ref<K extends RefKind> = { _ref: string; _kind: K };

/** `{ _ref: <uuid>, _kind }` as stored inside JSON (spec §4.3); `_ref` is a canonical lowercase UUID. Extra keys are rejected. */
export function refSchema<K extends RefKind>(kind: K): z.ZodType<Ref<K>> {
  // z.strictObject infers `_kind` as the literal `K`, but TypeScript cannot relate a generic literal
  // to `Ref<K>`, hence the cast through `unknown`; the runtime shape is exactly `Ref<K>`.
  return z.strictObject({ _ref: canonicalUuid, _kind: z.literal(kind) }) as unknown as z.ZodType<Ref<K>>;
}
