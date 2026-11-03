import type { AnyFieldKind, ContentType } from '@litljomi/cms-schema';

/**
 * What the form needs to know about one field of a content type. A content type holds functions,
 * which cannot cross from a server component to a client one, so the page passes these.
 */
export type FieldDescriptor = {
  key: string;
  kind: string;
  label: string;
  required: boolean;
  max?: number;
  multiline?: boolean;
  /** The content types a reference field may point to. */
  to?: string[];
};

export function describeFields(type: ContentType): FieldDescriptor[] {
  return Object.entries<AnyFieldKind>(type.fields).map(([key, field]) => {
    // `max` and `multiline` exist on text fields only, `to` on reference fields only.
    const { max, multiline, to } = field as { max?: unknown; multiline?: unknown; to?: unknown };
    return {
      key,
      kind: field.kind,
      label: field.label,
      required: field.required,
      ...(typeof max === 'number' ? { max } : {}),
      ...(typeof multiline === 'boolean' ? { multiline } : {}),
      ...(field.kind === 'reference' && Array.isArray(to) ? { to: to.filter((x): x is string => typeof x === 'string') } : {}),
    };
  });
}
