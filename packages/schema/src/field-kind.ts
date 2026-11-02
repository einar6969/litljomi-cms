import type { z } from 'zod';
import type { ProjectionContext } from './projection.ts';

export interface FieldOptionOverrides {
  label?: string;
  required?: boolean;
}

export interface FieldKind<TStored, TProjected> {
  kind: string;
  label: string;
  required: boolean;
  /** Lenient: types checked, empty allowed. */
  draftSchema(): z.ZodType<TStored | null | undefined>;
  /** Strict: required fields enforced. */
  publishSchema(): z.ZodType<TStored>;
  project(value: TStored | null | undefined, ctx: ProjectionContext): TProjected | null;
  tsType(): string;
  /** Returns a copy with a different label and/or required flag (used by `extendType`). */
  withOptions(o: FieldOptionOverrides): FieldKind<TStored, TProjected>;
}

/**
 * Shared schema plumbing: `base` validates a present value; draft allows null/undefined;
 * publish requires a value when `required`, otherwise allows null/undefined.
 */
export function draftOf<T>(base: z.ZodType<T>): z.ZodType<T | null | undefined> {
  return base.nullish() as z.ZodType<T | null | undefined>;
}

export function publishOf<T>(base: z.ZodType<T>, required: boolean): z.ZodType<T> {
  return (required ? base : base.nullish()) as z.ZodType<T>;
}

export function definedOnly<T extends object>(x: T): Partial<T> {
  return Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) as Partial<T>;
}
