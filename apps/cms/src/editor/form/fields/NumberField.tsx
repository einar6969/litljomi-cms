'use client';

import { number } from '@litljomi/cms-schema/src/fields/number.ts';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { t } from '@/i18n/is';
import { describedByOf, Field } from '@/ui/Field';
import type { FieldProps } from '../field-registry';

/** A number as the editor reads it: an Icelandic decimal comma. */
export const formatNumber = (n: number): string => String(n).replace('.', ',');

/**
 * The number in typed text, or NaN. Digits with an optional sign and one decimal comma or point;
 * anything else (exponents, spaces inside, hex, thousands separators) is not a number here.
 */
export function parseNumber(text: string): number {
  const s = text.trim();
  return /^[+-]?\d+(?:[.,]\d+)?$/.test(s) ? Number(s.replace(',', '.')) : Number.NaN;
}

/** The field's rule in words: "Heil tala, minnst 0." */
export function numberHelp({ min, max, integer }: { min?: number; max?: number; integer?: boolean }): string {
  const n = t.editor.number;
  const fill = (s: string) => s.replace('{min}', formatNumber(min ?? 0)).replace('{max}', formatNumber(max ?? 0));
  const range = min !== undefined && max !== undefined ? n.range : min !== undefined ? n.atLeast : max !== undefined ? n.atMost : null;
  return `${integer ? n.integer : n.decimal}${range ? `, ${fill(range)}` : ''}.`;
}

const textOf = (value: unknown): string => (typeof value === 'number' ? formatNumber(value) : '');

/**
 * A number. The text is saved only while it is a valid number for this field (the field kind's own
 * draft rule: type, range and whole numbers), so a half-typed one never makes the draft invalid.
 * Arrow up and down step by one within the range.
 */
export function NumberField({ id, label, required, value, onChange, min, max, integer = false }: FieldProps) {
  const schema = useMemo(() => number({ label, min, max, integer }).draftSchema(), [label, min, max, integer]);
  const [text, setText] = useState(textOf(value));
  const [valid, setValid] = useState(true);
  // A stored value that is not a number (written outside this form) until the editor types one.
  const [storedInvalid, setStoredInvalid] = useState(value !== undefined && value !== null && typeof value !== 'number');

  const change = (next: string) => {
    setText(next);
    setStoredInvalid(false);
    if (next.trim() === '') {
      setValid(true);
      onChange(undefined);
      return;
    }
    const parsed = schema.safeParse(parseNumber(next));
    setValid(parsed.success);
    if (parsed.success) onChange(parsed.data);
  };

  const step = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const current = parseNumber(text);
    const from = Number.isFinite(current) ? current : (min ?? 0);
    let next = Number.isFinite(current) ? from + (e.key === 'ArrowUp' ? 1 : -1) : from;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    change(formatNumber(next));
  };

  const help = numberHelp({ min, max, integer });
  const error = !valid ? t.editor.number.invalid : storedInvalid ? t.editor.invalidStored : null;
  return (
    <Field label={label} htmlFor={id} required={required} help={help} error={error}>
      <input
        type="text"
        inputMode={integer && (min === undefined || min >= 0) ? 'numeric' : 'decimal'}
        id={id}
        name={id}
        required={required}
        value={text}
        aria-invalid={error !== null}
        aria-describedby={describedByOf(id, { help, error })}
        onChange={(e) => change(e.target.value)}
        onKeyDown={step}
      />
    </Field>
  );
}
