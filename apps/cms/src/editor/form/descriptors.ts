import type { AnyFieldKind, ContentType } from '@litljomi/cms-schema';

/** One choice of a `select` field, as the form shows and stores it. */
export type SelectChoice = { value: string; label: string };

/**
 * What the form needs to know about one field of a content type. A content type holds functions,
 * which cannot cross from a server component to a client one, so the page passes these.
 */
export type FieldDescriptor = {
  key: string;
  kind: string;
  label: string;
  required: boolean;
  /** A text field's longest length, a number field's largest value, or a list's most items. */
  max?: number;
  multiline?: boolean;
  /** A number field's smallest value, or a list's fewest items on publish. */
  min?: number;
  /** A number field takes whole numbers only. */
  integer?: boolean;
  /** A select field's choices, in display order. */
  options?: SelectChoice[];
  /** The content types a reference field may point to. */
  to?: string[];
  /** A list's item field (M2-15). */
  of?: FieldDescriptor;
  /** A group's nested fields, in order (M2-15). */
  fields?: FieldDescriptor[];
};

const isChoice = (x: unknown): x is SelectChoice =>
  typeof x === 'object' && x !== null && typeof (x as SelectChoice).value === 'string' && typeof (x as SelectChoice).label === 'string';

const isKind = (x: unknown): x is AnyFieldKind =>
  typeof x === 'object' && x !== null && typeof (x as AnyFieldKind).kind === 'string' && typeof (x as AnyFieldKind).label === 'string';

/** The descriptor of one field, nested fields included (a list's item field, a group's fields). */
function describeField(key: string, field: AnyFieldKind): FieldDescriptor {
  // Kind-specific options: `max` on text, number and list fields, `multiline` on text, `min` on
  // number and list, `integer` on number, `options` on select, `to` on reference, `of` on list,
  // `fields` on group. Each is passed only when the field has it.
  const { max, multiline, min, integer, options, to, of, fields } = field as {
    max?: unknown;
    multiline?: unknown;
    min?: unknown;
    integer?: unknown;
    options?: unknown;
    to?: unknown;
    of?: unknown;
    fields?: unknown;
  };
  return {
    key,
    kind: field.kind,
    label: field.label,
    required: field.required,
    ...(typeof max === 'number' ? { max } : {}),
    ...(typeof multiline === 'boolean' ? { multiline } : {}),
    ...(typeof min === 'number' ? { min } : {}),
    ...(typeof integer === 'boolean' ? { integer } : {}),
    // Plain copies: the kind's options are frozen objects, and only plain data crosses to the client.
    ...(Array.isArray(options) ? { options: options.filter(isChoice).map(({ value, label }) => ({ value, label })) } : {}),
    ...(field.kind === 'reference' && Array.isArray(to) ? { to: to.filter((x): x is string => typeof x === 'string') } : {}),
    // On publish a list refuses an empty item whatever its item field's own flag, so each item is
    // marked required.
    ...(field.kind === 'list' && isKind(of) ? { of: { ...describeField(key, of), required: true } } : {}),
    ...(field.kind === 'group' && typeof fields === 'object' && fields !== null ? { fields: describeFieldSet(fields as Record<string, AnyFieldKind>) } : {}),
  };
}

function describeFieldSet(fields: Record<string, AnyFieldKind>): FieldDescriptor[] {
  return Object.entries<AnyFieldKind>(fields).map(([key, field]) => describeField(key, field));
}

export function describeFields(type: ContentType): FieldDescriptor[] {
  return describeFieldSet(type.fields);
}
