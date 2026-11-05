'use client';

import { t } from '@/i18n/is';
import { Notice } from '@/ui/Notice';
import type { FieldDescriptor } from './descriptors';
import { fieldRegistry } from './field-registry';

type Props = {
  field: FieldDescriptor;
  /** The control's id; nested inputs derive their own ids from it. */
  id: string;
  /** The label shown, when it is not the field's own (a list item's "Event 2"). */
  label?: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

/**
 * One field through the registry: the form's top-level fields, a list's items and a group's nested
 * fields all render here (M2-15). A kind with no component is shown as a notice, and its value is
 * left as it is.
 */
export function FieldInput({ field, id, label = field.label, value, onChange }: Props) {
  const Component = fieldRegistry[field.kind];
  if (!Component) {
    return (
      <div className="fld">
        <span className="lab">{label}</span>
        <Notice role="note">{t.editor.unsupportedField}</Notice>
      </div>
    );
  }
  return (
    <Component
      id={id}
      label={label}
      required={field.required}
      max={field.max}
      multiline={field.multiline}
      min={field.min}
      integer={field.integer}
      options={field.options}
      to={field.to}
      of={field.of}
      fields={field.fields}
      value={value}
      onChange={onChange}
    />
  );
}
