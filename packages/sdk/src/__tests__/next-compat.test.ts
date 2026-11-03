// M3-13: the SDK on Next.js 15 and 16 (spec §7.3, "currently 15 and 16; `revalidateTag`'s signature
// differs between them"; A12). The SDK does not import Next.js: the site passes its own
// `revalidateTag`, `draftMode` and `cookies`. This file runs them, from each major's own package,
// through the SDK's revalidation and preview code. The workspace runs the SDK suite once per major
// (`sdk-next15` and `sdk-next16` in vitest.workspace.ts), each with CMS_SDK_NEXT naming the package
// (`next15` or `next16`, npm aliases of next@15 and next@16 in packages/sdk/package.json).
//
// Next.js's functions read its request stores (AsyncLocalStorage). Outside `next start` this test
// provides them itself, with the fields the functions read; the fixture sites on both majors check
// the same code inside a real server (apps/demo-site/e2e).
import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PREVIEW_COOKIE, createPreviewHandler, createRevalidateHandler, readPreviewToken, signPreviewToken, signWebhook } from '../index.ts';

type Major = 'next15' | 'next16';
const pkg = process.env['CMS_SDK_NEXT'] as Major | undefined;
const EXPECTED_MAJOR: Record<Major, number> = { next15: 15, next16: 16 };

// Next.js sets this global in its server runtime before its stores load.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= AsyncLocalStorage;

interface Store<T> {
  run<R>(store: T, fn: () => R): R;
}
interface WorkStore {
  route: string;
  page: string;
  incrementalCache: object;
  cacheLifeProfiles: object;
  pendingRevalidatedTags?: Array<string | { tag: string; profile?: { expire?: number } }>;
  pathWasRevalidated?: unknown;
}
interface NextUnderTest {
  version: string;
  revalidateTag: typeof import('next16/cache').revalidateTag | typeof import('next15/cache').revalidateTag;
  draftMode: typeof import('next16/headers').draftMode | typeof import('next15/headers').draftMode;
  cookies: typeof import('next16/headers').cookies | typeof import('next15/headers').cookies;
  workAsyncStorage: Store<WorkStore>;
  workUnitAsyncStorage: Store<object>;
  RequestCookies: new (headers: Headers) => object;
}

function load(name: Major): NextUnderTest {
  const require = createRequire(import.meta.url);
  const dist = `${name}/dist/server`;
  return {
    version: (require(`${name}/package.json`) as { version: string }).version,
    revalidateTag: (require(`${name}/cache`) as NextUnderTest).revalidateTag,
    draftMode: (require(`${name}/headers`) as NextUnderTest).draftMode,
    cookies: (require(`${name}/headers`) as NextUnderTest).cookies,
    workAsyncStorage: (require(`${dist}/app-render/work-async-storage.external.js`) as { workAsyncStorage: Store<WorkStore> }).workAsyncStorage,
    workUnitAsyncStorage: (require(`${dist}/app-render/work-unit-async-storage.external.js`) as { workUnitAsyncStorage: Store<object> }).workUnitAsyncStorage,
    RequestCookies: (require(`${dist}/web/spec-extension/cookies.js`) as { RequestCookies: NextUnderTest['RequestCookies'] }).RequestCookies,
  };
}

const NOW = 1_800_000_000;
const TENANT = 'compat-site';

describe(`the SDK on Next.js (${pkg ?? 'CMS_SDK_NEXT not set'})`, () => {
  let next: NextUnderTest;
  beforeAll(() => {
    if (pkg !== 'next15' && pkg !== 'next16') throw new Error('CMS_SDK_NEXT must be next15 or next16 (set by vitest.workspace.ts)');
    next = load(pkg);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const workStore = (page: string): WorkStore => ({ route: page, page: `${page}/route`, incrementalCache: {}, cacheLifeProfiles: {} });
  /** A request store for a route handler (phase `action`) or a page render, with a draft mode provider and the request's cookies. */
  function requestStore(o: { draft: boolean; cookie?: string; phase?: 'action' | 'render' }) {
    const state = { enabled: o.draft };
    const cookies = new next.RequestCookies(new Headers(o.cookie === undefined ? {} : { cookie: o.cookie }));
    const provider = {
      get isEnabled() {
        return state.enabled;
      },
      enable: () => void (state.enabled = true),
      disable: () => void (state.enabled = false),
    };
    return { state, store: { type: 'request', phase: o.phase ?? 'action', draftMode: provider, cookies, mutableCookies: cookies, userspaceMutableCookies: cookies } };
  }

  it('is the major this project runs against', () => {
    expect(Number(next.version.split('.')[0])).toBe(EXPECTED_MAJOR[pkg!]);
  });

  describe('createRevalidateHandler with this major’s revalidateTag', () => {
    const body = '{"release":4}';
    const signed = () =>
      new Request('https://site.example/api/cms/revalidate', {
        method: 'POST',
        body,
        headers: { 'x-cms-timestamp': String(NOW), 'x-cms-signature': signWebhook(body, 's1', NOW) },
      });

    it('expires the cms tag at once, with no deprecation warning', async () => {
      const warn = vi.spyOn(console, 'warn');
      const handler = createRevalidateHandler({ secrets: () => ['s1'], revalidateTag: next.revalidateTag, now: () => NOW * 1000 });
      const store = workStore('/api/cms/revalidate');
      const res = await next.workAsyncStorage.run(store, () => handler(signed()));
      expect(res.status).toBe(200);
      const pending = store.pendingRevalidatedTags ?? [];
      expect(pending).toHaveLength(1);
      if (pkg === 'next15') {
        // 15: revalidateTag(tag) always expires at once; the profile argument is not read.
        expect(pending).toEqual(['cms']);
      } else {
        // 16: the profile { expire: 0 } is recorded with the tag: expire now, not stale-while-revalidate.
        expect(pending).toEqual([expect.objectContaining({ tag: 'cms', profile: expect.objectContaining({ expire: 0 }) })]);
      }
      // Set only for an immediate expiry (16 leaves it unset for a stale-while-revalidate profile).
      expect(store.pathWasRevalidated).toBeTruthy();
      expect(warn).not.toHaveBeenCalled();
    });

    it('does not touch the cache on a bad signature', async () => {
      const handler = createRevalidateHandler({ secrets: () => ['other'], revalidateTag: next.revalidateTag, now: () => NOW * 1000 });
      const store = workStore('/api/cms/revalidate');
      const res = await next.workAsyncStorage.run(store, () => handler(signed()));
      expect(res.status).toBe(401);
      expect(store.pendingRevalidatedTags ?? []).toEqual([]);
    });

    it.runIf(pkg === 'next16')('16 only: the one-argument form the SDK avoids is the deprecated one', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const store = workStore('/api/cms/revalidate');
      next.workAsyncStorage.run(store, () => (next.revalidateTag as (tag: string) => void)('cms'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('without the second argument is now deprecated'));
    });
  });

  describe('preview with this major’s draftMode and cookies', () => {
    const token = () => signPreviewToken({ tenant: TENANT, entry_id: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', draft_version: 1, exp: NOW + 600 }, 'p1');

    it('createPreviewHandler enables draft mode through draftMode().enable() and redirects', async () => {
      const handler = createPreviewHandler({
        tenant: TENANT,
        secrets: () => ['p1'],
        enableDraftMode: async () => (await next.draftMode()).enable(),
        now: () => NOW * 1000,
      });
      const { state, store } = requestStore({ draft: false });
      const url = `https://site.example/api/cms/preview?token=${encodeURIComponent(token())}&path=%2Fevents%2Fx`;
      const res = await next.workAsyncStorage.run(workStore('/api/cms/preview'), () => next.workUnitAsyncStorage.run(store, () => handler(new Request(url))));
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe('/events/x');
      expect(state.enabled).toBe(true);
    });

    it('a refused token leaves draft mode off', async () => {
      const handler = createPreviewHandler({ tenant: TENANT, secrets: () => ['p1'], enableDraftMode: async () => (await next.draftMode()).enable(), now: () => NOW * 1000 });
      const { state, store } = requestStore({ draft: false });
      const url = `https://site.example/api/cms/preview?token=${encodeURIComponent(signPreviewToken({ tenant: 'another-site', entry_id: '0b1c2d3e-4f50-4617-8899-aabbccddeeff', draft_version: 1, exp: NOW + 600 }, 'p1'))}&path=%2F`;
      const res = await next.workAsyncStorage.run(workStore('/api/cms/preview'), () => next.workUnitAsyncStorage.run(store, () => handler(new Request(url))));
      expect(res.status).toBe(401);
      expect(state.enabled).toBe(false);
    });

    it('readPreviewToken reads the cookie only in draft mode', async () => {
      const read = (draft: boolean) => {
        const { store } = requestStore({ draft, cookie: `${PREVIEW_COOKIE}=tok-1`, phase: 'render' });
        return next.workAsyncStorage.run(workStore('/events/x'), () =>
          next.workUnitAsyncStorage.run(store, () => readPreviewToken({ draftMode: next.draftMode, cookies: next.cookies })),
        );
      };
      expect(await read(true)).toBe('tok-1');
      expect(await read(false)).toBeNull();
    });
  });
});

// Compile time (pnpm typecheck): each major's own declarations fit what the SDK asks a site to pass.
// The values are never called; only their types are checked.
export function nextDeclarationsFitTheSdk(): void {
  const r15 = null as unknown as typeof import('next15/cache').revalidateTag;
  const r16 = null as unknown as typeof import('next16/cache').revalidateTag;
  const h15 = null as unknown as typeof import('next15/headers');
  const h16 = null as unknown as typeof import('next16/headers');
  const secrets = () => ['s'];
  createRevalidateHandler({ secrets, revalidateTag: r15 });
  createRevalidateHandler({ secrets, revalidateTag: r16 });
  void readPreviewToken({ draftMode: h15.draftMode, cookies: h15.cookies });
  void readPreviewToken({ draftMode: h16.draftMode, cookies: h16.cookies });
  createPreviewHandler({ tenant: TENANT, secrets, enableDraftMode: async () => (await h15.draftMode()).enable() });
  createPreviewHandler({ tenant: TENANT, secrets, enableDraftMode: async () => (await h16.draftMode()).enable() });
}
