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
          { type: 'settings', label: 'Stillingar', singleton: true },
          { group: 'Efni', items: [{ type: 'page', label: 'Síður' }, { type: 'news', label: 'Fréttir' }] },
          { group: 'Annað', items: [{ type: 'staff', label: 'Starfsfólk' }] },
          { type: 'footer', label: 'Fótur', singleton: true },
          { type: 'links', label: 'Tenglar' },
        ]}
      />,
    );
    expect(headings(html)).toEqual([t.tenant.contentTypes, 'Efni', 'Annað', t.tenant.contentTypes]);
    expect(links(html)).toEqual([
      ['/t/acme/settings', 'Stillingar'],
      ['/t/acme/page', 'Síður'],
      ['/t/acme/news', 'Fréttir'],
      ['/t/acme/staff', 'Starfsfólk'],
      ['/t/acme/footer', 'Fótur'],
      ['/t/acme/links', 'Tenglar'],
    ]);
  });

  it('encodes the tenant slug and type names in links', () => {
    const html = renderToStaticMarkup(<StructureNav tenantSlug="a b" structure={[{ type: 'x/y', label: 'X' }]} />);
    expect(links(html)).toEqual([['/t/a%20b/x%2Fy', 'X']]);
  });
});
