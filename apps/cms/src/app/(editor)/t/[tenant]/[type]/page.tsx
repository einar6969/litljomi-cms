import { isSingleton } from '@litljomi/cms-schema';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewEntryButton } from '@/editor/NewEntryButton';
import { OpenSingleton } from '@/editor/OpenSingleton';
import { t } from '@/i18n/is';
import { StatusBadge } from '@/ui/StatusBadge';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule, getType } from '@/modules/registry';

type Props = { params: Promise<{ tenant: string; type: string }> };

type Row = { id: string; slug: string | null; title: string | null; status: keyof typeof t.entries.statuses; updated_at: string };

const MAX_ROWS = 200;

// Only "Birt" is a positive state; the others are neutral.
const STATUS_TONE: Partial<Record<Row['status'], 'ok' | 'pending'>> = { published: 'ok' };
// Below 768 px the table is restyled as stacked rows (globals.css). Some screen readers drop a
// table's semantics once it is no longer display:table, so the roles are stated explicitly.
const HEAD = 'py-2 pr-4 font-display text-xs font-semibold uppercase tracking-wider text-muted';

// The entries of one content type, newest edit first. The tenant is resolved through
// api.my_tenants and the type must be in its module; the rows come from api.entry_list under the
// editor's session, so RLS decides what is listed. A singleton type has no list: its page opens
// the type's one entry, creating it on first open (§10.1).
export default async function EntryListPage({ params }: Props) {
  const { tenant: slug, type: typeName } = await params;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const type = getType(tenant.slug, typeName);
  if (!type) notFound();
  if (isSingleton(getModule(tenant.slug)!, type.name)) {
    return (
      <main className="flex flex-col gap-6">
        <h1>{type.label}</h1>
        <OpenSingleton tenantSlug={tenant.slug} type={type.name} />
      </main>
    );
  }
  const { data, error } = await (await createEditorClient())
    .from('entry_list')
    .select('id, slug, title, status, updated_at')
    .eq('tenant_id', tenant.id)
    .eq('type', type.name)
    .is('archived_at', null)
    .order('updated_at', { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(`entry_list: ${error.code}`);
  const rows = (data ?? []) as Row[];
  const base = `/t/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(type.name)}`;
  return (
    <main className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1>{type.label}</h1>
        <NewEntryButton tenantSlug={tenant.slug} type={type.name} />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-control bg-recessed px-4 py-8 text-center text-muted">{t.entries.empty}</p>
      ) : (
        <table role="table" className="entry-table w-full border-collapse text-left">
          <thead role="rowgroup">
            <tr role="row" className="border-b border-ink">
              <th role="columnheader" className={HEAD}>{t.entries.title}</th>
              <th role="columnheader" className={HEAD}>{t.entries.status}</th>
              <th role="columnheader" className={HEAD}>{t.entries.updated}</th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {rows.map((row) => (
              <tr key={row.id} role="row" className="border-b border-hairline">
                <td role="cell" className="py-1 pr-4 md:py-2">
                  <Link href={`${base}/${row.id}`} className="inline-flex min-h-[44px] items-center text-lg font-semibold md:text-base">
                    {row.title ?? t.entries.untitled}
                  </Link>
                </td>
                <td role="cell" className="py-2 pr-4">
                  <StatusBadge as="span" tone={STATUS_TONE[row.status] ?? 'pending'} className="text-sm">
                    {t.entries.statuses[row.status] ?? row.status}
                  </StatusBadge>
                </td>
                <td role="cell" className="py-2 text-sm text-muted">
                  <time dateTime={row.updated_at}>{new Date(row.updated_at).toLocaleString('is-IS', { timeZone: 'Atlantic/Reykjavik' })}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
