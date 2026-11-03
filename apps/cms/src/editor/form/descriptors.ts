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
  /** A text field's longest length, or a number field's largest value. */
  max?: number;
  multiline?: boolean;
  /** A number field's smallest value. */
  min?: number;
  /** A number field takes whole numbers only. */
  integer?: boolean;
  /** A select field's choices, in display order. */
  options?: SelectChoice[];
  /** The content types a reference field may point to. */
  to?: string[];
};

const isChoice = (x: unknown): x is SelectChoice =>
  typeof x === 'object' && x !== null && typeof (x as SelectChoice).value === 'string' && typeof (x as SelectChoice).label === 'string';

export function describeFields(type: ContentType): FieldDescriptor[] {
  return Object.entries<AnyFieldKind>(type.fields).map(([key, field]) => {
    // Kind-specific options: `max` on text and number fields, `multiline` on text, `min` and
    // `integer` on number, `options` on select, `to` on reference. Each is passed only when the field has it.
    const { max, multiline, min, integer, options, to } = field as { max?: unknown; multiline?: unknown; min?: unknown; integer?: unknown; options?: unknown; to?: unknown };
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
    };
  });
}
