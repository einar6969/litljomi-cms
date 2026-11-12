import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assetIdShape } from '@/editor/media/asset-metadata';
import { AssetDetail } from '@/editor/media/AssetDetail';
import { assetUse, loadLibraryFile } from '@/editor/server/library';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';
import { getType } from '@/modules/registry';
import { Icon } from '@/ui/Icon';
import { TopBar } from '@/ui/TopBar';

type Props = { params: Promise<{ tenant: string; assetId: string }> };

// One asset's own page (spec §5.6), linked from the image field: the library's detail panel
// (docs/plans/media-library.md section 6.1) on a page of its own. The asset is read from
// api.asset_list under the editor's session, filtered to the tenant of the URL: an asset of another
// tenant, an archived one, or a malformed id is simply not found. The file is shown by its
// thumbnail through a short-lived signed URL; for a file without one the page signs nothing and
// the detail asks for the preview, which makes the thumbnail (asset-actions.ts). Rendering never
// writes.
export default async function AssetPage({ params }: Props) {
  const { tenant: slug, assetId } = await params;
  if (!assetIdShape.safeParse(assetId).success) notFound();
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const detail = await loadLibraryFile(await createEditorClient(), tenant.id, assetId);
  if (!detail) notFound();
  const tenantPath = `/t/${encodeURIComponent(tenant.slug)}`;
  const libraryPath = `${tenantPath}/assets`;
  return (
    <>
      <TopBar title={tenant.name} crumbs={[{ label: tenant.name, href: tenantPath }, { label: t.library.title, href: libraryPath }, { label: t.asset.title }]} />
      <main className="page lib-solo">
        <div>
          <Link href={libraryPath} className="back">
            <Icon name="chevronLeft" />
            {t.library.detail.back}
          </Link>
          <h1>{t.asset.title}</h1>
        </div>
        <AssetDetail
          file={detail.file}
          url={detail.url}
          usage={detail.usage.map((row) => assetUse(row, tenantPath, (type) => getType(tenant.slug, type)?.label))}
          originalHref={`${libraryPath}/${detail.file.id}/original`}
        />
      </main>
    </>
  );
}
