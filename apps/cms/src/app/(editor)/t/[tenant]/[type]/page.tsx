import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NewEntryButton } from '@/editor/NewEntryButton';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant';
import { getType } from '@/modules/registry';

type Props = { params: Promise<{ tenant: string; type: string }> };

type Row = { id: string; slug: string | null; title: string | null; status: keyof typeof t.entries.statuses; updated_at: string };

const MAX_ROWS = 200;

// The entries of one content type, newest edit first. The tenant is resolved through
// api.my_tenants and the type must be in its module; the rows come from api.entry_list under the
// editor's session, so RLS decides what is listed.
export default async function EntryListPage({ params }: Props) {
  const { tenant: slug, type: typeName } = await params;
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (tenant.status !== 'active') return null;
  const type = getType(tenant.slug, typeName);
  if (!type) notFound();
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
    <main>
      <h1>{type.label}</h1>
      <NewEntryButton tenantSlug={tenant.slug} type={type.name} />
      {rows.length === 0 ? (
        <p>{t.entries.empty}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t.entries.title}</th>
              <th>{t.entries.status}</th>
              <th>{t.entries.updated}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <Link href={`${base}/${row.id}`}>{row.title ?? t.entries.untitled}</Link>
                </td>
                <td>{t.entries.statuses[row.status] ?? row.status}</td>
                <td>
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
