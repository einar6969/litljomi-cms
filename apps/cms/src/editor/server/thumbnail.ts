import 'server-only';
import type { SupabaseClient } from '@/lib/supabase/types';
import { authOrError } from './entry-context';
import { MEDIA_PRIVATE_BUCKET } from '../upload';
import { makeThumbnail, thumbnailPath } from './thumbnail-maker';

// The editor's thumbnail of a file (docs/plans/media-library.md section 5, design A; spec §5.6):
// made on the CMS server from the original's bytes, stored beside it in `media-private` with the
// editor's own session, and recorded by `api.set_asset_thumbnail`. Never published; shown to the
// tenant's editors through short-lived signed URLs, so the editor never loads an original to show
// a preview. A file is always registered whether or not its thumbnail can be made: a failure here
// leaves the file without one, never unregistered.
//
// The maker itself is ./thumbnail-maker.ts, which the import command shares; it is re-exported
// here so the app has one place to import it from.
export {
  decodeFootprint,
  makeThumbnail,
  MAX_DECODE_BYTES,
  MAX_THUMBNAIL_PIXELS,
  MAX_WAITING_DECODES,
  THUMBNAIL_SIZE,
  THUMBNAIL_TIMEOUT_SECONDS,
  thumbnailPath,
  withDecoder,
} from './thumbnail-maker';

/** The asset columns the thumbnail needs, as `api.asset_list` returns them. */
export type ThumbnailAsset = { id: string; tenant_id: string; original_path: string; thumb_path: string | null };

export type EnsuredThumbnail = { ok: true; path: string } | { ok: false; code: 'auth' | 'error' };

/**
 * The file's thumbnail path, made and recorded first if it has none. The original is read back with
 * the editor's session, unless the caller already holds its bytes (`original`, as registration
 * does). The thumbnail is uploaded with the editor's session (Storage RLS: a folder of a tenant they
 * belong to; never an overwrite), then recorded through `set_asset_thumbnail`, which finds the row
 * under RLS, takes only this file's own path and only once the object exists. A failed upload is
 * still followed by the recording: an earlier attempt may have left the object in place, and the
 * database refuses the path if there is none. An object never recorded is an orphan the sweep
 * deletes a day later. The tenant is the row's; the path is derived from it, never passed in.
 */
export async function ensureThumbnail(client: SupabaseClient, asset: ThumbnailAsset, original?: Uint8Array): Promise<EnsuredThumbnail> {
  if (asset.thumb_path !== null) return { ok: true, path: asset.thumb_path };
  let bytes = original;
  if (bytes === undefined) {
    const object = await client.storage.from(MEDIA_PRIVATE_BUCKET).download(asset.original_path);
    if (object.error || !object.data) return { ok: false, code: 'error' };
    bytes = new Uint8Array(await object.data.arrayBuffer());
  }
  const thumbnail = await makeThumbnail(bytes);
  if (thumbnail === null) return { ok: false, code: 'error' };
  const path = thumbnailPath(asset.tenant_id, asset.id);
  await client.storage.from(MEDIA_PRIVATE_BUCKET).upload(path, thumbnail, { contentType: 'image/webp', upsert: false });
  const recorded = await client.rpc('set_asset_thumbnail', { p_asset_id: asset.id, p_thumb_path: path });
  if (recorded.error) return { ok: false, code: authOrError(recorded) };
  return { ok: true, path };
}
