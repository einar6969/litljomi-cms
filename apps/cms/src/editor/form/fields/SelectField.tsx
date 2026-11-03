'use client';

import { t } from '@/i18n/is';
import { describedByOf, Field } from '@/ui/Field';
import type { FieldProps } from '../field-registry';

/**
 * One of the field's fixed choices, as a native select (keyboard and screen-reader operation come
 * with it). The first, empty choice clears the field. A stored value that is no longer one of the
 * choices stays selected and is named in an error, so it is never replaced without the editor
 * choosing another.
 */
export function SelectField({ id, label, required, value, onChange, options = [] }: FieldProps) {
  const current = typeof value === 'string' ? value : '';
  const unknown = current !== '' && !options.some((o) => o.value === current);
  const error = unknown ? t.editor.select.unknown.replace('{value}', current) : null;
  return (
    <Field label={label} htmlFor={id} required={required} error={error}>
      <select
        id={id}
        name={id}
        required={required}
        value={current}
        aria-invalid={unknown}
        aria-describedby={describedByOf(id, { error })}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      >
        <option value="">{t.editor.select.placeholder}</option>
        {unknown ? (
          <option value={current} disabled>
            {current}
          </option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
