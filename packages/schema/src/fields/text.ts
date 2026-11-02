import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';

export interface TextOptions {
  label: string;
  required?: boolean;
  max?: number;
  multiline?: boolean;
}

export type TextField = FieldKind<string, string> & { max?: number; multiline: boolean };

export function text(o: TextOptions): TextField {
  const required = o.required ?? false;
  const multiline = o.multiline ?? false;
  // Type and length limits apply to drafts as well; only "must not be empty" is publish-only.
  let lenient = z.string();
  if (o.max !== undefined) lenient = lenient.max(o.max);
  if (!multiline) lenient = lenient.refine((s) => !/[\r\n]/.test(s), 'single line only');
  const strict = required ? lenient.min(1) : lenient;
  return {
    kind: 'text',
    label: o.label,
    required,
    max: o.max,
    multiline,
    draftSchema: () => draftOf(lenient),
    publishSchema: () => publishOf(strict, required),
    project: (v) => v ?? null,
    tsType: () => 'string | null',
    withOptions: (x) => text({ ...o, ...definedOnly(x) }),
  };
}
