// The `reference` field kind against the local stack (plan M2-04; spec §4.3, §6.2 step 5 and
// "Unpublish", §7.1, §8.5 Delivery row). The demo module's event type has an optional `related`
// reference to another event. Editors act over the Data API with their own sessions; the worker
// runs as service_role with the secret key, as in production. Release assertions are about the
// entries each test creates: a demo build includes whatever demo content earlier files published.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BundleEntry } from '@litljomi/cms-sdk';
import { editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { buildRelease } from '../build-release';
import { processRequestById } from '../process-request';

let demo: SupabaseClient;
let labak: SupabaseClient;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  demo = await editorClient('editor_demo');
  labak = await editorClient('editor_labak');
  // A demo release left building by a run that stopped mid-build blocks the tenant; it is failed
  // the way the sweep fails it, only once it is stale (as labak-setup.ts does for labak).
  await withTx('service', (w) => w.query('select * from api.worker_fail_stale_releases()'));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

const rpcAs = async <T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await client.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};
const rpc = <T>(fn: string, args: Record<string, unknown>) => rpcAs<T>(demo, fn, args);

const slug = () => `m204-${randomUUID().slice(0, 8)}`;
const ref = (id: string) => ({ _ref: id, _kind: 'entry' });
const event = (title: string, extra: Record<string, unknown> = {}) => ({ title, startDate: '2026-12-01', ...extra });

/** A demo event created and saved by editor_demo (not published). */
async function draft(data: Record<string, unknown>) {
  const s = slug();
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'event', p_slug: s });
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  return { id, version, slug: s };
}

const requestPublish = (e: { id: string; version: number }) =>
  rpc<string>('request_publish', { p_entry_id: e.id, p_expected_draft_version: e.version });

/** Publishes through the real path: request_publish, then worker step 1. */
async function published(data: Record<string, unknown>) {
  const d = await draft(data);
  expect((await processRequestById(await requestPublish(d))).status).toBe('committed');
  return d;
}

const revisionCount = async (entryId: string) =>
  (await ownerQuery<{ n: number }>('select count(*)::int as n from cms.revisions where entry_id = $1', [entryId]))[0]!.n;

async function deliveredEvents(): Promise<BundleEntry[]> {
  const result = await buildRelease(TENANT.demo);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result.bundle!.entries['event'] ?? [];
}

describe('reference field (demo event.related)', () => {
  it('a reference to another tenant\'s entry fails validation and is never committed', async () => {
    const labakEntry = await rpcAs<string>(labak, 'create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: slug() });
    const entry = await draft(event('Viðburður'));
    // A draft cannot hold another tenant's reference: the refs trigger's same-tenant foreign keys
    // refuse the write. The direct-RPC bypass is set up as the owner, with the refs trigger disabled
    // for this one update inside a transaction (as 090_api_worker.test.sql does).
    await expect(
      rpc('save_draft', {
        p_entry_id: entry.id,
        p_expected_version: entry.version,
        p_data: event('Viðburður', { related: ref(labakEntry) }),
        p_schema_version: 1,
        p_title: null,
        p_sort_at: null,
      }),
    ).rejects.toThrow();
    const version = await withTx('owner', async (c) => {
      await c.query('alter table cms.drafts disable trigger drafts_sync_refs_on_update');
      const { rows } = await c.query(
        `update cms.drafts set data = data || jsonb_build_object('related', jsonb_build_object('_ref', $2::text, '_kind', 'entry')),
                               version = version + 1
         where entry_id = $1 returning version`,
        [entry.id, labakEntry],
      );
      await c.query('alter table cms.drafts enable trigger drafts_sync_refs_on_update');
      return rows[0].version as number;
    });

    const outcome = await processRequestById(await requestPublish({ id: entry.id, version }));

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({
      code: 'invalid_reference',
      refs: [{ path: '$."related"', kind: 'entry', id: labakEntry, reason: 'not_found' }],
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('a reference to an unpublished entry is refused', async () => {
    const target = await draft(event('Óbirtur')); // never published
    const entry = await draft(event('Viðburður', { related: ref(target.id) }));

    const outcome = await processRequestById(await requestPublish(entry));

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({
      code: 'invalid_reference',
      refs: [{ path: '$."related"', kind: 'entry', id: target.id, reason: 'unpublished' }],
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('resolves to the target\'s summary; unpublishing the target succeeds and the next release resolves it to null', async () => {
    const target = await published(event('Opið hús'));
    const entry = await published(event('Eftirfylgni', { related: ref(target.id) }));

    const before = (await deliveredEvents()).find((e) => e.id === entry.id);
    expect(before?.data.related).toEqual({
      id: target.id,
      type: 'event',
      slug: target.slug,
      title: 'Opið hús',
      path: `/events/${target.slug}`,
    });

    // §6.2 "Unpublish": never refused because other entries reference the entry.
    const requestId = await rpc<string>('request_unpublish', { p_entry_id: target.id });
    expect((await processRequestById(requestId)).status).toBe('committed');

    const events = await deliveredEvents();
    expect(events.some((e) => e.id === target.id)).toBe(false);
    const after = events.find((e) => e.id === entry.id);
    expect(after).toBeDefined();
    expect(after!.data.related).toBeNull();
    expect(after!.revisionId).toBe(before!.revisionId);
    expect(after!.contentHash).not.toBe(before!.contentHash);
  });
});
