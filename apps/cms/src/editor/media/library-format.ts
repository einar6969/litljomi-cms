// The words and numbers of the media library (docs/plans/media-library.md sections 6 and 10), with
// no I/O: sizes and dates in Icelandic form, the summary line's counts, the upload's result.
import { t } from '@/i18n/is';
import type { BadgeTone } from '@/ui/StatusBadge';

const isSingular = (n: number): boolean => n % 10 === 1 && n % 100 !== 11;
const pick = (n: number, one: string, many: string) => (isSingular(n) ? one : many);

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * A size in bytes as "60,5 KB": in steps of 1,024, so the 20 MB upload limit reads "20 MB"; one
 * decimal at most, after a comma; the next unit as soon as the rounded number reaches 1,024.
 */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? String(Math.round(value)) : (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '').replace('.', ',');
  return `${rounded} ${UNITS[unit]}`;
}

const DATE = new Intl.DateTimeFormat('is-IS', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Atlantic/Reykjavik' });

/**
 * An upload date as "4. okt. 2026", in Reykjavík time. Called on the server only: a browser without
 * Icelandic locale data (Playwright's Chromium among them) would write it in English, and the page
 * would not hydrate.
 */
export const formatUploadDate = (iso: string): string => DATE.format(new Date(iso));

/** A card's line: "2048×716 · 60,5 KB", or the size alone for a file without dimensions. */
export function fileMeta({ width, height, bytes }: { width: number | null; height: number | null; bytes: number }): string {
  if (width === null || height === null) return formatBytes(bytes);
  return t.library.meta.replace('{width}', String(width)).replace('{height}', String(height)).replace('{size}', formatBytes(bytes));
}

export const filesLine = (n: number): string => pick(n, t.library.filesOne, t.library.filesMany).replace('{n}', String(n));
export const unusedLine = (u: number): string => pick(u, t.library.unusedOne, t.library.unusedMany).replace('{u}', String(u));

/** The sentence at the end of an upload: how many files arrived, and how many failed, if any. */
export function uploadResult(done: number, failed: number): string {
  const parts = [];
  if (done > 0 || failed === 0) parts.push(pick(done, t.upload.resultOne, t.upload.resultMany).replace('{n}', String(done)));
  if (failed > 0) parts.push(pick(failed, t.upload.failedOne, t.upload.failedMany).replace('{f}', String(failed)));
  return parts.join(' ');
}

const KIND_LABELS: Record<string, string> = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'application/pdf': 'PDF' };

/** A file's type as editors know it ("JPEG"); an unknown type as itself. */
export const kindLabel = (mime: string): string => KIND_LABELS[mime] ?? mime;
