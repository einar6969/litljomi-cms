'use client';

import { useSyncExternalStore } from 'react';
import { t } from '@/i18n/is';
import { describedByOf, Field } from '@/ui/Field';
import type { FieldProps } from '../field-registry';

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

/** `YYYY-MM-DDTHH:MM` of a moment in the browser's time zone, as a datetime-local input shows it. */
function localWallTime(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The browser time zone's offset at that moment, as `±HH:MM`. */
function offsetOf(d: Date): string {
  const minutes = -d.getTimezoneOffset();
  return `${minutes < 0 ? '-' : '+'}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A stored ISO datetime with offset as the input's local value, or '' for none or one it cannot read. */
export function toLocalInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : localWallTime(d);
}

/**
 * The input's local value (`YYYY-MM-DDTHH:MM`, seconds dropped) as the ISO datetime with the
 * browser's offset at that moment, as the `datetime` kind stores it; undefined for '' or a value it
 * cannot read. A wall time that does not exist (inside a daylight-saving gap) is moved forward the
 * way the browser moves it, so the stored time and its offset always agree.
 */
export function fromLocalInput(local: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (m === null) return undefined;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  return Number.isNaN(date.getTime()) ? undefined : `${localWallTime(date)}${offsetOf(date)}`;
}

const noSubscription = () => () => {};

/**
 * A date and time, entered in the browser's own time zone (named in the help text) and stored with
 * that zone's offset, so a site in another zone shows the same moment. The server renders it empty:
 * its time zone is not the browser's, and the browser fills it in once it has hydrated.
 */
export function DateTimeField({ id, label, required, value, onChange }: FieldProps) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const zone = inBrowser ? Intl.DateTimeFormat().resolvedOptions().timeZone : '';
  const help = inBrowser ? t.editor.datetime.help.replace('{zone}', zone) : null;
  // A stored value the input cannot show (not a datetime string) is named in an error.
  const error = value !== undefined && value !== null && toLocalInput(value) === '' ? t.editor.invalidStored : null;
  return (
    <Field label={label} htmlFor={id} required={required} help={help} error={error}>
      <input
        type="datetime-local"
        id={id}
        name={id}
        required={required}
        disabled={!inBrowser}
        value={inBrowser ? toLocalInput(value) : ''}
        aria-invalid={error !== null}
        aria-describedby={describedByOf(id, { help, error })}
        onChange={(e) => onChange(fromLocalInput(e.target.value))}
      />
    </Field>
  );
}
