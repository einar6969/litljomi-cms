import { describe, expect, it } from 'vitest';
import { date, defineType, extendType, link, text } from '../index.ts';

const t = defineType({
  name: 't',
  version: 1,
  label: 'T',
  fields: { title: text({ label: 'Titill', required: true, max: 5 }) },
  preview: { title: 'title' },
  orderBy: 'title',
});

describe('defineType', () => {
  it('draft validator accepts empty required fields; publish validator rejects them', () => {
    expect(t.draftValidator().safeParse({}).success).toBe(true);
    expect(t.publishValidator().safeParse({}).success).toBe(false);
    expect(t.publishValidator().safeParse({ title: 'abcdef' }).success).toBe(false);
    expect(t.publishValidator().safeParse({ title: 'abc' }).success).toBe(true);
  });

  it('still checks types and limits on draft', () => {
    expect(t.draftValidator().safeParse({ title: 5 }).success).toBe(false);
    expect(t.draftValidator().safeParse({ title: 'abcdef' }).success).toBe(false);
    expect(t.draftValidator().safeParse({ title: null }).success).toBe(true);
  });

  it('strips unknown keys on draft parse', () => {
    expect(t.draftValidator().parse({ title: 'a', junk: 1 })).toEqual({ title: 'a' });
  });

  it('maps title and sort_at columns', () => {
    const n = defineType({
      name: 'n',
      version: 1,
      label: 'N',
      fields: { title: text({ label: 'T' }), when: date({ label: 'D' }) },
      preview: { title: 'title' },
      orderBy: 'when',
    });
    expect(n.queryColumns({ title: 'Hæ', when: '2025-01-02' })).toEqual({ title: 'Hæ', sortAt: '2025-01-02' });
    expect(n.queryColumns({})).toEqual({ title: null, sortAt: null });
    expect(n.queryColumns(null)).toEqual({ title: null, sortAt: null });
  });
});

describe('extendType', () => {
  it('overrides labels and adds fields without changing the base', () => {
    const ext = extendType(t, {
      label: 'T2',
      fieldOverrides: { title: { label: 'Fyrirsögn', required: false } },
      extraFields: { note: text({ label: 'Athugasemd', multiline: true }) },
    });
    expect(ext.label).toBe('T2');
    expect(ext.fields.title?.label).toBe('Fyrirsögn');
    expect(Object.keys(ext.fields)).toEqual(['title', 'note']);
    expect(ext.publishValidator().safeParse({}).success).toBe(true);
    expect(ext.publishValidator().safeParse({ title: 'abcdef' }).success).toBe(false);

    expect(t.label).toBe('T');
    expect(t.fields.title.label).toBe('Titill');
    expect(Object.keys(t.fields)).toEqual(['title']);
    expect(t.publishValidator().safeParse({}).success).toBe(false);
  });

  it('rejects unknown overrides and duplicate extra fields', () => {
    expect(() => extendType(t, { fieldOverrides: { nope: { label: 'x' } } })).toThrow();
    expect(() => extendType(t, { extraFields: { title: link({ label: 'x' }) } })).toThrow();
  });
});
