import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { refSchema, type Ref } from '../ref.ts';

export interface LinkOptions {
  label: string;
  required?: boolean;
  entryTypes?: string[];
}

export type LinkValue = { href: string } | { entry: Ref<'entry'> };
export type LinkField = FieldKind<LinkValue, LinkValue> & { entryTypes: string[] | undefined };

const ALLOWED_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

function isSafeHref(s: string): boolean {
  if (s !== s.trim()) return false;
  try {
    return ALLOWED_PROTOCOLS.has(new URL(s).protocol);
  } catch {
    return false;
  }
}

export function link(o: LinkOptions): LinkField {
  const required = o.required ?? false;
  const base = z.union([
    z.strictObject({ href: z.string().refine(isSafeHref, 'href must be https:, http: or mailto:') }),
    z.strictObject({ entry: refSchema('entry') }),
  ]) as unknown as z.ZodType<LinkValue>;
  return {
    kind: 'link',
    label: o.label,
    required,
    entryTypes: o.entryTypes,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    // Entry links are resolved to a path through ProjectionContext in Task 15; until then the
    // stored value is passed through unchanged.
    project: (v) => v ?? null,
    tsType: () => '{ href: string } | { entry: EntrySummary | null } | null',
    withOptions: (x) => link({ ...o, ...definedOnly(x) }),
  };
}
