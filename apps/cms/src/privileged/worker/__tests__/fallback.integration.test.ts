// The failed-entry fallback rule against the local stack (spec §7.1, §7.4, §8.5 Delivery; plan
// M3-05). A projection that fails for unchanged content (a faulty code or transform deploy) is
// simulated by rewriting, as owner, the data of the revision that is published, so the revision id
// stays the same and the projection now fails; a newer revision that fails is inserted as owner (the
// worker would never commit it). Every build includes whatever the tenant's earlier tests
// published, so assertions are about the entries each test creates.
//
// The demo cases end on the real demo site (apps/demo-site, `next build` and `next start`) reading
// the local stack's `delivery` bucket: an omitted entry's page answers 404 after the signed
// revalidation, and a reused entry's page still shows its previous content hash. The archived-asset
// case runs on labak, whose news items have an image (demo events have none).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseEntryMarkers, signWebhook, SIGNATURE_HEADER, TIMESTAMP_HEADER, type Bundle, type BundleEntry } from '@litljomi/cms-sdk';
import { startSite, WEBHOOK_SECRETS, type RunningSite } from '../../../../../demo-site/e2e/harness.ts';
import { editorClient, publicUrl } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { buildRelease, type BuildResult } from '../build-release';
import { processRequestById } from '../process-request';
import { prepareLabak } from './labak-setup';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';

type Tenant = 'demo' | 'labak';
const editors = {} as Record<Tenant, SupabaseClient>;
/** Entries this file published, withdrawn after the run so later builds do not carry them. */
const created: string[] = [];

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editors.demo = await editorClient('editor_demo');
  editors.labak = await editorClient('editor_labak');
  await prepareLabak();
});
afterAll(async () => {
  await ownerQuery('update cms.entries set published_rev_id = null, published_draft_version = null where id = any($1::uuid[])', [created]);
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(tenant: Tenant, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editors[tenant].schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

/** A draft saved by the tenant's editor; `slug` is returned for the site's paths. */
async function draft(tenant: Tenant, type: string, data: Record<string, unknown>) {
  const slug = `m305-${randomUUID().slice(0, 8)}`;
  const id = await rpc<string>(tenant, 'create_entry', { p_tenant_id: TENANT[tenant], p_type: type, p_slug: slug });
  created.push(id);
  const version = await rpc<number>(tenant, 'save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  return { id, slug, version };
}

/** Publishes through the real path: request_publish, then worker step 1. */
async function published(tenant: Tenant, type: string, data: Record<string, unknown>) {
  const d = await draft(tenant, type, data);
  const requestId = await rpc<string>(tenant, 'request_publish', { p_entry_id: d.id, p_expected_draft_version: d.version });
  expect((await processRequestById(requestId)).status).toBe('committed');
  return { id: d.id, slug: d.slug };
}

async function unpublished(tenant: Tenant, entryId: string) {
  const requestId = await rpc<string>(tenant, 'request_unpublish', { p_entry_id: entryId });
  expect((await processRequestById(requestId)).status).toBe('committed');
}

const event = (title: string, related?: string) => ({
  title,
  startDate: '2026-12-01',
  ...(related ? { related: { _ref: related, _kind: 'entry' } } : {}),
});

/** Unchanged content that no longer projects: the published revision loses its required title. */
const breakPublishedRevision = (entryId: string) =>
  ownerQuery(
    `update cms.revisions v set data = v.data - 'title' from cms.entries e
     where e.id = $1 and v.tenant_id = e.tenant_id and v.id = e.published_rev_id`,
    [entryId],
  );

/** A newer revision, published as owner, that does not project (the worker would never commit it). */
async function publishBrokenNewRevision(tenant: Tenant, entryId: string, data: Record<string, unknown>) {
  const [rev] = await ownerQuery<{ id: string }>(
    `insert into cms.revisions (tenant_id, entry_id, draft_version, schema_version, data, title, requested_by)
     values ($1, $2, 2, 1, $3, null, $4) returning id`,
    [TENANT[tenant], entryId, JSON.stringify(data), PERSONAS[tenant === 'demo' ? 'editor_demo' : 'editor_labak'].id],
  );
  await ownerQuery(`update cms.entries set published_rev_id = $2, published_draft_version = 2, last_published_at = now() where id = $1`, [
    entryId,
    rev!.id,
  ]);
}

const delivered = async (tenant: Tenant) => {
  const result = await buildRelease(TENANT[tenant]);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result as Required<Omit<BuildResult, 'fallback'>> & Pick<BuildResult, 'fallback'>;
};
const find = (b: Bundle, id: string): BundleEntry | undefined => Object.values(b.entries).flat().find((e) => e.id === id);
const releaseError = async (releaseId: string) =>
  (await ownerQuery<{ error: { omitted?: Array<{ entryId: string }>; fallback?: Array<{ entryId: string; fromRelease: number }> } | null }>(
    'select error from cms.releases where id = $1',
    [releaseId],
  ))[0]!.error;
const alertsOf = async (event: string, releaseId: string) =>
  ownerQuery<{ tenant_id: string; details: Record<string, unknown> }>(
    `select tenant_id, details from cms.audit_log where action = $1 and details ->> 'releaseId' = $2`,
    [`system.alert.${event}`, releaseId],
  );

describe('fallback on the demo tenant, seen on the demo site', () => {
  let site: RunningSite | undefined;
  afterAll(async () => {
    await site?.stop();
  });

  it('reuses only an unchanged revision whose references are allowed; everything else is left out and answers 404', async () => {
    // Release N: every entry projects.
    const reused = await published('demo', 'event', event('Endurnýtt'));
    const changed = await published('demo', 'event', event('Breytt'));
    const target = await published('demo', 'event', event('Markmið'));
    const referrer = await published('demo', 'event', event('Vísar á', target.id));
    const withdrawn = await published('demo', 'event', event('Afturkallað'));
    const archived = await published('demo', 'event', event('Í geymslu'));
    const neverPublished = await draft('demo', 'event', event('Aldrei birt'));
    const n = await delivered('demo');
    for (const e of [reused, changed, target, referrer, withdrawn, archived]) expect(find(n.bundle, e.id), e.slug).toBeDefined();

    // The site is built while release N is current, so every page above is prerendered.
    site = await startSite({ deliveryBaseUrl: `${env.apiUrl}/storage/v1/object/public/delivery` });
    expect((await fetch(`${site.url}/events/${changed.slug}`)).status).toBe(200);

    // Then, before release N+1, each entry fails to project:
    await breakPublishedRevision(reused.id); // same revision, nothing referenced: reused
    await publishBrokenNewRevision('demo', changed.id, { startDate: '2026-12-02' }); // a newer revision: left out
    await breakPublishedRevision(referrer.id); // same revision, but its target is unpublished: left out
    await unpublished('demo', target.id);
    for (const e of [withdrawn, archived]) await breakPublishedRevision(e.id);
    await unpublished('demo', withdrawn.id); // withdrawal wins over a reusable record
    await ownerQuery('update cms.entries set archived_at = now() where id = $1', [archived.id]);

    const next = await delivered('demo');

    expect(find(next.bundle, reused.id)).toEqual(find(n.bundle, reused.id));
    for (const e of [changed, referrer, target, withdrawn, archived, neverPublished]) expect(find(next.bundle, e.id), e.slug).toBeUndefined();
    expect(next.fallback?.map((f) => f.entryId)).toContain(reused.id);
    expect(next.omitted.map((o) => o.entryId)).toEqual(expect.arrayContaining([changed.id, referrer.id]));
    const error = await releaseError(next.releaseId);
    expect(error?.fallback).toEqual([expect.objectContaining({ entryId: reused.id, fromRelease: n.number })]);
    expect(error?.omitted?.map((o) => o.entryId)).toEqual(expect.arrayContaining([changed.id, referrer.id]));
    expect(JSON.stringify(error)).not.toContain(withdrawn.id);
    expect(JSON.stringify(error)).not.toContain(archived.id);
    expect(await alertsOf('release.entry_fallback', next.releaseId)).toEqual([
      { tenant_id: TENANT.demo, details: expect.objectContaining({ fallback: [expect.objectContaining({ entryId: reused.id })] }) },
    ]);
    expect(await alertsOf('release.entry_omitted', next.releaseId)).toHaveLength(1);

    // The site regenerates after the signed webhook (§7.3).
    const body = JSON.stringify({ tenant: 'demo', release: next.number });
    const ts = Math.floor(Date.now() / 1000);
    const revalidated = await fetch(`${site.url}/api/cms/revalidate`, {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/json', [TIMESTAMP_HEADER]: String(ts), [SIGNATURE_HEADER]: signWebhook(body, WEBHOOK_SECRETS[0]!, ts) },
    });
    expect(revalidated.status).toBe(200);

    // Next.js may serve the stale page once while it regenerates; the next request has the new release.
    const page = async (slug: string) => {
      await fetch(`${site!.url}/events/${slug}`);
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch(`${site!.url}/events/${slug}`);
      return { status: res.status, html: await res.text() };
    };
    for (const e of [changed, referrer, target, withdrawn, archived, neverPublished]) {
      expect((await page(e.slug)).status, e.slug).toBe(404);
    }
    const kept = await page(reused.slug);
    expect(kept.status).toBe(200);
    expect(parseEntryMarkers(kept.html)).toContainEqual({ id: reused.id, hash: find(n.bundle, reused.id)!.contentHash });
  });
});

describe('fallback on labak: a referenced asset that is archived', () => {
  // Real bytes with their real metadata: the worker re-derives an asset's metadata at publish (M3-07).
  const JPEG = TEST_JPEG;
  async function labakAsset(): Promise<string> {
    const id = randomUUID();
    const path = `${TENANT.labak}/${id}/mynd.jpg`;
    const { error } = await editors.labak.storage.from('media-private').upload(path, JPEG, { contentType: 'image/jpeg' });
    if (error) throw error;
    await rpc('labak', 'register_asset', {
      p_asset_id: id,
      p_tenant_id: TENANT.labak,
      p_original_path: path,
      p_filename: 'mynd.jpg',
      ...TEST_JPEG_METADATA,
    });
    return id;
  }
  const news = (title: string, imageId: string) => ({
    title,
    date: '2026-10-15',
    excerpt: 'Inngangur.',
    image: { _ref: imageId, _kind: 'asset', alt: 'Brauð' },
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
  });

  it('refuses the fallback when a referenced asset is archived now, and reuses it while the asset is not', async () => {
    const keptImage = await labakAsset();
    const archivedImage = await labakAsset();
    const kept = await published('labak', 'news', news('Mynd áfram', keptImage));
    const lost = await published('labak', 'news', news('Mynd í geymslu', archivedImage));
    const n = await delivered('labak');
    expect(find(n.bundle, kept.id)).toBeDefined();
    expect(find(n.bundle, lost.id)).toBeDefined();

    await breakPublishedRevision(kept.id);
    await breakPublishedRevision(lost.id);
    await ownerQuery('update cms.assets set archived_at = now() where id = $1', [archivedImage]);

    const next = await delivered('labak');

    expect(find(next.bundle, kept.id)).toEqual(find(n.bundle, kept.id));
    expect(find(next.bundle, lost.id)).toBeUndefined();
    expect(next.fallback?.map((f) => f.entryId)).toContain(kept.id);
    expect(next.omitted.map((o) => o.entryId)).toContain(lost.id);
  });
});
