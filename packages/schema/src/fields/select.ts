import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind, type FieldOptionOverrides } from '../field-kind.ts';

export interface SelectOption {
  /** What is stored and delivered. */
  value: string;
  /** What the editor shows. */
  label: string;
}

export interface SelectOptions {
  label: string;
  required?: boolean;
  /** The fixed list of choices, in display order. */
  options: readonly SelectOption[];
}

/** `withOptions` keeps the type, so the editor can read `options` after `extendType`. */
export type SelectField = Omit<FieldKind<string, string>, 'withOptions'> & {
  options: readonly SelectOption[];
  withOptions(o: FieldOptionOverrides): SelectField;
};

function checkedOptions(options: readonly SelectOption[]): readonly SelectOption[] {
  if (options.length === 0) throw new Error('select: needs at least one option');
  const seen = new Set<string>();
  for (const { value, label } of options) {
    if (value === '') throw new Error('select: an option has an empty value');
    if (label === '') throw new Error(`select: option "${value}" has an empty label`);
    if (seen.has(value)) throw new Error(`select: duplicate value "${value}"`);
    seen.add(value);
  }
  // A frozen copy: the module's array can change later without changing the validator.
  return Object.freeze(options.map(({ value, label }) => Object.freeze({ value, label })));
}

export function select(o: SelectOptions): SelectField {
  const required = o.required ?? false;
  const options = checkedOptions(o.options);
  const values = new Set(options.map((x) => x.value));
  // The stored value must be one of the listed values, in drafts as well.
  const base = z.string().refine((s) => values.has(s), 'not one of the listed values');
  return {
    kind: 'select',
    label: o.label,
    required,
    options,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v) => v ?? null,
    // A union of the values as string literals; JSON.stringify quotes and escapes each one.
    tsType: () => [...options.map((x) => JSON.stringify(x.value)), 'null'].join(' | '),
    withOptions: (x) => select({ ...o, options, ...definedOnly(x) }),
  };
}
