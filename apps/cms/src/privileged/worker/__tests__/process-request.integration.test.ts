// Worker step 1 against the local stack (plan Task 19, decisions 33–35; spec §6.1–6.3, §5.3;
// "Exactness: what M1 proves"; review focus 3). Editors act over the Data API with their own
// sessions (tests/integration's editorClient); the worker runs as service_role with the secret key,
// as in production. Run by `pnpm test:integration`, after tests/integration seeded the personas.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { editorClient, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { getType } from '@/modules/registry';
import { processPendingRequests, processRequestById } from '../process-request';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';

let editor: SupabaseClient;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});


const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

const JPEG = TEST_JPEG;

/**
 * An asset of labak, registered as the owner, with its original in media-private: the worker
 * checks that the original exists (Task 30, decision 36.4) and that the stored metadata is what
 * its bytes say (M3-07) before it commits a publish.
 */
async function labakAsset(): Promise<string> {
  const id = randomUUID();
  const m = TEST_JPEG_METADATA;
  const { error } = await secretClient()
    .storage.from('media-private')
    .upload(`${TENANT.labak}/${id}/a.jpg`, JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  await ownerQuery(
    `insert into cms.assets (id, tenant_id, original_path, filename, mime, bytes, width, height, sha256, created_by)
     values ($1::uuid, $2::uuid, $2::text || '/' || $1::text || '/a.jpg', 'a.jpg', 'image/jpeg', $4, $5, $6, $7, $3::uuid)`,
    [id, TENANT.labak, PERSONAS.editor_labak.id, m.p_bytes, m.p_width, m.p_height, m.p_sha256],
  );
  return id;
}

const slug = () => `t19-${randomUUID().slice(0, 8)}`;

/** A labak news entry created and saved by editor_labak; returns its id and draft version. */
async function newsEntry(data: Record<string, unknown>, o: { type?: string; slug?: string | null; schemaVersion?: number } = {}) {
  const id = await rpc<string>('create_entry', {
    p_tenant_id: TENANT.labak,
    p_type: o.type ?? 'news',
    p_slug: o.slug === undefined ? slug() : o.slug,
  });
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: data,
    p_schema_version: o.schemaVersion ?? 1,
    p_title: null,
    p_sort_at: null,
  });
  return { id, version };
}

const validNews = (imageId: string, extra: Record<string, unknown> = {}) => ({
  title: 'Nýtt brauð ársins',
  date: '2026-10-15',
  excerpt: 'Inngangur.',
  image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
  ...extra,
});

const requestRow = async (id: string) =>
  (
    await ownerQuery<{ status: string; error: unknown; revision_id: string | null; attempts: number }>(
      'select status, error, revision_id, attempts from cms.publish_requests where id = $1',
      [id],
    )
  )[0]!;
const revisionCount = async (entryId: string) =>
  (await ownerQuery<{ n: number }>('select count(*)::int as n from cms.revisions where entry_id = $1', [entryId]))[0]!.n;

describe('processRequestById (publish)', () => {
  it('commits a valid labak news draft; the revision equals the validated draft (exactness)', async () => {
    const image = await labakAsset();
    const data = validNews(image);
    const entry = await newsEntry(data);
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome).toEqual({
      requestId,
      tenantId: TENANT.labak,
      tenantSlug: 'labak',
      entryId: entry.id,
      action: 'publish',
      type: 'news',
      status: 'committed',
    });
    const [rev] = await ownerQuery<{ data: unknown; draft_version: number; schema_version: number; title: string; sort_at: string; id: string }>(
      `select r.id, r.data, r.draft_version, r.schema_version, r.title, to_char(r.sort_at at time zone 'UTC', 'YYYY-MM-DD') as sort_at
       from cms.revisions r join cms.publish_requests p on p.revision_id = r.id where p.id = $1`,
      [requestId],
    );
    const [draft] = await ownerQuery<{ data: unknown; version: number; schema_version: number }>(
      'select data, version, schema_version from cms.drafts where entry_id = $1',
      [entry.id],
    );
    expect(rev!.data).toEqual(draft!.data);
    expect(rev!.data).toEqual(data);
    expect(rev!.draft_version).toBe(entry.version);
    expect(rev!.schema_version).toBe(draft!.schema_version);
    // title and sort_at come from the type's queryColumns (spec §4.3).
    expect({ title: rev!.title, sortAt: rev!.sort_at }).toEqual(getType('labak', 'news')!.queryColumns(data));
    const refs = (table: string, key: string, id: string) =>
      ownerQuery(`select path, target_entry_id, target_asset_id from cms.${table} where ${key} = $1 order by path`, [id]);
    const revisionRefs = await refs('revision_refs', 'revision_id', rev!.id);
    expect(revisionRefs).toEqual(await refs('draft_refs', 'entry_id', entry.id));
    expect(revisionRefs).toEqual([{ path: '$."image"', target_entry_id: null, target_asset_id: image }]);
    const [e] = await ownerQuery<{ published_rev_id: string; published_draft_version: number }>(
      'select published_rev_id, published_draft_version from cms.entries where id = $1',
      [entry.id],
    );
    expect(e).toEqual({ published_rev_id: rev!.id, published_draft_version: entry.version });
  });

  it('refuses a draft missing the required image (direct-RPC bypass): failed_validation, no revision', async () => {
    const image = await labakAsset();
    const { image: _omitted, ...data } = validNews(image);
    const entry = await newsEntry(data); // save_draft accepts it: the database does not know the schema
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('failed_validation');
    const errors = outcome.errors as { code: string; issues: Array<{ path: unknown[] }> };
    expect(errors.code).toBe('invalid_data');
    expect(errors.issues.map((i) => i.path)).toContainEqual(['image']);
    expect(await requestRow(requestId)).toMatchObject({ status: 'failed_validation', error: errors, revision_id: null });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('marks a request superseded when the draft was saved after it (review focus 3)', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image));
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });
    // An autosave lands after the editor pressed publish.
    await rpc('save_draft', {
      p_entry_id: entry.id,
      p_expected_version: entry.version,
      p_data: validNews(image, { title: 'Breytt eftir birtingu' }),
      p_schema_version: 1,
      p_title: null,
      p_sort_at: null,
    });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('superseded');
    expect(await requestRow(requestId)).toMatchObject({
      status: 'superseded',
      error: { code: 'superseded', requested_version: entry.version, draft_version: entry.version + 1 },
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('refuses a draft that references an unpublished entry: failed_validation', async () => {
    const image = await labakAsset();
    const target = await newsEntry(validNews(image)); // never published
    const entry = await newsEntry(validNews(image, { source: { entry: { _ref: target.id, _kind: 'entry' } } }));
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({
      code: 'invalid_reference',
      refs: [{ path: '$."source"."entry"', kind: 'entry', id: target.id, reason: 'unpublished' }],
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('rejects a request by a revoked member (inserted as the owner)', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image));
    // revoked has no membership any more, so it cannot call request_publish; the row it would have
    // left behind (requested before the revocation) is inserted as the owner.
    const [row] = await ownerQuery<{ id: string }>(
      `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by)
       values ($1, $2, 'publish', $3, $4) returning id`,
      [TENANT.labak, entry.id, entry.version, PERSONAS.revoked.id],
    );

    const outcome = await processRequestById(row!.id);

    expect(outcome.status).toBe('rejected');
    expect(outcome.errors).toEqual({ code: 'forbidden' });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('refuses an entry of a type the tenant module does not define: unknown_type', async () => {
    const entry = await newsEntry({ title: 'x' }, { type: 'recipe' });
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome).toMatchObject({ status: 'failed_validation', type: 'recipe', errors: { code: 'unknown_type', type: 'recipe' } });
    expect((await requestRow(requestId)).error).toEqual({ code: 'unknown_type', type: 'recipe' });
  });

  it('refuses a draft written at a newer schema version than the type: draft_schema_ahead (spec §5.3, M2-05)', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image), { schemaVersion: 2 });
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({ code: 'draft_schema_ahead', draftSchemaVersion: 2, currentSchemaVersion: 1 });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('refuses an entry without a slug when its type has site pages: slug_required (decision 34.5)', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image), { slug: null });
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });

    const outcome = await processRequestById(requestId);

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({ code: 'slug_required' });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  // A7: a singleton shown on a shared page has no path of its own, and its title is never text, so
  // it never gets a slug; the slug is required only where the type has a path.
  it('commits an entry without a slug when its type has site checks but no path of its own (A7)', async () => {
    const demo = (await editorClient('editor_demo')).schema('api');
    const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
      const { data, error } = await demo.rpc(fn, args);
      if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
      return data as T;
    };
    const id = await call<string>('create_singleton_entry', { p_tenant_id: TENANT.demo, p_type: 'events-page', p_schema_version: 1 });
    const detail = await call<{ slug: string | null; draft_version: number }>('entry_detail_by_id', { p_entry_id: id });
    expect(detail.slug).toBeNull();
    const version = await call<number>('save_draft', {
      p_entry_id: id,
      p_expected_version: detail.draft_version,
      p_data: { intro: `A7 ${randomUUID().slice(0, 8)}` },
      p_schema_version: 1,
      p_title: null,
      p_sort_at: null,
    });
    const requestId = await call<string>('request_publish', { p_entry_id: id, p_expected_draft_version: version });

    const outcome = await processRequestById(requestId);

    expect(outcome).toMatchObject({ status: 'committed' });
    // Withdrawn again, so no later demo release carries it.
    expect((await processRequestById(await call<string>('request_unpublish', { p_entry_id: id }))).status).toBe('committed');
  });

  it('skips a request that is not claimable (already processed)', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image));
    const requestId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });
    expect((await processRequestById(requestId)).status).toBe('committed');

    const again = await processRequestById(requestId);

    expect(again).toMatchObject({ requestId, entryId: entry.id, status: 'skipped' });
    expect(await revisionCount(entry.id)).toBe(1);
  });
});

describe('processRequestById (unpublish)', () => {
  it('commits an unpublish: the entry has no published revision any more', async () => {
    const image = await labakAsset();
    const entry = await newsEntry(validNews(image));
    const publishId = await rpc<string>('request_publish', { p_entry_id: entry.id, p_expected_draft_version: entry.version });
    expect((await processRequestById(publishId)).status).toBe('committed');
    const requestId = await rpc<string>('request_unpublish', { p_entry_id: entry.id });

    const outcome = await processRequestById(requestId);

    expect(outcome).toEqual({
      requestId,
      tenantId: TENANT.labak,
      tenantSlug: 'labak',
      entryId: entry.id,
      action: 'unpublish',
      type: 'news',
      status: 'committed',
    });
    const [e] = await ownerQuery('select published_rev_id, published_draft_version from cms.entries where id = $1', [entry.id]);
    expect(e).toEqual({ published_rev_id: null, published_draft_version: null });
  });
});

describe('processPendingRequests', () => {
  it('claims and processes pending requests, each with its own outcome', async () => {
    // Leftover pending requests from other suites would be claimed too; clear them first so the
    // assertion is about this test's requests only. This changes shared state: it relies on no
    // other suite running a claim concurrently (the integration suites run one file at a time).
    await ownerQuery(`update cms.publish_requests set status = 'failed' where status in ('pending', 'validating')`);
    const image = await labakAsset();
    const good = await newsEntry(validNews(image));
    const { image: _omitted, ...invalid } = validNews(image);
    const bad = await newsEntry(invalid);
    const goodId = await rpc<string>('request_publish', { p_entry_id: good.id, p_expected_draft_version: good.version });
    const badId = await rpc<string>('request_publish', { p_entry_id: bad.id, p_expected_draft_version: bad.version });

    const outcomes = await processPendingRequests();

    // worker_claim_requests claims oldest first, so good (requested first) comes before bad.
    expect(outcomes.map((o) => [o.requestId, o.status])).toEqual([
      [goodId, 'committed'],
      [badId, 'failed_validation'],
    ]);
    expect(await processPendingRequests()).toEqual([]);
  });
});
