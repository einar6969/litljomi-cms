import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';

export interface BooleanOptions {
  label: string;
  /** A required boolean must be answered (true or false); `false` counts as a value. */
  required?: boolean;
}

export function boolean(o: BooleanOptions): FieldKind<boolean, boolean> {
  const required = o.required ?? false;
  const base = z.boolean();
  return {
    kind: 'boolean',
    label: o.label,
    required,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v) => v ?? null,
    tsType: () => 'boolean | null',
    withOptions: (x) => boolean({ ...o, ...definedOnly(x) }),
  };
}
