// The marker parser is the live-check contract (decision 7; spec §7.4). Task 18 security r1,
// Minors 11a–11c: only markers a browser renders as elements count, an id-only marker is visible to
// `absent` checks, and the scan is linear.
import { describe, expect, it } from 'vitest';
import { parseEntryMarkerIds, parseEntryMarkers, parseReleaseMarker } from '../index.ts';

const marker = (id: string, hash: string) => `<span hidden data-cms-entry="${id}" data-cms-hash="${hash}"></span>`;

describe('parseEntryMarkers outside rendered elements (11a)', () => {
  it.each([
    ['a comment', `<!-- ${marker('e', 'h')} -->`],
    ['an unterminated comment', `<!-- ${marker('e', 'h')}`],
    ['a script', `<script>var x = '${marker('e', 'h')}';</script>`],
    ['a script with attributes and an upper-case end tag', `<script type="text/plain">${marker('e', 'h')}</SCRIPT >`],
    ['a style', `<style>/* ${marker('e', 'h')} */</style>`],
    ['a template', `<template>${marker('e', 'h')}</template>`],
    ['a textarea', `<textarea>${marker('e', 'h')}</textarea>`],
    ['a title', `<title>${marker('e', 'h')}</title>`],
    ['another tag’s attribute value (double quotes)', `<div title="<span data-cms-entry='e' data-cms-hash='h'>"></div>`],
    ['another tag’s attribute value (single quotes)', `<div title='<span data-cms-entry="e" data-cms-hash="h">'></div>`],
  ])('ignores a marker inside %s', (_, html) => {
    expect(parseEntryMarkers(html)).toEqual([]);
    expect(parseEntryMarkerIds(html)).toEqual([]);
  });
  it('finds markers after a comment, a script and a template', () => {
    const html = `<!-- x --><script>1<2</script><template><p>t</p></template>${marker('e', 'h')}`;
    expect(parseEntryMarkers(html)).toEqual([{ id: 'e', hash: 'h' }]);
  });
  it('does not treat "</scripts>" as the end of a script', () => {
    expect(parseEntryMarkers(`<script>"</scripts>${marker('e', 'h')}"</script>`)).toEqual([]);
  });
  it('accepts unquoted values, upper-case names and a self-closing span', () => {
    expect(parseEntryMarkers('<SPAN DATA-CMS-ENTRY=e data-cms-hash=h />')).toEqual([{ id: 'e', hash: 'h' }]);
  });
  it('does not take a span-prefixed tag name for a span', () => {
    expect(parseEntryMarkers('<spanx data-cms-entry="e" data-cms-hash="h">')).toEqual([]);
  });
});

describe('parseEntryMarkerIds (11b: absent fails closed)', () => {
  it('returns the ids of complete, id-only and empty-hash markers', () => {
    const html = `${marker('1', 'a')}<span data-cms-entry="2"></span><span data-cms-entry="3" data-cms-hash=""></span><span data-cms-entry="4" data-cms-hash></span>`;
    expect(parseEntryMarkerIds(html)).toEqual(['1', '2', '3', '4']);
    // parseEntryMarkers keeps its contract: complete markers only.
    expect(parseEntryMarkers(html)).toEqual([{ id: '1', hash: 'a' }]);
  });
  it('ignores a marker without an id', () => {
    expect(parseEntryMarkerIds('<span data-cms-entry="" data-cms-hash="h"></span><span data-cms-hash="h"></span>')).toEqual([]);
  });
  it('decodes entities in ids', () => {
    expect(parseEntryMarkerIds('<span data-cms-entry="a&amp;b"></span>')).toEqual(['a&b']);
  });
});

describe('linear scan (11c)', () => {
  it.each([
    ['unterminated span starts', '<span a'.repeat(40_000)],
    ['unterminated attributes', '<span a="x" '.repeat(40_000)],
    ['an unterminated quote', '<span a="' + 'x'.repeat(500_000)],
    ['comment starts', '<!--'.repeat(100_000)],
    ['script starts', '<script>'.repeat(100_000)],
  ])('stays fast on %s', (_, html) => {
    const started = performance.now();
    parseEntryMarkers(html);
    parseEntryMarkerIds(html);
    parseReleaseMarker(html);
    expect(performance.now() - started).toBeLessThan(500);
  });
  it('stops at a tag without its closing ">"', () => {
    expect(parseEntryMarkers(`${marker('1', 'a')}<span data-cms-entry="2" data-cms-hash="b"`)).toEqual([{ id: '1', hash: 'a' }]);
  });
});

describe('parseReleaseMarker with the same scanner', () => {
  it('ignores a release marker in a comment or a script', () => {
    expect(parseReleaseMarker('<!-- <meta name="cms-release" content="3"> -->')).toBeNull();
    expect(parseReleaseMarker('<script>"<meta name=\'cms-release\' content=\'3\'>"</script>')).toBeNull();
    expect(parseReleaseMarker('<head><meta name="cms-release" content="3"/></head>')).toBe(3);
  });
});
