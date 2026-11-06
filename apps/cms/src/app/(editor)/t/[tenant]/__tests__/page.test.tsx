import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/t/acme',
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/editor/NewEntryButton', () => ({ NewEntryButton: () => <button data-new-entry="" /> }));
vi.mock('@/ui/TopBar', () => ({ TopBar: ({ title }: { title: string }) => <header data-top-bar={title} /> }));
const client = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createEditorClient: vi.fn(async () => client) }));
const tenant = vi.hoisted(() => ({ current: null as null | { id: string; slug: string; name: string; status: 'active' | 'suspended' } }));
vi.mock('@/lib/tenant', () => ({
  currentTenant: vi.fn(async () => tenant.current),
  isActive: (row: { status: string }) => row.status === 'active',
}));
const moduleTypes: Record<string, string> = vi.hoisted(() => ({ news: 'Frétt', notice: 'Tilkynning' }));
vi.mock('@/modules/registry', () => ({
  getModule: () => ({ structure: [{ type: 'news', label: 'Fréttir' }] }),
  getType: (slug: string, type: string) => (slug === 'acme' && moduleTypes[type] ? { name: type, label: moduleTypes[type] } : undefined),
}));
const load = vi.hoisted(() => ({ calls: [] as unknown[][], recent: [] as unknown[] }));
vi.mock('@/editor/server/tenant-overview', () => ({
  loadTenantOverview: vi.fn(async (...args: unknown[]) => {
    load.calls.push(args);
    return {
      band: { heading: 'Staðan', tag: false, lastPublished: null, viewChanges: false, siteUrl: null },
      counts: new Map(),
      recent: { ok: true, value: load.recent },
      showingWaiting: false,
      pages: [],
      pagesFailed: false,
      status: { ok: false, code: 'x' },
    };
  }),
}));

const { default: TenantHome } = await import('../page');

const ACTIVE = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as const };
const render = async (searchParams: Record<string, string | string[] | undefined> = {}) => {
  const element = await TenantHome({ params: Promise.resolve({ tenant: 'acme' }), searchParams: Promise.resolve(searchParams) });
  return element === null ? null : renderToStaticMarkup(element);
};

beforeEach(() => {
  load.calls = [];
  load.recent = [];
  tenant.current = ACTIVE;
});

describe('the tenant home', () => {
  it('keeps the top bar and renders the overview in main', async () => {
    const html = await render();
    expect(html).toContain(`data-top-bar="${t.app.title}"`);
    expect(html).toContain('<main class="page page-home">');
    expect(html).toContain('<h1>Acme</h1>');
    expect(html).toContain('Staðan');
  });

  it('loads under the editor client, for the resolved tenant', async () => {
    await render();
    expect(load.calls).toEqual([[client, { tenantId: ACTIVE.id, structure: [{ type: 'news', label: 'Fréttir' }], showWaiting: false }]]);
  });

  it('asks for the waiting entries only for the exact param', async () => {
    await render({ breytingar: '1' });
    await render({ breytingar: ['1'] });
    await render({ breytingar: '2' });
    expect(load.calls.map((call) => (call[1] as { showWaiting: boolean }).showWaiting)).toEqual([true, false, false]);
  });

  describe('the type label of a recent row', () => {
    const row = (id: string, type: string) => ({ id, type, title: `Færsla ${id}`, status: 'draft', updated_at: '2026-11-05T12:00:00Z' });

    it('is the structure\'s label, then the module\'s for a type outside the structure', async () => {
      load.recent = [row('e1', 'news'), row('e2', 'notice')];
      const html = await render();
      expect(html).toContain('<span class="ov-type">Fréttir</span>');
      expect(html).toContain('<span class="ov-type">Tilkynning</span>');
      expect(html).not.toContain('>Frétt<');
      expect(html).not.toContain('>notice<');
    });

    it('is left out when neither has one, and the key is never shown', async () => {
      load.recent = [row('e3', 'ghost')];
      const html = await render();
      expect(html).toContain('Færsla e3');
      expect(html).not.toContain('ov-type');
      expect(html).not.toContain('>ghost<');
    });
  });

  it('renders nothing and reads nothing for an inactive tenant', async () => {
    tenant.current = { ...ACTIVE, status: 'suspended' };
    expect(await render()).toBeNull();
    expect(load.calls).toEqual([]);
  });

  it('answers 404 for an unknown tenant', async () => {
    tenant.current = null;
    await expect(render()).rejects.toThrow('NOT_FOUND');
  });
});
