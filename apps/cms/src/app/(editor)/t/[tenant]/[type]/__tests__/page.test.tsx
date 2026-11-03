import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('@/editor/NewEntryButton', () => ({ NewEntryButton: () => <button data-new-entry="" /> }));
vi.mock('@/editor/OpenSingleton', () => ({ OpenSingleton: ({ type }: { type: string }) => <div data-open-singleton={type} /> }));
const rows = vi.hoisted(() => ({ data: [] as unknown[], calls: [] as unknown[][] }));
vi.mock('@/lib/supabase/server', () => ({
  createEditorClient: vi.fn(async () => {
    // Records every filter call, so the tests see what the page asked api.entry_list for.
    const record = (method: string) => (...args: unknown[]) => {
      rows.calls.push([method, ...args]);
      return query;
    };
    const query = {
      select: record('select'), eq: record('eq'), is: record('is'), ilike: record('ilike'), not: record('not'), order: record('order'),
      limit: async () => ({ data: rows.data, error: null }),
    };
    return { from: () => query };
  }),
}));
const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as const };
vi.mock('@/lib/tenant', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tenant')>()), currentTenant: vi.fn(async () => TENANT) }));
const structure = vi.hoisted(() => ({ singleton: false }));
vi.mock('@/modules/registry', () => ({
  getType: () => ({ name: 'news', label: 'Fréttir' }),
  getModule: () => ({ structure: [{ type: 'news', label: 'Fréttir', singleton: structure.singleton }] }),
}));

const { default: EntryListPage } = await import('../page');

const render = async (searchParams: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await EntryListPage({ params: Promise.resolve({ tenant: 'acme', type: 'news' }), searchParams: Promise.resolve(searchParams) }));

beforeEach(() => {
  structure.singleton = false;
  rows.calls = [];
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

describe('a singleton type (M2-09; spec §10.1)', () => {
  it('has no list and no "new entry" button: the page opens its one entry', async () => {
    structure.singleton = true;
    const html = await render();
    expect(html).toContain('data-open-singleton="news"');
    expect(html).not.toContain('<table');
    expect(html).not.toContain('data-new-entry');
    expect(html).toContain('<h1>Fréttir</h1>');
  });
  it('an ordinary type keeps its list and button', async () => {
    const html = await render();
    expect(html).toContain('<table');
    expect(html).toContain('data-new-entry');
    expect(html).not.toContain('data-open-singleton');
  });
});

describe('the entry list search and status filter (M2-10)', () => {
  it('without search params lists the type\'s entries that are not archived', async () => {
    await render();
    expect(rows.calls).toContainEqual(['eq', 'tenant_id', TENANT.id]);
    expect(rows.calls).toContainEqual(['eq', 'type', 'news']);
    expect(rows.calls).toContainEqual(['is', 'archived_at', null]);
    expect(rows.calls.some(([m]) => m === 'ilike')).toBe(false);
  });

  it('applies the search and the status from the URL to the query', async () => {
    await render({ q: ' kaka ', status: 'unpublished' });
    expect(rows.calls).toContainEqual(['ilike', 'title', '%kaka%']);
    expect(rows.calls).toContainEqual(['eq', 'status', 'draft']);
    expect(rows.calls).toContainEqual(['not', 'first_published_at', 'is', null]);
    expect(rows.calls).not.toContainEqual(['is', 'archived_at', null]);
  });

  it('is a GET search form back to the list, showing the URL\'s state', async () => {
    const html = await render({ q: 'Brauð "ársins"', status: 'archived' });
    const form = html.match(/<form[^>]*>/)?.[0] ?? '';
    for (const attr of ['role="search"', 'aria-label="Leit og sía"', 'method="get"', 'action="/t/acme/news"']) expect(form).toContain(attr);
    expect(html).toMatch(/<label for="entry-search"[^>]*><span>Leita í titlum<\/span><input id="entry-search"[^>]*>/);
    const input = html.match(/<input id="entry-search"[^>]*>/)?.[0] ?? '';
    for (const attr of ['name="q"', 'type="search"', 'value="Brauð &quot;ársins&quot;"']) expect(input).toContain(attr);
    expect(html).toMatch(/<option value="archived" selected="">Í skjalasafni<\/option>/);
    expect(html).toContain('<option value="unpublished">Tekið af vef</option>');
    expect(html).toMatch(/<button type="submit"[^>]*>Sía<\/button>/);
  });

  it('offers every status in the filter, and "all but archived" first', async () => {
    const html = await render();
    const options = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
    expect(options).toEqual(['', 'draft', 'published', 'changed', 'unpublished', 'archived']);
    expect(html).toMatch(/<option value="" selected="">Allar nema í skjalasafni<\/option>/);
  });

  it('offers to clear the filter only while one is applied', async () => {
    expect(await render()).not.toContain('Hreinsa síu');
    expect(await render({ status: 'draft' })).toMatch(/<a href="\/t\/acme\/news"[^>]*>Hreinsa síu<\/a>/);
  });

  it('says that nothing matched, not that there are no entries, when a filter finds none', async () => {
    rows.data = [];
    expect(await render()).toContain('Engar færslur ennþá.');
    const filtered = await render({ q: 'ekkert' });
    expect(filtered).toContain('Engar færslur passa við leitina.');
    expect(filtered).not.toContain('Engar færslur ennþá.');
  });

  it('ignores an unknown status', async () => {
    await render({ status: 'deleted' });
    expect(rows.calls).toContainEqual(['is', 'archived_at', null]);
    expect(rows.calls.some(([m, c]) => m === 'eq' && c === 'status')).toBe(false);
  });
});
