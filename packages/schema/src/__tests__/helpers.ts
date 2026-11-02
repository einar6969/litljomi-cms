import type { EntrySummary, ProjectionContext, PublicAsset } from '../index.ts';

export const fakeCtx = (o: { assets?: Record<string, PublicAsset>; entries?: Record<string, EntrySummary> }): ProjectionContext => ({
  asset: (id) => o.assets?.[id] ?? null,
  entry: (id) => o.entries?.[id] ?? null,
});
