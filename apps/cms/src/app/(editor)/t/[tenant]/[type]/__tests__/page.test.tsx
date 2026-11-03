import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/editor/NewEntryButton', () => ({ NewEntryButton: () => null }));
const rows = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/lib/supabase/server', () => ({
  createEditorClient: vi.fn(async () => {
    const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: async () => ({ data: rows.data, error: null }) };
    return { from: () => query };
  }),
}));
const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as const };
vi.mock('@/lib/tenant', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tenant')>()), currentTenant: vi.fn(async () => TENANT) }));
vi.mock('@/modules/registry', () => ({ getType: () => ({ name: 'news', label: 'Fréttir' }) }));

const { default: EntryListPage } = await import('../page');

const render = async () => renderToStaticMarkup(await EntryListPage({ params: Promise.resolve({ tenant: 'acme', type: 'news' }) }));

beforeEach(() => {
  rows.data = [{ id: '00000000-0000-4000-8000-0000000000e1', slug: null, title: 'Frétt', status: 'draft', updated_at: '2026-11-03T12:00:00Z' }];
});

describe('the entry list', () => {
  // Task 31 spec-quality r1: below 768 px the table is restyled as stacked blocks (globals.css),
  // which makes some screen readers (Safari/VoiceOver) drop the table semantics. Explicit roles
  // keep them at every width.
  it('states its table roles explicitly, so stacked rows at phone width stay a table', async () => {
    const html = await render();
    expect(html).toMatch(/<table[^>]*role="table"/);
    expect(html.match(/<thead[^>]*role="rowgroup"/g)).toHaveLength(1);
    expect(html.match(/<tbody[^>]*role="rowgroup"/g)).toHaveLength(1);
    expect(html.match(/<tr[^>]*role="row"/g)).toHaveLength(2);
    expect(html.match(/<th[^>]*role="columnheader"/g)).toHaveLength(3);
    expect(html.match(/<td[^>]*role="cell"/g)).toHaveLength(3);
  });
});
