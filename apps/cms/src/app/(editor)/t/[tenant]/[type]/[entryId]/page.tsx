import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { describeFields } from '@/editor/form/descriptors';
import { EntryForm } from '@/editor/form/EntryForm';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getType } from '@/modules/registry';

type Props = { params: Promise<{ tenant: string; type: string; entryId: string }> };

type Detail = {
  data: unknown;
  slug: string | null;
  draft_version: number;
  first_published_at: string | null;
  status: 'draft' | 'published' | 'changed' | 'archived';
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// One entry's form. The entry is read from api.entry_detail under the editor's session, filtered
// to the tenant and type of the URL: a row of another tenant or type is simply not found.
export default async function EntryPage({ params }: Props) {
  const { tenant: slug, type: typeName, entryId } = await params;
  if (!z.uuid().safeParse(entryId).success) notFound();
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const type = getType(tenant.slug, typeName);
  if (!type) notFound();
  const { data, error } = await (await createEditorClient())
    .from('entry_detail')
    .select('data, slug, draft_version, first_published_at, status')
    .eq('id', entryId)
    .eq('tenant_id', tenant.id)
    .eq('type', type.name)
    .maybeSingle();
  if (error) throw new Error(`entry_detail: ${error.code}`);
  if (!data) notFound();
  const entry = data as Detail;
  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href={`/t/${encodeURIComponent(tenant.slug)}/${encodeURIComponent(type.name)}`} className="inline-flex min-h-[44px] items-center text-[15px] font-medium">
          {t.entries.back}
        </Link>
      </p>
      <h1>{type.label}</h1>
      <EntryForm
        tenant={{ id: tenant.id, slug: tenant.slug }}
        entryId={entryId}
        fields={describeFields(type)}
        titleKey={type.preview.title}
        initialData={isObject(entry.data) ? entry.data : {}}
        initialVersion={entry.draft_version}
        initialSlug={entry.slug}
        slugLocked={entry.first_published_at !== null}
        published={entry.status === 'published' || entry.status === 'changed'}
      />
    </main>
  );
}
