import { describe, expect, it } from 'vitest';
import type { PreparedUpload } from '../upload';
import { MAX_BATCH, PARALLEL_UPLOADS, UploadQueue, type QueueSnapshot, type RegisterAnswer, type UploadAnswer } from '../media/upload-queue';

const TENANT = '00000000-0000-4000-8000-0000000000f1';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

/** Lets every settled promise run its callbacks. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const file = (name: string, type = 'image/jpeg', size = 1000) => new File([new Uint8Array(size)], name, { type });

/**
 * A queue whose uploads and registrations wait until the test answers them, so the test sees each
 * state. Each call is recorded with its path, so a retry's new id can be seen.
 */
function harness() {
  let n = 0;
  const uploads: { path: string; name: string; progress: (f: number) => void; answer: Deferred<UploadAnswer> }[] = [];
  const registrations: { path: string; answer: Deferred<RegisterAnswer> }[] = [];
  const snapshots: QueueSnapshot[] = [];
  const ends: { done: number; failed: number }[] = [];
  const queue = new UploadQueue({
    prepare(f): PreparedUpload {
      if (!f.type.startsWith('image/')) return { ok: false, reason: 'type' };
      if (f.size > 20_971_520) return { ok: false, reason: 'size' };
      const assetId = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
      return { ok: true, assetId, filename: f.name, path: `${TENANT}/${assetId}/${f.name}` };
    },
    upload(path, f, progress) {
      const answer = deferred<UploadAnswer>();
      uploads.push({ path, name: f.name, progress, answer });
      return answer.promise;
    },
    register(prepared) {
      const answer = deferred<RegisterAnswer>();
      registrations.push({ path: prepared.path, answer });
      return answer.promise;
    },
    onChange: (s) => snapshots.push(s),
    onBatchEnd: (r) => ends.push(r),
  });
  const states = () => queue.snapshot().items.map((i) => [i.name, i.state, ...(i.state === 'uploading' ? [i.progress] : []), ...(i.reason ? [i.reason] : [])]);
  /** Answers the upload and then the registration of the named file. */
  const finish = async (name: string, upload: UploadAnswer = 'ok', register: RegisterAnswer = { ok: true }) => {
    const u = uploads.filter((x) => x.name === name).at(-1)!;
    u.answer.resolve(upload);
    await flush();
    if (upload !== 'ok') return;
    registrations.filter((r) => r.path === u.path).at(-1)!.answer.resolve(register);
    await flush();
  };
  return { queue, uploads, registrations, snapshots, ends, states, finish };
}

describe('UploadQueue', () => {
  it(`uploads ${PARALLEL_UPLOADS} files at a time, each through waiting, uploading with a percentage, processing and done`, async () => {
    const h = harness();
    h.queue.add(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'].map((name) => file(name)));
    await flush();
    expect(h.uploads.map((u) => u.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(h.states()).toEqual([
      ['a.jpg', 'uploading', 0],
      ['b.jpg', 'uploading', 0],
      ['c.jpg', 'uploading', 0],
      ['d.jpg', 'waiting'],
    ]);

    h.uploads[0]!.progress(0.426);
    expect(h.states()[0]).toEqual(['a.jpg', 'uploading', 43]);

    h.uploads[0]!.answer.resolve('ok');
    await flush();
    expect(h.states()[0]).toEqual(['a.jpg', 'processing']);
    // The slot stays taken until the file is registered.
    expect(h.uploads).toHaveLength(3);

    h.registrations[0]!.answer.resolve({ ok: true });
    await flush();
    expect(h.states()[0]).toEqual(['a.jpg', 'done']);
    expect(h.uploads.map((u) => u.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    expect(h.ends).toEqual([]);
  });

  it('checks type and size first: a refused file fails with its reason and the others continue', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('skjal.txt', 'text/plain'), file('risi.jpg', 'image/jpeg', 20_971_521), file('b.png', 'image/png')]);
    await flush();
    expect(h.states()).toEqual([
      ['a.jpg', 'uploading', 0],
      ['skjal.txt', 'failed', 'type'],
      ['risi.jpg', 'failed', 'size'],
      ['b.png', 'uploading', 0],
    ]);
    expect(h.uploads.map((u) => u.name)).toEqual(['a.jpg', 'b.png']);
  });

  it('names a failed upload or registration on its own row, keeps the reason the server gives for type and size, and goes on', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg')]);
    await flush();
    await h.finish('a.jpg', 'error');
    await h.finish('b.jpg', 'ok', { ok: false, code: 'type' });
    await h.finish('c.jpg', 'ok', { ok: false, code: 'invalid' });
    await h.finish('d.jpg');
    expect(h.states()).toEqual([
      ['a.jpg', 'failed', 'error'],
      ['b.jpg', 'failed', 'type'],
      ['c.jpg', 'failed', 'error'],
    ]);
  });

  it('treats an upload or a registration that throws as a failure of that file', async () => {
    const h = harness();
    const queue = new UploadQueue({
      prepare: (f) => ({ ok: true, assetId: f.name, filename: f.name, path: f.name }),
      upload: async (path) => {
        if (path === 'a.jpg') throw new Error('network');
        return 'ok';
      },
      register: async () => {
        throw new Error('server');
      },
      onChange: () => {},
    });
    queue.add([file('a.jpg'), file('b.jpg')]);
    await flush();
    expect(queue.snapshot().items.map((i) => [i.name, i.state, i.reason])).toEqual([
      ['a.jpg', 'failed', 'error'],
      ['b.jpg', 'failed', 'error'],
    ]);
    expect(h.uploads).toEqual([]);
  });

  it('ends the batch with the counts, drops the files that arrived from the list and keeps the failed ones', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('b.txt', 'text/plain'), file('c.jpg')]);
    await flush();
    await h.finish('a.jpg');
    expect(h.ends).toEqual([]);
    await h.finish('c.jpg', 'error');
    expect(h.ends).toEqual([{ done: 1, failed: 2 }]);
    expect(h.queue.snapshot().result).toEqual({ done: 1, failed: 2 });
    expect(h.states()).toEqual([
      ['b.txt', 'failed', 'type'],
      ['c.jpg', 'failed', 'error'],
    ]);
  });

  it('ends at once a batch whose every file was refused before upload', async () => {
    const h = harness();
    h.queue.add([file('a.txt', 'text/plain')]);
    await flush();
    expect(h.ends).toEqual([{ done: 0, failed: 1 }]);
  });

  it('retries a failed file with a new id and path, as a new batch, and removes a row on request', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('b.jpg')]);
    await flush();
    await h.finish('a.jpg', 'error');
    await h.finish('b.jpg', 'ok', { ok: false, code: 'error' });
    expect(h.ends).toEqual([{ done: 0, failed: 2 }]);
    const [a, b] = h.queue.snapshot().items;
    const firstPath = h.uploads[0]!.path;

    h.queue.retry(a!.key);
    expect(h.queue.snapshot().result).toBeNull();
    await flush();
    expect(h.uploads.at(-1)!.name).toBe('a.jpg');
    expect(h.uploads.at(-1)!.path).not.toBe(firstPath);
    expect(h.uploads.at(-1)!.path).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/a\.jpg$/);
    await h.finish('a.jpg');
    // The retry was a batch of one; the file still failed from before is not counted again.
    expect(h.ends.at(-1)).toEqual({ done: 1, failed: 0 });
    expect(h.states()).toEqual([['b.jpg', 'failed', 'error']]);

    h.queue.remove(b!.key);
    expect(h.states()).toEqual([]);
  });

  it('never retries or removes a file that is still on its way', async () => {
    const h = harness();
    h.queue.add([file('a.jpg')]);
    await flush();
    const [a] = h.queue.snapshot().items;
    h.queue.retry(a!.key);
    h.queue.remove(a!.key);
    await flush();
    expect(h.uploads).toHaveLength(1);
    expect(h.states()).toEqual([['a.jpg', 'uploading', 0]]);
  });

  it('stops on a lost session, keeps what is left as waiting, and goes on with new ids after sign-in', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('b.jpg'), file('c.jpg'), file('d.jpg'), file('e.jpg')]);
    await flush();
    await h.finish('a.jpg', 'auth');
    expect(h.queue.snapshot().signedOut).toBe(true);
    // The two in flight finish; a registration refused for the session waits too.
    await h.finish('b.jpg');
    await h.finish('c.jpg', 'ok', { ok: false, code: 'auth' });
    expect(h.uploads.map((u) => u.name)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
    expect(h.states()).toEqual([
      ['a.jpg', 'waiting'],
      ['b.jpg', 'done'],
      ['c.jpg', 'waiting'],
      ['d.jpg', 'waiting'],
      ['e.jpg', 'waiting'],
    ]);
    expect(h.ends).toEqual([]);

    h.queue.resume();
    expect(h.queue.snapshot().signedOut).toBe(false);
    await flush();
    expect(h.uploads.slice(3).map((u) => u.name)).toEqual(['a.jpg', 'c.jpg', 'd.jpg']);
    expect(h.uploads[3]!.path).not.toBe(h.uploads[0]!.path);
    for (const name of ['a.jpg', 'c.jpg', 'd.jpg', 'e.jpg']) await h.finish(name);
    expect(h.ends).toEqual([{ done: 5, failed: 0 }]);
  });

  it(`takes at most ${MAX_BATCH} files per batch and says how many it left out`, async () => {
    const h = harness();
    h.queue.add(Array.from({ length: 48 }, (_, i) => file(`m${i}.jpg`)));
    h.queue.add([file('x.jpg'), file('y.jpg'), file('z.jpg'), file('w.jpg')]);
    await flush();
    const snapshot = h.queue.snapshot();
    expect(snapshot.items).toHaveLength(MAX_BATCH);
    expect(snapshot.items.at(-1)!.name).toBe('y.jpg');
    expect(snapshot.dropped).toBe(2);
    expect(h.uploads).toHaveLength(PARALLEL_UPLOADS);
  });

  it('reports every change to its listener', async () => {
    const h = harness();
    const before = h.snapshots.length;
    h.queue.add([file('a.jpg')]);
    await flush();
    h.uploads[0]!.progress(0.5);
    expect(h.snapshots.length).toBeGreaterThan(before + 1);
    expect(h.snapshots.at(-1)!.items[0]).toMatchObject({ state: 'uploading', progress: 50 });
  });

  it('counts the files in a batch for the live summary', async () => {
    const h = harness();
    h.queue.add([file('a.jpg'), file('b.jpg'), file('c.txt', 'text/plain')]);
    await flush();
    expect(h.queue.snapshot().progress).toEqual({ done: 0, total: 3 });
    await h.finish('a.jpg');
    expect(h.queue.snapshot().progress).toEqual({ done: 1, total: 3 });
  });
});
