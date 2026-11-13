// Media library L1 over real HTTP (docs/plans/media-library.md sections 4 and 8;
// 20261112200000_media_library.sql; spec §4.5, §4.6, §5.6). Editors act through PostgREST and the
// Storage API with their own sessions, so RLS on the security_invoker views and the storage
// policies are what keep a tenant's files, usage, counts and thumbnails to its members. The search
// uses the CMS's own pattern builder (entry-list-filter.ts), which the library page will reuse.
// 117_media_library.test.sql pins the catalog and the full persona matrix.
//
// The local database keeps earlier runs' rows, so every file name and text carries a per-run token
// and counts are compared as differences. Nothing is left published: the entries this file
// publishes are withdrawn again, because a later release build copies every published file's
// original, and these files have none.
import { randomBytes, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { titlePattern } from '../../../apps/cms/src/editor/entry-list-filter.ts';
import { anonClient, authHeaders, editorClient, secretClient } from './clients.ts';
import { env } from './env.ts';
import { PERSONAS, TENANT, type PersonaName } from './fixtures.ts';
import { closeAll, closeClient, expectBlocked, ownerQuery, pgAs, withTx } from './sql.ts';

type Editor = Extract<PersonaName, 'editor_labak' | 'editor_demo'>;
const OTHERS = ['editor_demo', 'outsider', 'revoked', 'platform_admin'] as const;

const token = randomBytes(4).toString('hex');
// A few bytes with a RIFF/WEBP signature; Storage checks the declared type, not the pixels.
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x0c, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, 0, 0, 0, 0]);

const one = async <T>(c: pg.Client, text: string, params: unknown[] = []): Promise<T> => {
  const { rows } = await c.query(text, params);
  return Object.values(rows[0] as Record<string, unknown>)[0] as T;
};

const rest = async (persona: PersonaName | 'anon', path: string, init: RequestInit = {}) => {
  const response = await fetch(`${env.apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...(await authHeaders(persona)), 'content-type': 'application/json', ...init.headers },
  });
  return { status: response.status, body: (await response.json()) as any };
};

const rpc = async (persona: PersonaName, fn: string, args: Record<string, unknown>) => {
  const { data, error } = await (await editorClient(persona)).schema('api').rpc(fn, args);
  return { data, error: error ? { code: error.code, message: error.message } : null };
};
const NOT_FOUND = { code: 'P0001', message: 'not_found' };
const FORBIDDEN = { code: 'P0001', message: 'forbidden' };

const thumbPath = (tenantId: string, assetId: string, size = 480) => `${tenantId}/${assetId}/thumb/${size}.webp`;

/** Registers a file of the editor's tenant the way the upload action does, and returns its id. */
async function register(as: Editor, name: string, bytes = 1000): Promise<string> {
  const tenantId = as === 'editor_labak' ? TENANT.labak : TENANT.demo;
  const id = randomUUID();
  const filename = `${name}-${token}.jpg`;
  const { error } = await rpc(as, 'register_asset', {
    p_asset_id: id,
    p_tenant_id: tenantId,
    p_original_path: `${tenantId}/${id}/${filename}`,
    p_filename: filename,
    p_mime: 'image/jpeg',
    p_bytes: bytes,
    p_width: 800,
    p_height: 600,
    p_sha256: 'a'.repeat(64),
  });
  if (error) throw new Error(`register_asset: ${error.code} ${error.message}`);
  return id;
}

const texts = async (as: Editor, id: string, alt: string | null, caption: string | null, credit: string | null) => {
  const { error } = await rpc(as, 'update_asset_text', { p_asset_id: id, p_default_alt: alt, p_caption: caption, p_credit: credit });
  if (error) throw new Error(`update_asset_text: ${error.code} ${error.message}`);
};

const refs = (...assetIds: string[]) => ({ gallery: assetIds.map((id) => ({ _ref: id, _kind: 'asset', alt: '' })) });

/** A labak news entry; `save` writes its draft at the next version. */
async function entry(title: string) {
  const id = await withTx('editor_labak', (e) => one<string>(e, `select api.create_entry($1, 'news')`, [TENANT.labak]));
  let version = 1;
  const save = async (data: Record<string, unknown>) => {
    version = await withTx('editor_labak', (e) =>
      one<number>(e, 'select api.save_draft($1, $2, $3, 1, $4, null)', [id, version, { title, ...data }, title]),
    );
  };
  const commit = async (request: string, sql: string, params: unknown[]) => {
    // Claims every pending request, leftovers of earlier runs included, as entry-list-filter does.
    await withTx('service', (w) => w.query('select api.worker_claim_requests(1000)'));
    expect(await withTx('service', (w) => one<string>(w, sql, [request, ...params]))).toBe('committed');
  };
  const publish = async () => {
    const request = await withTx('editor_labak', (e) => one<string>(e, 'select api.request_publish($1, $2)', [id, version]));
    await commit(request, `select api.worker_commit_publish($1, $2, 1, $3, now())`, [version, title]);
  };
  const unpublish = async () => {
    const request = await withTx('editor_labak', (e) => one<string>(e, 'select api.request_unpublish($1)', [id]));
    await commit(request, 'select api.worker_commit_unpublish($1)', []);
  };
  const archive = () => withTx('editor_labak', (e) => e.query('select api.archive_entry($1)', [id]));
  return { id, title, save, publish, unpublish, archive };
}

type ListRow = { id: string; in_use: boolean; missing_alt: boolean; kind: string };
type UsageRow = { asset_id: string; entry_id: string; type: string; title: string; in_draft: boolean; in_published: boolean };

/** The persona's asset_list rows for the ids. No tenant filter: RLS alone scopes it. */
const listed = async (as: PersonaName, ids: string[]): Promise<ListRow[]> => {
  const { data, error } = await (await editorClient(as)).schema('api').from('asset_list')
    .select('id, in_use, missing_alt, kind').in('id', ids).order('id');
  expect(error).toBeNull();
  return data as ListRow[];
};
const inUse = async (ids: Record<string, string>) => {
  const rows = await listed('editor_labak', Object.values(ids));
  return Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, rows.find((r) => r.id === id)?.in_use]));
};
const usage = async (as: PersonaName, ids: string[]): Promise<UsageRow[]> => {
  const { data, error } = await (await editorClient(as)).schema('api').from('asset_usage')
    .select('asset_id, entry_id, type, title, in_draft, in_published').in('asset_id', ids).order('asset_id').order('entry_id');
  expect(error).toBeNull();
  return data as UsageRow[];
};
/** The ids the persona's search finds, through the CMS's pattern builder. */
const search = async (as: PersonaName, q: string): Promise<string[]> => {
  const { data, error } = await (await editorClient(as)).schema('api').from('asset_list')
    .select('id').ilike('search_text', titlePattern(q)).order('id');
  expect(error).toBeNull();
  return (data as { id: string }[]).map((r) => r.id);
};
const summary = async (as: PersonaName, tenantId: string) => rpc(as, 'asset_summary', { p_tenant_id: tenantId });

const file: Record<string, string> = {};
const published: Array<{ unpublish: () => Promise<void> }> = [];

beforeAll(async () => {
  file.draft = await register('editor_labak', 'bolla');
  file.live = await register('editor_labak', 'braud');
  file.history = await register('editor_labak', 'kleina');
  file.unused = await register('editor_labak', 'snudur');
  file.demo = await register('editor_demo', 'demo');
  await texts('editor_labak', file.draft, `Bolla ${token}`, `Tilboð 100% rúgur_${token}*stjarna`, `Þóra Ægisdóttir ${token}`);
  await texts('editor_labak', file.live, `Brauð ${token}`, `rúgurX${token}`, null);
  await texts('editor_labak', file.history, `Kleina ${token}`, null, null);
  await texts('editor_demo', file.demo, null, `Tilboð 100% rúgur_${token}*stjarna`, `Þóra Ægisdóttir ${token}`);
});

afterAll(async () => {
  // Whatever a failed test left published is withdrawn (see the file comment).
  for (const e of published) await e.unpublish().catch(() => {});
  await closeAll();
});

describe('the library views through PostgREST', () => {
  it('asset_list carries the library columns to a member of the tenant', async () => {
    const row = await rest('editor_labak', `asset_list?select=*&id=eq.${file.draft}`);
    expect(row.status).toBe(200);
    expect(row.body).toHaveLength(1);
    expect(row.body[0]).toMatchObject({
      id: file.draft,
      tenant_id: TENANT.labak,
      filename: `bolla-${token}.jpg`,
      bytes: 1000,
      caption: `Tilboð 100% rúgur_${token}*stjarna`,
      credit: `Þóra Ægisdóttir ${token}`,
      thumb_path: null,
      kind: 'image',
      missing_alt: false,
      in_use: false,
      search_text: `bolla-${token}.jpg\nBolla ${token}\nTilboð 100% rúgur_${token}*stjarna\nÞóra Ægisdóttir ${token}`,
    });
    expect(Number.isNaN(Date.parse(row.body[0].created_at))).toBe(false);
    // The columns the deployed app reads keep their names and place.
    expect(Object.keys(row.body[0]).slice(0, 11)).toEqual([
      'id', 'tenant_id', 'filename', 'mime', 'width', 'height', 'focal_x', 'focal_y', 'default_alt', 'original_path', 'archived_at',
    ]);
  });

  it('in_use and asset_usage follow the draft and the published revision, never history or an archived entry', async () => {
    const ids = { draft: file.draft as string, live: file.live as string, history: file.history as string, unused: file.unused as string };
    expect(await inUse(ids)).toEqual({ draft: false, live: false, history: false, unused: false });

    // A draft only.
    const news = await entry(`Bollufrétt ${token}`);
    await news.save(refs(ids.draft, ids.draft));
    expect(await inUse(ids)).toEqual({ draft: true, live: false, history: false, unused: false });
    expect(await usage('editor_labak', [ids.draft])).toEqual([
      { asset_id: ids.draft, entry_id: news.id, type: 'news', title: news.title, in_draft: true, in_published: false },
    ]);

    // Published: the draft and the revision both name the two files.
    const bread = await entry(`Brauðfrétt ${token}`);
    await bread.save(refs(ids.live, ids.history));
    await bread.publish();
    published.push(bread);
    expect(await inUse(ids)).toEqual({ draft: true, live: true, history: true, unused: false });
    expect(await usage('editor_labak', [ids.live])).toEqual([
      { asset_id: ids.live, entry_id: bread.id, type: 'news', title: bread.title, in_draft: true, in_published: true },
    ]);

    // Published again without one file: the older revision still names it, and that does not count.
    await bread.save(refs(ids.live));
    await bread.publish();
    expect(await inUse(ids)).toEqual({ draft: true, live: true, history: false, unused: false });
    expect(await usage('editor_labak', [ids.history])).toEqual([]);

    // The draft moves on: the file is on the site only.
    await bread.save({});
    expect(await usage('editor_labak', [ids.live])).toEqual([
      { asset_id: ids.live, entry_id: bread.id, type: 'news', title: bread.title, in_draft: false, in_published: true },
    ]);
    expect((await inUse(ids)).live).toBe(true);
    // archive_asset refuses exactly this case, and no other here.
    expect((await rpc('editor_labak', 'archive_asset', { p_asset_id: ids.live })).error).toEqual({ code: 'P0001', message: 'published_reference' });

    // Withdrawn: nothing published names the file any more.
    await bread.unpublish();
    published.length = 0;
    expect(await inUse(ids)).toEqual({ draft: true, live: false, history: false, unused: false });
    expect(await usage('editor_labak', [ids.live, ids.history])).toEqual([]);

    // An archived entry's draft does not count.
    await news.archive();
    expect(await inUse(ids)).toEqual({ draft: false, live: false, history: false, unused: false });
    expect(await usage('editor_labak', Object.values(ids))).toEqual([]);
  });

  it('filters on in_use, missing_alt and kind like any other column', async () => {
    const used = await register('editor_labak', 'terta');
    const news = await entry(`Tertufrétt ${token}`);
    await news.save(refs(used));
    const mine = [file.draft, file.live, file.history, file.unused, used] as string[];
    const filtered = async (filter: string) =>
      ((await rest('editor_labak', `asset_list?select=id&id=in.(${mine.join(',')})&${filter}&order=created_at.desc,id.asc`)).body as { id: string }[])
        .map((r) => r.id).sort();
    expect(await filtered('in_use=is.true')).toEqual([used]);
    expect(await filtered('in_use=is.false&archived_at=is.null')).toEqual([file.draft, file.live, file.history, file.unused].sort());
    expect(await filtered('missing_alt=is.true')).toEqual([file.unused, used].sort());
    expect(await filtered('kind=eq.image')).toEqual([...mine].sort());
    expect(await filtered('kind=eq.document')).toEqual([]);
    await news.archive();
  });

  it('searches file name, alt, caption and credit with one pattern, wildcards as plain characters', async () => {
    const labak = [file.draft, file.live, file.history, file.unused].sort();
    expect(await search('editor_labak', token)).toEqual(expect.arrayContaining(labak));
    expect(await search('editor_labak', `SNUDUR-${token}`)).toEqual([file.unused]); // the file name
    expect(await search('editor_labak', `kleina ${token}`)).toEqual([file.history]); // the default alt
    expect(await search('editor_labak', `þóra ægisdóttir ${token}`)).toEqual([file.draft]); // the credit, Icelandic capitals
    // % and _ match themselves: only the caption that really has them is found.
    expect(await search('editor_labak', `100% rúgur_${token}`)).toEqual([file.draft]);
    expect(await search('editor_labak', `rúgur_${token}`)).toEqual([file.draft]);
    expect(await search('editor_labak', `%${token}`)).toEqual([]);
    expect(await search('editor_labak', `_${token}`)).toEqual([file.draft]);
    expect(await search('editor_labak', `0%${token}`)).toEqual([]);
    // PostgREST reads * as %, and has no escape for it, so the builder sends _ (one character).
    expect(await search('editor_labak', `${token}*stjarna`)).toEqual([file.draft]);
    expect(await search('editor_labak', `rúgur*stjarna`)).toEqual([]);
    expect(await search('editor_labak', `*`)).toEqual(expect.arrayContaining(labak));
  });

  it("keeps a search and a list inside the editor's own tenant", async () => {
    // demo's file carries the same caption and credit as labak's.
    expect(await search('editor_demo', `100% rúgur_${token}`)).toEqual([file.demo]);
    expect(await search('editor_demo', token)).toEqual([file.demo]);
    expect(await search('editor_labak', `þóra ægisdóttir ${token}`)).toEqual([file.draft]);
    expect((await listed('editor_demo', Object.values(file))).map((r) => r.id)).toEqual([file.demo]);
  });

  it('gives a non-member, a revoked editor and a platform admin without membership nothing', async () => {
    const news = await entry(`Snúðafrétt ${token}`);
    await news.save(refs(file.unused as string));
    expect(await usage('editor_labak', [file.unused as string])).toHaveLength(1);
    for (const as of OTHERS) {
      expect(await usage(as, [file.unused as string]), as).toEqual([]);
      expect((await rest(as, `asset_usage?select=*&tenant_id=eq.${TENANT.labak}`)).body, as).toEqual([]);
      expect((await rest(as, `asset_list?select=id&tenant_id=eq.${TENANT.labak}`)).body, as).toEqual([]);
      if (as !== 'editor_demo') expect(await search(as, token), as).toEqual([]);
      expect((await summary(as, TENANT.labak)).error, as).toEqual(NOT_FOUND);
      expect((await rpc(as, 'update_asset_text', { p_asset_id: file.unused, p_default_alt: 'x', p_caption: 'x', p_credit: 'x' })).error, as).toEqual(NOT_FOUND);
      expect((await rpc(as, 'set_asset_thumbnail', { p_asset_id: file.unused, p_thumb_path: thumbPath(TENANT.labak, file.unused as string) })).error, as).toEqual(NOT_FOUND);
    }
    await news.archive();
    const stored = await ownerQuery('select default_alt, caption, credit, thumb_path from cms.assets where id = $1', [file.unused]);
    expect(stored).toEqual([{ default_alt: null, caption: null, credit: null, thumb_path: null }]);
  });

  it('refuses anon on both views and all three functions', async () => {
    for (const path of ['asset_list?select=id&limit=1', 'asset_usage?select=asset_id&limit=1']) {
      expect((await rest('anon', path)).status, path).toBe(401);
    }
    for (const [fn, args] of [
      ['asset_summary', { p_tenant_id: TENANT.labak }],
      ['update_asset_text', { p_asset_id: file.unused, p_default_alt: 'x', p_caption: 'x', p_credit: 'x' }],
      ['set_asset_thumbnail', { p_asset_id: file.unused, p_thumb_path: thumbPath(TENANT.labak, file.unused as string) }],
    ] as const) {
      expect((await rest('anon', `rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) })).status, fn).toBe(401);
    }
  });
});

describe('asset_summary', () => {
  it("counts the tenant's files, and follows a new file, a use and an archive", async () => {
    type Summary = { files: number; bytes: number; images: number; documents: number; missing_alt: number; unused: number; archived: number };
    const read = async () => {
      const { data, error } = await summary('editor_labak', TENANT.labak);
      expect(error).toBeNull();
      return data as Summary;
    };
    const before = await read();
    expect(Object.keys(before).sort()).toEqual(['archived', 'bytes', 'documents', 'files', 'images', 'missing_alt', 'unused']);
    expect(before.documents).toBe(0);
    expect(before.images).toBe(before.files);

    const withAlt = await register('editor_labak', 'kaka', 3000);
    const noAlt = await register('editor_labak', 'vinarbraud', 4000);
    await texts('editor_labak', withAlt, `Kaka ${token}`, null, null);
    expect(await read()).toEqual({
      ...before, files: before.files + 2, images: before.images + 2, bytes: before.bytes + 7000,
      missing_alt: before.missing_alt + 1, unused: before.unused + 2,
    });

    const news = await entry(`Kökufrétt ${token}`);
    await news.save(refs(withAlt));
    expect((await read()).unused).toBe(before.unused + 1);

    expect((await rpc('editor_labak', 'archive_asset', { p_asset_id: noAlt })).error).toBeNull();
    expect(await read()).toEqual({
      ...before, files: before.files + 1, images: before.images + 1, bytes: before.bytes + 3000, archived: before.archived + 1,
    });
    await news.archive();

    // demo's editor reads demo's summary and never labak's.
    expect((await summary('editor_demo', TENANT.demo)).error).toBeNull();
    expect((await summary('editor_demo', TENANT.labak)).error).toEqual(NOT_FOUND);
  });
});

describe('texts and thumbnail through the Data API', () => {
  it('update_asset_text stores the three texts and refuses one past its limit', async () => {
    const id = await register('editor_labak', 'texti');
    await texts('editor_labak', id, 'Alt', 'Myndatexti', 'Ljósmyndari');
    const stored = () => ownerQuery('select default_alt, caption, credit, focal_x from cms.assets where id = $1', [id]);
    expect(await stored()).toEqual([{ default_alt: 'Alt', caption: 'Myndatexti', credit: 'Ljósmyndari', focal_x: null }]);
    for (const args of [
      { p_default_alt: 'a'.repeat(1001), p_caption: 'x', p_credit: 'x' },
      { p_default_alt: 'x', p_caption: 'a'.repeat(1001), p_credit: 'x' },
      { p_default_alt: 'x', p_caption: 'x', p_credit: 'a'.repeat(301) },
    ]) {
      expect((await rpc('editor_labak', 'update_asset_text', { p_asset_id: id, ...args })).error?.code).toBe('23514');
    }
    expect(await stored()).toEqual([{ default_alt: 'Alt', caption: 'Myndatexti', credit: 'Ljósmyndari', focal_x: null }]);
    expect((await rpc('editor_demo', 'update_asset_text', { p_asset_id: id, p_default_alt: 'x', p_caption: 'x', p_credit: 'x' })).error).toEqual(NOT_FOUND);
  });

  it("set_asset_thumbnail takes only the file's own path, and only once the object is stored", async () => {
    const id = await register('editor_labak', 'smamynd');
    const path = thumbPath(TENANT.labak, id);
    const labak = await editorClient('editor_labak');
    const demo = await editorClient('editor_demo');
    const set = (as: PersonaName, assetId: string, p: string) => rpc(as, 'set_asset_thumbnail', { p_asset_id: assetId, p_thumb_path: p });

    // Not uploaded yet.
    expect((await set('editor_labak', id, path)).error).toEqual(NOT_FOUND);
    expect((await labak.storage.from('media-private').upload(path, WEBP, { contentType: 'image/webp' })).error).toBeNull();

    // demo's own thumbnail exists too; labak's file may not point at it, nor at another labak file's.
    const demoThumb = thumbPath(TENANT.demo, file.demo as string);
    expect((await demo.storage.from('media-private').upload(demoThumb, WEBP, { contentType: 'image/webp' })).error).toBeNull();
    const sibling = thumbPath(TENANT.labak, file.unused as string);
    expect((await labak.storage.from('media-private').upload(sibling, WEBP, { contentType: 'image/webp' })).error).toBeNull();
    for (const bad of [demoThumb, sibling, thumbPath(TENANT.demo, id), `${TENANT.labak}/${id}/smamynd-${token}.jpg`, `${path}/x`, `${TENANT.labak}/${id}/thumb/480.png`]) {
      expect((await set('editor_labak', id, bad)).error, bad).toEqual(FORBIDDEN);
    }
    // Another tenant's editor cannot record it, cannot see the file, and cannot sign the object.
    expect((await set('editor_demo', id, path)).error).toEqual(NOT_FOUND);
    expect((await ownerQuery('select thumb_path from cms.assets where id = $1', [id]))[0]).toEqual({ thumb_path: null });

    expect((await set('editor_labak', id, path)).error).toBeNull();
    expect((await rest('editor_labak', `asset_list?select=thumb_path&id=eq.${id}`)).body).toEqual([{ thumb_path: path }]);

    // The editor signs the thumbnail with their own session (plan section 5); nobody else can.
    const signed = await labak.storage.from('media-private').createSignedUrl(path, 600);
    expect(signed.error).toBeNull();
    const fetched = await fetch(signed.data!.signedUrl);
    expect(fetched.status).toBe(200);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(WEBP);
    for (const as of OTHERS) {
      const c = await editorClient(as);
      expect((await c.storage.from('media-private').createSignedUrl(path, 600)).error, as).not.toBeNull();
      const batch = await c.storage.from('media-private').createSignedUrls([path], 600);
      expect((batch.data ?? []).every((d) => !d.signedUrl), as).toBe(true);
      expect((await c.storage.from('media-private').download(path)).error, as).not.toBeNull();
    }
    expect((await anonClient().storage.from('media-private').createSignedUrl(path, 600)).error).not.toBeNull();
    // An editor cannot write a thumbnail into another tenant's folder.
    const foreign = thumbPath(TENANT.demo, randomUUID());
    expect((await labak.storage.from('media-private').upload(foreign, WEBP, { contentType: 'image/webp' })).error).not.toBeNull();
    expect(await ownerQuery('select 1 from storage.objects where name = $1', [foreign])).toEqual([]);
  });

  it('the orphan listing keeps a thumbnail an asset row names and lists one no row names', async () => {
    const id = await register('editor_labak', 'geymd');
    const named = thumbPath(TENANT.labak, id);
    const unnamed = thumbPath(TENANT.labak, id, 960);
    const labak = await editorClient('editor_labak');
    for (const p of [named, unnamed]) {
      expect((await labak.storage.from('media-private').upload(p, WEBP, { contentType: 'image/webp' })).error).toBeNull();
    }
    expect((await rpc('editor_labak', 'set_asset_thumbnail', { p_asset_id: id, p_thumb_path: named })).error).toBeNull();
    try {
      // Long past any grace period, so both are first in the oldest-first listing.
      await ownerQuery(`update storage.objects set created_at = now() - interval '400 days' where bucket_id = 'media-private' and name = any($1)`, [[named, unnamed]]);
      const orphans = await withTx('service', async (w) => (await w.query('select name from api.worker_private_orphans(86400, 1000)')).rows as { name: string }[]);
      const names = orphans.map((o) => o.name);
      expect(names).toContain(unnamed);
      expect(names).not.toContain(named);
    } finally {
      // The sweep's own removal, so no later test finds this file's orphan.
      await secretClient().storage.from('media-private').remove([unnamed]);
    }
    expect(await ownerQuery(`select name from storage.objects where bucket_id = 'media-private' and name = any($1)`, [[named, unnamed]])).toEqual([{ name: named }]);
  });
});

describe('the new asset functions lock the tenant row', () => {
  const suspend = (c: pg.Client) => c.query(`update cms.tenants set status = 'suspended' where id = $1`, [TENANT.demo]);
  afterEach(async () => {
    await ownerQuery(`update cms.tenants set status = 'active' where id = $1`, [TENANT.demo]);
  });

  it.each([
    ['update_asset_text', `select api.update_asset_text($1, 'Alt', 'Texti', 'Nafn')`, (id: string) => [id]],
    ['set_asset_thumbnail', 'select api.set_asset_thumbnail($1, $2)', (id: string) => [id, thumbPath(TENANT.demo, id)]],
  ] as const)('%s waits for an in-flight suspension, then is refused with tenant_inactive', async (_name, sql, params) => {
    const id = await register('editor_demo', 'las');
    const owner = await pgAs('owner');
    await suspend(owner);

    const editor = await pgAs('editor_demo');
    const calling = editor.query(sql, params(id)).then(
      () => null,
      (e: unknown) => e,
    );
    await expectBlocked(editor);

    await owner.query('commit');
    await closeClient(owner);
    const error = (await calling) as { code?: string; message?: string } | null;
    expect({ code: error?.code, message: error?.message }).toEqual({ code: 'P0001', message: 'tenant_inactive' });
    await closeClient(editor);
    expect(await ownerQuery('select default_alt, caption, credit, thumb_path from cms.assets where id = $1', [id])).toEqual([
      { default_alt: null, caption: null, credit: null, thumb_path: null },
    ]);
  });

  it('a suspension waits for an in-flight update_asset_text, which commits its texts first', async () => {
    const id = await register('editor_demo', 'fyrst');
    const editor = await pgAs('editor_demo');
    await editor.query(`select api.update_asset_text($1, 'Alt', 'Texti', 'Nafn')`, [id]);

    const owner = await pgAs('owner');
    const suspending = suspend(owner);
    await expectBlocked(owner);

    await editor.query('commit');
    await suspending;
    await owner.query('commit');
    await closeClient(editor);
    await closeClient(owner);
    expect(await ownerQuery('select caption from cms.assets where id = $1', [id])).toEqual([{ caption: 'Texti' }]);
    expect((await ownerQuery<{ status: string }>('select status from cms.tenants where id = $1', [TENANT.demo]))[0]!.status).toBe('suspended');
  });
});

// The plan's measure before L1 merges (section 4.4): one tenant with 5,000 files and 20,000
// references; the list, the unused filter and the summary each well under a second, as an editor
// under RLS with the editor's 3 s statement timeout: the lookups by file first with statistics
// that predate the data, then everything with the statistics autovacuum keeps.
// The data lives in one transaction that is rolled back, so no other test, and no later release
// build, ever sees it; the editor's queries run in that same transaction after the role is
// switched, the way PostgREST impersonates.
//   files 1..5000
//   entries 1..1000: the draft names files 3(n-1)+1..3(n-1)+10        -> files 1..3007, 10,000 references
//   entries 1..500 are published: the revision names 2500+3(n-1)+k    -> files 2501..4007, 5,000 references
//   entries 1..500 have an older revision naming files 4001..4500     -> 5,000 references, history only
// In use: files 1..4007. Unused: 4008..5000, that is 993.
describe('timings at 5,000 files and 20,000 references', () => {
  it('the list, the unused filter, the search, the usage and the summary stay far below the 3 s limit', async () => {
    const run = randomUUID();
    const tenant = randomUUID();
    const editor = PERSONAS.editor_labak.id;
    const c = await pgAs('owner');
    try {
      await c.query(`insert into cms.tenants (id, slug, name) values ($1, $2, 'Tímamæling')`, [tenant, `timing-${token}`]);
      await c.query('insert into cms.memberships (tenant_id, user_id) values ($1, $2)', [tenant, editor]);
      await c.query(
        `insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, default_alt, caption, credit, created_at)
         select a.id, $1::uuid, $1::text || '/' || a.id::text || '/mynd-' || n || '.jpg', 'mynd-' || n || '.jpg', 'image/jpeg',
                100000 + n, 1600, 1200, repeat('a', 64),
                case when n % 3 = 0 then null else 'Lýsing á mynd númer ' || n || ' ' || repeat('orð ', 20) end,
                case when n % 2 = 0 then 'Myndatexti ' || n || ' ' || repeat('texti ', 30) end,
                case when n % 4 = 0 then 'Ljósmyndari ' || (n % 17) end,
                now() - make_interval(mins => n)
         from generate_series(1, 5000) n, lateral (select md5($2::text || ':a:' || n)::uuid as id) a`,
        [tenant, run],
      );
      await c.query(
        `insert into cms.entries (id, tenant_id, type, slug, created_by)
         select md5($2::text || ':e:' || n)::uuid, $1::uuid, 'news', 'timing-' || n, $3::uuid from generate_series(1, 1000) n`,
        [tenant, run, editor],
      );
      const gallery = (first: string) =>
        `(select jsonb_agg(jsonb_build_object('_ref', md5($2::text || ':a:' || (${first}))::uuid, '_kind', 'asset', 'alt', '')) from generate_series(1, 10) k)`;
      await c.query(
        `insert into cms.drafts (entry_id, tenant_id, schema_version, data, title, updated_by)
         select md5($2::text || ':e:' || n)::uuid, $1::uuid, 1, jsonb_build_object('gallery', ${gallery('(n - 1) * 3 + k')}), 'Frétt ' || n, $3::uuid
         from generate_series(1, 1000) n`,
        [tenant, run, editor],
      );
      for (const [kind, first] of [['old', '4000 + ((n - 1 + k) % 500) + 1'], ['live', '2500 + (n - 1) * 3 + k']] as const) {
        await c.query(
          `insert into cms.revisions (id, tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
           select md5($2::text || ':${kind}:' || n)::uuid, $1::uuid, md5($2::text || ':e:' || n)::uuid, 1, 1,
                  jsonb_build_object('gallery', ${gallery(first)}), 'Frétt ' || n, $3::uuid
           from generate_series(1, 500) n`,
          [tenant, run, editor],
        );
      }
      await c.query(
        `update cms.entries e
         set published_rev_id = md5($2::text || ':live:' || n)::uuid, published_draft_version = 1, first_published_at = now(), last_published_at = now()
         from generate_series(1, 500) n
         where e.tenant_id = $1 and e.id = md5($2::text || ':e:' || n)::uuid`,
        [tenant, run],
      );
      const counts = (await c.query(
        `select (select count(*)::int from cms.assets where tenant_id = $1) as files,
                (select count(*)::int from cms.draft_refs where tenant_id = $1)
                + (select count(*)::int from cms.revision_refs where tenant_id = $1) as refs`,
        [tenant],
      )).rows[0];
      expect(counts).toEqual({ files: 5000, refs: 20000 });
      const columns = 'id, filename, mime, width, height, bytes, created_at, default_alt, caption, credit, thumb_path, kind, missing_alt, in_use';
      const page = `from api.asset_list where tenant_id = $1 and archived_at is null`;
      const unusedCount = `select count(*)::int as n ${page} and in_use is false`;
      const summary = { files: 5000, bytes: 512502500, images: 5000, documents: 0, missing_alt: 1666, unused: 993, archived: 0 };
      // The editor, as PostgREST would run each request.
      const asEditor = async () => {
        await c.query(`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)`, [
          JSON.stringify({ sub: editor, role: 'authenticated', aal: 'aal1' }),
        ]);
        await c.query(`set local statement_timeout = '3s'`);
      };
      const timed = async <T>(name: string, text: string, params: unknown[]): Promise<T[]> => {
        const started = performance.now();
        const { rows } = await c.query(text, params);
        const ms = performance.now() - started;
        console.log(`media library timing: ${name}: ${ms.toFixed(0)} ms`);
        expect(ms, name).toBeLessThan(1000);
        return rows as T[];
      };

      // First with the statistics that predate the data, as in the minute after a large import
      // before autovacuum has analysed it: the lookups by file the unused filter, the summary and
      // the usage make must not depend on the statistics knowing this tenant.
      await asEditor();
      expect(await timed('before analyze: unused filter, first 60', `select ${columns} ${page} and in_use is false order by created_at desc, id limit 60`, [tenant])).toHaveLength(60);
      expect((await timed<{ n: number }>('before analyze: unused filter, exact count', unusedCount, [tenant]))[0]!.n).toBe(993);
      expect((await timed<{ s: Record<string, number> }>('before analyze: summary', 'select api.asset_summary($1) as s', [tenant]))[0]!.s).toEqual(summary);
      expect(await timed('before analyze: usage of one file', 'select * from api.asset_usage where tenant_id = $1 and asset_id = md5($2)::uuid', [tenant, `${run}:a:2600`])).not.toHaveLength(0);

      // Then with fresh statistics. Autovacuum cannot see these uncommitted rows, so the
      // statistics production would have within a minute of such an import are made here.
      // (ANALYZE's row estimates in pg_class outlive the rollback until the next autovacuum,
      // harmlessly.)
      await c.query('reset role');
      await c.query('set local statement_timeout to default');
      await c.query('analyze cms.assets, cms.entries, cms.drafts, cms.revisions, cms.draft_refs, cms.revision_refs, cms.memberships');
      await asEditor();

      // The unused filter looks each file up by the indexes led by the file, not by the refs
      // tables' primary keys, which lead by tenant and would read all its references per file.
      // The tenant id is a random UUID, inlined so EXPLAIN plans the query the view runs.
      const indexNames = (node: unknown, found = new Set<string>()): Set<string> => {
        if (Array.isArray(node)) for (const child of node) indexNames(child, found);
        else if (node && typeof node === 'object') {
          for (const [key, value] of Object.entries(node)) {
            if (key === 'Index Name' && typeof value === 'string') found.add(value);
            else indexNames(value, found);
          }
        }
        return found;
      };
      const plan = (await c.query(`explain (format json) ${unusedCount.replace('$1', `'${tenant}'::uuid`)}`)).rows[0]['QUERY PLAN'];
      const used = indexNames(plan);
      expect([...used], 'the unused filter\'s plan').toEqual(
        expect.arrayContaining(['draft_refs_target_asset_tenant_idx', 'revision_refs_target_asset_tenant_idx']),
      );
      expect(used.has('draft_refs_pkey') || used.has('revision_refs_pkey'), 'the unused filter uses no refs primary key').toBe(false);

      expect(await timed('list, newest 60', `select ${columns} ${page} order by created_at desc, id limit 60`, [tenant])).toHaveLength(60);
      expect(await timed('list, 60 from offset 4,900', `select ${columns} ${page} order by created_at desc, id limit 60 offset 4900`, [tenant])).toHaveLength(60);
      expect(await timed('unused filter, first 60', `select ${columns} ${page} and in_use is false order by created_at desc, id limit 60`, [tenant])).toHaveLength(60);
      expect(await timed('unused filter, last page', `select ${columns} ${page} and in_use is false order by created_at desc, id limit 60 offset 960`, [tenant])).toHaveLength(33);
      expect((await timed<{ n: number }>('unused filter, exact count', unusedCount, [tenant]))[0]!.n).toBe(993);
      expect(await timed('in use, by name', `select ${columns} ${page} and in_use order by filename, id limit 60`, [tenant])).toHaveLength(60);
      expect(await timed('missing alt filter', `select ${columns} ${page} and missing_alt order by created_at desc, id limit 60`, [tenant])).toHaveLength(60);
      expect(await timed('search', `select ${columns} ${page} and search_text ilike $2 order by created_at desc, id limit 60`, [tenant, titlePattern('ljósmyndari 16')])).toHaveLength(60);
      expect(await timed('search with no match', `select ${columns} ${page} and search_text ilike $2 limit 60`, [tenant, titlePattern('finnst hvergi')])).toHaveLength(0);
      expect(await timed('usage of one file', 'select * from api.asset_usage where tenant_id = $1 and asset_id = md5($2)::uuid', [tenant, `${run}:a:2600`])).not.toHaveLength(0);
      expect(await timed('usage of 60 files', 'select * from api.asset_usage where tenant_id = $1 and asset_id in (select md5($2::text || n)::uuid from generate_series(2570, 2629) n)', [tenant, `${run}:a:`])).not.toHaveLength(0);
      // 1,000 drafts and 500 published revisions, ten files each, no pair twice.
      expect((await timed<{ n: number }>('usage of the whole tenant', 'select count(*)::int as n from api.asset_usage where tenant_id = $1', [tenant]))[0]!.n).toBe(15000);
      expect((await timed<{ s: Record<string, number> }>('summary', 'select api.asset_summary($1) as s', [tenant]))[0]!.s).toEqual(summary);
    } finally {
      await closeClient(c); // rolls everything back
    }
    expect(await ownerQuery('select 1 from cms.tenants where id = $1', [tenant])).toEqual([]);
  });
});
