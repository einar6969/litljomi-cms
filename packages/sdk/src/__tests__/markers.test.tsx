import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CmsEntryMarker, CmsReleaseMarker, parseEntryMarkers, parseReleaseMarker } from '../index.ts';

describe('markers', () => {
  it('entry marker renders and parses back', () => {
    const html = renderToString(<CmsEntryMarker entry={{ id: 'e', contentHash: 'h' }} />);
    expect(html).toContain('data-cms-entry="e"');
    expect(parseEntryMarkers(html)).toEqual([{ id: 'e', hash: 'h' }]);
  });
  it('round trips values needing escaping', () => {
    const html = renderToString(<CmsEntryMarker entry={{ id: 'a"b&<c>', contentHash: "x'y" }} />);
    expect(parseEntryMarkers(html)).toEqual([{ id: 'a"b&<c>', hash: "x'y" }]);
  });
  it('parses several markers in document order and ignores incomplete ones', () => {
    const html =
      '<main><span hidden data-cms-entry="1" data-cms-hash="a"></span><span data-cms-hash="z" data-cms-entry="2"></span>' +
      '<span data-cms-entry="3"></span><span data-cms-hash="q"></span></main>';
    expect(parseEntryMarkers(html)).toEqual([
      { id: '1', hash: 'a' },
      { id: '2', hash: 'z' },
    ]);
    expect(parseEntryMarkers('<p>none</p>')).toEqual([]);
  });
  it('release marker renders and parses back', () => {
    const html = renderToString(<CmsReleaseMarker release={42} />);
    expect(html).toContain('name="cms-release"');
    expect(parseReleaseMarker(html)).toBe(42);
  });
  it('release marker parser accepts either attribute order and rejects junk', () => {
    expect(parseReleaseMarker('<meta content="7" name="cms-release">')).toBe(7);
    expect(parseReleaseMarker('<p>none</p>')).toBeNull();
    expect(parseReleaseMarker('<meta name="cms-release" content="abc">')).toBeNull();
    expect(parseReleaseMarker('<meta name="cms-release" content="-1">')).toBeNull();
    expect(parseReleaseMarker('<meta name="cms-release" content="1.5">')).toBeNull();
    expect(parseReleaseMarker('<meta name="cms-release" content="1"><meta name="cms-release" content="2">')).toBeNull();
    expect(parseReleaseMarker('<meta name="cms-release" content="3"><meta name="cms-release" content="3">')).toBe(3);
  });
});
