import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';
import type { Band, StatusSummary } from '../overview';
import { summarizeStatus } from '../overview';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ createEntryAction: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { TenantOverview } = await import('../TenantOverview');

type Overview = React.ComponentProps<typeof TenantOverview>['overview'];

const NOW = new Date('2026-11-05T15:00:00Z');
const ENTRY = { id: 'e1', type: 'news', title: 'Jólabakstur', status: 'published' as const, updated_at: '2026-11-05T14:32:00Z' };
const UP_TO_DATE: Band = { heading: t.overview.upToDate, tag: true, lastPublished: '2026-11-05T14:32:00Z', viewChanges: false, siteUrl: 'https://example.test' };
const summary: StatusSummary = summarizeStatus([]);

const overview = (over: Partial<Overview> = {}): Overview => ({
  band: UP_TO_DATE,
  counts: new Map(),
  recent: { ok: true, value: [ENTRY] },
  showingWaiting: false,
  pages: [],
  pagesFailed: false,
  status: { ok: true, value: summary },
  ...over,
});

const typeLabel = (type: string) => (type === 'news' ? 'Fréttir' : undefined);

const render = (over: Partial<Overview> = {}, structure: React.ComponentProps<typeof TenantOverview>['structure'] = [{ type: 'news', label: 'Fréttir' }]) =>
  renderToStaticMarkup(<TenantOverview tenantSlug="acme" tenantName="Acme" structure={structure} typeLabel={typeLabel} overview={overview(over)} now={NOW} />);

describe('the tenant overview', () => {
  it('keeps the tenant name as the only h1, over the greeting', () => {
    const html = render();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1>Acme</h1>');
    expect(html).toContain(t.tenant.greeting);
  });

  it('labels the band by its heading', () => {
    const html = render();
    expect(html).toMatch(/<section class="band" aria-labelledby="site-state">/);
    expect(html).toContain(`<h2 id="site-state">${t.overview.upToDate}</h2>`);
  });

  it('shows the tag, last published and the site link from the band', () => {
    const html = render();
    expect(html).toContain(`<span class="tag-go">${t.overview.live}</span>`);
    expect(html).toContain(t.overview.lastPublished);
    expect(html).toContain('<time dateTime="2026-11-05T14:32:00Z" class="mono');
    expect(html).toContain('í dag, 14:32');
    expect(html).toContain(`<a href="https://example.test" target="_blank" rel="noopener noreferrer" class="btn btn-line"><span>${t.overview.viewSite}</span>`);
  });

  it('shows none of them when the band has none', () => {
    const html = render({ band: { heading: t.publish.statusUnavailable, tag: false, lastPublished: null, viewChanges: false, siteUrl: null } });
    expect(html).toContain(t.publish.statusUnavailable);
    expect(html).not.toContain('tag-go');
    expect(html).not.toContain(t.overview.lastPublished);
    expect(html).not.toContain(t.overview.viewSite);
    expect(html).not.toContain(t.overview.viewChanges);
  });

  it('links "Skoða breytingar" to the waiting view as an ink button', () => {
    const html = render({ band: { ...UP_TO_DATE, heading: '1 breyting bíður birtingar.', viewChanges: true } });
    expect(html).toMatch(/<a href="\/t\/acme\?breytingar=1#recent" class="btn btn-ink">/);
    expect(html).toContain(t.overview.viewChanges);
  });

  it('heads the recent table with id="recent" and states its roles', () => {
    const html = render();
    expect(html).toMatch(/<h2[^>]*id="recent"[^>]*>/);
    expect(html).toMatch(/<table[^>]*role="table"[^>]*class="[^"]*entry-table/);
    expect(html.match(/<th[^>]*role="columnheader"/g)).toHaveLength(3);
  });

  it('links a row by its id and keeps the type label out of the link', () => {
    const html = render();
    expect(html).toContain('<a href="/t/acme/news/e1" class="t">Jólabakstur</a>');
    expect(html).toContain('Fréttir</span>');
    const link = /<a href="\/t\/acme\/news\/e1"[^>]*>(.*?)<\/a>/.exec(html)![1];
    expect(link).not.toContain('Fréttir');
  });

  it('shows the label it is given, whatever the structure says', () => {
    const html = renderToStaticMarkup(
      <TenantOverview tenantSlug="acme" tenantName="Acme" structure={[]} typeLabel={() => 'Tilkynning'} overview={overview({ recent: { ok: true, value: [{ ...ENTRY, type: 'notice' }] } })} now={NOW} />,
    );
    expect(html).toContain('<span class="ov-type">Tilkynning</span>');
  });

  it('renders no type label when there is none, and never the key', () => {
    const html = render({ recent: { ok: true, value: [{ ...ENTRY, type: 'notice' }] } });
    expect(html).not.toContain('ov-type');
    expect(html).not.toContain('>notice<');
  });

  it('encodes the slug and the type, and names an untitled entry', () => {
    const html = renderToStaticMarkup(
      <TenantOverview
        tenantSlug="a b"
        tenantName="Acme"
        structure={[{ type: 'x/y', label: 'X' }]}
        typeLabel={typeLabel}
        overview={overview({ recent: { ok: true, value: [{ ...ENTRY, type: 'x/y', title: null }] } })}
        now={NOW}
      />,
    );
    expect(html).toContain('href="/t/a%20b/x%2Fy/e1"');
    expect(html).toContain(t.entries.untitled);
  });

  it('shows the empty text for an empty list', () => {
    const html = render({ recent: { ok: true, value: [] } });
    expect(html).toContain(t.entries.empty);
    expect(html).not.toContain('<table');
  });

  it('shows the load error for a failed list, never the empty text', () => {
    const html = render({ recent: { ok: false, code: '42501' } });
    expect(html).toContain(t.editor.reference.loadError);
    expect(html).not.toContain(t.entries.empty);
    expect(html).not.toContain('42501');
  });

  it('offers the way back from the waiting view only', () => {
    expect(render()).not.toContain(t.entries.filter.clear);
    const html = render({ showingWaiting: true });
    expect(html).toContain(t.entries.filter.clear);
    expect(html).toMatch(/<a href="\/t\/acme"[^>]*>Hreinsa síu<\/a>/);
  });

  it('gives a tenant with no singletons no Síður card, and the table the full width', () => {
    const html = render();
    expect(html).not.toContain(`>${t.overview.pages}<`);
    expect(html).toContain('class="ov ov-one"');
  });

  it('lists the singletons in the Síður card, with a pill only when there is an entry', () => {
    const pages = [
      { type: 'about', label: 'Um okkur', entry: { ...ENTRY, id: 's1', type: 'about', status: 'changed' as const } },
      { type: 'hours', label: 'Opnunartímar', entry: null },
    ];
    const html = render({ pages }, [{ type: 'about', label: 'Um okkur', singleton: true }, { type: 'hours', label: 'Opnunartímar', singleton: true }]);
    expect(html).toContain(`>${t.overview.pages}<`);
    expect(html).toContain('class="ov"');
    expect(html).toContain('<a href="/t/acme/about" class="pg-row"><span>Um okkur</span>');
    expect(html).toMatch(/<a href="\/t\/acme\/hours" class="pg-row"><span>Opnunartímar<\/span><\/a>/);
    expect(html).toContain(t.entries.statuses.changed);
  });

  it('keeps the Síður rows with no pills and shows the load error when their read failed', () => {
    const html = render({ pages: [{ type: 'about', label: 'Um okkur', entry: null }], pagesFailed: true }, [{ type: 'about', label: 'Um okkur', singleton: true }]);
    expect(html).toContain('href="/t/acme/about"');
    expect(html).toContain(t.editor.reference.loadError);
  });

  it('lets an unproven state replace green in the list', () => {
    const status = summarizeStatus([
      {
        entry_id: 'e1', action: 'publish', status: 'pending', requested_at: '2026-11-05T12:00:00Z', release_status: null, omitted: false, site_count: 1,
        sites_notified: 0, sites_live_ok: 0, sites_not_confirmed: 0, retries_exhausted: false, live_retrying: false,
      },
    ]);
    const html = render({ status: { ok: true, value: status } });
    expect(html).toContain(t.publish.inProgress);
    expect(html).not.toContain('pill-ok');
  });

  it('never shows the ok tone when the status read failed', () => {
    const html = render({ status: { ok: false, code: 'capped' } });
    expect(html).toContain(t.entries.statuses.published);
    expect(html).not.toContain('pill-ok');
  });
});
