// The only file in the CMS app that imports tenant modules (spec §3.1; enforced by ESLint).
import type { ContentType, ModuleManifest } from '@litljomi/cms-schema';
import demo from '@litljomi/module-demo';
import labak from '@litljomi/module-labak';

export const modules: ModuleManifest[] = [labak, demo];

/** The module of a tenant, by its slug. */
export function getModule(slug: string): ModuleManifest | undefined {
  return modules.find((m) => m.tenant === slug);
}

/** A content type of a tenant, by the tenant's slug and the type's name. */
export function getType(slug: string, type: string): ContentType | undefined {
  return getModule(slug)?.types.find((t) => t.name === type);
}
