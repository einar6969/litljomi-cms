'use client';

import { t } from '@/i18n/is';
import { describedByOf, FieldGroup } from '@/ui/Field';
import type { FieldProps } from '../field-registry';

type Choice = { key: string; label: string; value: boolean | undefined };

/**
 * Yes or no, as radio buttons in a group named by the field's label. A required field must be
 * answered and `false` (Nei) is an answer, which a single checkbox could not tell apart from
 * unanswered (M2-03). An optional field also offers "not specified", which clears it. The arrow
 * keys move between the choices, as in any radio group.
 */
export function BooleanField({ id, label, required, value, onChange }: FieldProps) {
  const current = typeof value === 'boolean' ? value : undefined;
  // A stored value that is not a boolean selects no choice and is named in an error.
  const error = value !== undefined && value !== null && typeof value !== 'boolean' ? t.editor.invalidStored : null;
  const choices: Choice[] = [
    { key: 'yes', label: t.editor.boolean.yes, value: true },
    { key: 'no', label: t.editor.boolean.no, value: false },
    ...(required ? [] : [{ key: 'unset', label: t.editor.boolean.unset, value: undefined }]),
  ];
  return (
    <FieldGroup id={id} label={label} required={required} error={error} describedBy={describedByOf(id, { error })}>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {choices.map((choice) => (
          <label key={choice.key} className="inline-flex min-h-[44px] items-center gap-2 font-normal">
            <input
              type="radio"
              id={`${id}-${choice.key}`}
              name={id}
              value={choice.key}
              required={required}
              checked={error === null && current === choice.value}
              onChange={() => onChange(choice.value)}
              className="size-5 accent-[var(--color-ink)]"
            />
            {choice.label}
          </label>
        ))}
      </div>
    </FieldGroup>
  );
}
