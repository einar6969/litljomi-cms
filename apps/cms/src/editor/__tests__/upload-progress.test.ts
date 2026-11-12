import { describe, expect, it } from 'vitest';
import { uploadWithProgress, type UploadRequest } from '../upload';
import type { SupabaseClient } from '@/lib/supabase/types';

const TENANT = '00000000-0000-4000-8000-0000000000f1';
const ASSET = '00000000-0000-4000-8000-0000000000a1';
const PATH = `${TENANT}/${ASSET}/rugbraud.jpg`;
const ENV = { url: 'http://127.0.0.1:54321', publishableKey: 'sb_publishable_test' };
const TOKEN = 'header.payload.signature';

const clientWith = (session: { access_token: string } | null, error: unknown = null) =>
  ({ auth: { getSession: async () => ({ data: { session }, error }) } }) as unknown as SupabaseClient;

/** A request that records what is sent and answers when the test says so. */
class FakeRequest {
  static last: FakeRequest | null = null;
  opened: [string, string] | null = null;
  headers: Record<string, string> = {};
  body: unknown = undefined;
  status = 0;
  responseText = '';
  timeout = 0;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  constructor() {
    FakeRequest.last = this;
  }
  open(method: string, url: string) {
    this.opened = [method, url];
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: unknown) {
    this.body = body;
  }
  answer(status: number, text = '') {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }
}

const file = new File([new Uint8Array(10)], 'Rúgbrauð.jpg', { type: 'image/jpeg' });
const start = (client = clientWith({ access_token: TOKEN }), path = PATH, progress: number[] = []) =>
  uploadWithProgress(client, path, file, (f) => progress.push(f), ENV, () => new FakeRequest() as unknown as UploadRequest);
const sent = async () => {
  for (let i = 0; i < 5 && FakeRequest.last?.body === undefined; i++) await Promise.resolve();
  return FakeRequest.last!;
};

describe('uploadWithProgress', () => {
  it("posts the file to media-private with the editor's own token, never overwriting, and reports progress", async () => {
    FakeRequest.last = null;
    const progress: number[] = [];
    const result = start(undefined, PATH, progress);
    const request = await sent();
    expect(request.opened).toEqual(['POST', `${ENV.url}/storage/v1/object/media-private/${PATH}`]);
    expect(request.headers).toEqual({
      authorization: `Bearer ${TOKEN}`,
      apikey: ENV.publishableKey,
      'x-upsert': 'false',
      'content-type': 'image/jpeg',
      'cache-control': 'max-age=3600',
    });
    expect(request.body).toBe(file);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
    request.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
    request.answer(200, '{"Key":"media-private/x"}');
    await expect(result).resolves.toBe('ok');
    expect(progress).toEqual([0.5]);
  });

  it('sends nothing without a session', async () => {
    FakeRequest.last = null;
    await expect(start(clientWith(null))).resolves.toBe('auth');
    await expect(start(clientWith(null, new Error('refresh failed')))).resolves.toBe('auth');
    expect(FakeRequest.last).toBeNull();
  });

  it('sends nothing to a path that is not a file of the upload form', async () => {
    FakeRequest.last = null;
    for (const path of [`${TENANT}/${ASSET}/../x.jpg`, `${TENANT}/${ASSET}/thumb/480.webp`, `${TENANT}/x/rugbraud.jpg`, `https://example.com/${PATH}`, `${TENANT}/${ASSET}/a b.jpg`]) {
      await expect(start(undefined, path), path).resolves.toBe('error');
    }
    expect(FakeRequest.last).toBeNull();
  });

  it('tells an expired or refused token from any other refusal', async () => {
    const answer = async (status: number, text: string) => {
      const result = start();
      (await sent()).answer(status, text);
      return result;
    };
    FakeRequest.last = null;
    expect(await answer(401, '')).toBe('auth');
    FakeRequest.last = null;
    expect(await answer(400, '{"statusCode":"403","error":"Unauthorized","message":"jwt expired"}')).toBe('auth');
    FakeRequest.last = null;
    expect(await answer(400, '{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}')).toBe('error');
    FakeRequest.last = null;
    expect(await answer(409, '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}')).toBe('error');
    FakeRequest.last = null;
    expect(await answer(413, 'Payload too large')).toBe('error');
  });

  it('answers the generic error when the request fails, is aborted or times out', async () => {
    for (const event of ['onerror', 'onabort', 'ontimeout'] as const) {
      FakeRequest.last = null;
      const result = start();
      (await sent())[event]?.();
      await expect(result, event).resolves.toBe('error');
    }
  });
});
