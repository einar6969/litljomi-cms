import { defineType, type AnyFieldKind, type ContentType } from './define-type.ts';

export interface ExtendOptions {
  label?: string;
  fieldOverrides?: Partial<Record<string, { label?: string; required?: boolean }>>;
  extraFields?: Record<string, AnyFieldKind>;
}

/** A new type derived from `base`; `base` itself is never modified. */
export function extendType<F extends Record<string, AnyFieldKind>>(base: ContentType<F>, o: ExtendOptions): ContentType {
  const overrides = o.fieldOverrides ?? {};
  for (const key of Object.keys(overrides)) {
    if (!(key in base.fields)) throw new Error(`extendType: unknown field "${key}"`);
  }
  const extra = o.extraFields ?? {};
  for (const key of Object.keys(extra)) {
    if (key in base.fields) throw new Error(`extendType: field "${key}" already exists`);
  }
  const fields: Record<string, AnyFieldKind> = {};
  for (const [key, field] of Object.entries(base.fields)) {
    const override = overrides[key];
    fields[key] = override ? field.withOptions(override) : field;
  }
  return defineType<Record<string, AnyFieldKind>>({
    name: base.name,
    version: base.version,
    label: o.label ?? base.label,
    fields: { ...fields, ...extra },
    preview: base.preview,
    orderBy: base.orderBy,
    transforms: base.transforms,
  });
}
