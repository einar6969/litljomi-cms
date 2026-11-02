// Storage boundary over the Storage API (spec §5.6, §8.1, §11.1; plan Task 12,
// gates A4 and A5). media-private: editors read and upload under their own
// tenant's prefix only, and never update or delete. media-public and delivery:
// public read, written by the worker (secret key) only.
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { anonClient, editorClient, publicUrl, secretClient } from './clients.ts';
import { TENANT } from './fixtures.ts';
import { closeAll, ownerQuery } from './sql.ts';

// A few bytes with a JPEG signature; the Storage API checks the declared
// content type against the bucket's allowed MIME types, not the pixels.
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const upload = (
  c: SupabaseClient,
  bucket: string,
  path: string,
  options: { upsert?: boolean; contentType?: string } = {},
  bytes: Uint8Array = JPEG,
) => c.storage.from(bucket).upload(path, bytes, { contentType: 'image/jpeg', ...options });
const objectExists = async (bucket: string, path: string) =>
  (await ownerQuery('select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, path])).length === 1;

afterAll(closeAll);

describe('A4: media-private by tenant prefix and membership', () => {
  let assetId: string;
  let labakPath: string;
  beforeAll(async () => {
    assetId = randomUUID();
    labakPath = `${TENANT.labak}/${assetId}/a.jpg`;
  });

  it('A4: editor uploads only under own tenant prefix in media-private', async () => {
    const labak = await editorClient('editor_labak');
    expect((await upload(labak, 'media-private', labakPath)).error).toBeNull();
    expect(await objectExists('media-private', labakPath)).toBe(true);

    const intoDemo = `${TENANT.demo}/${randomUUID()}/a.jpg`;
    expect((await upload(labak, 'media-private', intoDemo)).error).not.toBeNull();
    expect(await objectExists('media-private', intoDemo)).toBe(false);

    // A first folder that is not a tenant id at all.
    const noTenant = `labak/${randomUUID()}/a.jpg`;
    expect((await upload(labak, 'media-private', noTenant)).error).not.toBeNull();
    expect(await objectExists('media-private', noTenant)).toBe(false);
  });

  it('A4: an editor reads its own tenant\'s originals; other personas cannot', async () => {
    const own = await (await editorClient('editor_labak')).storage.from('media-private').download(labakPath);
    expect(own.error).toBeNull();
    expect(new Uint8Array(await own.data!.arrayBuffer())).toEqual(JPEG);

    for (const persona of ['editor_demo', 'outsider', 'revoked', 'platform_admin'] as const) {
      const c = await editorClient(persona);
      expect((await c.storage.from('media-private').download(labakPath)).error, persona).not.toBeNull();
      const listed = await c.storage.from('media-private').list(`${TENANT.labak}/${assetId}`);
      expect(listed.data ?? [], persona).toEqual([]);
      const signed = await c.storage.from('media-private').createSignedUrl(labakPath, 60);
      expect(signed.error, persona).not.toBeNull();
    }
    expect((await anonClient().storage.from('media-private').download(labakPath)).error).not.toBeNull();
  });

  it('A4: outsiders, revoked members and anon cannot upload to media-private', async () => {
    for (const persona of ['outsider', 'revoked', 'platform_admin'] as const) {
      const path = `${TENANT.labak}/${randomUUID()}/a.jpg`;
      expect((await upload(await editorClient(persona), 'media-private', path)).error, persona).not.toBeNull();
      expect(await objectExists('media-private', path)).toBe(false);
    }
    const path = `${TENANT.labak}/${randomUUID()}/a.jpg`;
    expect((await upload(anonClient(), 'media-private', path)).error).not.toBeNull();
    expect(await objectExists('media-private', path)).toBe(false);
  });

  it('A4: an editor cannot overwrite, move or delete an original', async () => {
    const labak = await editorClient('editor_labak');
    // Different bytes, so a successful overwrite would show in the content.
    const other = new Uint8Array([...JPEG.slice(0, -2), 0x00, 0xff, 0xd9]);
    expect((await upload(labak, 'media-private', labakPath, { upsert: true }, other)).error).not.toBeNull();
    const kept = await labak.storage.from('media-private').download(labakPath);
    expect(kept.error).toBeNull();
    expect(new Uint8Array(await kept.data!.arrayBuffer())).toEqual(JPEG);
    const moved = `${TENANT.labak}/${randomUUID()}/b.jpg`;
    expect((await labak.storage.from('media-private').move(labakPath, moved)).error).not.toBeNull();
    await labak.storage.from('media-private').remove([labakPath]);
    expect(await objectExists('media-private', labakPath)).toBe(true);
    expect(await objectExists('media-private', moved)).toBe(false);
  });

  it('A4: media-private refuses types other than JPEG, PNG and WebP', async () => {
    const path = `${TENANT.labak}/${randomUUID()}/a.pdf`;
    const { error } = await upload(await editorClient('editor_labak'), 'media-private', path, { contentType: 'application/pdf' });
    expect(error).not.toBeNull();
    expect(await objectExists('media-private', path)).toBe(false);
  });

  it('A4: editor cannot write media-public or delivery', async () => {
    for (const persona of ['editor_labak', 'editor_demo', 'platform_admin'] as const) {
      const c = await editorClient(persona);
      for (const [bucket, path] of [
        ['media-public', `labak/${randomUUID()}/a.jpg`],
        ['media-public', `${TENANT.labak}/${randomUUID()}/a.jpg`],
        ['delivery', 'labak/current.json'],
        ['delivery', `labak/releases/${Date.now()}.json`],
      ] as const) {
        expect((await upload(c, bucket, path)).error, `${persona} ${bucket}/${path}`).not.toBeNull();
        expect(await objectExists(bucket, path)).toBe(false);
      }
    }
    expect((await upload(anonClient(), 'delivery', 'labak/current.json')).error).not.toBeNull();
  });
});

describe('A5: server-side copy from media-private to media-public', () => {
  it('A5: secret client copies media-private → media-public', async () => {
    const assetId = randomUUID();
    const source = `${TENANT.labak}/${assetId}/a.jpg`;
    expect((await upload(await editorClient('editor_labak'), 'media-private', source)).error).toBeNull();

    // Not public before the copy.
    expect((await fetch(publicUrl('media-public', `labak/${assetId}/a.jpg`))).status).not.toBe(200);
    const { error } = await secretClient().storage.from('media-private')
      .copy(source, `labak/${assetId}/a.jpg`, { destinationBucket: 'media-public' });
    expect(error).toBeNull();
    const res = await fetch(publicUrl('media-public', `labak/${assetId}/a.jpg`));
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(JPEG);
    // The original stays private.
    expect((await fetch(publicUrl('media-private', source))).status).not.toBe(200);
  });

  it('A5: the worker writes delivery, which is publicly readable', async () => {
    const path = `labak/releases/test-${randomUUID()}.json`;
    const body = new Blob([JSON.stringify({ ok: true })], { type: 'application/json' });
    const { error } = await secretClient().storage.from('delivery').upload(path, body, { contentType: 'application/json' });
    expect(error).toBeNull();
    const res = await fetch(publicUrl('delivery', path));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
