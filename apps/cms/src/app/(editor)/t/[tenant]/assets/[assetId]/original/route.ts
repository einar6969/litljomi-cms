import { assetIdShape } from '@/editor/media/asset-metadata';
import { previewUrl } from '@/editor/upload';
import { createEditorClient } from '@/lib/supabase/server';
import { currentTenant, isActive } from '@/lib/tenant';

// "Opna upprunalegu skrána" (docs/plans/media-library.md section 6.1): an original is signed only
// when the editor asks for it, so a page never holds a signature of it that expires while open.
// The asset is read from api.asset_list with the editor's session, filtered to the tenant of the
// URL, which must be active; the original is signed with the same session (Storage RLS) for 600
// seconds, like every editor preview (§5.6), and the browser is sent to it. Anything else, a
// malformed id included, is 404. Never cached.
export const dynamic = 'force-dynamic';

const notFound = () => new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });

export async function GET(_req: Request, ctx: { params: Promise<{ tenant: string; assetId: string }> }): Promise<Response> {
  const { tenant: slug, assetId } = await ctx.params;
  if (!assetIdShape.safeParse(assetId).success) return notFound();
  const tenant = await currentTenant(slug);
  if (!tenant || !isActive(tenant)) return notFound();
  const client = await createEditorClient();
  const { data, error } = await client.from('asset_list').select('original_path').eq('id', assetId).eq('tenant_id', tenant.id).is('archived_at', null).maybeSingle();
  if (error) throw new Error(`asset_list: ${error.code}`);
  const path = (data as { original_path: string } | null)?.original_path;
  const url = path ? await previewUrl(client, path) : null;
  if (!url) return notFound();
  return new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } });
}
