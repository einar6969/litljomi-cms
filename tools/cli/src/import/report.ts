// The comparison report (import plan section 2.7): the public bundle read as a site reads it, compared
// with the manifest word for word and file by hash. The expected value of each entry is the module's
// own projection of the manifest's data, so every field kind (and any kind added later) is compared
// in its delivered shape. Anything that could not be checked is counted as unchecked, never as passed.
import { projectEntry, type ModuleManifest, type ProjectionContext } from '@litljomi/cms-schema';
import { Failure } from '../hosted.ts';
import { assetIdFor, sha256Hex } from './media.ts';
import { itemData, type Plan, type PlanItem } from './plan.ts';
import { pointer, type Lookup, type Path } from './refs.ts';
import type { EditorSession } from './session.ts';

export const POINTER_POLL_MS = 10_000;
export const POINTER_WAIT_MS = 10 * 60_000;

/** Stands in for a delivered image's URL in the expected value; the real one is downloaded and hashed. */
const SENTINEL = 'https://import.invalid/asset/';
const BUNDLE_PATH = /^releases\/\d+\.json$/;

export interface Difference {
  key: string;
  type: string;
  at: string;
  what: string;
  expected?: string;
  actual?: string;
}

export interface Report {
  format: 1;
  tenant: string;
  release: number | null;
  checked: { entries: number; files: number };
  differences: Difference[];
  unchecked: { what: string; count: number }[];
  /** Entries of the imported types that the manifest does not name: listed, not judged. */
  extras: { type: string; id: string; slug: string | null }[];
  notices: string[];
}

interface BundleEntry {
  id: string;
  slug: string | null;
  title: string | null;
  sortAt: string | null;
  data: unknown;
}

export interface ReportInput {
  plan: Plan;
  module: ModuleManifest;
  tenant: { id: string; slug: string };
  ids: Map<string, string>;
  /** The local stack delivers every image as null until A4: the file half is unchecked there. */
  local: boolean;
  lastRelease: number | null;
  notices: string[];
  session: EditorSession;
  now(): number;
  sleep(ms: number): Promise<void>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v) ?? 'undefined';
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

/** The first differing word of two texts, with five words either side of it on each side. */
export function wordContext(expected: string, actual: string): { expected: string; actual: string } {
  const a = expected.split(/(\s+)/);
  const b = actual.split(/(\s+)/);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  // Tokens alternate word, space; five words either side are ten tokens.
  const around = (t: string[]) => t.slice(Math.max(0, i - 10), i + 11).join('');
  return { expected: around(a), actual: around(b) };
}

/** Reads the tenant's pointer as the SDK does (packages/sdk/src/client.ts), then the bundle it names. */
async function readBundle(s: EditorSession, slug: string): Promise<{ release: number; entries: Record<string, BundleEntry[]> } | 'none' | string> {
  const base = `/storage/v1/object/public/delivery/${encodeURIComponent(slug)}`;
  const p = await s.publicGet(`${base}/current.json`);
  if (!p.ok) return p.status === 400 || p.status === 404 ? 'none' : `reading the pointer: ${p.detail}`;
  const pointer = p.body as Record<string, unknown> | null;
  if (!isObject(pointer) || pointer.format !== 1 || pointer.tenant !== slug) return 'the pointer is not this tenant\'s format 1 pointer';
  const release = pointer.release;
  if (!Number.isSafeInteger(release) || (release as number) < 1) return 'the pointer names no release';
  if (typeof pointer.bundle !== 'string' || !BUNDLE_PATH.test(pointer.bundle) || pointer.bundle !== `releases/${String(release)}.json`) {
    return 'the pointer names an unexpected bundle';
  }
  const b = await s.publicGet(`${base}/${pointer.bundle}`);
  if (!b.ok) return `reading the bundle: ${b.detail}`;
  const bundle = b.body as Record<string, unknown> | null;
  if (!isObject(bundle) || bundle.format !== 1 || bundle.tenant !== slug || bundle.release !== release || !isObject(bundle.entries)) {
    return 'the bundle is not the pointer\'s';
  }
  return { release: release as number, entries: bundle.entries as Record<string, BundleEntry[]> };
}

export async function buildReport(input: ReportInput): Promise<Report> {
  const { plan, module, tenant, ids, session } = input;
  const report: Report = {
    format: 1,
    tenant: tenant.slug,
    release: null,
    checked: { entries: 0, files: 0 },
    differences: [],
    unchecked: [],
    extras: [],
    notices: input.notices,
  };
  const unchecked = (what: string, count: number) => {
    if (count > 0) report.unchecked.push({ what, count });
  };

  // Wait for a pointer at least as new as the import's last release.
  let bundle: Awaited<ReturnType<typeof readBundle>>;
  const started = input.now();
  for (;;) {
    bundle = await readBundle(session, tenant.slug);
    const fresh = typeof bundle === 'object' && (input.lastRelease === null || bundle.release >= input.lastRelease);
    if (fresh || (bundle === 'none' && input.lastRelease === null) || (typeof bundle === 'string' && bundle !== 'none')) break;
    if (input.now() - started >= POINTER_WAIT_MS) break;
    await input.sleep(POINTER_POLL_MS);
  }
  if (bundle === 'none') {
    for (const item of plan.items) report.differences.push({ key: item.key, type: item.type, at: '(entry)', what: 'not in the public bundle (the tenant has no published release)' });
    return report;
  }
  if (typeof bundle === 'string') {
    unchecked(`entries not compared: ${bundle}`, plan.items.length);
    return report;
  }
  if (input.lastRelease !== null && bundle.release < input.lastRelease) {
    unchecked(`entries not compared: the pointer still names release ${bundle.release}, older than the import's ${input.lastRelease}`, plan.items.length);
    return report;
  }
  report.release = bundle.release;
  const entries = bundle.entries;
  const bundleEntry = (type: string, id: string): BundleEntry | undefined =>
    (Object.hasOwn(entries, type) && Array.isArray(entries[type]) ? entries[type] : []).find((e) => isObject(e) && e.id === id);

  // The expected projection: entries as the manifest describes them, images by their manifest file.
  const lookup: Lookup = {
    entry: (key) => {
      const item = plan.byKey.get(key);
      const id = ids.get(key);
      return item === undefined || id === undefined ? null : { id, type: item.type };
    },
    file: (path) => {
      const f = plan.files.get(path);
      return f === undefined ? null : { id: assetIdFor(tenant.id, f.sha256), alt: f.alt };
    },
  };
  const itemById = new Map<string, PlanItem>();
  for (const item of plan.items) {
    const id = ids.get(item.key);
    if (id !== undefined) itemById.set(id, item);
  }
  const fileById = new Map([...plan.files.values()].map((f) => [assetIdFor(tenant.id, f.sha256), f]));
  const ctx: ProjectionContext = {
    entry(id) {
      const item = itemById.get(id);
      if (item === undefined) return null;
      const data = itemData(plan, item, lookup, 'full');
      const { title, sortAt } = item.contentType.queryColumns(data);
      // A target's slug and sort key as delivered: a slug that differs is reported once, at the target.
      const delivered = bundleEntry(item.type, id);
      const slug = delivered === undefined ? item.slug : delivered.slug;
      const integration = module.site[item.type];
      let path: string | null = null;
      try {
        path = integration?.path ? integration.path({ id, type: item.type, slug, sortAt: delivered?.sortAt ?? sortAt }) : null;
      } catch {
        path = null;
      }
      return { id, type: item.type, slug, title, path };
    },
    asset(id) {
      const f = fileById.get(id);
      if (f === undefined || input.local) return null;
      return { id, url: `${SENTINEL}${id}`, width: f.meta.width, height: f.meta.height, mime: f.meta.mime, alt: f.alt, focal: null };
    },
  };

  const fileChecks = new Map<string, { url: string; key: string; type: string; at: string }>();
  for (const item of plan.items) {
    const id = ids.get(item.key);
    const diff = (at: Path | string, what: string, expected?: unknown, actual?: unknown) =>
      report.differences.push({
        key: item.key,
        type: item.type,
        at: typeof at === 'string' ? at : pointer(at),
        what,
        ...(expected === undefined ? {} : { expected: short(expected) }),
        ...(actual === undefined ? {} : { actual: short(actual) }),
      });
    const delivered = id === undefined ? undefined : bundleEntry(item.type, id);
    if (delivered === undefined) {
      diff('(entry)', id === undefined ? 'never created' : `not in release ${bundle.release}`);
      continue;
    }
    report.checked.entries += 1;
    if (!item.singleton && delivered.slug !== item.slug) diff('(slug)', 'published slug differs from the manifest', item.slug, delivered.slug);
    let expected: Record<string, unknown>;
    try {
      expected = projectEntry(item.contentType, itemData(plan, item, lookup, 'full'), ctx);
    } catch (e) {
      diff('(data)', `the manifest's data could not be projected (${e instanceof Error ? e.name : 'error'})`);
      continue;
    }
    if (input.local) unchecked('image uses not compared on the local stack (local images are delivered as null until A4)', item.files.length);
    compare(expected, delivered.data, [], {
      diff,
      file: (url, at) => {
        const assetId = (at.expected as string).slice(SENTINEL.length);
        if (typeof url !== 'string') return diff(at.path, 'an image is delivered without a URL');
        if (!fileChecks.has(assetId)) fileChecks.set(assetId, { url, key: item.key, type: item.type, at: pointer(at.path) });
      },
    });
  }

  // Each delivered image once: its bytes must be the manifest file's.
  for (const [assetId, check] of fileChecks) {
    const f = fileById.get(assetId);
    if (f === undefined) continue;
    let got: Awaited<ReturnType<EditorSession['publicGet']>>;
    try {
      got = await session.publicGet(check.url);
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      unchecked('images delivered from outside the target project', 1);
      continue;
    }
    if (!got.ok) {
      report.differences.push({ key: check.key, type: check.type, at: check.at, what: `file ${f.path}: the delivered image could not be read (${got.detail})` });
      continue;
    }
    report.checked.files += 1;
    if (got.bytes.byteLength !== f.bytes || sha256Hex(got.bytes) !== f.sha256) {
      report.differences.push({
        key: check.key,
        type: check.type,
        at: check.at,
        what: `file ${f.path}: the delivered image is not the manifest's file`,
        expected: `${f.bytes} bytes, sha256 ${f.sha256}`,
        actual: `${got.bytes.byteLength} bytes, sha256 ${sha256Hex(got.bytes)}`,
      });
    }
  }
  const captioned = [...plan.files.values()].filter((f) => f.caption !== null || f.credit !== null).length;
  unchecked('file captions and credits (not delivered until L3)', captioned);

  const imported = new Set(plan.items.map((i) => i.type));
  const known = new Set(ids.values());
  for (const type of imported) {
    for (const e of Object.hasOwn(entries, type) && Array.isArray(entries[type]) ? entries[type] : []) {
      if (isObject(e) && typeof e.id === 'string' && !known.has(e.id)) report.extras.push({ type, id: e.id, slug: typeof e.slug === 'string' ? e.slug : null });
    }
  }
  if (Object.keys(plan.order).length > 0) unchecked('order: validated, not applied (manual ordering, A12, does not exist yet)', Object.keys(plan.order).length);
  return report;
}

interface Compare {
  diff(at: Path, what: string, expected?: unknown, actual?: unknown): void;
  file(url: unknown, at: { path: Path; expected: unknown }): void;
}

function compare(expected: unknown, actual: unknown, at: Path, c: Compare): void {
  if (typeof expected === 'string' && expected.startsWith(SENTINEL)) return c.file(actual, { path: at, expected });
  if (typeof expected === 'string') {
    if (typeof actual !== 'string') return c.diff(at, 'not the same kind of value', expected, actual);
    if (expected !== actual) {
      const w = wordContext(expected, actual);
      c.diff(at, 'text differs', w.expected, w.actual);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) return c.diff(at, 'not the same kind of value', expected, actual);
    if (expected.length !== actual.length) c.diff(at, `holds ${actual.length} item(s), the manifest ${expected.length}`);
    for (let i = 0; i < Math.min(expected.length, actual.length); i++) compare(expected[i], actual[i], [...at, i], c);
    return;
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return c.diff(at, expected === null ? 'differs' : 'missing or not an object', expected, actual);
    // A delivered image's focal point is the editor's to set, not the manifest's.
    const image = typeof expected.url === 'string' && expected.url.startsWith(SENTINEL);
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const k of [...keys].sort()) {
      if (image && k === 'focal') continue;
      if (expected[k] === undefined && actual[k] === undefined) continue;
      compare(expected[k], actual[k], [...at, k], c);
    }
    return;
  }
  if (!Object.is(expected, actual) && !(expected == null && actual == null)) c.diff(at, 'differs', expected, actual);
}
