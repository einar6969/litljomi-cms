// The overview's reads against the local stack (spec §4.5): `loadTenantOverview` exactly as the page
// runs it, with a client of the `api` schema carrying the persona's own session. RLS alone decides
// what comes back, so an editor of tenant B asking for tenant A gets no rows and no counts above 0,
// not even the fact that A has a site.
import { randomUUID } from 'node:crypto';
import type { StructureNode } from '@litljomi/cms-schema';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { editorApiClient, editorClient } from '../../../../../../tests/integration/src/clients.ts';
import { PERSONAS, TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { t } from '@/i18n/is';
import { loadTenantOverview } from '../tenant-overview';

const STRUCTURE: Record<'labak' | 'demo', StructureNode[]> = {
  labak: [{ type: 'news', label: 'Fréttir' }],
  demo: [
    { group: 'Content', items: [{ type: 'event', label: 'Events' }] },
    { type: 'site-info', label: 'Site info', singleton: true },
  ],
};

const created: string[] = [];
let request: string;
let labakNews: string;
let demoEvent: string;

async function entry(tenant: 'demo' | 'labak', type: string, title: string): Promise<string> {
  const client = await editorClient(tenant === 'demo' ? 'editor_demo' : 'editor_labak');
  const api = client.schema('api');
  const { data: id, error } = await api.rpc('create_entry', { p_tenant_id: TENANT[tenant], p_type: type, p_slug: `overview-${randomUUID().slice(0, 8)}` });
  if (error) throw new Error(`create_entry: ${error.code} ${error.message}`);
  const saved = await api.rpc('save_draft', { p_entry_id: id, p_expected_version: 1, p_data: { title }, p_schema_version: 1, p_title: title, p_sort_at: null });
  if (saved.error) throw new Error(`save_draft: ${saved.error.code} ${saved.error.message}`);
  created.push(id as string);
  return id as string;
}

const load = async (persona: 'editor_labak' | 'editor_demo' | 'outsider', tenant: 'labak' | 'demo', showWaiting = false) =>
  loadTenantOverview(await editorApiClient(persona), { tenantId: TENANT[tenant], structure: STRUCTURE[tenant], showWaiting });

beforeAll(async () => {
  labakNews = await entry('labak', 'news', 'Yfirlit frétt');
  demoEvent = await entry('demo', 'event', 'Yfirlit viðburður');
  const [row] = await ownerQuery<{ id: string }>(
    `insert into cms.publish_requests (tenant_id, entry_id, action, draft_version, requested_by) values ($1, $2, 'publish', 1, $3) returning id`,
    [TENANT.demo, demoEvent, PERSONAS.editor_demo.id],
  );
  request = row!.id;
});

afterAll(async () => {
  // Nothing left waiting or listed, so later specs see the tenants as before.
  await ownerQuery(`update cms.publish_requests set status = 'failed' where id = $1`, [request]);
  await ownerQuery('update cms.entries set archived_at = now() where id = any($1::uuid[]) and archived_at is null', [created]);
  await closeAll();
});

describe('loadTenantOverview under RLS', () => {
  it("shows the tenant's own editor its own rows", async () => {
    const own = await load('editor_demo', 'demo');
    expect(own.recent).toMatchObject({ ok: true });
    expect(own.recent.ok && own.recent.value.map((row) => row.id)).toContain(demoEvent);
    expect(own.counts.get('event')?.total).toBeGreaterThan(0);
    expect(own.status.ok && [...own.status.value.unproven.keys()]).toContain(demoEvent);
    expect(own.band.siteUrl).toBe('http://localhost:3101');

    const labak = await load('editor_labak', 'labak');
    expect(labak.recent.ok && labak.recent.value.map((row) => row.id)).toContain(labakNews);
  });

  it('leaves the columns the overview does not use out of its rows', async () => {
    const own = await load('editor_labak', 'labak');
    expect(own.recent.ok && Object.keys(own.recent.value[0]!).sort()).toEqual(['id', 'status', 'title', 'type', 'updated_at']);
  });

  it("gives an editor of tenant B no rows and no counts of tenant A, in either direction", async () => {
    for (const [persona, tenant] of [
      ['editor_demo', 'labak'],
      ['editor_labak', 'demo'],
    ] as const) {
      for (const showWaiting of [false, true]) {
        const other = await load(persona, tenant, showWaiting);
        expect(other.recent).toEqual({ ok: true, value: [] });
        expect(other.showingWaiting).toBe(false);
        expect(other.status.ok && other.status.value.unproven.size + other.status.value.proven.size).toBe(0);
        expect([...other.counts.values()].every(({ total, drafts }) => total === 0 && drafts === 0)).toBe(true);
        expect(other.pages.every((page) => page.entry === null)).toBe(true);
        // Every read answered, with nothing: the tenant's site is not visible either.
        expect(other.band).toEqual({ heading: t.publish.noSite, tag: false, lastPublished: null, viewChanges: false, siteUrl: null });
      }
    }
  });

  it('gives a non-member none of either tenant', async () => {
    for (const tenant of ['labak', 'demo'] as const) {
      const other = await load('outsider', tenant);
      expect(other.recent).toEqual({ ok: true, value: [] });
      expect([...other.counts.values()].every(({ total }) => total === 0)).toBe(true);
      expect(other.band.heading).toBe(t.publish.noSite);
    }
  });
});
