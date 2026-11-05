import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { t } from '@/i18n/is';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined }) }));
vi.mock('@/app/(editor)/t/[tenant]/actions', () => ({ createEntryAction: vi.fn() }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const { StructureNav } = await import('../StructureNav');

const headings = (html: string) => [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
const links = (html: string) => [...html.matchAll(/<a href="([^"]*)"[^>]*><span>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]]);

describe('StructureNav (M2-09; spec §3.2)', () => {
  it('shows ungrouped types under "Efnisflokkar", as before groups existed', () => {
    const html = renderToStaticMarkup(<StructureNav tenantSlug="acme" structure={[{ type: 'news', label: 'Fréttir' }]} />);
    expect(headings(html)).toEqual([t.tenant.contentTypes]);
    expect(links(html)).toEqual([['/t/acme/news', 'Fréttir']]);
    expect(html).toMatch(/<nav aria-label="[^"]+"/);
  });

  it('follows the declared order of groups and items, each group under its own label', () => {
    const html = renderToStaticMarkup(
      <StructureNav
        tenantSlug="acme"
        structure={[
          { group: 'Efni', items: [{ type: 'page', label: 'Síður' }, { type: 'news', label: 'Fréttir' }] },
          { type: 'links', label: 'Tenglar' },
          { group: 'Annað', items: [{ type: 'staff', label: 'Starfsfólk' }] },
        ]}
      />,
    );
    expect(headings(html)).toEqual(['Efni', t.tenant.contentTypes, 'Annað']);
    expect(links(html)).toEqual([
      ['/t/acme/page', 'Síður'],
      ['/t/acme/news', 'Fréttir'],
      ['/t/acme/links', 'Tenglar'],
      ['/t/acme/staff', 'Starfsfólk'],
    ]);
  });

  it('leaves the singletons to the Síður card, and a section left with nothing with them', () => {
    const html = renderToStaticMarkup(
      <StructureNav
        tenantSlug="acme"
        structure={[
          { type: 'settings', label: 'Stillingar', singleton: true },
          { group: 'Efni', items: [{ type: 'news', label: 'Fréttir' }, { type: 'about', label: 'Um okkur', singleton: true }] },
          { group: 'Annað', items: [{ type: 'footer', label: 'Fótur', singleton: true }] },
        ]}
      />,
    );
    expect(headings(html)).toEqual(['Efni']);
    expect(links(html)).toEqual([['/t/acme/news', 'Fréttir']]);
  });

  it('renders nothing when every type is a singleton', () => {
    const html = renderToStaticMarkup(<StructureNav tenantSlug="acme" structure={[{ type: 'about', label: 'Um okkur', singleton: true }]} />);
    expect(html).toBe('');
  });

  it('shows a card\'s count line outside its link, and leaves it out with no count', () => {
    const html = renderToStaticMarkup(
      <StructureNav
        tenantSlug="acme"
        structure={[{ type: 'news', label: 'Fréttir' }, { type: 'staff', label: 'Starfsfólk' }]}
        counts={new Map([['news', { total: 24, drafts: 1 }]])}
      />,
    );
    expect(html).toContain('<p class="meta-l">24 færslur, 1 uppkast</p>');
    expect(html.match(/meta-l/g)).toHaveLength(1);
    expect(links(html)).toEqual([['/t/acme/news', 'Fréttir'], ['/t/acme/staff', 'Starfsfólk']]);
    const link = /<a href="\/t\/acme\/news"[^>]*>(.*?)<\/a>/.exec(html)![1];
    expect(link).not.toContain('færslur');
  });

  it('encodes the tenant slug and type names in links', () => {
    const html = renderToStaticMarkup(<StructureNav tenantSlug="a b" structure={[{ type: 'x/y', label: 'X' }]} />);
    expect(links(html)).toEqual([['/t/a%20b/x%2Fy', 'X']]);
  });
});
