import { z } from 'zod';

export type RefKind = 'entry' | 'asset';
export type Ref<K extends RefKind> = { _ref: string; _kind: K };

/** `{ _ref: <uuid>, _kind }` as stored inside JSON (spec §4.3). Extra keys are rejected. */
export function refSchema<K extends RefKind>(kind: K): z.ZodType<Ref<K>> {
  return z.strictObject({ _ref: z.guid(), _kind: z.literal(kind) }) as unknown as z.ZodType<Ref<K>>;
}
