import type { Bundle, BundleEntry, Pointer } from './bundle.ts';

export interface CmsClient {
  getBundle(): Promise<Bundle>;
  getEntries<T = Record<string, unknown>>(type: string): Promise<BundleEntry<T>[]>;
  getEntry<T = Record<string, unknown>>(type: string, slug: string): Promise<BundleEntry<T> | null>;
}

const BUNDLE_PATH = /^releases\/\d+\.json$/;

/**
 * Reads the pointer with the Next.js fetch cache (tag `cms`, revalidate 3600) and the immutable
 * bundle it names with `force-cache`. Never `no-store`: that would make the site's routes dynamic
 * (spec §7.3). `next` is a Next.js fetch extension; other runtimes ignore it.
 */
export function createCmsClient(o: { deliveryBaseUrl: string; tenant: string; fetch?: typeof fetch }): CmsClient {
  const doFetch = o.fetch ?? fetch;
  const base = o.deliveryBaseUrl.replace(/\/+$/, '');

  // Untyped on purpose: the caller checks `format`, tenant and release before trusting the shape.
  async function readJson(url: string, init: object): Promise<unknown> {
    const res = await doFetch(url, init);
    if (!res.ok) throw new Error(`cms: ${url} responded ${res.status}`);
    return res.json();
  }

  async function getBundle(): Promise<Bundle> {
    const pointer = (await readJson(`${base}/${o.tenant}/current.json`, { next: { tags: ['cms'], revalidate: 3600 } })) as Pointer;
    if (pointer?.format !== 1) throw new Error(`cms: unsupported pointer format ${String(pointer?.format)}`);
    if (pointer.tenant !== o.tenant) throw new Error('cms: pointer tenant does not match');
    if (!Number.isSafeInteger(pointer.release) || pointer.release < 1) throw new Error('cms: pointer release is not a release number');
    if (typeof pointer.bundle !== 'string' || !BUNDLE_PATH.test(pointer.bundle)) throw new Error('cms: unexpected bundle path in pointer');
    // The pointer names exactly its own release's bundle (Task 26 security r1, F4).
    if (pointer.bundle !== `releases/${pointer.release}.json`) throw new Error('cms: pointer bundle is not its release\'s bundle');
    const bundle = (await readJson(`${base}/${o.tenant}/${pointer.bundle}`, { cache: 'force-cache' })) as Bundle;
    if (bundle?.format !== 1) throw new Error(`cms: unsupported bundle format ${String(bundle?.format)}`);
    if (bundle.tenant !== o.tenant) throw new Error('cms: bundle tenant does not match');
    if (bundle.release !== pointer.release) throw new Error('cms: bundle release does not match the pointer');
    return bundle;
  }

  async function getEntries<T>(type: string): Promise<BundleEntry<T>[]> {
    const { entries } = await getBundle();
    return (Object.hasOwn(entries, type) ? (entries[type] ?? []) : []) as BundleEntry<T>[];
  }

  return {
    getBundle,
    getEntries,
    async getEntry<T>(type: string, slug: string) {
      return (await getEntries<T>(type)).find((e) => e.slug === slug) ?? null;
    },
  };
}
