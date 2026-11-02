// The marker parser is the live-check contract (decision 7; spec §7.4). Task 18 security r1,
// Minors 11a–11c: only markers a browser renders as elements count, an id-only marker is visible to
// `absent` checks, and the scan is linear.
import { describe, expect, it } from 'vitest';
import { parseEntryMarkerIds, parseEntryMarkers, parseReleaseMarker, scanEntryMarkers } from '../index.ts';

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

// Task 21 security r1, Major: the scan must not desynchronise on text whose case fold changes its
// length ('İ', U+0130, lower-cases to two code units), or every later marker disappears.
describe('non-ASCII text before a skipped element (Task 21 security r1)', () => {
  const texts = [
    ['İ (U+0130)', 'Heimsókn frá İzmir'],
    ['several İ', 'İİİİİİİİİİ'],
    ['other non-ASCII text', 'Þórður ẞ Ångström K Σ 😀'],
  ];
  const skipped = [
    ['a title', '<title>x</title>'],
    ['a title holding the text', '<title>TEXT</title>'],
    ['a script', '<script>var x = 1;</script>'],
    ['a style', '<style>p{}</style>'],
    ['a textarea', '<textarea>x</textarea>'],
    ['a template', '<template><p>x</p></template>'],
    ['a comment', '<!-- x -->'],
  ];
  const cases = texts.flatMap(([tn, text]) => skipped.map(([sn, el]) => [`${tn} before ${sn}`, text!, el!] as const));
  it.each(cases)('%s: markers after it are still found', (_, text, el) => {
    const html = `<p>${text}</p>${el.replace('TEXT', text)}<p>${text}</p>${marker('E', 'H')}`;
    expect(parseEntryMarkerIds(html)).toEqual(['E']);
    expect(parseEntryMarkers(html)).toEqual([{ id: 'E', hash: 'H' }]);
    expect(scanEntryMarkers(html)).toEqual({ ids: ['E'], markers: [{ id: 'E', hash: 'H' }], complete: true });
  });
  it.each(cases)('%s: the release marker after it is still found', (_, text, el) => {
    expect(parseReleaseMarker(`<head><p>${text}</p>${el.replace('TEXT', text)}<meta name="cms-release" content="7"></head>`)).toBe(7);
  });
  it('the review’s repros', () => {
    expect(parseEntryMarkerIds(`<title>Heimsókn frá İzmir</title><script>x</script><span data-cms-entry="E" data-cms-hash="H">`)).toEqual(['E']);
    expect(parseEntryMarkerIds(`<p>İ</p><script>x</script><p>text</p><span data-cms-entry="E" data-cms-hash="H">`)).toEqual(['E']);
  });
  it('still hides a marker inside a skipped element after non-ASCII text', () => {
    expect(scanEntryMarkers(`<p>İ</p><script>"${marker('E', 'H')}"</script>`)).toEqual({ ids: [], markers: [], complete: true });
  });
  it('folds only ASCII in tag names: a non-ASCII look-alike does not close a script', () => {
    // 'K' (U+212A, Kelvin) and 'ſ' (U+017F) fold to ASCII under full Unicode case rules; browsers do not fold them.
    expect(scanEntryMarkers(`<script>x</ſcript>${marker('E', 'H')}`)).toEqual({ ids: [], markers: [], complete: false });
  });
});

// Task 21 security r1, Minor: a scan that cannot complete is inconclusive, never "no marker".
describe('scanEntryMarkers: complete', () => {
  it('is complete on a well-formed page', () => {
    expect(scanEntryMarkers(`<!DOCTYPE html><html><head><title>t</title></head><body><!-- c -->${marker('1', 'a')}<span data-cms-entry="2"></span></body></html>`)).toEqual({
      ids: ['1', '2'],
      markers: [{ id: '1', hash: 'a' }],
      complete: true,
    });
  });
  it('is complete on an empty page', () => {
    expect(scanEntryMarkers('')).toEqual({ ids: [], markers: [], complete: true });
  });
  it.each([
    ['an unterminated start tag', '<div class="x"'],
    ['an unterminated quote', '<div class="x>'],
    ['an unterminated comment', '<!-- x'],
    ['an unterminated doctype', '<!DOCTYPE html'],
    ['an unterminated end tag', '</div'],
    ['a never-closed script', '<script>x'],
    ['a never-closed title', '<title>x'],
    ['a never-closed style', '<style>x'],
    ['a never-closed textarea', '<textarea>x'],
    ['a never-closed template', '<template>x'],
    ['a script end tag without its ">"', '<script>x</script'],
  ])('is incomplete after %s, keeping the markers found before it', (_, tail) => {
    expect(scanEntryMarkers(`${marker('1', 'a')}${tail}`)).toEqual({ ids: ['1'], markers: [{ id: '1', hash: 'a' }], complete: false });
  });
  it.each([
    ['<!-->', '<!-->'],
    ['<!--->', '<!--->'],
    ['a comment closed by --!>', '<!-- x --!>'],
  ])('ends a comment where a browser does: %s', (_, comment) => {
    expect(scanEntryMarkers(`${comment}${marker('1', 'a')}<!-- y -->`)).toEqual({ ids: ['1'], markers: [{ id: '1', hash: 'a' }], complete: true });
  });
  it('stays linear', () => {
    const started = performance.now();
    for (const html of ['<span a'.repeat(40_000), '<!--'.repeat(100_000), '<!---->'.repeat(100_000), '<!-- -->'.repeat(100_000) + '--!>', '<script>'.repeat(100_000), 'İ<title>'.repeat(100_000), '<p>İ</p><title>x</title>'.repeat(50_000)]) scanEntryMarkers(html);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
