import { previewGet } from '@/privileged/preview/endpoint-route';

// The preview endpoint (spec §7.5, plan M3-11). Its logic is in privileged/ (decision 35's rule,
// extended to this one entry): it verifies the preview token with the tenant's preview secrets and
// returns the published content with the token's draft overlaid. Never cached.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, ctx: { params: Promise<{ tenant: string }> }): Promise<Response> {
  const { tenant } = await ctx.params;
  return previewGet(req, tenant);
}
