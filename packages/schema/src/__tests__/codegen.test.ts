import { describe, expect, it } from 'vitest';
import { date, defineType, generateDeliveryTypes, image, link, richText, text } from '../index.ts';

const t = defineType({
  name: 'news',
  version: 1,
  label: 'N',
  fields: {
    title: text({ label: 'T', required: true }),
    when: date({ label: 'D' }),
    pic: image({ label: 'I' }),
    body: richText({ label: 'B' }),
    related: link({ label: 'R' }),
  },
  preview: { title: 'title' },
  orderBy: 'when',
});

describe('generateDeliveryTypes', () => {
  const out = generateDeliveryTypes([t]);
  it('marks entry references nullable', () => {
    expect(out).toContain('related: { href: string } | { entry: EntrySummary | null } | null');
  });
  it('declares one interface per type from each field tsType, plus shared types', () => {
    expect(out).toContain('export interface NewsEntry {');
    expect(out).toContain('  title: string | null;');
    expect(out).toContain('  pic: PublicAsset | null;');
    expect(out).toContain('  body: ProjectedRichTextDoc | null;');
    expect(out).toContain('export interface PublicAsset {');
    expect(out).toContain('export interface EntrySummary {');
    expect(out).toContain("import type { ProjectedRichTextDoc } from '@litljomi/rich-text';");
  });
  it('is deterministic and handles several types', () => {
    const u = defineType({ ...t, name: 'event-item', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' });
    expect(generateDeliveryTypes([t, u])).toContain('export interface EventItemEntry {');
    expect(generateDeliveryTypes([t, u])).toBe(generateDeliveryTypes([t, u]));
  });
  it('rejects type names that are not safe identifiers', () => {
    const bad = defineType({ ...t, name: 'a b', fields: { title: text({ label: 'T' }) }, preview: { title: 'title' }, orderBy: 'title' });
    expect(() => generateDeliveryTypes([bad])).toThrow();
  });
});
