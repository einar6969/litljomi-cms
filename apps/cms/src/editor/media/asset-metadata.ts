// An asset's editable metadata (spec §5.6): its focal point and default alt text, saved through
// `api.update_asset` (§4.6) with the editor's own session, so RLS and the function decide whether
// the asset may be changed. The image field and the asset detail both save through
// `updateAssetAction`, which uses these.
//
// This file imports nothing from the app, so the integration tests run the same parsing and call.
import { z } from 'zod';

/** The canonical lowercase UUID form, as the asset path and the database require (decision 25). */
export const assetIdShape = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** The longest default alt text an editor can save; the per-use alt input has the same limit. */
export const MAX_ALT_LENGTH = 1000;

const unit = z.number().min(0).max(1);

/** An asset's metadata as `update_asset` stores it: both focal coordinates in 0..1, or both null. */
export const assetMetadataShape = z
  .object({ id: assetIdShape, focalX: unit.nullable(), focalY: unit.nullable(), defaultAlt: z.string().max(MAX_ALT_LENGTH).nullable() })
  .refine((a) => (a.focalX === null) === (a.focalY === null), 'focal point needs both coordinates');

export type AssetMetadata = z.infer<typeof assetMetadataShape>;

/**
 * What one save changes: the focal point (null removes it), the default alt text (null clears
 * it), or both. A part left out keeps its stored value, so the image field and an asset detail open
 * in another tab do not overwrite each other's change with what they loaded earlier.
 */
export const assetChangeShape = z
  .strictObject({
    focal: z.strictObject({ x: unit, y: unit }).nullable().optional(),
    defaultAlt: z.string().max(MAX_ALT_LENGTH).nullable().optional(),
  })
  .refine((c) => c.focal !== undefined || c.defaultAlt !== undefined, 'nothing to change');

export type AssetChange = z.infer<typeof assetChangeShape>;

/** The stored metadata of an asset, as `api.asset_list` returns it. */
export type StoredAssetMetadata = { id: string; focal_x: number | null; focal_y: number | null; default_alt: string | null };

/** The metadata to save: the change, and the stored values for every part it leaves out. */
export function mergeAssetChange(stored: StoredAssetMetadata, change: AssetChange): AssetMetadata {
  const focal = change.focal === undefined ? (stored.focal_x === null || stored.focal_y === null ? null : { x: stored.focal_x, y: stored.focal_y }) : change.focal;
  return {
    id: stored.id,
    focalX: focal?.x ?? null,
    focalY: focal?.y ?? null,
    defaultAlt: change.defaultAlt === undefined ? stored.default_alt : change.defaultAlt,
  };
}

/** The longest caption and credit, as the columns' checks allow (docs/plans/media-library.md section 3.1). */
export const MAX_CAPTION_LENGTH = 1000;
export const MAX_CREDIT_LENGTH = 300;

/** Trimmed, and null for nothing: an empty or blank text clears it. */
const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((s) => (s === null || s.trim() === '' ? null : s.trim()));

/**
 * A file's three texts, saved together by the library's "Vista breytingar" through
 * `api.update_asset_text`: its default alt text, caption and credit. All three are always given.
 */
export const assetTextShape = z.strictObject({ defaultAlt: text(MAX_ALT_LENGTH), caption: text(MAX_CAPTION_LENGTH), credit: text(MAX_CREDIT_LENGTH) });

export type AssetTexts = z.input<typeof assetTextShape>;

/** Calls `api.update_asset_text` (tenant from the row, tenant active) with already parsed texts. */
export function saveAssetText(client: { rpc: (fn: 'update_asset_text', args: Record<string, unknown>) => PromiseLike<RpcResult> }, id: string, texts: z.output<typeof assetTextShape>) {
  return client.rpc('update_asset_text', { p_asset_id: id, p_default_alt: texts.defaultAlt, p_caption: texts.caption, p_credit: texts.credit });
}

type RpcResult = { error: { code?: string; message?: string } | null; status?: number };

/** The one call this needs from an `api` client. */
type RpcClient = { rpc: (fn: 'update_asset', args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null; status?: number }> };

/**
 * Calls `api.update_asset` with already parsed metadata. The function takes the tenant from the
 * asset row, which RLS hides unless the caller is a member of its tenant (`not_found`), and refuses
 * a tenant that is not active (`tenant_inactive`). Returns supabase-js's result unchanged.
 */
export function saveAssetMetadata(client: RpcClient, metadata: AssetMetadata) {
  return client.rpc('update_asset', {
    p_asset_id: metadata.id,
    p_focal_x: metadata.focalX,
    p_focal_y: metadata.focalY,
    p_default_alt: metadata.defaultAlt,
  });
}
