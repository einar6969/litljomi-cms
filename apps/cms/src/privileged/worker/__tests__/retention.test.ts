// removeExpiredReleaseFiles with a fake admin client (plan M3-06, spec §7.2): the database claims the
// expired releases and lists their objects, the worker builds the paths through storage-paths,
// removes them per bucket, and marks the releases cleaned, or releases the claim when a removal
// fails. The database side runs in 105_retention.test.sql and retention.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELEASES_PER_SWEEP, removeExpiredReleaseFiles } from '../retention';

type Reply = { data?: unknown; error?: { code: string; message: string } };
let replies: Record<string, Reply> = {};
let removeError: Record<string, { message: string } | null> = {};
const calls: Array<{ fn: string; args: unknown }> = [];
const db = {
  rpc: vi.fn(async (fn: string, args: unknown) => {
    calls.push({ fn, args });
    const reply = replies[fn] ?? {};
    return { data: reply.data ?? null, error: reply.error ?? null };
  }),
  storage: {
    from: (bucket: string) => ({
      remove: async (names: string[]) => {
        calls.push({ fn: 'storage.remove', args: { bucket, names } });
        return { data: [], error: removeError[bucket] ?? null };
      },
    }),
  },
};

const T = '00000000-0000-4000-8000-00000000a001';
const R1 = '00000000-0000-4000-8000-000000000001';
const R2 = '00000000-0000-4000-8000-000000000002';
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const now = () => new Date('2026-11-03T13:00:00.000Z');
const bundleRow = (release: string, n: number) => ({ release_id: release, tenant_id: T, tenant_slug: 'prufa', release_number: n, asset_id: null, filename: null });
const mediaRow = (release: string, n: number, asset: string, filename: string) => ({ ...bundleRow(release, n), asset_id: asset, filename });

beforeEach(() => {
  calls.length = 0;
  replies = {};
  removeError = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('removeExpiredReleaseFiles', () => {
  it('claims at the given clock, removes the bundles and the listed media per bucket, then marks the releases cleaned', async () => {
    replies.worker_claim_release_cleanup = {
      data: [bundleRow(R1, 1), mediaRow(R1, 1, A1, 'a.jpg'), bundleRow(R2, 2), mediaRow(R2, 2, A2, 'b.png')],
    };

    const result = await removeExpiredReleaseFiles(db as never, { now });

    expect(RELEASES_PER_SWEEP).toBe(20);
    expect(result).toEqual({
      releaseIds: [R1, R2],
      removed: { delivery: ['prufa/releases/1.json', 'prufa/releases/2.json'], mediaPublic: [`prufa/${A1}/a.jpg`, `prufa/${A2}/b.png`] },
    });
    expect(calls).toEqual([
      { fn: 'worker_claim_release_cleanup', args: { p_now: '2026-11-03T13:00:00.000Z', p_limit: 20 } },
      { fn: 'storage.remove', args: { bucket: 'delivery', names: ['prufa/releases/1.json', 'prufa/releases/2.json'] } },
      { fn: 'storage.remove', args: { bucket: 'media-public', names: [`prufa/${A1}/a.jpg`, `prufa/${A2}/b.png`] } },
      { fn: 'worker_finish_release_cleanup', args: { p_release_ids: [R1, R2], p_deleted: true } },
    ]);
  });

  it('does nothing more when nothing has expired', async () => {
    replies.worker_claim_release_cleanup = { data: [] };

    expect(await removeExpiredReleaseFiles(db as never, { now, limit: 5 })).toEqual({ releaseIds: [], removed: { delivery: [], mediaPublic: [] } });
    expect(calls).toEqual([{ fn: 'worker_claim_release_cleanup', args: { p_now: '2026-11-03T13:00:00.000Z', p_limit: 5 } }]);
  });

  it('skips a media object whose filename the build refuses (it was never copied) and keeps the rest', async () => {
    replies.worker_claim_release_cleanup = { data: [bundleRow(R1, 1), mediaRow(R1, 1, A1, 'a\\b.jpg'), mediaRow(R1, 1, A2, 'b.png')] };

    const result = await removeExpiredReleaseFiles(db as never, { now });

    expect(result.removed.mediaPublic).toEqual([`prufa/${A2}/b.png`]);
    expect(calls.at(-1)).toEqual({ fn: 'worker_finish_release_cleanup', args: { p_release_ids: [R1], p_deleted: true } });
  });

  it('a failed removal releases the claim and is thrown', async () => {
    replies.worker_claim_release_cleanup = { data: [bundleRow(R1, 1), mediaRow(R1, 1, A1, 'a.jpg')] };
    removeError['media-public'] = { message: 'storage down' };

    await expect(removeExpiredReleaseFiles(db as never, { now })).rejects.toThrow('media-public remove(1 objects): storage down');
    expect(calls.at(-1)).toEqual({ fn: 'worker_finish_release_cleanup', args: { p_release_ids: [R1], p_deleted: false } });
    expect(calls.some((c) => c.fn === 'worker_finish_release_cleanup' && (c.args as { p_deleted: boolean }).p_deleted)).toBe(false);
  });

  it('a failed claim is thrown and nothing is removed', async () => {
    replies.worker_claim_release_cleanup = { error: { code: '22023', message: 'p_limit must be between 1 and 100' } };

    await expect(removeExpiredReleaseFiles(db as never, { now, limit: 0 })).rejects.toThrow('worker_claim_release_cleanup: 22023');
    expect(calls.map((c) => c.fn)).toEqual(['worker_claim_release_cleanup']);
  });
});
