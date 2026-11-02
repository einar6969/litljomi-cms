import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';

export interface DateOptions {
  label: string;
  required?: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as YYYY-MM-DD. */
function isCalendarDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// An empty date is stored as null: the draft schema rejects '' like any other non-date string.
export function date(o: DateOptions): FieldKind<string, string> {
  const required = o.required ?? false;
  const base = z.string().refine(isCalendarDate, 'expected YYYY-MM-DD');
  return {
    kind: 'date',
    label: o.label,
    required,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v) => v ?? null,
    tsType: () => 'string | null',
    withOptions: (x) => date({ ...o, ...definedOnly(x) }),
  };
}
