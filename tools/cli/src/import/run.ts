// The writing half of `import` (import plan sections 2.3 to 2.6): files with their thumbnails,
// entries, the manual order of the types the module orders by hand, drafts, then publication in
// waves and batches. Every step asks the server first, so a run killed between any two calls
// continues without duplicates when it is run again with the same arguments; nothing is ever undone.
// Output is keys, ids, statuses and counts, never data, tokens or signed URLs.
//
// The order is applied as soon as the entries exist, before any draft is saved or any publish is
// requested: a release lists a manually ordered type by the entries' order as it stands when the
// release is built (spec §5.1, §7.2), so the run's first release, and every one after it, already
// has the manifest's order. Only when this run delivers no release (every entry was already
// published, by an earlier run) while the public bundle still lists a type in another order does
// the order wait for the tenant's next release: the run then files one publish of an entry of its
// own, its data unchanged, so that release is built now (`releaseOrder`).
import { contentHash } from '@litljomi/cms-schema';
import { Failure, UUID_RE, clean } from '../hosted.ts';
import type { LedgerFile, Pass } from './ledger.ts';
import { assetIdFor, sha256Hex } from './media.ts';
import { orderDifference, planMoves, relativeOrder } from './order.ts';
import { itemData, sameJson, type Plan, type PlanFile, type PlanItem } from './plan.ts';
import type { Lookup } from './refs.ts';
import { readBundle } from './report.ts';
import type { ApiResult, EditorSession } from './session.ts';

export const MEDIA_BUCKET = 'media-private';
export const POLL_MS = 10_000;
/** PostgREST's row cap on a hosted project: a type's list must fit in one read to be ordered. */
export const MAX_ORDERED_ENTRIES = 1000;
export const STALL_MS = 10 * 60_000;

export interface RunDeps {
  /** A media file's bytes, refusing a symlink (main.ts opens with O_NOFOLLOW). */
  readBytes(path: string): Promise<Uint8Array>;
  /**
   * L2's thumbnail maker, the one an editor's upload calls (apps/cms/src/editor/server/
   * thumbnail-maker.ts, wired in main.ts): the thumbnail of a file's bytes and the one path it may
   * have, or null when it makes none (an image it does not decode, or one over its limits). Absent
   * in tests that need none: files then arrive without a thumbnail, which the CMS makes when an
   * editor first views the file.
   */
  thumbnail?: (bytes: Uint8Array, tenantId: string, assetId: string) => Promise<{ bytes: Uint8Array; path: string } | null>;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RunOptions {
  /** The tenant's slug, which names its public delivery folder. */
  tenant: string;
  media: string;
  batchSize: number;
  firstBatchOnly: boolean;
}

export interface RunOutcome {
  /** Why the run stopped before the end, or null. */
  stopped: string | null;
  /** True when `--first-batch-only` stopped it after the first batch. */
  firstBatchStop: boolean;
  /** The newest release any of the importer's requests was delivered in. */
  lastRelease: number | null;
  /** Things reported rather than touched. */
  notices: string[];
  /** Files given a thumbnail by this run, and files left without one. */
  thumbnailsMade: number;
  thumbnailsMissing: number;
  /** Moves made through api.move_entry in this run. */
  moves: number;
  /** Keys whose entry the importer knows, by key. */
  ids: Map<string, string>;
}

type Log = (line: string) => void;

interface Detail {
  id: string;
  tenant_id: string;
  type: string;
  slug: string | null;
  schema_version: number;
  draft_version: number;
  published_draft_version: number | null;
  first_published_at: string | null;
  status: string;
  data: unknown;
}

interface StatusRow {
  request_id: string;
  entry_id: string;
  status: string;
  error: unknown;
  release_number: number | null;
  release_status: string | null;
  retries_exhausted: boolean | null;
  omitted: boolean | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isEmpty = (data: unknown) => isObject(data) && Object.keys(data).length === 0;
const text = (s: string | null | undefined) => (s === undefined || s === null || s === '' ? null : s);
const FAILED_STATUSES = new Set(['failed_validation', 'rejected', 'failed', 'superseded']);
const OPEN_STATUSES = new Set(['pending', 'validating']);
const seconds = (ms: number) => `${Math.round(ms / 1000)}s`;

function need(result: ApiResult, what: string): unknown {
  if (!result.ok) throw new Failure(`FAILED: ${what}: ${result.detail}`);
  return result.body;
}

/** A request's error as code and field paths only: its messages may quote content. */
export function errorSummary(error: unknown): string {
  if (!isObject(error)) return 'no detail';
  const code = typeof error.code === 'string' ? clean(error.code) : 'unknown';
  const issues = Array.isArray(error.issues) ? error.issues : [];
  const paths = issues
    .map((i) => (isObject(i) && Array.isArray(i.path) ? '/' + i.path.map((p) => clean(String(p))).join('/') : null))
    .filter((p): p is string => p !== null);
  return paths.length > 0 ? `${code} at ${paths.slice(0, 10).join(', ')}` : code;
}

function asDetail(body: unknown, key: string): Detail | null {
  if (body === null) return null;
  if (!isObject(body) || typeof body.id !== 'string' || typeof body.tenant_id !== 'string' || typeof body.type !== 'string' || !Number.isSafeInteger(body.draft_version))
    throw new Failure(`FAILED: ${key}: unexpected entry_detail_by_id response`);
  return body as unknown as Detail;
}

export class Importer {
  readonly ids = new Map<string, string>();
  private readonly blocked = new Set<string>();
  private readonly notices: string[] = [];
  private lastRelease: number | null = null;
  private thumbnailsMade = 0;
  private thumbnailsMissing = 0;
  private moves = 0;
  /** Files already published by an earlier wave or run: a batch's new images are the others. */
  private readonly publishedFiles = new Set<string>();
  private firstBatchMeasured = false;

  constructor(
    private readonly plan: Plan,
    private readonly s: EditorSession,
    private readonly ledger: LedgerFile,
    private readonly tenantId: string,
    private readonly deps: RunDeps,
    private readonly options: RunOptions,
    private readonly log: Log,
  ) {}

  private notice(key: string, what: string): void {
    this.blocked.add(key);
    this.notices.push(`${key}: ${what}`);
    this.log(`  NOT TOUCHED ${key}: ${what}`);
  }

  lookup(): Lookup {
    return {
      entry: (key) => {
        const item = this.plan.byKey.get(key);
        const id = this.ids.get(key);
        return item === undefined || id === undefined ? null : { id, type: item.type };
      },
      file: (path) => {
        const f = this.plan.files.get(path);
        return f === undefined ? null : { id: assetIdFor(this.tenantId, f.sha256), alt: f.alt };
      },
    };
  }

  private pass(item: PlanItem): Pass {
    return this.plan.dropped.has(item.key) ? 'first' : 'full';
  }

  private dataFor(item: PlanItem, pass: Pass) {
    const data = itemData(this.plan, item, this.lookup(), pass);
    return { data, hash: contentHash({ schemaVersion: item.contentType.version, data }) };
  }

  /**
   * The entry as the server has it, refused unless it is in the run's tenant and of the item's type.
   * save_draft and request_publish take only the entry id, and the database derives the tenant from
   * the entry: an editor of several tenants given a wrong or planted ledger id would otherwise write
   * to another tenant. Every write to an entry follows a call to this.
   */
  private async detail(key: string, id: string): Promise<Detail | null> {
    const detail = asDetail(need(await this.s.rpc('entry_detail_by_id', { p_entry_id: id }), `reading entry ${id} (${key})`), key);
    if (detail === null) return null;
    const type = (this.plan.byKey.get(key) as PlanItem).type;
    if (detail.tenant_id !== this.tenantId) throw new Failure(`FAILED: ${key}: entry ${id} is in tenant ${clean(detail.tenant_id)}, not ${this.tenantId}; nothing more was written`);
    if (detail.type !== type) throw new Failure(`FAILED: ${key}: entry ${id} is a ${clean(detail.type)} entry on the server, not ${type}; nothing more was written`);
    return detail;
  }

  /** Every ledger record of the manifest's keys, checked against the server before anything is written. */
  async checkLedger(): Promise<void> {
    for (const item of this.plan.items) {
      const rec = this.ledger.entry(item.key);
      if (rec === undefined) continue;
      if (rec.type !== item.type) throw new Failure(`FAILED: ${item.key}: the ledger has it as type ${rec.type}, the manifest as ${item.type}`);
      if ((await this.detail(item.key, rec.id)) === null) throw new Failure(`FAILED: ${item.key}: entry ${rec.id}, named by the ledger, is not visible; nothing was written`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // 1. Files

  private async assetRow(id: string): Promise<Record<string, unknown> | null> {
    const body = need(
      await this.s.view('asset_list', `id=eq.${id}&select=id,original_path,default_alt,caption,credit,thumb_path,archived_at`),
      `reading the library for ${id}`,
    );
    if (!Array.isArray(body)) throw new Failure('FAILED: unexpected asset_list response');
    return (body[0] as Record<string, unknown> | undefined) ?? null;
  }

  private async readFile(f: PlanFile): Promise<Uint8Array<ArrayBuffer>> {
    const bytes = await this.deps.readBytes(`${this.options.media.replace(/\/+$/, '')}/${f.path}`);
    if (sha256Hex(bytes) !== f.sha256) throw new Failure(`FAILED: file ${f.path} changed on disk after it was checked; nothing more was written`);
    return new Uint8Array(bytes);
  }

  async files(): Promise<void> {
    for (const f of this.plan.files.values()) {
      const id = assetIdFor(this.tenantId, f.sha256);
      const path = `${this.tenantId}/${id}/${f.filename}`;
      let row = await this.assetRow(id);
      let state = 'already in the library';
      let bytes: Uint8Array<ArrayBuffer> | null = null;
      if (row === null) {
        bytes = await this.readFile(f);
        const up = await this.s.upload(MEDIA_BUCKET, path, bytes, f.meta.mime);
        if (up === 'exists') {
          // Uploaded by an earlier run that stopped before registering: checked before it is registered.
          const stored = await this.s.download(MEDIA_BUCKET, path);
          if (!stored.ok) throw new Failure(`FAILED: file ${f.path}: reading the stored object back: ${stored.detail}`);
          if (sha256Hex(stored.bytes) !== f.sha256) throw new Failure(`FAILED: file ${f.path}: the object already stored at its path is not this file; nothing more was written`);
        } else if (up !== 'created') {
          throw new Failure(`FAILED: file ${f.path}: uploading: ${up.detail}`);
        }
        const registered = await this.s.rpc('register_asset', {
          p_asset_id: id,
          p_tenant_id: this.tenantId,
          p_original_path: path,
          p_filename: f.filename,
          p_mime: f.meta.mime,
          p_bytes: f.meta.bytes,
          p_width: f.meta.width,
          p_height: f.meta.height,
          p_sha256: f.meta.sha256,
        });
        if (!registered.ok) {
          row = await this.assetRow(id);
          if (row === null) throw new Failure(`FAILED: file ${f.path}: registering: ${registered.detail}`);
        } else {
          row = { id, original_path: path, default_alt: null, caption: null, credit: null, thumb_path: null, archived_at: null };
          state = 'registered';
        }
      }
      if (row.original_path !== path) throw new Failure(`FAILED: file ${f.path}: asset ${id} has another path in the library; nothing more was written`);
      if (row.archived_at !== null && row.archived_at !== undefined) throw new Failure(`FAILED: file ${f.path}: asset ${id} is archived in the library; nothing more was written`);

      // Texts: written to a file that has none; an existing text that differs is someone's edit.
      const want = { alt: text(f.alt), caption: text(f.caption), credit: text(f.credit) };
      const have = { alt: text(row.default_alt as string | null), caption: text(row.caption as string | null), credit: text(row.credit as string | null) };
      if (!sameJson(want, have)) {
        if (have.alt === null && have.caption === null && have.credit === null) {
          need(
            await this.s.rpc('update_asset_text', { p_asset_id: id, p_default_alt: want.alt, p_caption: want.caption, p_credit: want.credit }),
            `file ${f.path}: setting its alt, caption and credit`,
          );
        } else {
          this.notices.push(`file ${f.path}: its alt, caption or credit in the library differs from the manifest; not touched`);
          this.log(`  NOT TOUCHED file ${f.path}: its texts in the library differ from the manifest`);
        }
      }

      if (row.thumb_path === null || row.thumb_path === undefined) state += await this.thumbnailFor(f, id, bytes);
      this.log(`file ${f.path}: ${id} ${state}`);
    }
  }

  /**
   * The file's thumbnail, made and stored as an editor's upload makes it (`ensureThumbnail`,
   * apps/cms/src/editor/server/thumbnail.ts): the maker's bytes uploaded to the one path it names,
   * never overwriting, then recorded through `set_asset_thumbnail`, which takes only this file's own
   * path and only once the object exists. A failed upload is still followed by the recording, as
   * there: an earlier run may have left the object in place. The file stays registered whatever
   * happens here; one left without a thumbnail gets it when an editor first views it.
   */
  private async thumbnailFor(f: PlanFile, id: string, read: Uint8Array<ArrayBuffer> | null): Promise<string> {
    const made = this.deps.thumbnail === undefined ? null : await this.deps.thumbnail(read ?? (await this.readFile(f)), this.tenantId, id);
    if (made === null) {
      this.thumbnailsMissing += 1;
      return ', no thumbnail';
    }
    await this.s.upload(MEDIA_BUCKET, made.path, new Uint8Array(made.bytes), 'image/webp');
    const recorded = await this.s.rpc('set_asset_thumbnail', { p_asset_id: id, p_thumb_path: made.path });
    if (!recorded.ok) {
      this.thumbnailsMissing += 1;
      return `, its thumbnail not recorded (${recorded.detail})`;
    }
    this.thumbnailsMade += 1;
    return ', thumbnail made';
  }

  // -------------------------------------------------------------------------------------------
  // 2. Entries

  private async findBySlug(item: PlanItem): Promise<string | null> {
    const query = `tenant_id=eq.${this.tenantId}&type=eq.${encodeURIComponent(item.type)}&slug=eq.${encodeURIComponent(item.slug as string)}&status=neq.archived&select=id`;
    const body = need(await this.s.view('entry_list', query), `${item.key}: looking up slug ${item.slug}`);
    if (!Array.isArray(body) || body.length > 1) throw new Failure(`FAILED: ${item.key}: unexpected entry_list response`);
    const id = (body[0] as { id?: unknown } | undefined)?.id;
    if (id === undefined) return null;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure(`FAILED: ${item.key}: unexpected entry_list response`);
    return id;
  }

  async entries(): Promise<void> {
    // Entries found without a ledger record whose draft is not empty: adopted only if their draft is
    // exactly what the importer would save, checked once every key has an id.
    const provisional: PlanItem[] = [];
    for (const item of this.plan.items) {
      const rec = this.ledger.entry(item.key);
      if (rec !== undefined) {
        // Checked against the server by checkLedger, before the files.
        if (rec.type !== item.type) throw new Failure(`FAILED: ${item.key}: the ledger has it as type ${rec.type}, the manifest as ${item.type}`);
        this.ids.set(item.key, rec.id);
        continue;
      }
      if (item.singleton) {
        const id = need(
          await this.s.rpc('create_singleton_entry', { p_tenant_id: this.tenantId, p_type: item.type, p_schema_version: item.contentType.version }),
          `${item.key}: opening singleton ${item.type}`,
        );
        if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure(`FAILED: ${item.key}: unexpected create_singleton_entry response`);
        this.ids.set(item.key, id);
        provisional.push(item);
        continue;
      }
      let id = await this.findBySlug(item);
      if (id === null) {
        const created = await this.s.rpc('create_entry', { p_tenant_id: this.tenantId, p_type: item.type, p_slug: item.slug, p_schema_version: item.contentType.version });
        if (created.ok) {
          if (typeof created.body !== 'string' || !UUID_RE.test(created.body)) throw new Failure(`FAILED: ${item.key}: unexpected create_entry response`);
          await this.ledger.set(item.key, { id: created.body, type: item.type });
          this.ids.set(item.key, created.body);
          this.log(`entry ${item.key}: ${created.body} created (${item.type}/${item.slug})`);
          continue;
        }
        if (created.message !== 'slug_taken') throw new Failure(`FAILED: ${item.key}: creating the entry: ${created.detail}`);
        id = await this.findBySlug(item);
        if (id === null) throw new Failure(`FAILED: ${item.key}: slug ${item.slug} is taken, but no live entry has it`);
      }
      this.ids.set(item.key, id);
      provisional.push(item);
    }
    for (const item of provisional) {
      const id = this.ids.get(item.key) as string;
      const detail = await this.detail(item.key, id);
      if (detail === null) throw new Failure(`FAILED: ${item.key}: entry ${id} is not visible`);
      const ours = isEmpty(detail.data) || sameJson(detail.data, this.dataFor(item, 'full').data) || sameJson(detail.data, this.dataFor(item, 'first').data);
      if (!ours) {
        if (item.singleton) {
          this.notice(item.key, `singleton ${item.type} (${id}) already has content that is not the manifest's`);
          continue;
        }
        throw new Failure(
          `FAILED: ${item.key}: ${item.type} entry ${id} already has slug ${item.slug} and content that is not the manifest's, and the ledger does not name it. ` +
            'The run stops rather than create a duplicate (import plan 2.3); nothing more was written',
        );
      }
      await this.ledger.set(item.key, { id, type: item.type });
      this.log(`entry ${item.key}: ${id} found${item.singleton ? ' (singleton)' : ` (${item.type}/${item.slug})`}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // 5. Order (applied here, before the drafts and the publishing: see the head of this file)

  /** The type's live entries as its list orders them: by position, then id (api.entry_list, A12). */
  private async listOrder(type: string): Promise<string[]> {
    const query = `tenant_id=eq.${this.tenantId}&type=eq.${encodeURIComponent(type)}&archived_at=is.null&select=id&order=order_position.asc,id.asc&limit=${MAX_ORDERED_ENTRIES}`;
    const body = need(await this.s.view('entry_list', query), `reading the order of ${type}`);
    if (!Array.isArray(body)) throw new Failure(`FAILED: unexpected entry_list response for the order of ${type}`);
    if (body.length >= MAX_ORDERED_ENTRIES) throw new Failure(`FAILED: type ${type} has ${MAX_ORDERED_ENTRIES} or more live entries; the import orders a type only when its whole list fits in one read`);
    return body.map((row) => {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure(`FAILED: unexpected entry_list response for the order of ${type}`);
      return id;
    });
  }

  /**
   * Every type the module orders by hand, in the manifest's order, through api.move_entry as the
   * editor's list moves an entry. Only the manifest's own entries are moved, each relative to
   * another of them; the type's other entries keep their places. A list already in order is left
   * as it is, so a re-run moves nothing. The list is read again afterwards and must be in order.
   */
  async order(): Promise<void> {
    for (const [type, keys] of Object.entries(this.plan.manualOrder)) {
      const wanted = keys.map((k) => this.ids.get(k) as string);
      const keyOf = new Map(keys.map((k) => [this.ids.get(k) as string, k]));
      const name = (id: string) => keyOf.get(id) as string;
      const current = await this.listOrder(type);
      let moves;
      try {
        moves = planMoves(current, wanted);
      } catch {
        throw new Failure(`FAILED: the list of ${type} does not hold every entry of the manifest's ${type}; nothing more was written`);
      }
      if (moves.length === 0) {
        this.log(`order ${type}: already in the manifest's order; nothing moved`);
        continue;
      }
      for (const m of moves) {
        need(await this.s.rpc('move_entry', { p_entry_id: m.entry, p_target_id: m.target, p_place: m.place }), `order ${type}: moving ${name(m.entry)} ${m.place} ${name(m.target)}`);
        this.moves += 1;
        this.log(`order ${type}: ${name(m.entry)} moved ${m.place} ${name(m.target)}`);
      }
      const after = relativeOrder(await this.listOrder(type), wanted);
      if (after.length !== wanted.length || orderDifference(wanted, after) !== null) {
        throw new Failure(`FAILED: order ${type}: after ${moves.length} move(s) the list is still not in the manifest's order (someone else moving entries meanwhile?); run again`);
      }
      this.log(`order ${type}: ${moves.length} move(s), before anything of this run is published`);
    }
  }

  /**
   * After the waves: when this run delivered no release, the public bundle may still list a
   * manually ordered type in an older order (moves made by this run, or by an earlier one that
   * stopped, while every entry was already published). A new order reaches the site only with the
   * tenant's next release (§5.1), so the run files one publish of an entry of that type that is
   * already published with the importer's own data, unchanged, and waits for its release. Nothing is
   * filed when the delivered order is already the manifest's, or when no such entry exists (the
   * report then shows the difference).
   */
  async releaseOrder(): Promise<boolean> {
    if (Object.keys(this.plan.manualOrder).length === 0 || this.lastRelease !== null) return true;
    const bundle = await readBundle(this.s, this.options.tenant);
    if (typeof bundle !== 'object') return true;
    for (const [type, keys] of Object.entries(this.plan.manualOrder)) {
      const listed: unknown[] = Object.hasOwn(bundle.entries, type) && Array.isArray(bundle.entries[type]) ? bundle.entries[type] : [];
      const delivered = listed.map((e) => (isObject(e) && typeof e.id === 'string' ? e.id : '')).filter((id) => id !== '');
      const wanted = keys.map((k) => this.ids.get(k) as string);
      if (orderDifference(wanted, delivered) === null) continue;
      for (const key of keys) {
        if (this.blocked.has(key)) continue;
        const rec = this.ledger.entry(key);
        const id = this.ids.get(key) as string;
        if (rec?.savedVersion === undefined || !delivered.includes(id)) continue;
        const detail = await this.detail(key, id);
        if (detail === null || detail.draft_version !== rec.savedVersion || detail.published_draft_version !== rec.savedVersion) continue;
        this.log(
          `order ${type}: release ${bundle.release} lists it in another order than the manifest's, and this run published nothing; ` +
            `publishing ${key} again, its data unchanged, so the next release carries the order`,
        );
        const result = await this.s.rpc('request_publish', { p_entry_id: id, p_expected_draft_version: rec.savedVersion });
        if (!result.ok && result.message === 'version_conflict') {
          this.notice(key, "its draft changed after the importer's save; not published");
          return false;
        }
        const filed = need(result, `${key}: requesting publication`);
        if (typeof filed !== 'string' || !UUID_RE.test(filed)) throw new Failure(`FAILED: ${key}: unexpected request_publish response`);
        await this.ledger.update(key, { requestId: filed, requestedVersion: rec.savedVersion });
        this.log(`publish ${key}: requested (${filed})`);
        const pass = rec.publishedPass ?? 'full';
        // One release carries every type's order: one request is enough.
        return this.waitBatch([{ item: this.plan.byKey.get(key) as PlanItem, id, requestId: filed, filedAt: this.deps.now() }], () => pass, false);
      }
      this.log(
        `order ${type}: release ${bundle.release} lists it in another order than the manifest's, and no entry of it is published with the importer's data; ` +
          'the next release the tenant publishes carries the order',
      );
    }
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // 3. Drafts

  /** Saves the item's data for `pass` unless it is there already; false when the item is left alone. */
  async saveDraft(item: PlanItem, pass: Pass): Promise<boolean> {
    if (this.blocked.has(item.key)) return false;
    const id = this.ids.get(item.key) as string;
    const rec = this.ledger.entry(item.key);
    if (rec === undefined) return false;
    // A cycle's first pass is over once its full data has been saved.
    if (pass === 'first' && rec.savedPass === 'full') return true;
    const { data, hash } = this.dataFor(item, pass);
    const detail = await this.detail(item.key, id);
    if (detail === null) throw new Failure(`FAILED: ${item.key}: entry ${id} is not visible`);
    if (sameJson(detail.data, data) && detail.schema_version === item.contentType.version) {
      if (rec.savedVersion !== detail.draft_version || rec.savedHash !== hash || rec.savedPass !== pass) {
        await this.ledger.update(item.key, { savedVersion: detail.draft_version, savedHash: hash, savedPass: pass });
      }
      return true;
    }
    if (rec.savedVersion !== undefined && detail.draft_version !== rec.savedVersion) {
      this.notice(item.key, `its draft moved past the importer's save (version ${rec.savedVersion} → ${detail.draft_version}): someone else's edit`);
      return false;
    }
    if (rec.savedVersion === undefined && !isEmpty(detail.data)) {
      this.notice(item.key, 'its draft has content the importer did not save');
      return false;
    }
    if (detail.published_draft_version !== null && !(pass === 'full' && rec.publishedPass === 'first' && rec.publishedVersion === detail.published_draft_version)) {
      this.notice(item.key, 'it is published, and the manifest differs from what was published; not republished (import decision 6)');
      return false;
    }
    const { title, sortAt } = item.contentType.queryColumns(data);
    const saved = await this.s.rpc('save_draft', {
      p_entry_id: id,
      p_expected_version: detail.draft_version,
      p_data: data,
      p_schema_version: item.contentType.version,
      p_title: title,
      p_sort_at: sortAt,
    });
    if (!saved.ok && saved.message === 'version_conflict') {
      this.notice(item.key, 'its draft changed while the importer was saving it: someone else\'s edit');
      return false;
    }
    const version = need(saved, `${item.key}: saving the draft`);
    if (!Number.isSafeInteger(version)) throw new Failure(`FAILED: ${item.key}: unexpected save_draft response`);
    await this.ledger.update(item.key, { savedVersion: version as number, savedHash: hash, savedPass: pass });
    this.log(`draft ${item.key}: version ${String(version)}${pass === 'first' ? ' (first pass)' : ''}`);
    return true;
  }

  async drafts(): Promise<void> {
    for (const item of this.plan.items) await this.saveDraft(item, this.pass(item));
  }

  // -------------------------------------------------------------------------------------------
  // 4. Publish

  private async statuses(entryIds: string[]): Promise<Map<string, StatusRow>> {
    const body = need(
      await this.s.view(
        'publication_status',
        `entry_id=in.(${entryIds.join(',')})&select=request_id,entry_id,status,error,release_number,release_status,retries_exhausted,omitted`,
      ),
      'reading publication_status',
    );
    if (!Array.isArray(body)) throw new Failure('FAILED: unexpected publication_status response');
    return new Map((body as StatusRow[]).map((r) => [r.entry_id, r]));
  }

  /** Publishes the wave's items in batches; false when any item of the wave is not published. */
  async publishWave(keys: string[], pass: (item: PlanItem) => Pass, label: string): Promise<boolean | 'first-batch'> {
    const todo: { item: PlanItem; id: string; requestId: string; filedAt: number }[] = [];
    let allPublished = true;
    for (const key of keys) {
      const item = this.plan.byKey.get(key) as PlanItem;
      const p = pass(item);
      if (!(await this.saveDraft(item, p))) {
        allPublished = false;
        continue;
      }
      const rec = this.ledger.entry(key);
      const id = this.ids.get(key) as string;
      const detail = await this.detail(key, id);
      if (rec === undefined || detail === null || rec.savedVersion === undefined) {
        allPublished = false;
        continue;
      }
      if (detail.published_draft_version === rec.savedVersion) {
        if (rec.publishedVersion !== rec.savedVersion) await this.ledger.update(key, { publishedVersion: rec.savedVersion, publishedPass: p });
        for (const f of item.files) this.publishedFiles.add(f);
        continue;
      }
      // 2.4: the slug and the draft must still be the importer's at the moment of the request.
      if (detail.draft_version !== rec.savedVersion || (!item.singleton && detail.slug !== item.slug)) {
        this.notice(key, `its ${detail.draft_version !== rec.savedVersion ? 'draft' : `slug (now ${String(detail.slug)})`} changed after the importer's save; not published`);
        allPublished = false;
        continue;
      }
      const latest = (await this.statuses([id])).get(id);
      if (rec.requestId !== undefined && rec.requestedVersion === rec.savedVersion && latest?.request_id === rec.requestId) {
        if (latest.status === 'failed_validation' && rec.failedHash === rec.savedHash) {
          this.notice(key, `its publish failed validation (${errorSummary(latest.error)}); not retried until the manifest changes`);
          allPublished = false;
          continue;
        }
      }
      // A request still in flight is waited for, not filed again: one whose answer was lost before the
      // ledger recorded it included. The draft is the importer's (checked above), and the worker
      // publishes only the draft version a request names, so whoever filed it, it publishes this data.
      if (latest !== undefined && (OPEN_STATUSES.has(latest.status) || (latest.status === 'committed' && latest.release_status !== 'delivered' && latest.retries_exhausted !== true))) {
        if (rec.requestId !== latest.request_id) await this.ledger.update(key, { requestId: latest.request_id, requestedVersion: rec.savedVersion });
        todo.push({ item, id, requestId: latest.request_id, filedAt: this.deps.now() });
        continue;
      }
      todo.push({ item, id, requestId: '', filedAt: 0 });
    }

    const size = this.options.batchSize;
    for (let start = 0; start < todo.length; start += size) {
      const batch = todo.slice(start, start + size);
      for (const b of batch) {
        if (b.requestId !== '') continue;
        const rec = this.ledger.entry(b.item.key);
        const result = await this.s.rpc('request_publish', { p_entry_id: b.id, p_expected_draft_version: rec?.savedVersion });
        if (!result.ok && result.message === 'version_conflict') {
          this.notice(b.item.key, 'its draft changed after the importer\'s save; not published');
          b.requestId = 'none';
          continue;
        }
        const filed = need(result, `${b.item.key}: requesting publication`);
        if (typeof filed !== 'string' || !UUID_RE.test(filed)) throw new Failure(`FAILED: ${b.item.key}: unexpected request_publish response`);
        b.requestId = filed;
        b.filedAt = this.deps.now();
        await this.ledger.update(b.item.key, { requestId: filed, requestedVersion: rec?.savedVersion as number });
        this.log(`publish ${b.item.key}: requested (${filed})`);
      }
      const filed = batch.filter((b) => b.requestId !== 'none');
      if (filed.length < batch.length) allPublished = false;
      if (filed.length === 0) continue;
      const measure = !this.firstBatchMeasured;
      this.firstBatchMeasured = true;
      const ok = await this.waitBatch(filed, pass, measure);
      if (!ok) allPublished = false;
      if (measure && this.options.firstBatchOnly) return 'first-batch';
    }
    if (!allPublished) this.log(`${label}: not every item was published; the run stops before the next wave`);
    return allPublished;
  }

  private async waitBatch(batch: { item: PlanItem; id: string; requestId: string; filedAt: number }[], pass: (item: PlanItem) => Pass, measure: boolean): Promise<boolean> {
    const started = this.deps.now();
    const times = new Map<string, { committed?: number; built?: number; delivered?: number; release?: number }>();
    const done = new Map<string, boolean>();
    let signature = '';
    let changedAt = started;
    while (done.size < batch.length) {
      await this.deps.sleep(POLL_MS);
      const rows = await this.statuses(batch.map((b) => b.id));
      const now = this.deps.now();
      for (const b of batch) {
        if (done.has(b.item.key)) continue;
        const row = rows.get(b.id);
        const t = times.get(b.item.key) ?? {};
        times.set(b.item.key, t);
        if (row === undefined) continue;
        if (row.request_id !== b.requestId) {
          this.notice(b.item.key, 'someone else requested a publish or withdrawal of it meanwhile');
          done.set(b.item.key, false);
          continue;
        }
        if (row.status === 'committed' && t.committed === undefined) t.committed = now;
        if (row.release_number !== null && t.built === undefined) {
          t.built = now;
          t.release = row.release_number;
        }
        if (row.status === 'committed' && row.release_status === 'delivered' && row.omitted !== true) {
          t.delivered = now;
          done.set(b.item.key, true);
          if (row.release_number !== null) this.lastRelease = Math.max(this.lastRelease ?? 0, row.release_number);
          const rec = this.ledger.entry(b.item.key);
          await this.ledger.update(b.item.key, { publishedVersion: rec?.requestedVersion as number, publishedPass: pass(b.item) });
          this.log(`publish ${b.item.key}: delivered in release ${String(row.release_number)}`);
        } else if (FAILED_STATUSES.has(row.status) || row.omitted === true || (row.release_status === 'failed' && row.retries_exhausted === true)) {
          done.set(b.item.key, false);
          if (row.status === 'failed_validation') await this.ledger.update(b.item.key, { failedHash: this.ledger.entry(b.item.key)?.savedHash as string });
          const why = row.status === 'committed' ? (row.omitted === true ? 'left out of its release' : `its release ${String(row.release_number)} failed`) : `${row.status}: ${errorSummary(row.error)}`;
          this.notice(b.item.key, `publish failed (${why})`);
        }
      }
      const next = JSON.stringify([...rows.values()].map((r) => [r.request_id, r.status, r.release_number, r.release_status]));
      if (next !== signature) {
        signature = next;
        changedAt = now;
      } else if (now - changedAt >= STALL_MS && done.size < batch.length) {
        throw new Failure(`FAILED: no progress on the publish queue for ${STALL_MS / 60_000} minutes: the sweep may have stopped (B11). Run again to resume`);
      }
    }
    if (measure) {
      const newFiles = new Set(batch.flatMap((b) => b.item.files).filter((f) => !this.publishedFiles.has(f)));
      const bytes = [...newFiles].reduce((n, f) => n + (this.plan.files.get(f)?.bytes ?? 0), 0);
      this.log(`first batch: ${batch.length} request(s), ${newFiles.size} new image(s), ${bytes} bytes (polled every ${POLL_MS / 1000}s):`);
      for (const b of batch) {
        const t = times.get(b.item.key) ?? {};
        const at = (x: number | undefined) => (x === undefined ? '-' : `+${seconds(x - b.filedAt)}`);
        this.log(`  ${b.item.key}: requested +0s, committed ${at(t.committed)}, release ${t.release ?? '-'} built ${at(t.built)}, delivered ${at(t.delivered)}`);
      }
    }
    for (const b of batch) if (done.get(b.item.key) === true) for (const f of b.item.files) this.publishedFiles.add(f);
    return [...done.values()].every((v) => v);
  }

  /** Steps 1 to 5, the order straight after the entries; stops at the first failure, which the caller reports. */
  async run(): Promise<RunOutcome> {
    const outcome = (stopped: string | null, firstBatchStop = false): RunOutcome => ({
      stopped,
      firstBatchStop,
      lastRelease: this.lastRelease,
      notices: this.notices,
      thumbnailsMade: this.thumbnailsMade,
      thumbnailsMissing: this.thumbnailsMissing,
      moves: this.moves,
      ids: this.ids,
    });
    await this.checkLedger();
    await this.files();
    await this.entries();
    await this.order();
    await this.drafts();
    const firstPass = (item: PlanItem) => this.pass(item);
    for (const [i, wave] of this.plan.waves.entries()) {
      const result = await this.publishWave(wave, firstPass, `wave ${i + 1}`);
      if (result === 'first-batch') return outcome(null, true);
      if (!result) return outcome(`wave ${i + 1} was not fully published`);
    }
    if (this.plan.secondPass.length > 0) {
      const result = await this.publishWave(this.plan.secondPass, () => 'full', 'second pass');
      if (result === 'first-batch') return outcome(null, true);
      if (!result) return outcome('the second pass was not fully published');
    }
    if (!(await this.releaseOrder())) return outcome('the release that carries the order was not delivered');
    return outcome(null);
  }
}
