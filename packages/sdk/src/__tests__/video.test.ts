import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Bundle, PublicAsset, PublicVideo } from '../index.ts';

// A11: a video field's delivered value, an additive type of format 1 (spec §5.2, §7.2).
describe('PublicVideo', () => {
  it('types the provider, id, address, title and a still that may be absent', () => {
    expectTypeOf<PublicVideo['provider']>().toEqualTypeOf<'youtube' | 'vimeo'>();
    expectTypeOf<PublicVideo['id']>().toEqualTypeOf<string>();
    expectTypeOf<PublicVideo['url']>().toEqualTypeOf<string>();
    expectTypeOf<PublicVideo['title']>().toEqualTypeOf<string>();
    expectTypeOf<PublicVideo['still']>().toEqualTypeOf<PublicAsset | null>();
  });

  it('reads a video from a bundle', () => {
    const bundle = JSON.parse(
      '{"format":1,"tenant":"t","release":1,"generatedAt":"x","entries":{"project":[{"id":"e","revisionId":"r","contentHash":"h","slug":null,"title":null,"sortAt":null,"firstPublishedAt":"x","lastPublishedAt":"x","schemaVersion":1,"data":{"clip":{"provider":"vimeo","id":"76979871","url":"https://vimeo.com/76979871","title":"Myndband","still":null}}}]}}',
    ) as Bundle;
    const clip = bundle.entries.project![0]!.data.clip as PublicVideo;
    expect(clip).toEqual({ provider: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871', title: 'Myndband', still: null });
  });
});
