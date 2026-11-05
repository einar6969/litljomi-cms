import { isSingleton } from '@litljomi/cms-schema';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewEntryButton } from '@/editor/NewEntryButton';
import { OpenSingleton } from '@/editor/OpenSingleton';
import { SearchShortcut } from '@/editor/SearchShortcut';
import { structureLabel } from '@/editor/structure';
import { applyEntryListFilter, isFiltered, MAX_QUERY_LENGTH, parseEntryListFilter, STATUS_FILTERS, type StatusFilter } from '@/editor/entry-list-filter';
import { t } from '@/i18n/is';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { StatusBadge, type BadgeTone } from '@/ui/StatusBadge';
import { TopBar } from '@/ui/TopBar';
import { Cloud } from '@/ui/Wordmark';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule, getType } from '@/modules/registry';

type Props = {
  params: Promise<{ tenant: string; type: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type Row = { id: string; slug: string | null; title: string | null; status: keyof typeof t.entries.statuses; updated_at: string };

const MAX_ROWS = 200;

// Green is what is live; amber is a live entry whose draft has moved on; the rest are neutral.
const STATUS_TONE: Partial<Record<Row['status'], BadgeTone>> = { published: 'ok', changed: 'warning', archived: 'hollow', draft: 'neutral' };

const FILTER_LABELS: Record<StatusFilter, string> = { ...t.entries.statuses, unpublished: t.entries.filter.unpublished };

// The entries of one content type, newest edit first. The tenant is resolved through
// api.my_tenants and the type must be in its module; the rows come from api.entry_list under the
// editor's session, so RLS decides what is listed. The title search and status filter (M2-10) are
// in the URL, sent by a plain GET form, so they work before the page's JavaScript has loaded. A
// singleton type has no list: its page opens the type's one entry, creating it on first open (§10.1).
export default async function EntryListPage({ params, searchParams }: Props) {
  const { tenant: slug, type: typeName } = await params;
  const filter = parseEntryListFilter(await searchParams);
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const type = getType(tenant.slug, typeName);
  if (!type) notFound();
  const manifest = getModule(tenant.slug)!;
  const heading = structureLabel(manifest.structure, type.name) ?? type.label;
  const tenantPath = `/t/${encodeURIComponent(tenant.slug)}`;
  const bar = <TopBar title={tenant.name} crumbs={[{ label: tenant.name, href: tenantPath }, { label: heading }]} />;
  if (isSingleton(manifest, type.name)) {
    return (
      <>
        {bar}
        <main className="page">
          <h1>{heading}</h1>
          <OpenSingleton tenantSlug={tenant.slug} type={type.name} />
        </main>
      </>
    );
  }
  const query = (await createEditorClient())
    .from('entry_list')
    .select('id, slug, title, status, updated_at')
    .eq('tenant_id', tenant.id)
    .eq('type', type.name);
  const { data, error } = await applyEntryListFilter(query, filter)
    .order('updated_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(`entry_list: ${error.code}`);
  const rows = (data ?? []) as Row[];
  const base = `/t/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(type.name)}`;
  const filtered = isFiltered(filter);
  return (
    <>
      {bar}
      <main className="page">
        <SearchShortcut inputId="entry-search" />
        <div className="head">
          <h1>{heading}</h1>
          <NewEntryButton tenantSlug={tenant.slug} type={type.name} />
        </div>
        {rows.length === 0 && !filtered ? null : (
          <form role="search" aria-label={t.entries.filter.label} method="get" action={base} className="tools">
            <div className="search">
              <label htmlFor="entry-search" className="sr-only">
                {t.entries.filter.search}
              </label>
              <Icon name="search" />
              <input id="entry-search" name="q" type="search" placeholder={t.entries.filter.search} maxLength={MAX_QUERY_LENGTH} defaultValue={filter.q} />
              <span className="kbd" aria-hidden="true">
                /
              </span>
            </div>
            <label htmlFor="entry-status" className="sr-only">
              {t.entries.filter.status}
            </label>
            <select id="entry-status" name="status" defaultValue={filter.status ?? ''}>
              <option value="">{t.entries.filter.all}</option>
              {STATUS_FILTERS.map((status) => (
                <option key={status} value={status}>
                  {FILTER_LABELS[status]}
                </option>
              ))}
            </select>
            <Button type="submit">{t.entries.filter.submit}</Button>
            {filtered ? (
              <Link href={base} className="inline-flex min-h-[44px] items-center px-2 text-sm">
                {t.entries.filter.clear}
              </Link>
            ) : null}
          </form>
        )}
        {rows.length === 0 ? (
          <div className="card empty">
            {filtered ? null : <Cloud />}
            <p>{filtered ? t.entries.filter.none : t.entries.empty}</p>
            {filtered ? null : <NewEntryButton tenantSlug={tenant.slug} type={type.name} />}
          </div>
        ) : (
          <div className="card tbl-w">
            {/* Below 768 px the table is restyled as stacked rows (globals.css). Some screen readers
                drop a table's semantics once it is no longer display:table, so the roles are stated. */}
            <table role="table" className="tbl entry-table">
              <thead role="rowgroup">
                <tr role="row">
                  <th role="columnheader">{t.entries.title}</th>
                  <th role="columnheader" className="w-status">
                    {t.entries.status}
                  </th>
                  <th role="columnheader" className="w-time">
                    {t.entries.updated}
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((row) => (
                  <tr key={row.id} role="row">
                    <td role="cell">
                      <Link href={`${base}/${row.id}`} className={row.title ? 't' : 't text-muted'}>
                        {row.title ?? t.entries.untitled}
                      </Link>
                    </td>
                    <td role="cell">
                      <StatusBadge tone={STATUS_TONE[row.status] ?? 'neutral'}>{t.entries.statuses[row.status] ?? row.status}</StatusBadge>
                    </td>
                    <td role="cell">
                      <time className="mono text-muted" dateTime={row.updated_at}>
                        {new Date(row.updated_at).toLocaleString('is-IS', { timeZone: 'Atlantic/Reykjavik' })}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
