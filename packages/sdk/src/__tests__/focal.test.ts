import { describe, expect, expectTypeOf, it } from 'vitest';
import { focalPoint, focalPosition, type Bundle, type PublicAsset } from '../index.ts';

const asset = (extra: Partial<PublicAsset> = {}): PublicAsset => ({
  id: 'a1', url: 'https://cdn.example/t/a1/a.jpg', width: 800, height: 600, mime: 'image/jpeg', alt: 'Brauð', ...extra,
});

describe('PublicAsset focal point (format 1, additive)', () => {
  it('types the focal point as optional, so an image without the key is still a PublicAsset', () => {
    expectTypeOf<PublicAsset['focal']>().toEqualTypeOf<{ x: number; y: number } | null | undefined>();
    expectTypeOf<Omit<PublicAsset, 'focal'>>().toExtend<PublicAsset>();
  });

  it('reads a bundle written before focal points were delivered, and one with them', () => {
    const old = JSON.parse(
      '{"format":1,"tenant":"t","release":1,"generatedAt":"x","entries":{"news":[{"id":"e","revisionId":"r","contentHash":"h","slug":null,"title":null,"sortAt":null,"firstPublishedAt":"x","lastPublishedAt":"x","schemaVersion":1,"data":{"pic":{"id":"a1","url":"https://cdn.example/a.jpg","width":8,"height":6,"mime":"image/jpeg","alt":""}}}]}}',
    ) as Bundle;
    const pic = old.entries.news![0]!.data.pic as PublicAsset;
    expect(focalPoint(pic)).toBeNull();
    expect(focalPosition(pic)).toBe('50% 50%');

    const now = { ...pic, focal: { x: 0.2, y: 0.8 } };
    expect(focalPoint(now)).toEqual({ x: 0.2, y: 0.8 });
    expect(focalPosition(now)).toBe('20% 80%');
  });

  it('treats null, and anything that is not two numbers in 0..1, as no focal point', () => {
    expect(focalPosition(asset({ focal: null }))).toBe('50% 50%');
    for (const focal of [{ x: -0.1, y: 0.5 }, { x: 0.5, y: 1.5 }, { x: Number.NaN, y: 0.5 }, { x: '0.5', y: 0.5 }, { x: 0.5 }]) {
      expect(focalPoint(asset({ focal: focal as unknown as PublicAsset['focal'] }))).toBeNull();
    }
  });

  it('keeps the edges and rounds to 0.1 %', () => {
    expect(focalPosition(asset({ focal: { x: 0, y: 1 } }))).toBe('0% 100%');
    expect(focalPosition(asset({ focal: { x: 1 / 3, y: 0.6667 } }))).toBe('33.3% 66.7%');
  });
});
