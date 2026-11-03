'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n/is';
import { describedByOf, FieldGroup } from '@/ui/Field';
import type { FieldProps } from '../field-registry';
import { FieldInput } from '../FieldInput';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A group (spec §5.2): its nested fields, each rendered through the registry, under one legend.
 * The stored value is one object; a nested field cleared is left out of it, and a group with no
 * values left is cleared. Each nested control's id derives from the group's (`<id>-<key>`), so a
 * nested field's help and error text belong to it. Keys the group does not describe are kept.
 * A stored value that is not an object is named in an error and replaced only when the editor
 * fills in a nested field.
 */
export function GroupField({ id, label, required, value, onChange, fields = [] }: FieldProps) {
  const [storedInvalid, setStoredInvalid] = useState(value !== undefined && value !== null && !isObject(value));
  // The latest object, so two nested changes before a re-render both land.
  const latest = useRef<Record<string, unknown>>(isObject(value) ? value : {});
  useEffect(() => {
    latest.current = isObject(value) ? value : {};
  }, [value]);

  const change = (key: string, next: unknown) => {
    const object = { ...latest.current };
    if (next === undefined) delete object[key];
    else object[key] = next;
    latest.current = object;
    setStoredInvalid(false);
    onChange(Object.keys(object).length === 0 ? undefined : object);
  };

  const current = isObject(value) ? value : {};
  const error = storedInvalid ? t.editor.invalidStored : null;
  return (
    <FieldGroup id={id} label={label} required={required} error={error} describedBy={describedByOf(id, { error })}>
      <div className="flex flex-col gap-5 border-l-2 border-hairline pl-4">
        {fields.map((field) => (
          <FieldInput key={field.key} field={field} id={`${id}-${field.key}`} value={current[field.key]} onChange={(next) => change(field.key, next)} />
        ))}
      </div>
    </FieldGroup>
  );
}
