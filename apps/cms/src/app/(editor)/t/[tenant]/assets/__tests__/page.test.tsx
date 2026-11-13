import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NOT_FOUND');
  }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, scroll: _scroll, ...rest }: { href: string; children: React.ReactNode; scroll?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const TENANT = { id: '00000000-0000-4000-8000-0000000000f1', slug: 'acme', name: 'Acme', status: 'active' as const };
const FILE = '00000000-0000-4000-8000-0000000000a1';
const ENTRY = '00000000-0000-4000-8000-0000000000e1';

type Answer = { data: unknown; count?: number | null; error: { code: string } | null };
const db = vi.hoisted(() => ({
  summary: { data: { files: 2, bytes: 61_952, unused: 1 } as unknown, error: null as { code: string } | null },
  list: { data: [] as unknown[], error: null as { code: string } | null },
  file: { data: null as unknown, error: null },
  usage: { data: [] as unknown[], error: null },
  status: { data: [] as unknown[], count: 0 as number | null, error: null as { code: string } | null },
  abandoned: { data: [] as unknown[], count: 0 as number | null, error: null },
  /** Every query: its table and the calls made on it. */
  queries: [] as { table: string; calls: unknown[][] }[],
  signed: [] as string[][],
}));

vi.mock('@/lib/supabase/server', () => ({
  createEditorClient: vi.fn(async () => ({
    rpc: async (name: string, args: unknown) => (db.queries.push({ table: `rpc:${name}`, calls: [[args]] }), db.summary),
    from(table: string) {
      const query = { table, calls: [] as unknown[][] };
      db.queries.push(query);
      const answer = (): Answer => {
        if (table === 'asset_usage') return db.usage;
        if (table === 'publication_status') return db.status;
        if (table === 'entry_list') return db.abandoned;
        return query.calls.some((c) => c[0] === 'eq' && c[1] === 'id') ? db.file : db.list;
      };
      const chain: Record<string, unknown> = {
        then: (resolve: (a: Answer) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject),
      };
      for (const method of ['select', 'eq', 'is', 'not', 'limit', 'ilike', 'order', 'in', 'range']) {
        chain[method] = (...args: unknown[]) => (query.calls.push([method, ...args]), chain);
      }
      chain.maybeSingle = async () => (query.calls.push(['maybeSingle']), answer());
      return chain;
    },
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => (db.signed.push(paths), { data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })), error: null }),
        createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }),
      }),
    },
  })),
}));
vi.mock('@/lib/tenant', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/tenant')>()), currentTenant: vi.fn(async () => TENANT) }));
vi.mock('@/modules/registry', () => ({ getType: (_slug: string, type: string) => (type === 'news' ? { name: 'news', label: 'Frétt' } : undefined) }));

const { default: LibraryPage } = await import('../page');

const render = async (searchParams: Record<string, string | string[]> = {}) =>
  renderToStaticMarkup(await LibraryPage({ params: Promise.resolve({ tenant: 'acme' }), searchParams: Promise.resolve(searchParams) }));

const row = (n: number, o: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  filename: `mynd-${n}.jpg`,
  mime: 'image/jpeg',
  kind: 'image',
  width: 64,
  height: 48,
  bytes: 30_976,
  created_at: '2026-10-04T12:00:00Z',
  default_alt: null,
  thumb_path: `${TENANT.id}/x/thumb/480.webp`.replace('x', String(n)),
  ...o,
});

const listQuery = () => db.queries.find((q) => q.table === 'asset_list' && !q.calls.some((c) => c[0] === 'maybeSingle'))!;

beforeEach(() => {
  db.summary = { data: { files: 2, bytes: 61_952, unused: 1 }, error: null };
  db.list = { data: [row(1), row(2, { default_alt: 'Brauð', thumb_path: null })], error: null };
  db.file = { data: null, error: null };
  db.usage = { data: [], error: null };
  db.status = { data: [], count: 0, error: null };
  db.abandoned = { data: [], count: 0, error: null };
  db.queries = [];
  db.signed = [];
});

describe('the library page', () => {
  it("lists the tenant's files that are not taken out, newest first, the first 60 and one more", async () => {
    const html = await render();
    expect(html).toContain(`<h1>${t.library.title}</h1>`);
    expect(listQuery().calls).toEqual([
      ['select', 'id, filename, mime, kind, width, height, bytes, created_at, default_alt, thumb_path'],
      ['eq', 'tenant_id', TENANT.id],
      ['is', 'archived_at', null],
      ['order', 'created_at', { ascending: false }],
      ['order', 'id', { ascending: true }],
      ['range', 0, 60],
    ]);
    expect(db.queries.find((q) => q.table === 'rpc:asset_summary')?.calls).toEqual([[{ p_tenant_id: TENANT.id }]]);
    expect(html).toContain('mynd-1.jpg');
    expect(html).toContain('aria-label="mynd-2.jpg, Brauð"');
  });

  it('signs the listed thumbnails in one call and leaves a file without one to the browser', async () => {
    const html = await render();
    expect(db.signed).toEqual([[`${TENANT.id}/1/thumb/480.webp`]]);
    expect(html).toContain(`src="https://signed/${TENANT.id}/1/thumb/480.webp"`);
  });

  it('shows the summary line with the unused count as a link to the unused filter', async () => {
    const html = await render();
    expect(html).toContain('2 skrár · 60,5 KB');
    expect(html).toContain(`<a href="/t/acme/assets?filter=unused">1 ónotuð</a>`);
  });

  it('applies the search, a filter and a sort from the URL, and keeps them in the links', async () => {
    const html = await render({ q: 'brauð', filter: 'missing-alt', sort: 'name', view: 'list' });
    expect(listQuery().calls).toContainEqual(['ilike', 'search_text', '%brauð%']);
    expect(listQuery().calls).toContainEqual(['is', 'missing_alt', true]);
    expect(listQuery().calls).toContainEqual(['order', 'filename', { ascending: true }]);
    expect(html).toContain('<table role="table"');
    // Dates are written on the server, in Icelandic.
    expect(html).toContain('<time dateTime="2026-10-04T12:00:00Z">4. okt. 2026</time>');
    expect(html).toContain(`href="/t/acme/assets?q=brau%C3%B0&amp;filter=missing-alt&amp;sort=name&amp;view=list&amp;file=${row(1).id}"`);
    // The usage counts of the list view.
    expect(db.queries.find((q) => q.table === 'asset_usage')?.calls).toContainEqual(['in', 'asset_id', [row(1).id, row(2).id]]);
    expect(html).toContain(t.entries.filter.clear);
  });

  it('offers "Sýna fleiri" when there are more files, and reads every page up to the one asked for', async () => {
    db.list = { data: Array.from({ length: 121 }, (_, i) => row(i + 1)), error: null };
    const html = await render({ page: '2' });
    expect(listQuery().calls).toContainEqual(['range', 0, 120]);
    expect(html.match(/class="lib-card"/g)).toHaveLength(120);
    expect(html).toContain(`href="/t/acme/assets?page=3"`);
    expect(html).toContain(t.library.more);
  });

  it('says so when the last page it can show still has more', async () => {
    db.list = { data: Array.from({ length: 961 }, (_, i) => row(i + 1)), error: null };
    const html = await render({ page: '16' });
    expect(html).not.toContain(t.library.more);
    expect(html).toContain(t.library.capped.replace('{n}', '960'));
  });

  it('has one card with "Hlaða upp" for an empty library, and no toolbar', async () => {
    db.summary = { data: { files: 0, bytes: 0, unused: 0 }, error: null };
    db.list = { data: [], error: null };
    const html = await render();
    expect(html).toContain(t.library.empty);
    expect(html).not.toContain('role="search"');
    expect(html.match(new RegExp(`${t.library.upload}</button>`, 'g'))).toHaveLength(1);
  });

  it('says when no file matches, with a way to clear the search', async () => {
    db.list = { data: [], error: null };
    const html = await render({ q: 'ekkert' });
    expect(html).toContain(t.library.none);
    expect(html).toMatch(new RegExp(`<div class="card empty"><p>${t.library.none}</p><a href="/t/acme/assets"[^>]*>${t.entries.filter.clear}</a>`));
  });

  it("opens a file's details beside the files, with its usage linked to each entry", async () => {
    db.file = {
      data: { ...row(1), id: FILE, focal_x: null, focal_y: null, caption: 'Nýbakað', credit: null },
      error: null,
    };
    db.usage = { data: [{ entry_id: ENTRY, type: 'news', title: 'Ný frétt', in_draft: true, in_published: true }], error: null };
    const html = await render({ file: FILE });
    const fileQuery = db.queries.find((q) => q.table === 'asset_list' && q.calls.some((c) => c[0] === 'maybeSingle'))!;
    expect(fileQuery.calls).toContainEqual(['eq', 'id', FILE]);
    expect(fileQuery.calls).toContainEqual(['eq', 'tenant_id', TENANT.id]);
    expect(fileQuery.calls).toContainEqual(['is', 'archived_at', null]);
    expect(db.queries.find((q) => q.table === 'asset_usage')?.calls).toContainEqual(['eq', 'asset_id', FILE]);
    expect(html).toContain('class="lib has-panel"');
    expect(html).toContain(t.library.detail.title);
    expect(html).toContain(`href="/t/acme/news/${ENTRY}"`);
    expect(html).toContain(t.library.detail.nextPublish);
    expect(html).toContain(`href="/t/acme/assets/${FILE}/original"`);
    // The entry has no publish request on record: nothing proves it live, so the pill never says so (§7.4).
    expect(html).not.toContain(t.library.usage.live);
  });

  it('labels a file\'s use "on the site" only for an entry whose publish is confirmed live, and reads the proof as the overview does', async () => {
    db.file = { data: { ...row(1), id: FILE, focal_x: null, focal_y: null, caption: null, credit: null }, error: null };
    db.usage = { data: [{ entry_id: ENTRY, type: 'news', title: 'Ný frétt', in_draft: false, in_published: true }], error: null };
    const publish = {
      entry_id: ENTRY,
      action: 'publish',
      status: 'committed',
      requested_at: '2026-11-01T10:00:00Z',
      release_status: 'delivered',
      omitted: false,
      site_count: 1,
      sites_notified: 1,
      sites_live_ok: 0,
      sites_not_confirmed: 0,
      retries_exhausted: false,
      live_retrying: false,
      latest_action: 'publish',
      nothing_checked: false,
    };
    // Committed and delivered, the live check still running.
    db.status = { data: [publish], count: 1, error: null };
    let html = await render({ file: FILE });
    expect(html).toContain(t.publish.revalidated);
    expect(html).not.toContain(t.library.usage.live);
    expect(db.queries.some((q) => q.table === 'publication_status' && q.calls.some((c) => c[0] === 'eq' && c[1] === 'tenant_id' && c[2] === TENANT.id))).toBe(true);

    // The status read failed: never "on the site".
    db.status = { data: null as unknown as unknown[], count: null, error: { code: '57014' } };
    html = await render({ file: FILE });
    expect(html).not.toContain(t.library.usage.live);
    expect(html).toContain(t.library.detail.nextPublish);

    // Every site confirmed.
    db.status = { data: [{ ...publish, sites_live_ok: 1 }], count: 1, error: null };
    html = await render({ file: FILE });
    expect(html).toContain(t.library.usage.live);
  });

  it('shows no panel for a file it cannot find, and throws a database error with its code only', async () => {
    const html = await render({ file: FILE });
    expect(html).not.toContain('has-panel');
    db.list = { data: null as unknown as unknown[], error: { code: '57014' } };
    await expect(render()).rejects.toThrow('asset_list: 57014');
  });
});
