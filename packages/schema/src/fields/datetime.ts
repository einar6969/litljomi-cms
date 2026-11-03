import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';

export interface DateTimeOptions {
  label: string;
  required?: boolean;
}

/**
 * ISO 8601 date and time with an explicit offset: `YYYY-MM-DDTHH:MM[:SS[.sss]]` followed by `Z`
 * or `±HH:MM`. A time without an offset is ambiguous for sites in other zones, so it is refused.
 */
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/** True for a real calendar date and a valid time and offset in the form above. */
function isOffsetDateTime(s: string): boolean {
  const m = ISO_DATETIME.exec(s);
  if (m === null) return false;
  const [, y, mo, d, h, mi, sec, oh, om] = m;
  const date = `${y}-${mo}-${d}`;
  const day = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) return false;
  const within = (v: string | undefined, max: number) => v === undefined || Number(v) <= max;
  return within(h, 23) && within(mi, 59) && within(sec, 59) && within(oh, 23) && within(om, 59);
}

// Stored and delivered as written (the offset is kept); an empty datetime is stored as null.
export function datetime(o: DateTimeOptions): FieldKind<string, string> {
  const required = o.required ?? false;
  const base = z.string().refine(isOffsetDateTime, 'expected YYYY-MM-DDTHH:MM[:SS[.sss]] with Z or ±HH:MM');
  return {
    kind: 'datetime',
    label: o.label,
    required,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v) => v ?? null,
    tsType: () => 'string | null',
    withOptions: (x) => datetime({ ...o, ...definedOnly(x) }),
  };
}
