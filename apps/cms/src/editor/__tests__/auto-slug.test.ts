import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { slugBase, slugFits, syncSlug } = await import('../server/auto-slug');
import type { SupabaseClient } from '@/lib/supabase/types';

const ENTRY = '00000000-0000-4000-8000-0000000000e1';
type Answer = { error: { code?: string; message?: string } | null; status?: number };

let tried: string[];
let answer: (slug: string) => Answer;
const client = {
  rpc: async (name: string, args: { p_entry_id: string; p_slug: string }) => {
    expect(name).toBe('set_slug');
    expect(args.p_entry_id).toBe(ENTRY);
    tried.push(args.p_slug);
    return answer(args.p_slug);
  },
} as unknown as SupabaseClient;

const taken = { error: { code: 'P0001', message: 'slug_taken' }, status: 400 };

beforeEach(() => {
  tried = [];
  answer = () => ({ error: null });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('slugBase', () => {
  it('transliterates Icelandic and fits the database with room for a number', () => {
    expect(slugBase('Nýtt sýningarár hefst')).toBe('nytt-syningarar-hefst');
    expect(slugBase(null)).toBe('');
    expect(slugBase('!!!')).toBe('');
    const long = slugBase(`${'a'.repeat(189)} b`);
    expect(long).toBe('a'.repeat(189));
  });
});

describe('slugFits', () => {
  it('accepts the base and the base with a number, nothing else', () => {
    expect(slugFits('braud', 'braud')).toBe(true);
    expect(slugFits('braud-2', 'braud')).toBe(true);
    expect(slugFits('braud-arsins', 'braud')).toBe(false);
    expect(slugFits(null, 'braud')).toBe(false);
  });
});

describe('syncSlug', () => {
  it('sets the slug from the title when there is none', async () => {
    await syncSlug(client, ENTRY, null, 'Brauð ársins');
    expect(tried).toEqual(['braud-arsins']);
  });

  it('follows a changed title', async () => {
    await syncSlug(client, ENTRY, 'braud', 'Brauð ársins');
    expect(tried).toEqual(['braud-arsins']);
  });

  it('writes nothing when the slug already fits, so an autosave adds no audit event', async () => {
    await syncSlug(client, ENTRY, 'braud-arsins', 'Brauð ársins');
    await syncSlug(client, ENTRY, 'braud-arsins-3', 'Brauð ársins');
    expect(tried).toEqual([]);
  });

  it('writes nothing for a title with no letters', async () => {
    await syncSlug(client, ENTRY, null, '');
    await syncSlug(client, ENTRY, null, null);
    expect(tried).toEqual([]);
  });

  it('numbers a taken slug', async () => {
    answer = (slug) => (slug === 'braud-3' ? { error: null } : taken);
    await syncSlug(client, ENTRY, null, 'Brauð');
    expect(tried).toEqual(['braud', 'braud-2', 'braud-3']);
  });

  it('leaves a locked slug alone after the first publish', async () => {
    answer = () => ({ error: { code: 'P0001', message: 'slug_locked' }, status: 400 });
    await syncSlug(client, ENTRY, 'braud', 'Annað');
    expect(tried).toEqual(['annad']);
  });

  it('never fails the save', async () => {
    answer = () => ({ error: { code: 'XX000', message: 'boom' }, status: 500 });
    await expect(syncSlug(client, ENTRY, null, 'Brauð')).resolves.toBeUndefined();
    const throwing = { rpc: async () => Promise.reject(new Error('down')) } as unknown as SupabaseClient;
    await expect(syncSlug(throwing, ENTRY, null, 'Brauð')).resolves.toBeUndefined();
  });

  it('gives up when no number is free', async () => {
    answer = () => taken;
    await syncSlug(client, ENTRY, null, 'Brauð');
    expect(tried).toHaveLength(50);
  });
});
