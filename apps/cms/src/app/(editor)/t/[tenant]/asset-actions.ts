'use server';

import { z } from 'zod';
import { authOrError, hasSession } from '@/editor/server/entry-context';
import { inspectImage } from '@/editor/server/image-metadata';
import { EXTENSION_BY_MIME, MEDIA_PRIVATE_BUCKET, previewUrl, SAFE_FILENAME } from '@/editor/upload';
import { assetChangeShape, assetIdShape, assetMetadataShape, mergeAssetChange, saveAssetMetadata, type AssetChange } from '@/editor/media/asset-metadata';
import { createEditorClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@/lib/supabase/types';
import { isActive, resolveTenant } from '@/lib/tenant';

// Image assets (spec §5.6). Every export here is an endpoint any signed-in user can call with any
// arguments: each validates its arguments, uses only the editor's own session
// (`createEditorClient`; never the secret key) and lets Storage RLS, RLS and the `api` functions
// decide. Nothing here trusts metadata the browser could send: the server reads the uploaded
// object back and derives it.

const MAX_PATH_LENGTH = 200;

type Failure = 'invalid' | 'auth' | 'error';

export type RegisterAssetResult = { ok: true; assetId: string } | { ok: false; code: Failure | 'type' | 'size' };
export type AssetPreviewResult =
  | { ok: true; url: string; defaultAlt: string | null; focalX: number | null; focalY: number | null }
  | { ok: false; code: Failure };
export type UpdateAssetResult = { ok: true } | { ok: false; code: Failure };

const registerArgs = z.object({
  tenantSlug: z.string(),
  assetId: assetIdShape,
  path: z.string().max(MAX_PATH_LENGTH),
  filename: z.string().regex(SAFE_FILENAME),
});

/**
 * Registers an original the editor has just uploaded to `media-private` (§5.6). The tenant comes
 * only from `api.my_tenants` and must be active; the path must be exactly
 * `${tenant.id}/${assetId}/${filename}`. The object is read back with the editor's session (Storage
 * RLS), and its type, size, dimensions and SHA-256 come from its bytes (`inspectImage`): an object
 * that is not really a JPEG, PNG or WebP of at most 20 MB, or not of the type its name says, is
 * refused and never registered. `register_asset` checks the membership and the path again.
 */
export async function registerAssetAction(tenantSlug: string, assetId: string, path: string, filename: string): Promise<RegisterAssetResult> {
  const args = registerArgs.safeParse({ tenantSlug, assetId, path, filename });
  if (!args.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const tenant = await resolveTenant(client, args.data.tenantSlug);
    if (!tenant || !isActive(tenant)) return { ok: false, code: 'invalid' };
    if (args.data.path !== `${tenant.id}/${args.data.assetId}/${args.data.filename}`) return { ok: false, code: 'invalid' };

    const object = await client.storage.from(MEDIA_PRIVATE_BUCKET).download(args.data.path);
    if (object.error || !object.data) return { ok: false, code: 'error' };
    const image = await inspectImage(new Uint8Array(await object.data.arrayBuffer()));
    if (!image.ok) return { ok: false, code: image.reason };
    if (!args.data.filename.endsWith(`.${EXTENSION_BY_MIME[image.mime]}`)) return { ok: false, code: 'type' };

    const result = await client.rpc('register_asset', {
      p_asset_id: args.data.assetId,
      p_tenant_id: tenant.id,
      p_original_path: args.data.path,
      p_filename: args.data.filename,
      p_mime: image.mime,
      p_bytes: image.bytes,
      p_width: image.width,
      p_height: image.height,
      p_sha256: image.sha256,
    });
    if (result.error) return { ok: false, code: authOrError(result) };
    return { ok: true, assetId: args.data.assetId };
  } catch {
    return { ok: false, code: 'error' };
  }
}

type AssetRow = { id: string; tenant_id: string; original_path: string; default_alt: string | null; focal_x: number | null; focal_y: number | null };

/**
 * The asset, read through `api.asset_list` with the editor's session (RLS hides another tenant's),
 * if its tenant (from the row, through `api.my_tenants`) is active; otherwise null. A database
 * error is thrown, never read as "not found".
 */
async function loadAsset(client: SupabaseClient, id: string): Promise<AssetRow | null> {
  const asset = await client.from('asset_list').select('id, tenant_id, original_path, default_alt, focal_x, focal_y').eq('id', id).maybeSingle();
  if (asset.error) throw new Error(`asset_list: ${asset.error.code}`);
  if (!asset.data) return null;
  const row = asset.data as AssetRow;
  const tenant = await client.from('my_tenants').select('id, status').eq('id', row.tenant_id).maybeSingle();
  if (tenant.error) throw new Error(`my_tenants: ${tenant.error.code}`);
  return isActive(tenant.data) ? row : null;
}

/**
 * The editor's preview of an asset: a signed URL of its original in `media-private`, valid for
 * 600 seconds (§5.6), with its default alt text and focal point. The tenant comes from the asset.
 */
export async function assetPreviewAction(id: string): Promise<AssetPreviewResult> {
  const args = assetIdShape.safeParse(id);
  if (!args.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const asset = await loadAsset(client, args.data);
    if (!asset) return { ok: false, code: 'error' };
    const url = await previewUrl(client, asset.original_path);
    if (!url) return { ok: false, code: 'error' };
    return { ok: true, url, defaultAlt: asset.default_alt, focalX: asset.focal_x, focalY: asset.focal_y };
  } catch {
    return { ok: false, code: 'error' };
  }
}

const updateArgs = z.object({ id: assetIdShape, change: assetChangeShape });

/**
 * Changes an asset's focal point (both coordinates in 0..1, or null to remove it), its default alt
 * text, or both, through `api.update_asset` (§4.6, §5.6), which finds the row under RLS. A part the
 * change leaves out keeps the value just read from `api.asset_list`. The tenant comes from the
 * asset and must be active.
 */
export async function updateAssetAction(id: string, change: AssetChange): Promise<UpdateAssetResult> {
  const args = updateArgs.safeParse({ id, change });
  if (!args.success) return { ok: false, code: 'invalid' };
  try {
    const client = await createEditorClient();
    if (!(await hasSession(client))) return { ok: false, code: 'auth' };
    const asset = await loadAsset(client, args.data.id);
    if (!asset) return { ok: false, code: 'error' };
    const metadata = assetMetadataShape.safeParse(mergeAssetChange(asset, args.data.change));
    if (!metadata.success) return { ok: false, code: 'error' };
    const { error, status } = await saveAssetMetadata(client, metadata.data);
    if (error) return { ok: false, code: authOrError({ error, status }) };
    return { ok: true };
  } catch {
    return { ok: false, code: 'error' };
  }
}
