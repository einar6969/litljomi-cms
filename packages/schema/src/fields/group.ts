import { z } from 'zod';
import type { AnyFieldKind } from '../define-type.ts';
import { definedOnly, draftOf, publishOf, type FieldKind, type FieldOptionOverrides } from '../field-kind.ts';
import { assertFields, fieldShapes } from '../field-set.ts';
import { projectFields } from '../projection.ts';
import { objectTsType } from '../codegen.ts';

export interface GroupOptions<F extends Record<string, AnyFieldKind>> {
  label: string;
  required?: boolean;
  /** The nested fields, under the same key rules as a type's fields; at least one. */
  fields: F;
}

/** `withOptions` keeps the type, so the editor can read `fields` after `extendType`. */
export type GroupField<F extends Record<string, AnyFieldKind> = Record<string, AnyFieldKind>> = Omit<
  FieldKind<Record<string, unknown>, Record<string, unknown>>,
  'withOptions'
> & {
  fields: F;
  withOptions(o: FieldOptionOverrides): GroupField<F>;
};

/**
 * A fixed set of named fields stored as one object (spec §5.2): `{ <key>: <value of that field> }`.
 * Validation recurses: a draft checks each nested field leniently; on publish, a present group
 * enforces its nested required fields, a required group must be present, and an absent optional
 * group is not looked into. Unknown keys are stripped, as at the top level. Projection projects
 * each nested field (absent ones as null), so references and images inside resolve like top-level
 * ones; a nested projection error is reported under the nested key.
 */
export function group<F extends Record<string, AnyFieldKind>>(o: GroupOptions<F>): GroupField<F> {
  const required = o.required ?? false;
  assertFields('group', o.fields);
  if (Object.keys(o.fields).length === 0) throw new Error('group: needs at least one field');
  // A frozen copy: the module's object can change later without changing the validator.
  const fields = Object.freeze({ ...o.fields }) as F;
  const shapes = fieldShapes(fields);
  const draftBase = z.object(shapes.draft);
  const publishBase = z.object(shapes.publish);
  return {
    kind: 'group',
    label: o.label,
    required,
    fields,
    draftSchema: () => draftOf(draftBase),
    publishSchema: () => publishOf(publishBase, required),
    project: (v, ctx) => (v == null ? null : projectFields(fields, v, ctx)),
    tsType: () => `${objectTsType(fields)} | null`,
    withOptions: (x) => group({ ...o, fields, ...definedOnly(x) }),
  };
}
