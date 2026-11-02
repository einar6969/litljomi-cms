'use client';

import { link } from '@litljomi/cms-schema/src/fields/link.ts';
import { useState } from 'react';
import { t } from '@/i18n/is';
import { Field } from '@/ui/Field';
import { Notice } from '@/ui/Notice';
import type { FieldProps } from '../field-registry';

// The field kind's own rule (https:, http: or mailto:, no credentials), so the form and the server
// cannot disagree. A deep import: the package's barrel loads node:crypto, which a browser cannot.
const hrefSchema = link({ label: '' }).draftSchema();

/** The external address of a stored link value, or '' for none or an entry link. */
const hrefOf = (value: unknown): string => {
  const href = typeof value === 'object' && value !== null ? (value as { href?: unknown }).href : undefined;
  return typeof href === 'string' ? href : '';
};

const isEntryLink = (value: unknown): boolean => typeof value === 'object' && value !== null && 'entry' in value;

/**
 * An external link. The text is saved only while it is a valid address, so a half-typed one never
 * makes the whole draft invalid. A link to another entry is shown as a notice and left as it is.
 */
export function LinkField({ id, label, required, value, onChange }: FieldProps) {
  const [text, setText] = useState(hrefOf(value));
  const [valid, setValid] = useState(true);
  if (isEntryLink(value)) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[15px] font-medium">{label}</span>
        <Notice role="note">{t.editor.entryLink}</Notice>
      </div>
    );
  }
  const change = (next: string) => {
    setText(next);
    if (next === '') {
      setValid(true);
      onChange(undefined);
      return;
    }
    const parsed = hrefSchema.safeParse({ href: next });
    setValid(parsed.success);
    if (parsed.success) onChange(parsed.data);
  };
  return (
    <Field label={label} htmlFor={id} error={valid ? null : t.editor.invalidUrl}>
      <input type="text" inputMode="url" id={id} name={id} required={required} value={text} aria-invalid={!valid} onChange={(e) => change(e.target.value)} />
    </Field>
  );
}
