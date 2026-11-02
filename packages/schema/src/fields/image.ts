import { z } from 'zod';
import { canonicalUuid } from '@litljomi/rich-text';
import { definedOnly, draftOf, publishOf, type FieldKind } from '../field-kind.ts';
import { resolveAsset, type PublicAsset } from '../projection.ts';

export interface ImageOptions {
  label: string;
  required?: boolean;
}

/** `{ _ref, _kind: 'asset', alt }`: an asset reference with the alt text for this use (spec §4.3, §5.1). */
export type ImageValue = { _ref: string; _kind: 'asset'; alt: string };

const base: z.ZodType<ImageValue> = z.strictObject({
  _ref: canonicalUuid,
  _kind: z.literal('asset'),
  alt: z.string(),
}) as unknown as z.ZodType<ImageValue>;

export function image(o: ImageOptions): FieldKind<ImageValue, PublicAsset> {
  const required = o.required ?? false;
  return {
    kind: 'image',
    label: o.label,
    required,
    draftSchema: () => draftOf(base),
    publishSchema: () => publishOf(base, required),
    // The use's own alt text replaces the asset's default alt, even when it is empty (an empty alt
    // marks a decorative image on purpose; the asset default is not substituted back). Null when the asset is unknown or
    // its URL is not https (see resolveAsset).
    project: (v, ctx) => {
      if (v == null) return null;
      const asset = resolveAsset(ctx, v._ref);
      return asset === null ? null : { ...asset, alt: v.alt };
    },
    tsType: () => 'PublicAsset | null',
    withOptions: (x) => image({ ...o, ...definedOnly(x) }),
  };
}
