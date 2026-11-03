// The focal point of an image (spec §5.6): fractions of its width and height, from the top left.

export type FocalPoint = { x: number; y: number };

/** Where a keyboard user starts when the image has no focal point yet: the centre. */
export const CENTRE: FocalPoint = { x: 0.5, y: 0.5 };

/** One arrow key press moves the point this far; with Shift, `FINE_STEP`. */
export const STEP = 0.05;
export const FINE_STEP = 0.01;

// Two decimals is finer than any crop needs, and keeps repeated steps free of float drift.
const round = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;

/** The point at an offset into a box of the given size, clamped to the box. */
export const fraction = (offset: number, size: number): number => round(offset / size);

const ARROWS: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** The point an arrow key moves `from` to (clamped to the image), or null for any other key. */
export function moveFocal(from: FocalPoint | null, key: string, fine: boolean): FocalPoint | null {
  const arrow = ARROWS[key];
  if (!arrow) return null;
  const start = from ?? CENTRE;
  const step = fine ? FINE_STEP : STEP;
  return { x: round(start.x + arrow[0] * step), y: round(start.y + arrow[1] * step) };
}

/** A point as whole percentages, for people: `{ x: 20, y: 75 }`. */
export const percentOf = (p: FocalPoint) => ({ x: Math.round(p.x * 100), y: Math.round(p.y * 100) });
