import type { FocalPoint, PublicAsset } from './bundle.ts';

const isUnit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;

// Rounded to 0.1 %, finer than any crop needs, so the value stays short and stable.
const percent = (n: number) => `${Math.round(n * 1000) / 10}%`;

/**
 * The asset's focal point, or null when it has none: null in the bundle, absent in a bundle
 * written before focal points were delivered, or not two numbers in 0..1.
 */
export function focalPoint(asset: Pick<PublicAsset, 'focal'>): FocalPoint | null {
  const focal = asset.focal;
  return focal != null && isUnit(focal.x) && isUnit(focal.y) ? { x: focal.x, y: focal.y } : null;
}

/**
 * A CSS `object-position` (or `background-position`) value that keeps the focal point in view when
 * the image is cropped with `object-fit: cover`: `"20% 80%"`, or `"50% 50%"` (the centre, CSS's
 * default) for an asset without one.
 */
export function focalPosition(asset: Pick<PublicAsset, 'focal'>): string {
  const focal = focalPoint(asset);
  return focal === null ? '50% 50%' : `${percent(focal.x)} ${percent(focal.y)}`;
}
