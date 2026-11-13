// An in-memory stand-in for the Hub's editor API, as the import sees it over HTTP: Auth's password
// and refresh grants, the `api` views and functions an editor calls, Storage, and a sweep that
// commits requests (three per run, as the real sweep claims per tenant) and delivers a bundle. It
// is a test double, not a model of every rule: it keeps the ones the importer relies on. Manual
// order (A12) as the migration has it: an unmoved entry's position is minus its creation, so the
// newest comes first; api.move_entry writes a key between the new neighbours; the bundle lists a
// manually ordered type by position.
import { createHash, randomUUID } from 'node:crypto';
import { isManuallyOrdered, projectEntry, type ModuleManifest, type ProjectionContext } from '@litljomi/cms-schema';

export const REF = 'acmetestref000000000';
export const ORIGIN = `https://${REF}.supabase.co`;
export const PUBLISHABLE = 'sb_publishable_TESTONLY';
export const EMAIL = 'editor@example.test';
export const PASSWORD = 'TestOnly-password-0123';
export const TENANT_ID = '0a0a0a0a-0000-4000-8000-000000000001';
export const SLUG = 'acme';
/** A tenant the editor is also a member of (decision 4: an operator's own membership in several). */
export const OTHER_TENANT_ID = '0a0a0a0a-0000-4000-8000-000000000009';

interface Entry {
  id: string;
  type: string;
  slug: string | null;
  singleton: boolean;
  archived: boolean;
  data: Record<string, unknown>;
  schema_version: number;
  draft_version: number;
  published_draft_version: number | null;
  first_published_at: string | null;
  published: { data: Record<string, unknown>; title: string | null; sortAt: string | null } | null;
  title: string | null;
  sort_at: string | null;
  /** Creation, in sequence; an unmoved entry's position is minus it. */
  created: number;
  order_key: number | null;
}

interface Request {
  id: string;
  entry_id: string;
  draft_version: number;
  status: string;
  error: unknown;
  release_number: number | null;
  release_status: string | null;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const pgError = (message: string, code = 'P0001', status = 400) => json(status, { code, message });
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

export class FakeHub {
  calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  readonly objects = new Map<string, Uint8Array>();
  readonly assets = new Map<string, Record<string, unknown>>();
  readonly entries = new Map<string, Entry>();
  readonly requests: Request[] = [];
  release = 0;
  clock = Date.UTC(2026, 10, 12, 12, 0, 0);
  tokenSeconds = 3600;
  l1 = true;
  factors: unknown[] = [];
  member = true;
  tenantStatus = 'active';
  /** Commits nothing while true: a stopped sweep. */
  sweepStopped = false;
  /** Count of calls after which every call fails as if the process had died. */
  killAfter: number | null = null;
  killed = false;
  /** Run before each call is handled, by call number (a concurrent editor, for instance). */
  before: (n: number, method: string, path: string) => void = () => {};
  /** Replaces a delivered object's bytes (a changed byte on the public side). */
  tamperPublic: ((path: string, bytes: Uint8Array) => Uint8Array) | null = null;
  /** Lists manually ordered types in reverse in every bundle: a delivery that loses the order. */
  reverseDelivered = false;
  private created = 0;
  /** Rewrites entry_detail_by_id's answer: an entry the server places in another tenant, or another type. */
  rewriteDetail: ((detail: ReturnType<FakeHub['detailOf']>) => Record<string, unknown>) | null = null;
  private tokens = new Map<string, number>();
  private refresh = new Set<string>();
  readonly userId = '0b0b0b0b-0000-4000-8000-000000000002';

  constructor(private readonly module: ModuleManifest) {}

  fetch = async (url: string, init: RequestInit): Promise<Response> => {
    if (this.killed) throw Object.assign(new Error('killed'), { cause: { code: 'ECONNREFUSED' } });
    const u = new URL(url);
    if (u.origin !== ORIGIN) throw new Error(`request outside the target: ${u.origin}`);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = init.body;
    if (typeof init.body === 'string' && (headers['content-type'] ?? '').includes('json')) body = JSON.parse(init.body);
    const n = this.calls.length + 1;
    this.before(n, init.method ?? 'GET', u.pathname);
    this.calls.push({ method: init.method ?? 'GET', path: u.pathname + u.search, headers, body });
    const response = this.handle(init.method ?? 'GET', u, headers, body);
    if (this.killAfter !== null && n >= this.killAfter) {
      this.killed = true;
      throw Object.assign(new Error('killed'), { cause: { code: 'ECONNRESET' } });
    }
    return response;
  };

  private user(headers: Record<string, string>): string | null {
    if (headers.apikey !== PUBLISHABLE) return null;
    const token = (headers.authorization ?? '').replace(/^Bearer /, '');
    const exp = this.tokens.get(token);
    return exp !== undefined && exp > this.clock ? this.userId : null;
  }

  private issue() {
    const access = `access-${randomUUID()}`;
    const refresh = `refresh-${randomUUID()}`;
    this.tokens.set(access, this.clock + this.tokenSeconds * 1000);
    this.refresh.add(refresh);
    return { access_token: access, refresh_token: refresh, expires_in: this.tokenSeconds, expires_at: Math.floor(this.clock / 1000) + this.tokenSeconds, user: { id: this.userId, factors: this.factors } };
  }

  private handle(method: string, u: URL, headers: Record<string, string>, body: unknown): Response {
    const p = u.pathname;
    if (p === '/auth/v1/token') {
      if (headers.apikey !== PUBLISHABLE) return json(401, { msg: 'no apikey' });
      const b = body as Record<string, string>;
      if (u.searchParams.get('grant_type') === 'password') {
        if (b.email !== EMAIL || b.password !== PASSWORD) return json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        return json(200, this.issue());
      }
      if (u.searchParams.get('grant_type') === 'refresh_token' && this.refresh.delete(b.refresh_token as string)) return json(200, this.issue());
      return json(400, { error_code: 'refresh_token_not_found', msg: 'bad refresh' });
    }
    if (p.startsWith('/storage/v1/object/public/')) return this.publicObject(p.slice('/storage/v1/object/public/'.length));
    const user = this.user(headers);
    if (user === null) return json(401, { code: 'PGRST301', message: 'JWT expired or missing' });
    if (p.startsWith('/storage/v1/object/authenticated/')) {
      const key = decodeURIComponent(p.slice('/storage/v1/object/authenticated/'.length));
      const obj = this.objects.get(key);
      return obj === undefined ? json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' }) : new Response(new Uint8Array(obj), { status: 200 });
    }
    if (p.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(p.slice('/storage/v1/object/'.length));
      if (!key.startsWith(`media-private/${TENANT_ID}/`) || !this.member) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      if (headers['x-upsert'] !== 'false') return json(400, { message: 'importer must not upsert' });
      if (this.objects.has(key)) return json(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      this.objects.set(key, new Uint8Array(body as Uint8Array));
      return json(200, { Key: key });
    }
    if (p.startsWith('/rest/v1/rpc/')) return this.rpc(p.slice('/rest/v1/rpc/'.length), body as Record<string, unknown>);
    if (method === 'GET' && p.startsWith('/rest/v1/')) return this.view(p.slice('/rest/v1/'.length), u.searchParams);
    return json(404, { message: 'no route' });
  }

  private publicObject(key: string): Response {
    const obj = this.objects.get(`public/${decodeURIComponent(key)}`);
    if (obj === undefined) return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const bytes = this.tamperPublic ? this.tamperPublic(key, obj) : obj;
    return new Response(new Uint8Array(bytes), { status: 200 });
  }

  private view(name: string, q: URLSearchParams): Response {
    const eq = (k: string) => q.get(k)?.replace(/^eq\./, '');
    if (name === 'my_tenants') return json(200, this.member && eq('slug') === SLUG ? [{ id: TENANT_ID, slug: SLUG, status: this.tenantStatus }] : []);
    if (name === 'asset_list') {
      const row = this.assets.get(eq('id') ?? '');
      if (!this.l1) return json(400, { code: '42703', message: 'column asset_list.caption does not exist' });
      return json(200, row === undefined ? [] : [{ ...row }]);
    }
    if (name === 'entry_list') {
      if (q.get('order') !== null) {
        // The importer's read of a type's order: live entries by position, then id.
        if (eq('tenant_id') !== TENANT_ID || q.get('archived_at') !== 'is.null' || q.get('order') !== 'order_position.asc,id.asc') return json(400, { message: 'unexpected order query' });
        return json(200, this.listed(decodeURIComponent(eq('type') ?? '')).map((e) => ({ id: e.id })));
      }
      const rows = [...this.entries.values()].filter((e) => !e.archived && e.type === eq('type') && e.slug === decodeURIComponent(eq('slug') ?? ''));
      return json(200, rows.map((e) => ({ id: e.id })));
    }
    if (name === 'publication_status') {
      const ids = (q.get('entry_id') ?? '').replace(/^in\.\(|\)$/g, '').split(',');
      const latest = new Map<string, Request>();
      for (const r of this.requests) if (ids.includes(r.entry_id)) latest.set(r.entry_id, r);
      return json(200, [...latest.values()].map((r) => ({ request_id: r.id, entry_id: r.entry_id, status: r.status, error: r.error, release_number: r.release_number, release_status: r.release_status, retries_exhausted: false, omitted: false })));
    }
    return json(404, { code: 'PGRST205', message: 'no such view' });
  }

  position(e: Entry): number {
    return e.order_key ?? -e.created;
  }

  /** A type's live entries in list order (api.entry_list's order_position, then id). */
  listed(type: string): Entry[] {
    return [...this.entries.values()].filter((e) => e.type === type && !e.archived).sort((a, b) => this.position(a) - this.position(b) || (a.id < b.id ? -1 : 1));
  }

  /** Entry ids of a type in list order. */
  order(type: string): string[] {
    return this.listed(type).map((e) => e.id);
  }

  /** As an earlier import that set no order: every key cleared, so the list is newest first again. */
  clearOrder(type: string): void {
    for (const e of this.entries.values()) if (e.type === type) e.order_key = null;
  }

  private status(e: Entry): string {
    if (e.archived) return 'archived';
    if (e.published_draft_version === null) return 'draft';
    return e.draft_version === e.published_draft_version ? 'published' : 'changed';
  }

  detailOf(e: Entry) {
    return {
      id: e.id,
      tenant_id: TENANT_ID,
      type: e.type,
      slug: e.slug,
      schema_version: e.schema_version,
      draft_version: e.draft_version,
      published_draft_version: e.published_draft_version,
      first_published_at: e.first_published_at,
      status: this.status(e),
      data: structuredClone(e.data),
    };
  }

  private newEntry(type: string, slug: string | null, singleton: boolean, version: number): Entry {
    const e: Entry = {
      id: randomUUID(),
      type,
      slug,
      singleton,
      archived: false,
      data: {},
      schema_version: version,
      draft_version: 1,
      published_draft_version: null,
      first_published_at: null,
      published: null,
      title: null,
      sort_at: null,
      created: ++this.created,
      order_key: null,
    };
    this.entries.set(e.id, e);
    return e;
  }

  private rpc(name: string, a: Record<string, unknown>): Response {
    switch (name) {
      case 'asset_summary':
        return this.l1 ? json(200, { files: this.assets.size }) : json(404, { code: 'PGRST202', message: 'Could not find the function api.asset_summary' });
      case 'register_asset': {
        if (a.p_tenant_id !== TENANT_ID || a.p_original_path !== `${TENANT_ID}/${String(a.p_asset_id)}/${String(a.p_filename)}`) return pgError('forbidden');
        if (this.assets.has(a.p_asset_id as string)) return pgError('duplicate key value violates unique constraint "assets_pkey"', '23505', 409);
        const stored = this.objects.get(`media-private/${String(a.p_original_path)}`);
        if (stored === undefined || sha(stored) !== a.p_sha256) return pgError('asset_mismatch');
        this.assets.set(a.p_asset_id as string, {
          id: a.p_asset_id,
          original_path: a.p_original_path,
          filename: a.p_filename,
          mime: a.p_mime,
          width: a.p_width,
          height: a.p_height,
          default_alt: null,
          caption: null,
          credit: null,
          thumb_path: null,
          archived_at: null,
        });
        return json(200, a.p_asset_id);
      }
      case 'update_asset_text': {
        const row = this.assets.get(a.p_asset_id as string);
        if (row === undefined) return pgError('not_found');
        Object.assign(row, { default_alt: a.p_default_alt, caption: a.p_caption, credit: a.p_credit });
        return json(200, null);
      }
      case 'set_asset_thumbnail': {
        const row = this.assets.get(a.p_asset_id as string);
        if (row === undefined || !this.objects.has(`media-private/${String(a.p_thumb_path)}`)) return pgError('not_found');
        // Only the file's own thumbnail path, as the database's check has it.
        if (a.p_thumb_path !== `${TENANT_ID}/${String(a.p_asset_id)}/thumb/480.webp`) return pgError('new row violates check constraint "assets_thumb_path_check"', '23514');
        row.thumb_path = a.p_thumb_path;
        return json(200, null);
      }
      case 'create_entry': {
        if (a.p_tenant_id !== TENANT_ID) return pgError('not_found');
        if ([...this.entries.values()].some((e) => !e.archived && e.type === a.p_type && e.slug === a.p_slug)) return pgError('slug_taken');
        if ([...this.entries.values()].some((e) => e.type === a.p_type && e.singleton)) return pgError('singleton_mismatch');
        return json(200, this.newEntry(a.p_type as string, (a.p_slug as string | null) ?? null, false, a.p_schema_version as number).id);
      }
      case 'create_singleton_entry': {
        const live = [...this.entries.values()].find((e) => e.type === a.p_type && e.singleton && !e.archived);
        return json(200, (live ?? this.newEntry(a.p_type as string, null, true, a.p_schema_version as number)).id);
      }
      case 'entry_detail_by_id': {
        const e = this.entries.get(a.p_entry_id as string);
        if (e === undefined) return json(200, null);
        return json(200, this.rewriteDetail ? this.rewriteDetail(this.detailOf(e)) : this.detailOf(e));
      }
      case 'save_draft': {
        const e = this.entries.get(a.p_entry_id as string);
        if (e === undefined) return pgError('not_found');
        if (e.draft_version !== a.p_expected_version) return pgError('version_conflict');
        e.data = structuredClone(a.p_data as Record<string, unknown>);
        e.schema_version = a.p_schema_version as number;
        e.title = (a.p_title as string | null) ?? null;
        e.sort_at = (a.p_sort_at as string | null) ?? null;
        e.draft_version += 1;
        return json(200, e.draft_version);
      }
      case 'set_slug': {
        const e = this.entries.get(a.p_entry_id as string);
        if (e === undefined) return pgError('not_found');
        if (e.first_published_at !== null) return pgError('slug_locked');
        e.slug = a.p_slug as string;
        return json(200, null);
      }
      case 'move_entry': {
        const e = this.entries.get(a.p_entry_id as string);
        const t = this.entries.get(a.p_target_id as string);
        if (a.p_place !== 'before' && a.p_place !== 'after') return pgError('p_place must be before or after', '22023');
        if (e === undefined || t === undefined) return pgError('not_found');
        if (e.type !== t.type || e.id === t.id || e.archived || t.archived) return pgError('forbidden');
        const others = this.listed(e.type).filter((x) => x.id !== e.id);
        const i = others.findIndex((x) => x.id === t.id);
        const before = a.p_place === 'before';
        const lo = before ? (i > 0 ? this.position(others[i - 1] as Entry) : Math.min(-this.created - 1, this.position(t)) - 1) : this.position(t);
        const hi = before ? this.position(t) : i < others.length - 1 ? this.position(others[i + 1] as Entry) : this.position(t) + 1;
        const at = this.position(e);
        if (at > lo && at < hi) return json(200, null);
        e.order_key = (lo + hi) / 2;
        return json(200, null);
      }
      case 'request_publish': {
        const e = this.entries.get(a.p_entry_id as string);
        if (e === undefined) return pgError('not_found');
        if (this.tenantStatus !== 'active') return pgError('tenant_inactive');
        if (a.p_expected_draft_version !== e.draft_version) return pgError('version_conflict');
        const r: Request = { id: randomUUID(), entry_id: e.id, draft_version: e.draft_version, status: 'pending', error: null, release_number: null, release_status: null };
        this.requests.push(r);
        return json(200, r.id);
      }
      default:
        return json(404, { code: 'PGRST202', message: `Could not find the function api.${name}` });
    }
  }

  /** An entry with an empty draft, made outside the importer: for a planted ledger. */
  plantEntry(type: string, slug: string | null, singleton = false): string {
    return this.newEntry(type, slug, singleton, 1).id;
  }

  /** An entry an editor made and published, outside the manifest. */
  publishedExtra(type: string, slug: string, data: Record<string, unknown>): string {
    const e = this.newEntry(type, slug, false, 1);
    e.data = data;
    e.draft_version = 2;
    this.requests.push({ id: randomUUID(), entry_id: e.id, draft_version: 2, status: 'pending', error: null, release_number: null, release_status: null });
    this.sweep();
    return e.id;
  }

  /** An editor's save through the app: the data, then the slug re-derived as auto-slug does. */
  editorSave(id: string, change: (data: Record<string, unknown>) => void, newSlug?: string): void {
    const e = this.entries.get(id) as Entry;
    change(e.data);
    e.draft_version += 1;
    if (newSlug !== undefined && e.first_published_at === null) e.slug = newSlug;
  }

  /** One run of the sweep: commits up to three pending requests, then builds and delivers one release. */
  sweep(): void {
    if (this.sweepStopped) return;
    const claimed = this.requests.filter((r) => r.status === 'pending').slice(0, 3);
    if (claimed.length === 0) return;
    const committed: Request[] = [];
    for (const r of claimed) {
      const e = this.entries.get(r.entry_id) as Entry;
      const type = this.module.types.find((t) => t.name === e.type);
      if (e.draft_version !== r.draft_version) {
        r.status = 'superseded';
        continue;
      }
      const parsed = type?.publishValidator().safeParse(e.data);
      if (type === undefined || !parsed?.success) {
        r.status = 'failed_validation';
        r.error = { code: 'invalid_data', issues: parsed?.success === false ? parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) : [] };
        continue;
      }
      // Every entry reference must already be published (spec §6.2 step 5), or be this entry itself.
      const refs = JSON.stringify(e.data).match(/"_ref":"([0-9a-f-]{36})","_kind":"entry"/g) ?? [];
      const unpublished = refs.map((m) => m.slice(8, 44)).filter((id) => id !== e.id && this.entries.get(id)?.published === null);
      if (unpublished.length > 0) {
        r.status = 'rejected';
        r.error = { code: 'reference_unpublished' };
        continue;
      }
      const q = type.queryColumns(e.data);
      e.published = { data: structuredClone(e.data), title: q.title, sortAt: q.sortAt };
      e.published_draft_version = e.draft_version;
      e.first_published_at ??= new Date(this.clock).toISOString();
      r.status = 'committed';
      committed.push(r);
    }
    if (committed.length === 0) return;
    this.release += 1;
    for (const r of committed) {
      r.release_number = this.release;
      r.release_status = 'delivered';
    }
    this.deliver();
  }

  private deliver(): void {
    const published = [...this.entries.values()].filter((e) => e.published !== null && !e.archived);
    const ctx: ProjectionContext = {
      entry: (id) => {
        const e = published.find((x) => x.id === id);
        if (e === undefined) return null;
        const integration = this.module.site[e.type];
        return { id: e.id, type: e.type, slug: e.slug, title: e.published?.title ?? null, path: integration?.path ? integration.path({ id: e.id, type: e.type, slug: e.slug, sortAt: e.published?.sortAt ?? null }) : null };
      },
      asset: (id) => {
        const a = this.assets.get(id);
        if (a === undefined) return null;
        const publicPath = `media-public/${String(a.original_path)}`;
        this.objects.set(`public/${publicPath}`, this.objects.get(`media-private/${String(a.original_path)}`) as Uint8Array);
        return { id, url: `${ORIGIN}/storage/v1/object/public/${publicPath}`, width: a.width as number, height: a.height as number, mime: a.mime as string, alt: (a.default_alt as string | null) ?? '', focal: null, caption: (a.caption as string | null) ?? null, credit: (a.credit as string | null) ?? null };
      },
    };
    const entries: Record<string, unknown[]> = {};
    for (const e of published) {
      const type = this.module.types.find((t) => t.name === e.type);
      if (type === undefined) continue;
      (entries[e.type] ??= []).push({ id: e.id, slug: e.slug, title: e.published?.title, sortAt: e.published?.sortAt, data: projectEntry(type, e.published?.data, ctx) });
    }
    // A manually ordered type in list order (the snapshot's order_rank); reversed when asked.
    for (const t of this.module.types) {
      const list = entries[t.name];
      if (!isManuallyOrdered(t) || list === undefined) continue;
      const rank = new Map(this.order(t.name).map((id, i) => [id, i]));
      list.sort((a, b) => (rank.get((a as { id: string }).id) ?? 0) - (rank.get((b as { id: string }).id) ?? 0));
      if (this.reverseDelivered) list.reverse();
    }
    const bundle = { format: 1, tenant: SLUG, release: this.release, generatedAt: new Date(this.clock).toISOString(), entries };
    this.objects.set(`public/delivery/${SLUG}/releases/${this.release}.json`, new TextEncoder().encode(JSON.stringify(bundle)));
    this.objects.set(
      `public/delivery/${SLUG}/current.json`,
      new TextEncoder().encode(JSON.stringify({ format: 1, tenant: SLUG, release: this.release, bundle: `releases/${this.release}.json`, generatedAt: bundle.generatedAt })),
    );
  }

  /** A new release of what is published, with no request: as another publish of the tenant would build. */
  redeliver(): void {
    this.release += 1;
    this.deliver();
  }

  /** The ids of a type in the order release `n` lists them. */
  deliveredOrder(n: number, type: string): string[] {
    const bundle = JSON.parse(new TextDecoder().decode(this.objects.get(`public/delivery/${SLUG}/releases/${n}.json`))) as { entries: Record<string, { id: string }[]> };
    return (bundle.entries[type] ?? []).map((e) => e.id);
  }

  /** Replaces a string in the delivered bundle (a changed word on the public side). */
  tamperBundle(from: string, to: string): void {
    const key = `public/delivery/${SLUG}/releases/${this.release}.json`;
    const text = new TextDecoder().decode(this.objects.get(key));
    this.objects.set(key, new TextEncoder().encode(text.split(from).join(to)));
  }

  count(method: string, path: string): number {
    return this.calls.filter((c) => c.method === method && c.path.startsWith(path)).length;
  }
}
