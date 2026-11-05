import 'server-only';
import { slugify } from '@litljomi/cms-schema/src/slugify.ts';
import type { SupabaseClient } from '@/lib/supabase/types';
import { failureOf } from './entry-context';

// Room for "-999" in the database's 200 characters.
const MAX_BASE_LENGTH = 190;
const MAX_TRIES = 50;

/** The title as a slug, cut short enough to store and take a suffix; empty when nothing is left. */
export function slugBase(title: string | null): string {
  return slugify(title ?? '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/, '');
}

/** True when `slug` is the base, or the base with the number a taken slug got. */
export function slugFits(slug: string | null, base: string): boolean {
  if (slug === null) return false;
  return slug === base || (slug.startsWith(`${base}-`) && /^\d+$/.test(slug.slice(base.length + 1)));
}

/**
 * Keeps an entry's slug in step with its title (Einar, 2026-11-05: tenants never see or set a slug).
 * It runs after a draft is saved and writes only when the title has moved away from the slug, since
 * a slug change is audited (§4.8). A taken slug gets a number. Once the entry is published the
 * database answers `slug_locked` and the slug stays (§4.3).
 *
 * The save has already succeeded, so this never fails it: the next save tries again, and a publish
 * without a slug names the problem itself.
 */
export async function syncSlug(client: SupabaseClient, entryId: string, current: string | null, title: string | null): Promise<void> {
  const base = slugBase(title);
  if (base === '' || slugFits(current, base)) return;
  try {
    for (let n = 1; n <= MAX_TRIES; n += 1) {
      const result = await client.rpc('set_slug', { p_entry_id: entryId, p_slug: n === 1 ? base : `${base}-${n}` });
      if (!result.error) return;
      const failure = failureOf({ error: result.error, status: result.status });
      if (failure === 'slug_locked') return;
      if (failure !== 'slug_taken') {
        console.error(`auto slug failed: ${result.error.code ?? failure}`);
        return;
      }
    }
    console.error('auto slug failed: no free number');
  } catch {
    console.error('auto slug failed: threw');
  }
}
