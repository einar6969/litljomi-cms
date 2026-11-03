import Link from 'next/link';
import { notFound } from 'next/navigation';
import { assetIdShape } from '@/editor/media/asset-metadata';
import { AssetDetail } from '@/editor/media/AssetDetail';
import { previewUrl } from '@/editor/upload';
import { t } from '@/i18n/is';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';

type Props = { params: Promise<{ tenant: string; assetId: string }> };

type Row = {
  id: string;
  filename: string;
  width: number;
  height: number;
  focal_x: number | null;
  focal_y: number | null;
  default_alt: string | null;
  original_path: string;
};

// One asset's detail (spec §5.6), linked from the image field. The asset is read from
// api.asset_list under the editor's session, filtered to the tenant of the URL: an asset of another
// tenant, an archived one, or a malformed id is simply not found. The original is shown through a
// short-lived signed URL. `assets` is a static segment beside [type], so no content type may be
// named "assets" (the module registry's tests check this).
export default async function AssetPage({ params }: Props) {
  const { tenant: slug, assetId } = await params;
  if (!assetIdShape.safeParse(assetId).success) notFound();
  const tenant = await currentTenant(slug);
  if (!tenant) notFound();
  if (!isActive(tenant)) return null;
  const client = await createEditorClient();
  const { data, error } = await client
    .from('asset_list')
    .select('id, filename, width, height, focal_x, focal_y, default_alt, original_path')
    .eq('id', assetId)
    .eq('tenant_id', tenant.id)
    .is('archived_at', null)
    .maybeSingle();
  if (error) throw new Error(`asset_list: ${error.code}`);
  if (!data) notFound();
  const asset = data as Row;
  const url = await previewUrl(client, asset.original_path);
  if (!url) throw new Error('asset preview: signing failed');
  return (
    <main className="flex flex-col gap-4">
      <p>
        <Link href={`/t/${encodeURIComponent(tenant.slug)}`} className="inline-flex min-h-[44px] items-center text-[15px] font-medium">
          {t.asset.back}
        </Link>
      </p>
      <h1>{t.asset.title}</h1>
      <AssetDetail
        assetId={asset.id}
        url={url}
        filename={asset.filename}
        width={asset.width}
        height={asset.height}
        focal={asset.focal_x !== null && asset.focal_y !== null ? { x: asset.focal_x, y: asset.focal_y } : null}
        defaultAlt={asset.default_alt}
      />
    </main>
  );
}
