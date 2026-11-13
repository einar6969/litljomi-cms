// Uploading several files at once (docs/plans/media-library.md section 6.2, slice L5), with no I/O
// of its own: the upload, the registration and the check before upload are given to it, so the
// states can be tested without a browser. Each file is checked first (type, size), then uploaded,
// `PARALLEL_UPLOADS` at a time, then registered; it holds its place until its registration answers.
//
// A file that fails is named on its own row with its reason, and the others continue. A retry
// prepares the file again, with a new asset id and path: an object a failed attempt left behind is
// never registered, and the orphan sweep removes it a day later. A lost session stops the queue:
// nothing new starts, every file that was refused for the session waits again, and `resume()` goes
// on, again with new ids. A batch ends when nothing waits or is on its way; its files that arrived
// leave the list (the library shows them), its failed ones stay.
import type { PreparedUpload } from '../upload';

export const MAX_BATCH = 50;
export const PARALLEL_UPLOADS = 3;

export type UploadState = 'waiting' | 'uploading' | 'processing' | 'done' | 'failed';
/** Why a file failed: its type or size (from the check before upload, or the server's own), or anything else. */
export type UploadReason = 'type' | 'size' | 'error';

export type UploadItem = {
  readonly key: number;
  readonly name: string;
  readonly state: UploadState;
  /** 0–100 while uploading. */
  readonly progress: number;
  readonly reason: UploadReason | null;
};

export type QueueSnapshot = {
  readonly items: readonly UploadItem[];
  /** The session was lost: nothing starts until `resume()`. */
  readonly signedOut: boolean;
  /** Files left out of the last `add`, beyond `MAX_BATCH`. */
  readonly dropped: number;
  /** How many files the current batch has, and how many of them have arrived (the live summary). */
  readonly progress: { readonly done: number; readonly total: number };
  /** The counts of the batch that ended last, until another starts. */
  readonly result: { readonly done: number; readonly failed: number } | null;
};

export type UploadAnswer = 'ok' | 'auth' | 'error';
export type RegisterAnswer = { ok: true } | { ok: false; code: string };
type Prepared = Extract<PreparedUpload, { ok: true }>;

export type UploadDeps = {
  /** The check before upload, and the file's id, name and path (editor/upload.ts `prepareUpload`). */
  prepare(file: File): PreparedUpload;
  /** Uploads the original; `onProgress` gets the fraction sent. */
  upload(path: string, file: File, onProgress: (fraction: number) => void): Promise<UploadAnswer>;
  /** Registers the uploaded original (`registerAssetAction`). */
  register(prepared: Prepared): Promise<RegisterAnswer>;
  onChange(snapshot: QueueSnapshot): void;
  onBatchEnd?(result: { done: number; failed: number }): void;
};

type Entry = { key: number; file: File; state: UploadState; progress: number; reason: UploadReason | null; prepared: Prepared | null };

const reasonOf = (code: string): UploadReason => (code === 'type' || code === 'size' ? code : 'error');

/** The call's answer, or `fallback` when it throws or rejects. */
function settled<T>(call: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return call().catch(() => fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

export class UploadQueue {
  private entries: Entry[] = [];
  private nextKey = 1;
  private running = 0;
  private signedOut = false;
  private dropped = 0;
  /** The entries of the current batch (by key), including the ones that failed. */
  private batch = new Set<number>();
  private result: QueueSnapshot['result'] = null;

  constructor(private readonly deps: UploadDeps) {}

  snapshot(): QueueSnapshot {
    const batch = this.entries.filter((e) => this.batch.has(e.key));
    return {
      items: this.entries.map(({ key, file, state, progress, reason }) => ({ key, name: file.name, state, progress, reason })),
      signedOut: this.signedOut,
      dropped: this.dropped,
      progress: { done: batch.filter((e) => e.state === 'done').length, total: this.batch.size },
      result: this.result,
    };
  }

  /** Queues the files, up to `MAX_BATCH` in the current batch. A file refused by the check fails at once. */
  add(files: Iterable<File>): void {
    const all = [...files];
    const room = Math.max(0, MAX_BATCH - this.batch.size);
    this.dropped = Math.max(0, all.length - room);
    this.result = null;
    for (const file of all.slice(0, room)) {
      const entry: Entry = { key: this.nextKey++, file, state: 'waiting', progress: 0, reason: null, prepared: null };
      this.check(entry);
      this.entries.push(entry);
      this.batch.add(entry.key);
    }
    this.changed();
    this.pump();
  }

  /** Tries a failed file again, with a new id and path. */
  retry(key: number): void {
    const entry = this.entries.find((e) => e.key === key);
    if (!entry || entry.state !== 'failed') return;
    entry.state = 'waiting';
    entry.reason = null;
    entry.progress = 0;
    entry.prepared = null;
    this.check(entry);
    this.result = null;
    this.dropped = 0;
    this.batch.add(entry.key);
    this.changed();
    this.pump();
  }

  /** Takes a file that is not on its way off the list. */
  remove(key: number): void {
    const entry = this.entries.find((e) => e.key === key);
    if (!entry || entry.state === 'uploading' || entry.state === 'processing') return;
    this.entries = this.entries.filter((e) => e !== entry);
    this.batch.delete(key);
    this.changed();
    this.pump();
  }

  /** Goes on after the editor has signed in again. */
  resume(): void {
    this.signedOut = false;
    this.changed();
    this.pump();
  }

  /** Prepares a waiting entry: a file the check refuses fails with its reason. */
  private check(entry: Entry): void {
    const prepared = this.deps.prepare(entry.file);
    if (prepared.ok) entry.prepared = prepared;
    else {
      entry.state = 'failed';
      entry.reason = prepared.reason;
    }
  }

  private pump(): void {
    while (!this.signedOut && this.running < PARALLEL_UPLOADS) {
      const next = this.entries.find((e) => e.state === 'waiting');
      if (!next) break;
      this.running += 1;
      void this.send(next).finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
    this.endBatchIfIdle();
  }

  private async send(entry: Entry): Promise<void> {
    if (entry.prepared === null) this.check(entry);
    const prepared = entry.prepared;
    if (prepared === null) return this.changed();
    entry.state = 'uploading';
    entry.progress = 0;
    this.changed();
    const onProgress = (fraction: number) => {
      if (entry.state !== 'uploading') return;
      entry.progress = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
      this.changed();
    };
    const uploaded = await settled<UploadAnswer>(() => this.deps.upload(prepared.path, entry.file, onProgress), 'error');
    if (uploaded !== 'ok') return this.settle(entry, uploaded === 'auth' ? 'auth' : 'error');
    entry.state = 'processing';
    this.changed();
    const registered = await settled<RegisterAnswer>(() => this.deps.register(prepared), { ok: false, code: 'error' });
    if (registered.ok) {
      entry.state = 'done';
      entry.progress = 100;
      this.changed();
    } else this.settle(entry, registered.code);
  }

  /** A failed attempt: a lost session puts the file back to wait with a fresh id, anything else fails it. */
  private settle(entry: Entry, code: string): void {
    entry.prepared = null;
    entry.progress = 0;
    if (code === 'auth') {
      entry.state = 'waiting';
      this.signedOut = true;
    } else {
      entry.state = 'failed';
      entry.reason = reasonOf(code);
    }
    this.changed();
  }

  private endBatchIfIdle(): void {
    if (this.batch.size === 0 || this.running > 0 || this.entries.some((e) => e.state === 'waiting' && this.batch.has(e.key))) return;
    const batch = this.entries.filter((e) => this.batch.has(e.key));
    const result = { done: batch.filter((e) => e.state === 'done').length, failed: batch.filter((e) => e.state === 'failed').length };
    this.entries = this.entries.filter((e) => e.state !== 'done');
    this.batch.clear();
    this.result = result;
    this.changed();
    this.deps.onBatchEnd?.(result);
  }

  private changed(): void {
    this.deps.onChange(this.snapshot());
  }
}
