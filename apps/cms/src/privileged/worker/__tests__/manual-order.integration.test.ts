// A12: manual ordering against the local stack (migration 20261112230000_manual_order; spec §4.6
// api.move_entry, §5.1, §7.2). The demo module's `partner` type is ordered by hand. Editors act over
// the Data API (PostgREST) with their own sessions; the worker runs as service_role with the secret
// key, as in production. The demo tenant keeps whatever earlier files and runs published, so every
// assertion about order is about the entries this file creates, in their relative order (a
// subsequence of the type's order keeps that order).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isManuallyOrdered } from '@litljomi/cms-schema';
import type { Bundle } from '@litljomi/cms-sdk';
import { anonClient, editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { getModule } from '@/modules/registry';
import { buildRelease } from '../build-release';
import { manualTypes, releaseView } from '../deliver';
import { processRequestById } from '../process-request';

let demo: SupabaseClient;
let labak: SupabaseClient;

beforeAll(async () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  demo = await editorClient('editor_demo');
  labak = await editorClient('editor_labak');
  // A demo release left building by a run that stopped mid-build blocks the tenant (as in
  // list-group.integration.test.ts).
  await withTx('service', (w) => w.query('select * from api.worker_fail_stale_releases()'));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await closeAll();
});

const module = getModule('demo')!;
const PARTNER = module.types.find((t) => isManuallyOrdered(t))!.name;

const rpcAs = async <T>(client: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await client.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};
const rpc = <T>(fn: string, args: Record<string, unknown>) => rpcAs<T>(demo, fn, args);
const move = (entryId: string, targetId: string, place: 'before' | 'after', client = demo) =>
  rpcAs<null>(client, 'move_entry', { p_entry_id: entryId, p_target_id: targetId, p_place: place });

/** A partner created and saved by editor_demo, each in its own request (so its own created_at). */
async function partner(title: string): Promise<{ id: string; version: number }> {
  const id = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: PARTNER, p_slug: `a12-${randomUUID().slice(0, 8)}` });
  const version = await rpc<number>('save_draft', {
    p_entry_id: id,
    p_expected_version: 1,
    p_data: { title },
    p_schema_version: 1,
    p_title: title,
    p_sort_at: null,
  });
  return { id, version };
}
async function publish(e: { id: string; version: number }) {
  const request = await rpc<string>('request_publish', { p_entry_id: e.id, p_expected_draft_version: e.version });
  expect((await processRequestById(request)).status).toBe('committed');
}

/** The type's list as the editor's page asks for it, narrowed to `ids`. */
async function listed(ids: string[]): Promise<string[]> {
  const { data, error } = await demo
    .schema('api')
    .from('entry_list')
    .select('id')
    .eq('tenant_id', TENANT.demo)
    .eq('type', PARTNER)
    .is('archived_at', null)
    .order('order_position', { ascending: true })
    .order('id', { ascending: true })
    .limit(1000);
  if (error) throw new Error(`entry_list: ${error.code}`);
  return (data as { id: string }[]).map((r) => r.id).filter((id) => ids.includes(id));
}

async function delivered(): Promise<Bundle> {
  const result = await buildRelease(TENANT.demo);
  expect(result.status, JSON.stringify(result)).toBe('delivered');
  return result.bundle!;
}
const inBundle = (bundle: Bundle, type: string, ids: string[]) => (bundle.entries[type] ?? []).map((e) => e.id).filter((id) => ids.includes(id));

describe('manual ordering of the demo partners (A12)', () => {
  it('orders newest first until moved, moves through PostgREST, and the release lists the partners in that order', async () => {
    const a = await partner('Alfa');
    const b = await partner('Beta');
    const c = await partner('Gamma');
    const ids = [a.id, b.id, c.id];
    // Newest first, with nothing written to any of them.
    expect(await listed(ids)).toEqual([c.id, b.id, a.id]);
    const keys = await ownerQuery<{ n: number }>('select count(*)::int as n from cms.entries where id = any($1::uuid[]) and order_key is not null', [ids]);
    expect(keys[0]!.n).toBe(0);

    await move(a.id, c.id, 'before');
    expect(await listed(ids)).toEqual([a.id, c.id, b.id]);
    await move(b.id, a.id, 'after');
    expect(await listed(ids)).toEqual([a.id, b.id, c.id]);

    for (const e of [a, b, c]) await publish(e);
    const bundle = await delivered();
    expect(bundle.format).toBe(1);
    expect(inBundle(bundle, PARTNER, ids)).toEqual([a.id, b.id, c.id]);
    for (const e of (bundle.entries[PARTNER] ?? []).filter((x) => ids.includes(x.id))) expect(e.sortAt).toBeNull();
    // What the module's site checks see: the same order.
    const view = releaseView(bundle, manualTypes(module));
    expect(view.entries(PARTNER).map((e) => e.id).filter((id) => ids.includes(id))).toEqual([a.id, b.id, c.id]);

    // A move reaches the bundle with the next release; it is not a publish of its own.
    await move(c.id, a.id, 'before');
    expect(inBundle(await delivered(), PARTNER, ids)).toEqual([c.id, a.id, b.id]);

    // The moves are audited, with the editor as actor.
    const audit = await ownerQuery<{ n: number }>(
      `select count(*)::int as n from cms.audit_log where action = 'entry.moved' and target_id = any($1::uuid[]) and actor_id is not null`,
      [ids],
    );
    expect(audit[0]!.n).toBe(3);
  });

  it('a new partner comes first, before partners that were moved', async () => {
    const a = await partner('Delta');
    const b = await partner('Epsilon');
    await move(a.id, b.id, 'before');
    const fresh = await partner('Zeta');
    expect(await listed([a.id, b.id, fresh.id])).toEqual([fresh.id, a.id, b.id]);
    for (const e of [a, b, fresh]) await publish(e);
    expect(inBundle(await delivered(), PARTNER, [a.id, b.id, fresh.id])).toEqual([fresh.id, a.id, b.id]);
  });

  it('leaves a type ordered by a field as it was: the bundle lists events by entry id, the view by sortAt', async () => {
    const bundle = await delivered();
    const events = (bundle.entries['event'] ?? []).map((e) => e.id);
    expect(events).toEqual([...events].sort());
  });

  it('refuses over PostgREST: anon, another tenant\'s editor, a target of another type, an archived target', async () => {
    const a = await partner('Eta');
    const b = await partner('Theta');
    const anon = await anonClient().schema('api').rpc('move_entry', { p_entry_id: a.id, p_target_id: b.id, p_place: 'before' });
    expect(anon.error?.code).toBe('42501');
    await expect(move(a.id, b.id, 'before', labak)).rejects.toThrow('P0001 not_found');
    const event = await rpc<string>('create_entry', { p_tenant_id: TENANT.demo, p_type: 'event', p_slug: `a12-${randomUUID().slice(0, 8)}` });
    await expect(move(a.id, event, 'before')).rejects.toThrow('P0001 forbidden');
    await rpc('archive_entry', { p_entry_id: b.id });
    await expect(move(a.id, b.id, 'after')).rejects.toThrow('P0001 forbidden');
    await expect(move(a.id, b.id, 'sideways' as 'before')).rejects.toThrow('22023');
    const keys = await ownerQuery<{ n: number }>('select count(*)::int as n from cms.entries where id = any($1::uuid[]) and order_key is not null', [[a.id, b.id]]);
    expect(keys[0]!.n).toBe(0);
  });
});
