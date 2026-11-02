'use client';

import { Field } from '@/ui/Field';
import type { FieldProps } from '../field-registry';

export function DateField({ id, label, required, value, onChange }: FieldProps) {
  return (
    <Field label={label} htmlFor={id}>
      <input
        type="date"
        id={id}
        name={id}
        required={required}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      />
    </Field>
  );
}
