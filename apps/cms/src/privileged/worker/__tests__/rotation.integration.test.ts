// Rotating a site's webhook secret against the local stack (spec §8.2, §7.3; plan M4-02, review focus
// 1). Runs on labak with one fake site (node:http on a fixed port) that verifies each webhook with the
// secrets it holds, as the SDK's revalidation handler does with CMS_WEBHOOK_SECRETS, and renders the
// bundle the delivery bucket's pointer names, reloading it only on a verified webhook. The tenant's
// other active sites are deactivated around the tests as owner and restored after, with the ids kept
// in a file until then, as in pipeline.integration.test.ts.
//
// The rotation is the real `provision webhook-secret`. The command refuses every host but
// https://<ref>.supabase.co, so it is given a project reference that exists nowhere and a fetch that
// sends each of its requests to the local stack instead: nothing here reaches a hosted system.
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook, type Bundle, type BundleEntry, type Pointer } from '@litljomi/cms-sdk';
import { editorClient, publicUrl, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { runProvision } from '../../../../../../tools/cli/src/provision.ts';
import { buildRelease } from '../build-release';
import { processAndDeliver, sweep } from '../pipeline';
import { processPendingRequests } from '../process-request';
import { entryMarker, html, releaseMeta, startFakeSite, type FakeSite, type Recorded } from './fake-site';
import { prepareLabak } from './labak-setup';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';

const PORT = 3193;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const REVALIDATE = '/api/cms/revalidate';
const fast = { pollMs: 100, timeoutMs: 15_000 };
const MINUTE = 60_000;
/** The labak sites this file deactivated and has not restored yet (a run killed midway leaves it). */
const DEACTIVATED_FILE = join(tmpdir(), 'litljomi-cms-rotation-deactivated-sites.json');
/** A project reference of the right form that belongs to no project; see `hostedFetch`. */
const REF = 'rotationtest00000000';
const PROJECT_ORIGIN = `https://${REF}.supabase.co`;

const newSecret = () => randomBytes(32).toString('base64url');

let editor: SupabaseClient;
let site: FakeSite;
let siteId: string;
let deactivated: string[] = [];
/** What the site holds: its CMS_WEBHOOK_SECRETS. */
let accepted: string[] = [];
/** What the fake site renders: the bundle loaded at start and on each verified webhook. */
let rendered: Bundle | null = null;

async function loadBundle(): Promise<Bundle | null> {
  const p = await fetch(publicUrl('delivery', 'labak/current.json'), { cache: 'no-store' });
  if (!p.ok) return null;
  const pointer = (await p.json()) as Pointer;
  const b = await fetch(publicUrl('delivery', `labak/${pointer.bundle}`), { cache: 'no-store' });
  return b.ok ? ((await b.json()) as Bundle) : null;
}

const signedWith = (req: Recorded, secrets: string[]) =>
  verifyWebhook({
    body: req.body,
    signature: String(req.headers[SIGNATURE_HEADER] ?? ''),
    timestamp: Number(req.headers[TIMESTAMP_HEADER]),
    secrets,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

const news = (): BundleEntry[] => rendered?.entries['news'] ?? [];
const listing = () => html(releaseMeta(rendered?.release ?? 0), `<ul>${news().map((e) => `<li>${entryMarker(e.id, e.contentHash)}${e.title}</li>`).join('')}</ul>`);

async function startLabakSite(): Promise<FakeSite> {
  const s = await startFakeSite(PORT);
  s.handler = async (req) => {
    if (req.method === 'POST' && req.path === REVALIDATE) {
      if (!signedWith(req, accepted)) return { status: 401, html: '{}' };
      rendered = await loadBundle();
      return { status: 200, html: '{"revalidated":true}' };
    }
    if (req.path === '/' || req.path === '/frettir') return { status: 200, html: listing() };
    const slug = /^\/frettir\/([a-z0-9-]+)$/.exec(req.path)?.[1];
    const entry = slug ? news().find((e) => e.slug === slug) : undefined;
    if (entry) return { status: 200, html: html(releaseMeta(rendered!.release), `<article>${entryMarker(entry.id, entry.contentHash)}<h1>${entry.title}</h1></article>`) };
    return { status: 404, html: html('', '<h1>404</h1>') };
  };
  return s;
}

const webhooks = () => site.requests.filter((r) => r.path === REVALIDATE);

/** Sets the secret as the setup, before a test starts its rotation. */
async function holdInCms(secret: string): Promise<void> {
  const { error } = await secretClient().schema('api').rpc('admin_set_webhook_secret', { p_site_id: siteId, p_webhook_secret: secret });
  if (error) throw new Error(`admin_set_webhook_secret: ${error.message}`);
}

/** Only the command's own requests, each sent to the local stack instead of the project's origin. */
const hostedFetch = (url: string, init: RequestInit): Promise<Response> => {
  if (!url.startsWith(`${PROJECT_ORIGIN}/`)) throw new Error(`refusing ${url}`);
  return fetch(`${env.apiUrl}${url.slice(PROJECT_ORIGIN.length)}`, init);
};

/** `provision webhook-secret --site-id <id> --expect-ref <ref>`, with `secret` on standard input. */
async function rotate(secret: string): Promise<void> {
  const lines: string[] = [];
  const write = (line: string) => void lines.push(line);
  const code = await runProvision(['webhook-secret', '--site-id', siteId, '--expect-ref', REF, '--env-file=/rotation-test.env'], { log: write, error: write }, {
    fetch: hostedFetch,
    readTextFile: async () => `NEXT_PUBLIC_SUPABASE_URL=${PROJECT_ORIGIN}\nSUPABASE_SECRET_KEY=${env.secretKey}\n`,
    readStdin: async () => `${secret}\n`,
  });
  expect(lines).toEqual([`target: ${REF}.supabase.co`, `site ${siteId}: webhook secret set`]);
  expect(code).toBe(0);
}

beforeAll(async () => {
  site = await startLabakSite(); // fails on a busy port, before any setup writes to the database
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  editor = await editorClient('editor_labak');
  await prepareLabak();

  const existing = await ownerQuery<{ id: string }>('select id from cms.sites where tenant_id = $1 and base_url = $2', [TENANT.labak, BASE_URL]);
  if (existing[0]) {
    siteId = existing[0].id;
  } else {
    const { data, error } = await secretClient()
      .schema('api')
      .rpc('admin_create_site', {
        p_tenant_id: TENANT.labak,
        p_base_url: BASE_URL,
        p_revalidate_url: `${BASE_URL}${REVALIDATE}`,
        p_preview_url: null,
        p_webhook_secret: newSecret(),
      });
    if (error) throw new Error(`admin_create_site: ${error.message}`);
    siteId = data as string;
  }
  // An earlier run that was killed left its list: those sites are restored first.
  const leftover = existsSync(DEACTIVATED_FILE) ? (JSON.parse(readFileSync(DEACTIVATED_FILE, 'utf8')) as string[]) : [];
  if (leftover.length > 0) await ownerQuery('update cms.sites set active = true where id = any($1::uuid[]) and id <> $2', [leftover, siteId]);
  deactivated = (
    await ownerQuery<{ id: string }>('update cms.sites set active = false where tenant_id = $1 and active and id <> $2 returning id', [TENANT.labak, siteId])
  ).map((r) => r.id);
  writeFileSync(DEACTIVATED_FILE, JSON.stringify(deactivated));
  await ownerQuery('update cms.sites set active = true where id = $1', [siteId]);

  // What earlier files left unreleased goes out here, so each release links only this file's requests.
  await processPendingRequests(100);
  expect((await buildRelease(TENANT.labak)).status).toBe('delivered');
  rendered = await loadBundle();
});
afterAll(async () => {
  await site?.close();
  if (siteId) await ownerQuery('update cms.sites set active = false where id = $1', [siteId]);
  if (deactivated.length > 0) await ownerQuery('update cms.sites set active = true where id = any($1::uuid[])', [deactivated]);
  rmSync(DEACTIVATED_FILE, { force: true });
  vi.unstubAllEnvs();
  await closeAll();
});

const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await editor.schema('api').rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data as T;
};

async function labakAsset(): Promise<string> {
  const id = randomUUID();
  const path = `${TENANT.labak}/${id}/mynd.jpg`;
  const { error } = await editor.storage.from('media-private').upload(path, TEST_JPEG, { contentType: 'image/jpeg' });
  if (error) throw error;
  await rpc('register_asset', {
    p_asset_id: id,
    p_tenant_id: TENANT.labak,
    p_original_path: path,
    p_filename: 'mynd.jpg',
    ...TEST_JPEG_METADATA,
  });
  return id;
}

/** A labak news entry with a draft, and a publish request for it (the fast path not run). */
async function requested(title: string): Promise<{ entryId: string; requestId: string }> {
  const entryId = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: `m402-${randomUUID().slice(0, 8)}` });
  const version = await rpc<number>('save_draft', {
    p_entry_id: entryId,
    p_expected_version: 1,
    p_data: {
      title,
      date: '2026-11-05',
      excerpt: 'Inngangur.',
      image: { _ref: await labakAsset(), _kind: 'asset', alt: 'Brauð' },
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
    },
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  const requestId = await rpc<string>('request_publish', { p_entry_id: entryId, p_expected_draft_version: version });
  return { entryId, requestId };
}

type Delivery = { status: string; notify_status: string; notify_attempts: number; live_status: string; last_error: unknown; next_attempt_at: Date | null };
async function deliveryOf(requestId: string): Promise<Delivery> {
  const [row] = await ownerQuery<Delivery>(
    `select pr.status, sd.notify_status, sd.notify_attempts, sd.live_status, sd.last_error, sd.next_attempt_at
     from cms.publish_requests pr
     left join cms.site_deliveries sd on sd.release_id = pr.release_id and sd.site_id = $2
     where pr.id = $1`,
    [requestId, siteId],
  );
  return row!;
}

const secretRef = async () => (await ownerQuery<{ webhook_secret_ref: string }>('select webhook_secret_ref from cms.sites where id = $1', [siteId]))[0]!.webhook_secret_ref;

const delivered = { status: 'committed', notify_status: 'ok', notify_attempts: 1, live_status: 'ok', last_error: null, next_attempt_at: null };

/** Publishes a new entry through the fast path: it must arrive at the first attempt, signed with `secret` alone. */
async function publishesFirstTime(title: string, secret: string, other: string): Promise<void> {
  const r = await requested(title);
  const before = webhooks().length;
  await processAndDeliver(r.requestId, fast);
  expect(await deliveryOf(r.requestId)).toMatchObject(delivered);
  const sent = webhooks().slice(before);
  expect(sent).toHaveLength(1);
  expect(signedWith(sent[0]!, [secret])).toBe(true);
  expect(signedWith(sent[0]!, [other])).toBe(false);
  expect(news().some((e) => e.id === r.entryId)).toBe(true);
}

describe('rotating a webhook secret', () => {
  it('in order: the site accepts old,new, the CMS rotates, the site accepts only new, with no failed delivery', async () => {
    const [oldSecret, newValue] = [newSecret(), newSecret()];
    await holdInCms(oldSecret);
    accepted = [oldSecret];
    const ref = await secretRef();
    await publishesFirstTime('Fyrir skiptin', oldSecret, newValue);
    const before = webhooks().length;

    accepted = [oldSecret, newValue];
    await publishesFirstTime('Báðir lyklar, sá gamli í CMS', oldSecret, newValue);
    await rotate(newValue);
    await publishesFirstTime('Báðir lyklar, sá nýi í CMS', newValue, oldSecret);

    accepted = [newValue];
    await publishesFirstTime('Aðeins nýi lykillinn', newValue, oldSecret);

    expect(webhooks().length - before).toBe(3);
    // Rotated in place, so the site row needs no other change.
    expect(await secretRef()).toBe(ref);
  });

  it('rerun with the same value: nothing changes and publishing goes on', async () => {
    const [oldSecret, newValue] = [newSecret(), newSecret()];
    await holdInCms(oldSecret);
    accepted = [newValue];
    await rotate(newValue);
    await rotate(newValue);
    await publishesFirstTime('Sami lykill tvisvar', newValue, oldSecret);
  });

  it.each([
    ['only the old secret', (oldSecret: string) => [oldSecret]],
    ['the old secret and a mistyped new one', (oldSecret: string, newValue: string) => [oldSecret, `${newValue.slice(0, -1)}!`]],
  ])('out of order, the site holding %s: it refuses the webhook, the delivery retries, and succeeds once the site accepts the new one', async (_name, held) => {
    const [oldSecret, newValue] = [newSecret(), newSecret()];
    await holdInCms(oldSecret);
    accepted = held(oldSecret, newValue);
    await rotate(newValue);

    const r = await requested('Lykill í rangri röð');
    const t0 = Date.now();
    await processAndDeliver(r.requestId, { ...fast, now: () => t0 });
    expect(await deliveryOf(r.requestId)).toMatchObject({
      status: 'committed',
      notify_status: 'failed',
      notify_attempts: 1,
      live_status: 'pending',
      last_error: { code: 'notify_failed', status: 401 },
      next_attempt_at: new Date(t0 + MINUTE),
    });
    expect(news().some((e) => e.id === r.entryId)).toBe(false);

    // Still refused at the first retry.
    await sweep({ ...fast, now: () => t0 + MINUTE });
    const refused = await deliveryOf(r.requestId);
    expect(refused).toMatchObject({ notify_status: 'failed', notify_attempts: 2, live_status: 'pending', last_error: { code: 'notify_failed', status: 401 } });
    expect(refused.next_attempt_at).not.toBeNull();

    // The site gets the new secret; the next retry that falls due delivers.
    accepted = [newValue];
    const due = refused.next_attempt_at!.getTime();
    await sweep({ ...fast, now: () => due });
    expect(await deliveryOf(r.requestId)).toMatchObject({ ...delivered, notify_attempts: 3 });
    expect(news().some((e) => e.id === r.entryId)).toBe(true);
  });
});
