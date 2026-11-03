import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind, type FieldOptionOverrides } from '../field-kind.ts';

export interface NumberOptions {
  label: string;
  required?: boolean;
  /** Smallest allowed value, inclusive. */
  min?: number;
  /** Largest allowed value, inclusive. */
  max?: number;
  /** Whole numbers only (safe integers). */
  integer?: boolean;
}

/** `withOptions` keeps the type, so the editor can read `min`, `max` and `integer` after `extendType`. */
export type NumberField = Omit<FieldKind<number, number>, 'withOptions'> & {
  min?: number;
  max?: number;
  integer: boolean;
  withOptions(o: FieldOptionOverrides): NumberField;
};

function assertBound(name: 'min' | 'max', v: number | undefined): void {
  if (v !== undefined && !Number.isFinite(v)) throw new Error(`number: ${name} must be a finite number`);
}

export function number(o: NumberOptions): NumberField {
  const required = o.required ?? false;
  const integer = o.integer ?? false;
  assertBound('min', o.min);
  assertBound('max', o.max);
  if (o.min !== undefined && o.max !== undefined && o.min > o.max) throw new Error(`number: min (${o.min}) is greater than max (${o.max})`);
  // Type, range and integer checks apply to drafts as well; only "must not be empty" is publish-only.
  // z.number() refuses NaN and ±Infinity; .int() refuses fractions and unsafe integers.
  let base = integer ? z.number().int() : z.number();
  if (o.min !== undefined) base = base.min(o.min);
  if (o.max !== undefined) base = base.max(o.max);
  return {
    kind: 'number',
    label: o.label,
    required,
    min: o.min,
    max: o.max,
    integer,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v) => v ?? null,
    tsType: () => 'number | null',
    withOptions: (x) => number({ ...o, ...definedOnly(x) }),
  };
}
