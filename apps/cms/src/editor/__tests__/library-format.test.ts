import { describe, expect, it } from 'vitest';
import { t } from '@/i18n/is';
import { fileMeta, filesLine, formatBytes, formatUploadDate, kindLabel, unusedLine, uploadResult, usageState } from '../media/library-format';

describe('formatBytes', () => {
  it('writes sizes in Icelandic form, with a decimal comma and one decimal at most', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(61_952)).toBe('60,5 KB');
    expect(formatBytes(1_048_576)).toBe('1 MB');
    expect(formatBytes(20_971_520)).toBe('20 MB');
    expect(formatBytes(5_347_737)).toBe('5,1 MB');
    expect(formatBytes(1_288_490_189)).toBe('1,2 GB');
  });

  it('moves to the next unit when rounding reaches it', () => {
    expect(formatBytes(1_048_575)).toBe('1 MB');
    expect(formatBytes(1023)).toBe('1023 B');
  });
});

describe('formatUploadDate', () => {
  it('is a short Icelandic date in Reykjavík time', () => {
    expect(formatUploadDate('2026-10-04T12:00:00Z')).toBe('4. okt. 2026');
    // Reykjavík is on UTC all year, so a late upload keeps its day.
    expect(formatUploadDate('2026-12-31T23:30:00Z')).toBe('31. des. 2026');
  });
});

describe('fileMeta', () => {
  it("is the card line: an image's dimensions, then its size", () => {
    expect(fileMeta({ width: 2048, height: 716, bytes: 61_952 })).toBe('2048×716 · 60,5 KB');
  });

  it('is only the size for a file without dimensions', () => {
    expect(fileMeta({ width: null, height: null, bytes: 61_952 })).toBe('60,5 KB');
  });
});

describe('the summary line', () => {
  it('uses the singular for a number ending in 1 but not 11', () => {
    expect(filesLine(1)).toBe('1 skrá');
    expect(filesLine(21)).toBe('21 skrá');
    expect(filesLine(11)).toBe('11 skrár');
    expect(filesLine(0)).toBe('0 skrár');
    expect(filesLine(3)).toBe('3 skrár');
    expect(unusedLine(1)).toBe('1 ónotuð');
    expect(unusedLine(111)).toBe('111 ónotaðar');
    expect(unusedLine(4)).toBe('4 ónotaðar');
  });
});

describe('uploadResult', () => {
  it('says how many files arrived and how many failed, each in its own number', () => {
    expect(uploadResult(1, 0)).toBe('1 skrá er komin í safnið.');
    expect(uploadResult(12, 0)).toBe('12 skrár eru komnar í safnið.');
    expect(uploadResult(3, 2)).toBe('3 skrár eru komnar í safnið. Ekki tókst að hlaða upp 2 skrám.');
    expect(uploadResult(0, 1)).toBe('Ekki tókst að hlaða upp 1 skrá.');
  });
});

describe('kindLabel', () => {
  it('names the accepted types, and falls back to the type itself', () => {
    expect(kindLabel('image/jpeg')).toBe('JPEG');
    expect(kindLabel('image/png')).toBe('PNG');
    expect(kindLabel('image/webp')).toBe('WebP');
    expect(kindLabel('application/pdf')).toBe('PDF');
    expect(kindLabel('image/gif')).toBe('image/gif');
  });
});

describe('usageState', () => {
  it('is "on the site" when the published revision uses the file, else "in a draft"', () => {
    expect(usageState({ in_draft: true, in_published: true })).toEqual({ label: t.library.usage.live, tone: 'ok' });
    expect(usageState({ in_draft: false, in_published: true })).toEqual({ label: t.library.usage.live, tone: 'ok' });
    expect(usageState({ in_draft: true, in_published: false })).toEqual({ label: t.library.usage.draft, tone: 'neutral' });
  });
});
