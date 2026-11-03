// The `list` and `group` field kinds against the local stack (plan M2-06; spec §4.3 "`_ref` at any
// depth", §5.2, §6.2 step 5, A13). The demo module's event type has an optional `program` group
// holding `highlights`, a list of references to events, so a reference sits inside a list inside a
// group. Editors act over the Data API with their own sessions; the worker runs as service_role
// with the secret key, as in production. Release assertions are about the entries each test
// creates: a demo build includes whatever demo content earlier files published.
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

const slug = () => `m206-${randomUUID().slice(0, 8)}`;
const ref = (id: string) => ({ _ref: id, _kind: 'entry' });
const event = (title: string, extra: Record<string, unknown> = {}) => ({ title, startDate: '2026-12-01', ...extra });
/** `program.highlights` holding the given entries, keyed h0, h1, … */
const program = (...ids: string[]) => ({ program: { intro: 'Dagskrá', highlights: ids.map((id, i) => ({ _key: `h${i}`, value: ref(id) })) } });
/** Where the refs trigger and the worker report a highlight: a list item's value inside the group. */
const highlightPath = (i: number) => `$."program"."highlights"[${i}]."value"`;

const save = (id: string, expectedVersion: number, data: Record<string, unknown>) =>
  rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: expectedVersion,
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });

/** A demo event created and saved by editor_demo (not published). */
async function draft(data: Record<string, unknown>) {
  const s = slug();
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'event', p_slug: s });
  return { id, version: await save(id, 1, data), slug: s };
}

const requestPublish = (e: { id: string; version: number }) =>
  rpc<string>('request_publish', { p_entry_id: e.id, p_expected_draft_version: e.version });

/** Publishes through the real path: request_publish, then worker step 1. */
async function published(data: Record<string, unknown>) {
  const d = await draft(data);
  expect((await processRequestById(await requestPublish(d))).status).toBe('committed');
  return d;
}

const draftRefs = (entryId: string) =>
  ownerQuery<{ path: string; target_entry_id: string | null }>(
    'select path, target_entry_id from cms.draft_refs where entry_id = $1 order by path',
    [entryId],
  );
const revisionCount = async (entryId: string) =>
  (await ownerQuery<{ n: number }>('select count(*)::int as n from cms.revisions where entry_id = $1', [entryId]))[0]!.n;

async function deliveredEvents(): Promise<BundleEntry[]> {
  const result = await buildRelease(TENANT.demo);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result.bundle!.entries['event'] ?? [];
}

describe('list and group fields (demo event.program.highlights)', () => {
  it('a reference inside a list inside a group is extracted into draft_refs, and follows a reorder', async () => {
    const a = await draft(event('Fyrsti'));
    const b = await draft(event('Annar'));
    const entry = await draft(event('Dagskrá', program(a.id, b.id)));

    expect(await draftRefs(entry.id)).toEqual([
      { path: highlightPath(0), target_entry_id: a.id },
      { path: highlightPath(1), target_entry_id: b.id },
    ]);

    // Reordered: the same keys and targets, at swapped positions.
    const reordered = { ...event('Dagskrá'), program: { intro: 'Dagskrá', highlights: [{ _key: 'h1', value: ref(b.id) }, { _key: 'h0', value: ref(a.id) }] } };
    await save(entry.id, entry.version, reordered);
    expect(await draftRefs(entry.id)).toEqual([
      { path: highlightPath(0), target_entry_id: b.id },
      { path: highlightPath(1), target_entry_id: a.id },
    ]);
  });

  it('a nested reference to another tenant\'s entry is refused on save and at commit', async () => {
    const labakEntry = await rpcAs<string>(labak, 'create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: slug() });
    const target = await published(event('Opið hús'));
    const entry = await draft(event('Dagskrá'));

    // The refs trigger's same-tenant foreign keys refuse the write.
    await expect(save(entry.id, entry.version, event('Dagskrá', program(target.id, labakEntry)))).rejects.toThrow();
    expect(await draftRefs(entry.id)).toEqual([]);

    // The direct-RPC bypass is set up as the owner, with the refs trigger disabled for this one
    // update inside a transaction (as 090_api_worker.test.sql and the M2-04 test do); the commit
    // extracts the references again and refuses the cross-tenant one at its nested path.
    const version = await withTx('owner', async (c) => {
      await c.query('alter table cms.drafts disable trigger drafts_sync_refs_on_update');
      const { rows } = await c.query('update cms.drafts set data = $2::jsonb, version = version + 1 where entry_id = $1 returning version', [
        entry.id,
        JSON.stringify(event('Dagskrá', program(target.id, labakEntry))),
      ]);
      await c.query('alter table cms.drafts enable trigger drafts_sync_refs_on_update');
      return rows[0].version as number;
    });

    const outcome = await processRequestById(await requestPublish({ id: entry.id, version }));

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({
      code: 'invalid_reference',
      refs: [{ path: highlightPath(1), kind: 'entry', id: labakEntry, reason: 'not_found' }],
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('a nested reference to an unpublished entry is refused at commit', async () => {
    const target = await draft(event('Óbirtur')); // never published
    const entry = await draft(event('Dagskrá', program(target.id)));

    const outcome = await processRequestById(await requestPublish(entry));

    expect(outcome.status).toBe('failed_validation');
    expect(outcome.errors).toEqual({
      code: 'invalid_reference',
      refs: [{ path: highlightPath(0), kind: 'entry', id: target.id, reason: 'unpublished' }],
    });
    expect(await revisionCount(entry.id)).toBe(0);
  });

  it('a published nested reference is delivered as the target\'s summary, with the item key', async () => {
    const target = await published(event('Opið hús'));
    const entry = await published(event('Dagskrá', program(target.id)));

    const delivered = (await deliveredEvents()).find((e) => e.id === entry.id);
    expect(delivered?.data.program).toEqual({
      intro: 'Dagskrá',
      highlights: [
        {
          _key: 'h0',
          value: { id: target.id, type: 'event', slug: target.slug, title: 'Opið hús', path: `/events/${target.slug}` },
        },
      ],
    });
  });
});
