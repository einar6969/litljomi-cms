'use client';

import type { FieldProps } from '../field-registry';

export function TextField({ id, label, required, value, onChange, max, multiline }: FieldProps) {
  const text = typeof value === 'string' ? value : '';
  const common = {
    id,
    name: id,
    value: text,
    required,
    maxLength: max,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value === '' ? undefined : e.target.value),
  };
  return <label htmlFor={id}>{label}{multiline ? <textarea {...common} rows={4} /> : <input type="text" {...common} />}</label>;
}
