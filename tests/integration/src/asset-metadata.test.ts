// Plan M2-12: an asset's focal point and default alt text, saved the way updateAssetAction saves
// them (the CMS's own asset-metadata.ts: parse, merge the change onto the row read from
// api.asset_list, call api.update_asset), with real editor sessions through PostgREST. An editor of
// demo cannot see or change a labak asset: the persona cell of 080_api_editor.test.sql, re-asserted
// through the action's code path.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  assetChangeShape,
  assetMetadataShape,
  mergeAssetChange,
  saveAssetMetadata,
  type AssetChange,
  type StoredAssetMetadata,
} from '../../../apps/cms/src/editor/media/asset-metadata.ts';
import { editorApiClient } from './clients.ts';
import { TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

afterAll(closeAll);

/** A labak asset committed by the owner, with a focal point and a default alt text. */
async function labakAsset(): Promise<string> {
  const id = randomUUID();
  await ownerQuery(
    `insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, focal_x, focal_y, default_alt)
     values ($1::uuid, $2::uuid, $2::text || '/' || $1::text || '/a.jpg', 'a.jpg', 'image/jpeg', 10, 1, 1, repeat('a', 64), 0.5, 0.25, 'Brauð')`,
    [id, TENANT.labak],
  );
  return id;
}

const stored = async (id: string) =>
  (await ownerQuery<{ focal_x: number | null; focal_y: number | null; default_alt: string | null }>('select focal_x, focal_y, default_alt from cms.assets where id = $1', [id]))[0];

/** What updateAssetAction does after its session and tenant checks: read, merge, save. */
async function update(as: PersonaName, id: string, change: AssetChange) {
  const client = await editorApiClient(as);
  const row = await client.from('asset_list').select('id, focal_x, focal_y, default_alt').eq('id', id).maybeSingle();
  expect(row.error).toBeNull();
  if (!row.data) return { visible: false as const, error: null };
  const metadata = assetMetadataShape.parse(mergeAssetChange(row.data as StoredAssetMetadata, assetChangeShape.parse(change)));
  const { error } = await saveAssetMetadata(client, metadata);
  return { visible: true as const, error };
}

describe('asset metadata through the action code path', () => {
  it("lets labak's editor move the focal point, keeping the default alt text, then change the alt text alone", async () => {
    const id = await labakAsset();
    expect(await update('editor_labak', id, { focal: { x: 0.1, y: 0.9 } })).toEqual({ visible: true, error: null });
    expect(await stored(id)).toEqual({ focal_x: 0.1, focal_y: 0.9, default_alt: 'Brauð' });
    expect(await update('editor_labak', id, { defaultAlt: 'Rúgbrauð' })).toEqual({ visible: true, error: null });
    expect(await stored(id)).toEqual({ focal_x: 0.1, focal_y: 0.9, default_alt: 'Rúgbrauð' });
    expect(await update('editor_labak', id, { focal: null })).toEqual({ visible: true, error: null });
    expect(await stored(id)).toEqual({ focal_x: null, focal_y: null, default_alt: 'Rúgbrauð' });
  });

  it("does not let demo's editor see a labak asset, or change it even with the id and every value", async () => {
    const id = await labakAsset();
    expect(await update('editor_demo', id, { focal: { x: 0.9, y: 0.9 } })).toEqual({ visible: false, error: null });
    const client = await editorApiClient('editor_demo');
    const { error } = await saveAssetMetadata(client, assetMetadataShape.parse({ id, focalX: 0.9, focalY: 0.9, defaultAlt: 'Annað' }));
    expect({ code: error?.code, message: error?.message }).toEqual({ code: 'P0001', message: 'not_found' });
    expect(await stored(id)).toEqual({ focal_x: 0.5, focal_y: 0.25, default_alt: 'Brauð' });
  });

  it('refuses a focal point outside 0..1 in the database too, should a caller skip the parsing', async () => {
    const id = await labakAsset();
    const client = await editorApiClient('editor_labak');
    const { error } = await saveAssetMetadata(client, { id, focalX: 1.5, focalY: 0.5, defaultAlt: null });
    expect(error?.code).toBe('23514');
    expect(await stored(id)).toEqual({ focal_x: 0.5, focal_y: 0.25, default_alt: 'Brauð' });
  });
});
