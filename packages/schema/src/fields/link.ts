import { z } from 'zod';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { refSchema, type Ref } from '../ref.ts';
import { resolveEntry, type EntrySummary } from '../projection.ts';

export interface LinkOptions {
  label: string;
  required?: boolean;
  entryTypes?: string[];
}

export type LinkValue = { href: string } | { entry: Ref<'entry'> };
/** Delivered form: external links keep their canonical href; entry links carry the target's summary (null when unpublished). */
export type LinkProjected = { href: string } | { entry: EntrySummary | null };
export type LinkField = FieldKind<LinkValue, LinkProjected> & { entryTypes: string[] | undefined };

// Same rule as packages/rich-text/src/doc-schema.ts (isSafeHref, canonicalHref); keep the two
// copies identical. Valid hrefs are stored as new URL(s).href.
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
    z.strictObject({ href: z.string().refine(isSafeHref, 'href must be https:, http: or mailto:').transform((s) => new URL(s).href) }),
    z.strictObject({ entry: refSchema('entry') }),
  ]) as unknown as z.ZodType<LinkValue>;
  return {
    kind: 'link',
    label: o.label,
    required,
    entryTypes: o.entryTypes,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    project: (v, ctx) => {
      if (v == null) return null;
      return 'href' in v ? { href: v.href } : { entry: resolveEntry(ctx, v.entry._ref) };
    },
    tsType: () => '{ href: string } | { entry: EntrySummary | null } | null',
    withOptions: (x) => link({ ...o, ...definedOnly(x) }),
  };
}
