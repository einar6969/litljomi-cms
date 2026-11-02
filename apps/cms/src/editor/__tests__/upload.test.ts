import { describe, expect, it, vi } from 'vitest';
import { MAX_UPLOAD_BYTES, prepareUpload, previewUrl, safeFilename, uploadOriginal } from '../upload';
import type { SupabaseClient } from '@/lib/supabase/types';

const TENANT = '00000000-0000-4000-8000-0000000000f1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const fileOf = (bytes: number, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

describe('prepareUpload (review focus 4)', () => {
  it('rejects a HEIC image before upload', () => {
    expect(prepareUpload(fileOf(1024, 'IMG_0001.HEIC', 'image/heic'), TENANT)).toEqual({ ok: false, reason: 'type' });
  });

  it('rejects a PDF before upload', () => {
    expect(prepareUpload(fileOf(1024, 'skjal.pdf', 'application/pdf'), TENANT)).toEqual({ ok: false, reason: 'type' });
  });

  it('rejects a JPEG of 20971521 bytes (one over 20 MB) before upload', () => {
    expect(MAX_UPLOAD_BYTES).toBe(20971520);
    expect(prepareUpload(fileOf(20971521, 'stor.jpg', 'image/jpeg'), TENANT)).toEqual({ ok: false, reason: 'size' });
  });

  it('accepts a 1 KB PNG with a fresh asset id and the path {tenant_id}/{asset_id}/{filename}', () => {
    const result = prepareUpload(fileOf(1024, 'Brauð ársins.PNG', 'image/png'), TENANT);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assetId).toMatch(UUID);
    expect(result.path).toBe(`${TENANT}/${result.assetId}/braud-arsins.png`);
    const again = prepareUpload(fileOf(1024, 'a.png', 'image/png'), TENANT);
    expect(again.ok && again.assetId).not.toBe(result.assetId);
  });

  it('accepts JPEG and WebP up to exactly 20 MB, and rejects an empty file and other types', () => {
    expect(prepareUpload(fileOf(20971520, 'a.jpg', 'image/jpeg'), TENANT).ok).toBe(true);
    expect(prepareUpload(fileOf(10, 'a.webp', 'image/webp'), TENANT).ok).toBe(true);
    expect(prepareUpload(fileOf(0, 'a.jpg', 'image/jpeg'), TENANT)).toEqual({ ok: false, reason: 'size' });
    for (const type of ['image/gif', 'image/svg+xml', 'image/avif', '', 'image/jpeg; x=y', 'image/jpg']) {
      expect(prepareUpload(fileOf(10, 'a.jpg', type), TENANT)).toEqual({ ok: false, reason: 'type' });
    }
  });

  it('refuses a tenant id that is not a canonical UUID (a programming error, not a user one)', () => {
    for (const tenant of ['', 'labak', TENANT.toUpperCase(), `${TENANT}/x`]) {
      expect(() => prepareUpload(fileOf(10, 'a.png', 'image/png'), tenant)).toThrow();
    }
  });
});

describe('safeFilename', () => {
  it('is one lowercase ASCII segment with the extension of the type', () => {
    expect(safeFilename('Brauð ársins 2025.JPG', 'image/jpeg')).toBe('braud-arsins-2025.jpg');
    expect(safeFilename('Þorrablót.jpeg', 'image/jpeg')).toBe('thorrablot.jpg');
    expect(safeFilename('../../etc/passwd', 'image/png')).toBe('passwd.png');
    expect(safeFilename('C:\\Users\\x\\mynd.webp', 'image/webp')).toBe('mynd.webp');
    expect(safeFilename('.png', 'image/png')).toBe('mynd.png');
    expect(safeFilename('', 'image/png')).toBe('mynd.png');
    expect(safeFilename('a.png.exe', 'image/png')).toBe('a-png.png');
  });

  it('bounds the length', () => {
    const name = safeFilename(`${'x'.repeat(500)}.jpg`, 'image/jpeg');
    expect(name.length).toBeLessThanOrEqual(84);
    expect(name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.jpg$/);
  });
});

describe('browser storage helpers', () => {
  it('uploads to media-private with the file type and never overwrites', async () => {
    const upload = vi.fn(async () => ({ data: { path: 'p' }, error: null }));
    const from = vi.fn(() => ({ upload }));
    const client = { storage: { from } } as unknown as SupabaseClient;
    const file = fileOf(10, 'a.png', 'image/png');
    await expect(uploadOriginal(client, `${TENANT}/x/a.png`, file)).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('media-private');
    expect(upload).toHaveBeenCalledWith(`${TENANT}/x/a.png`, file, { contentType: 'image/png', upsert: false });
  });

  it('reports a failed upload as false', async () => {
    const client = { storage: { from: () => ({ upload: async () => ({ data: null, error: { message: 'x' } }) }) } } as unknown as SupabaseClient;
    await expect(uploadOriginal(client, 'p', fileOf(10, 'a.png', 'image/png'))).resolves.toBe(false);
  });

  it('signs a 600-second preview URL in media-private', async () => {
    const createSignedUrl = vi.fn(async () => ({ data: { signedUrl: 'http://127.0.0.1:54321/storage/v1/object/sign/media-private/p?token=t' }, error: null }));
    const from = vi.fn(() => ({ createSignedUrl }));
    const client = { storage: { from } } as unknown as SupabaseClient;
    await expect(previewUrl(client, 'p')).resolves.toContain('/object/sign/media-private/');
    expect(from).toHaveBeenCalledWith('media-private');
    expect(createSignedUrl).toHaveBeenCalledWith('p', 600);
  });

  it('is null when signing fails', async () => {
    const client = { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: 'x' } }) }) } } as unknown as SupabaseClient;
    await expect(previewUrl(client, 'p')).resolves.toBeNull();
  });
});
