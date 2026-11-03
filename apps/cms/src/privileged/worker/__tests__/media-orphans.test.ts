// removePrivateOrphans with a fake admin client (M3-07): the database lists the orphans, Storage
// removes them in one batch. The database side runs in media-orphans.integration.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORPHAN_GRACE_SECONDS, ORPHANS_PER_SWEEP, removePrivateOrphans } from '../media-orphans';

type Reply = { data?: unknown; error?: { code: string; message: string } };
let rpcReply: Reply = {};
let removeReply: { error: { message: string } | null } = { error: null };
const calls: Array<{ fn: string; args: unknown }> = [];
const db = {
  rpc: vi.fn(async (fn: string, args: unknown) => {
    calls.push({ fn, args });
    return { data: rpcReply.data ?? null, error: rpcReply.error ?? null };
  }),
  storage: {
    from: (bucket: string) => ({
      remove: async (names: string[]) => {
        calls.push({ fn: 'storage.remove', args: { bucket, names } });
        return { data: [], error: removeReply.error };
      },
    }),
  },
};

beforeEach(() => {
  calls.length = 0;
  rpcReply = {};
  removeReply = { error: null };
});

describe('removePrivateOrphans', () => {
  it('lists orphans older than a day, at most 100, and removes them from media-private in one batch', async () => {
    rpcReply = { data: [{ name: 't/a/x.jpg' }, { name: 't/b/y.png' }] };

    expect(await removePrivateOrphans(db as never)).toEqual(['t/a/x.jpg', 't/b/y.png']);
    expect(ORPHAN_GRACE_SECONDS).toBe(86400);
    expect(ORPHANS_PER_SWEEP).toBe(100);
    expect(calls).toEqual([
      { fn: 'worker_private_orphans', args: { p_grace_seconds: 86400, p_limit: 100 } },
      { fn: 'storage.remove', args: { bucket: 'media-private', names: ['t/a/x.jpg', 't/b/y.png'] } },
    ]);
  });

  it('removes nothing when there are no orphans', async () => {
    rpcReply = { data: [] };
    expect(await removePrivateOrphans(db as never, { graceSeconds: 3600, limit: 5 })).toEqual([]);
    expect(calls).toEqual([{ fn: 'worker_private_orphans', args: { p_grace_seconds: 3600, p_limit: 5 } }]);
  });

  it('throws when the listing or the removal fails', async () => {
    rpcReply = { error: { code: '22023', message: 'p_grace_seconds must be at least 3600' } };
    await expect(removePrivateOrphans(db as never, { graceSeconds: 1 })).rejects.toThrow('worker_private_orphans: 22023');

    rpcReply = { data: [{ name: 't/a/x.jpg' }] };
    removeReply = { error: { message: 'storage down' } };
    await expect(removePrivateOrphans(db as never)).rejects.toThrow('media-private remove(1 orphans): storage down');
  });
});
