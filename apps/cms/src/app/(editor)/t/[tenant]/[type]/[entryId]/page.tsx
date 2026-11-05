import { isSingleton } from '@litljomi/cms-schema';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { describeFields } from '@/editor/form/descriptors';
import { EntryForm } from '@/editor/form/EntryForm';
import { OutdatedDraft } from '@/editor/form/OutdatedDraft';
import { RESTORED_PARAM } from '@/editor/revisions';
import { structureLabel } from '@/editor/structure';
import { readEntryDetail } from '@/editor/server/entry-detail';
import { loadRevisionHistory } from '@/editor/server/restore-revision';
import { t } from '@/i18n/is';
import { requireUserId } from '@/lib/auth/session';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getModule, getType } from '@/modules/registry';
import { Icon } from '@/ui/Icon';
import { TopBar, type Crumb } from '@/ui/TopBar';

type Props = {
  params: Promise<{ tenant: string; type: string; entryId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// One entry's form. The entry is read by id under the editor's session and held to the tenant and
// type of the URL: a row of another tenant or type is simply not found.
export default async function EntryPage({ params, searchParams }: Props) {
  const { tenant: slug, type: typeName, entryId } = await params;
  if (!z.uuid().safeParse(entryId).success) notFound();
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const type = getType(tenant.slug, typeName);
  if (!type) notFound();
  const client = await createEditorClient();
  // The form keeps unsaved changes under this user and names them in every save (M2-17).
  const userId = await requireUserId(client);
  const { data: entry, error } = await readEntryDetail(client, entryId, tenant.id);
  if (error) throw new Error(`entry_detail_by_id: ${error.code}`);
  if (entry?.type !== type.name) notFound();
  // M2-16: the published revisions, for the history and restore. Not read for an outdated draft,
  // which shows no form until it is updated.
  const outdated = entry.schema_version < type.version;
  const revisions = outdated ? [] : await loadRevisionHistory(client, tenant.id, entryId);
  const restored = (await searchParams)?.[RESTORED_PARAM] === '1';
  const published = entry.status === 'published' || entry.status === 'changed';
  const fields = describeFields(type);
  const fieldLabels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  // A singleton has no list to go back to: its type's page would open this entry again.
  const manifest = getModule(tenant.slug)!;
  const singleton = isSingleton(manifest, type.name);
  const tenantPath = `/t/${encodeURIComponent(tenant.slug)}`;
  const listLabel = structureLabel(manifest.structure, type.name) ?? type.label;
  const stored = isObject(entry.data) ? entry.data : {};
  const titleValue = stored[type.preview.title];
  const title = typeof titleValue === 'string' && titleValue !== '' ? titleValue : t.entries.untitled;
  const backTo = singleton ? tenantPath : `${tenantPath}/${encodeURIComponent(type.name)}`;
  const backName = singleton ? t.entries.backHome : t.entries.back;
  const crumbs: Crumb[] = singleton
    ? [{ label: tenant.name, href: tenantPath, name: backName }, { label: listLabel }]
    : [{ label: tenant.name, href: tenantPath }, { label: listLabel, href: backTo, name: backName }, { label: title }];
  return (
    <>
      <TopBar title={tenant.name} crumbs={crumbs} saves={!outdated} />
      <main className="page">
        <div>
          <Link href={backTo} className="back">
            <Icon name="chevronLeft" />
            {backName}
          </Link>
          <h1>{type.label}</h1>
        </div>
        {outdated ? (
          // §5.3, M2-14: a draft written at an older version is updated before it can be edited.
          <OutdatedDraft entryId={entryId} version={entry.draft_version} published={published} fieldLabels={fieldLabels} />
        ) : (
          <EntryForm
            tenant={{ id: tenant.id, slug: tenant.slug }}
            userId={userId}
            entryId={entryId}
            fields={fields}
            titleKey={type.preview.title}
            initialData={stored}
            initialVersion={entry.draft_version}
            published={published}
            revisions={revisions}
            restored={restored}
          />
        )}
      </main>
    </>
  );
}
