// Worker step 3 against the local stack (plan Task 21, decisions 34 and 35; spec §6.1, §7.3, §7.4).
// Runs on labak with one fake site (node:http on a fixed port), created idempotently; the tenant's
// other active sites are deactivated around the tests as owner and restored after, and the fake
// site is deactivated again (Task 21 quality r1, Minor 7). The ids deactivated are kept in a file
// until they are restored, so a run killed midway is healed by the next one. The fake site
// renders the labak bundle that the delivery bucket's pointer names, reloading it only when a
// correctly signed webhook arrives, as a site's revalidation would. Earlier labak content is in
// every build, so assertions are about the entries each test creates.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, verifyWebhook, type Bundle, type BundleEntry, type Pointer } from '@litljomi/cms-sdk';
import { mailsTo, sleep, waitMail } from '../../../../../../tests/integration/src/auth-api.ts';
import { editorClient, publicUrl, secretClient } from '../../../../../../tests/integration/src/clients.ts';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery, withTx } from '../../../../../../tests/integration/src/sql.ts';
import { buildRelease } from '../build-release';
import { processAndDeliver, sweep } from '../pipeline';
import { STALE_RELEASE_SECONDS } from '../sweep';
import { processPendingRequests } from '../process-request';
import { entryMarker, html, releaseMeta, startFakeSite, type FakeSite } from './fake-site';
import { prepareLabak } from './labak-setup';
import { TEST_JPEG, TEST_JPEG_METADATA } from './test-image';

const PORT = 3198;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SECRET = 'pipeline-fake-site-secret';
const fast = { pollMs: 100, timeoutMs: 15_000 };
/** The labak sites this file deactivated and has not restored yet (a run killed midway leaves it). */
const DEACTIVATED_FILE = join(tmpdir(), 'litljomi-cms-pipeline-deactivated-sites.json');

let editor: SupabaseClient;
let site: FakeSite;
let siteId: string;
let deactivated: string[] = [];
/** What the fake site renders: the bundle loaded at start and on each verified webhook. */
let rendered: Bundle | null = null;
/** When set, the fake site answers the webhook with this status and does not revalidate. */
let webhookStatus: number | null = null;
/** When false, the fake site acknowledges webhooks but never reloads (a stale site). */
let revalidates = true;

const JPEG = TEST_JPEG;

async function loadBundle(): Promise<Bundle | null> {
  const p = await fetch(publicUrl('delivery', 'labak/current.json'), { cache: 'no-store' });
  if (!p.ok) return null;
  const pointer = (await p.json()) as Pointer;
  const b = await fetch(publicUrl('delivery', `labak/${pointer.bundle}`), { cache: 'no-store' });
  return b.ok ? ((await b.json()) as Bundle) : null;
}

const news = (): BundleEntry[] => rendered?.entries['news'] ?? [];
const listing = () => html(releaseMeta(rendered?.release ?? 0), `<ul>${news().map((e) => `<li>${entryMarker(e.id, e.contentHash)}${e.title}</li>`).join('')}</ul>`);

async function startLabakSite(): Promise<FakeSite> {
  const s = await startFakeSite(PORT);
  s.handler = async (req) => {
    if (req.method === 'POST' && req.path === '/api/cms/revalidate') {
      const ok = verifyWebhook({
        body: req.body,
        signature: String(req.headers[SIGNATURE_HEADER] ?? ''),
        timestamp: Number(req.headers[TIMESTAMP_HEADER]),
        secrets: [SECRET],
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      if (!ok) return { status: 401, html: '{}' };
      if (webhookStatus !== null) return { status: webhookStatus, html: '{}' };
      if (revalidates) rendered = await loadBundle();
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

/** Fails with a clear message when something already listens on the fixed fake-site port. */
async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (e: NodeJS.ErrnoException) =>
      reject(new Error(e.code === 'EADDRINUSE' ? `port ${port} (the pipeline tests' fake site) is already in use; stop whatever runs there first` : `cannot probe port ${port}: ${e.message}`)),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

beforeAll(async () => {
  await assertPortFree(PORT); // before any setup writes to the database
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
        p_revalidate_url: `${BASE_URL}/api/cms/revalidate`,
        p_preview_url: null,
        p_webhook_secret: SECRET,
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

  // Earlier files leave labak requests pending or committed without a release (some of them for
  // entries a build omits). Each test's release must link only the requests it creates, so they
  // are processed and released here first (buildRelease alone notifies no site).
  await processPendingRequests(100);
  expect((await buildRelease(TENANT.labak)).status).toBe('delivered');

  site = await startLabakSite();
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
  const { error } = await editor.storage.from('media-private').upload(path, JPEG, { contentType: 'image/jpeg' });
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
async function requested(title: string): Promise<{ entryId: string; slug: string; requestId: string }> {
  const slug = `t21-${randomUUID().slice(0, 8)}`;
  const entryId = await rpc<string>('create_entry', { p_tenant_id: TENANT.labak, p_type: 'news', p_slug: slug });
  const data = {
    title,
    date: '2026-11-02',
    excerpt: 'Inngangur.',
    image: { _ref: await labakAsset(), _kind: 'asset', alt: 'Brauð' },
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Meginmál.' }] }] },
  };
  const version = await rpc<number>('save_draft', {
    p_entry_id: entryId,
    p_expected_version: 1,
    p_data: data,
    p_schema_version: 1,
    p_title: null,
    p_sort_at: null,
  });
  const requestId = await rpc<string>('request_publish', { p_entry_id: entryId, p_expected_draft_version: version });
  return { entryId, slug, requestId };
}

type Delivery = { notify_status: string; notify_attempts: number; live_status: string; last_error: unknown; number: number };
async function deliveryOf(requestId: string): Promise<Delivery & { status: string; release_id: string | null }> {
  const [row] = await ownerQuery<Delivery & { status: string; release_id: string | null }>(
    `select pr.status, pr.release_id, r.number, sd.notify_status, sd.notify_attempts, sd.live_status, sd.last_error
     from cms.publish_requests pr
     left join cms.releases r on r.id = pr.release_id
     left join cms.site_deliveries sd on sd.release_id = pr.release_id and sd.site_id = $2
     where pr.id = $1`,
    [requestId, siteId],
  );
  return row!;
}
const webhooks = () => site.requests.filter((r) => r.path === '/api/cms/revalidate');

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** The retry schedule of a request's delivery to the fake site, in epoch ms (M3-02). */
async function scheduleOf(requestId: string): Promise<{ first_failed_at: number | null; next_attempt_at: number | null }> {
  const [row] = await ownerQuery<{ first_failed_at: Date | null; next_attempt_at: Date | null }>(
    `select sd.first_failed_at, sd.next_attempt_at
     from cms.publish_requests pr
     join cms.site_deliveries sd on sd.release_id = pr.release_id and sd.site_id = $2
     where pr.id = $1`,
    [requestId, siteId],
  );
  return { first_failed_at: row?.first_failed_at?.getTime() ?? null, next_attempt_at: row?.next_attempt_at?.getTime() ?? null };
}

describe('processAndDeliver', () => {
  let published: { entryId: string; slug: string; requestId: string };

  it('committed → delivered → notify_status ok → live_status ok against the fake site', async () => {
    published = await requested('Fljótleiðin');
    const before = webhooks().length;

    await processAndDeliver(published.requestId, fast);

    const d = await deliveryOf(published.requestId);
    expect(d).toMatchObject({ status: 'committed', notify_status: 'ok', notify_attempts: 1, live_status: 'ok', last_error: null });
    expect(d.release_id).not.toBeNull();
    // The site received a signed webhook for that release and now renders the entry with its hash.
    const sent = webhooks().slice(before);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!.body.toString('utf8'))).toEqual({ tenant: 'labak', release: d.number });
    const entry = news().find((e) => e.id === published.entryId);
    expect(entry?.slug).toBe(published.slug);
    expect(rendered?.release).toBe(d.number);
    expect(site.hits(`/frettir/${published.slug}`)).toBeGreaterThan(0);
    expect(site.hits('/frettir')).toBeGreaterThan(0);
    // M3-08: the release records its pointer lag. The local stack has no CDN in front of Storage,
    // so the public pointer serves the release within the bound (fresh).
    const [lag] = await ownerQuery<{ pointer_lag_ms: number | null; pointer_fresh: boolean | null }>(
      'select pointer_lag_ms, pointer_fresh from cms.releases where id = $1',
      [d.release_id],
    );
    expect(lag?.pointer_fresh).toBe(true);
    expect(lag?.pointer_lag_ms).toBeGreaterThanOrEqual(0);
    expect(lag?.pointer_lag_ms).toBeLessThan(120_000);
  });

  it('an unpublish is live when the own path is 404 and no listing carries the marker', async () => {
    const requestId = await rpc<string>('request_unpublish', { p_entry_id: published.entryId });
    await processAndDeliver(requestId, fast);
    expect(await deliveryOf(requestId)).toMatchObject({ status: 'committed', notify_status: 'ok', live_status: 'ok' });
    expect(news().some((e) => e.id === published.entryId)).toBe(false);
  });

  it('a site that does not revalidate is live not_confirmed, with the entry in last_error', async () => {
    revalidates = false;
    try {
      const r = await requested('Gömul síða');
      const before = webhooks().length;
      await processAndDeliver(r.requestId, { pollMs: 100, timeoutMs: 1_500 });
      const d = await deliveryOf(r.requestId);
      expect(d).toMatchObject({ notify_status: 'ok', live_status: 'not_confirmed' });
      expect(d.last_error).toMatchObject({ code: 'live_not_confirmed' });
      expect(JSON.stringify(d.last_error)).toContain(r.entryId);
      // The stale site shows no marker for the new entry at all (no stale hash), so only the
      // notification is sent; the stale-hash resend is proven in live-check.test.ts.
      expect(webhooks().length - before).toBe(1);
    } finally {
      revalidates = true;
      rendered = await loadBundle();
    }
  });
});

describe('sweep', () => {
  it('picks up a request whose fast path never ran: commit, release, notify ok, live ok', async () => {
    const r = await requested('Sópurinn');
    expect((await deliveryOf(r.requestId)).status).toBe('pending');

    await sweep(fast);

    const d = await deliveryOf(r.requestId);
    expect(d).toMatchObject({ status: 'committed', notify_status: 'ok', notify_attempts: 1, live_status: 'ok' });
    expect(d.release_id).not.toBeNull();
  });

  // M3-02: the schedule is kept by the database at the worker's clock; the tests move that clock
  // (the functions' p_now) instead of waiting.
  it('retries a failed notification when its next attempt is due (1 minute later), then confirms live', async () => {
    const r = await requested('Endurtekning');
    const t0 = Date.now();
    webhookStatus = 500;
    try {
      await processAndDeliver(r.requestId, { ...fast, now: () => t0 });
    } finally {
      webhookStatus = null;
    }
    expect(await deliveryOf(r.requestId)).toMatchObject({
      status: 'committed',
      notify_status: 'failed',
      notify_attempts: 1,
      live_status: 'pending',
      last_error: { code: 'notify_failed', status: 500 },
    });
    expect(await scheduleOf(r.requestId)).toEqual({ first_failed_at: t0, next_attempt_at: t0 + MINUTE });

    // Not due yet: a sweep 30 seconds later leaves it alone.
    const before = webhooks().length;
    await sweep({ ...fast, now: () => t0 + 30_000 });
    expect(await deliveryOf(r.requestId)).toMatchObject({ notify_status: 'failed', notify_attempts: 1 });
    expect(webhooks().length).toBe(before);

    await sweep({ ...fast, now: () => t0 + MINUTE });

    expect(await deliveryOf(r.requestId)).toMatchObject({ notify_status: 'ok', notify_attempts: 2, live_status: 'ok', last_error: null });
    expect(await scheduleOf(r.requestId)).toEqual({ first_failed_at: t0, next_attempt_at: null });
  });

  // M3-03: a missed live check is retried on the same schedule: the sweep notifies the site again
  // and runs the full live check.
  it('a site serving a stale pointer for the first check is not_confirmed, then retried 1 minute later and live ok', async () => {
    const r = await requested('Gamall vísir');
    const t0 = Date.now();
    // The first check: the site acknowledges the webhook but keeps rendering the previous pointer's
    // bundle (a stale current.json), through the notification and the §7.4 resend.
    revalidates = false;
    try {
      await processAndDeliver(r.requestId, { pollMs: 100, timeoutMs: 1_500, now: () => t0 });
    } finally {
      revalidates = true;
    }
    expect(await deliveryOf(r.requestId)).toMatchObject({ notify_status: 'ok', notify_attempts: 1, live_status: 'not_confirmed', last_error: { code: 'live_not_confirmed' } });
    expect(await scheduleOf(r.requestId)).toEqual({ first_failed_at: t0, next_attempt_at: t0 + MINUTE });
    const status = await editor.schema('api').from('publication_status').select('sites_not_confirmed, retries_exhausted, live_retrying').eq('entry_id', r.entryId).single();
    expect(status.data).toEqual({ sites_not_confirmed: 1, retries_exhausted: false, live_retrying: true });

    // Not due 30 seconds later.
    const before = webhooks().length;
    await sweep({ ...fast, now: () => t0 + 30_000 });
    expect(webhooks().length).toBe(before);

    // Due: notified again; the site now reads the current pointer, and the full live check passes.
    await sweep({ ...fast, now: () => t0 + MINUTE });
    const sent = webhooks().slice(before);
    expect(sent).toHaveLength(1);
    const d = await deliveryOf(r.requestId);
    expect(JSON.parse(sent[0]!.body.toString('utf8'))).toEqual({ tenant: 'labak', release: d.number });
    expect(d).toMatchObject({ notify_status: 'ok', notify_attempts: 2, live_status: 'ok', last_error: null });
    expect(await scheduleOf(r.requestId)).toEqual({ first_failed_at: t0, next_attempt_at: null });
    expect(news().find((e) => e.id === r.entryId)).toBeDefined();
    const after = await editor.schema('api').from('publication_status').select('sites_live_ok, site_count, live_retrying').eq('entry_id', r.entryId).single();
    expect(after.data).toEqual({ sites_live_ok: 1, site_count: 1, live_retrying: false });
  });

  it('a newer delivered release stops the retries of an older not_confirmed one', async () => {
    const older = await requested('Eldri útgáfa');
    const t0 = Date.now();
    revalidates = false;
    try {
      await processAndDeliver(older.requestId, { pollMs: 100, timeoutMs: 1_500, now: () => t0 });
    } finally {
      revalidates = true;
    }
    expect(await deliveryOf(older.requestId)).toMatchObject({ live_status: 'not_confirmed', notify_attempts: 1 });
    expect((await scheduleOf(older.requestId)).next_attempt_at).toBe(t0 + MINUTE);

    // A newer publish is delivered and confirmed before the older one's retry is due.
    const newer = await requested('Nýrri útgáfa');
    await processAndDeliver(newer.requestId, { ...fast, now: () => t0 + 10_000 });
    const n = await deliveryOf(newer.requestId);
    expect(n).toMatchObject({ live_status: 'ok' });
    expect(n.number).toBeGreaterThan((await deliveryOf(older.requestId)).number);

    // The older release's retry is due, but it is superseded: the sweep does not notify for it.
    const before = webhooks().length;
    await sweep({ ...fast, now: () => t0 + MINUTE });
    expect(webhooks().length).toBe(before);
    expect(await deliveryOf(older.requestId)).toMatchObject({ live_status: 'not_confirmed', notify_attempts: 1 });
    const status = await editor.schema('api').from('publication_status').select('live_retrying').eq('entry_id', older.entryId).single();
    expect(status.data).toEqual({ live_retrying: false });
  });

  it('a site answering 500 is retried on schedule and marked failed after 24 hours, with one alert and one email', { timeout: 180_000 }, async () => {
    const r = await requested('Sólarhringur');
    const t0 = Date.now();
    const due: number[] = [];
    // M3-04: alert emails go to the local stack's Mailpit through the hosted SMTP code path.
    const adminEmail = `alerts-${randomUUID().slice(0, 8)}@test.local`;
    vi.stubEnv('CMS_ALERT_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('CMS_ALERT_SMTP_PORT', '54325');
    vi.stubEnv('CMS_ALERT_EMAIL_FROM', 'cms-alerts@test.local');
    vi.stubEnv('CMS_ALERT_EMAIL_TO', adminEmail);
    webhookStatus = 500;
    try {
      await processAndDeliver(r.requestId, { ...fast, now: () => t0 });
      for (let i = 0; i < 20; i++) {
        const { next_attempt_at: next } = await scheduleOf(r.requestId);
        if (next === null) break;
        due.push((next - t0) / MINUTE);
        const { notify_attempts: attempts } = await deliveryOf(r.requestId);
        // A second before it is due, the sweep does not retry; at its time, it does.
        await sweep({ ...fast, now: () => next - 1_000 });
        expect((await deliveryOf(r.requestId)).notify_attempts).toBe(attempts);
        await sweep({ ...fast, now: () => next });
        expect((await deliveryOf(r.requestId)).notify_attempts).toBe(attempts + 1);
      }
    } finally {
      webhookStatus = null;
    }

    // Attempts at 0, 1, 3, 7 … 1023 minutes and at 24 hours; that failure ends the retries.
    expect(due).toEqual([1, 3, 7, 15, 31, 63, 127, 255, 511, 1023, 1440]);
    const d = await deliveryOf(r.requestId);
    expect(d).toMatchObject({ notify_status: 'failed', notify_attempts: 12, live_status: 'pending', last_error: { code: 'notify_failed', status: 500 } });
    expect(await scheduleOf(r.requestId)).toEqual({ first_failed_at: t0, next_attempt_at: null });
    const alerts = await ownerQuery<{ details: Record<string, unknown> }>(
      'select details from cms.audit_log where action = $1 and details ->> $2 = $3',
      ['system.alert.delivery.retries_exhausted', 'releaseId', d.release_id],
    );
    expect(alerts.map((a) => a.details)).toEqual([expect.objectContaining({ siteId, attempts: 12, code: 'notify_failed', status: 500 })]);

    // Never retried again, even days later; the site now answers, but nothing calls it.
    const before = webhooks().length;
    try {
      await sweep({ ...fast, now: () => t0 + 3 * DAY });
    } finally {
      vi.stubEnv('CMS_ALERT_SMTP_HOST', '');
    }
    expect(await deliveryOf(r.requestId)).toMatchObject({ notify_status: 'failed', notify_attempts: 12 });
    expect(webhooks().length).toBe(before);

    // Exactly one email for this delivery's exhaustion (twelve failed notifications and the later
    // sweep): the tenant, the release and the reason, and no secret or content. Other alerts raised
    // meanwhile (other fixtures' work in the shared database) are other incidents, emailed apart.
    await waitMail(adminEmail, 1);
    await sleep(1_000);
    const all = (await mailsTo(adminEmail)).map((m) => ({ ...m, Text: m.Text.replace(/\r\n/g, '\n') }));
    const mails = all.filter((m) => m.Subject.includes('delivery.retries_exhausted') && m.Text.includes(d.release_id!));
    expect(mails).toHaveLength(1);
    const mail = mails[0]!;
    expect(mail.Subject).toBe(`[Litljómi CMS] delivery.retries_exhausted (tenant ${TENANT.labak})`);
    expect(mail.Text).toContain(`Tenant: ${TENANT.labak}\n`);
    expect(mail.Text).toMatch(new RegExp(`Release: \\d+ \\(${d.release_id}\\)\n`));
    expect(mail.Text).toContain('Reason: notify_failed\n');
    expect(mail.Text).toContain(`siteId: ${siteId}\n`);
    for (const m of all) {
      for (const leaked of [SECRET, 'Sólarhringur', 'Meginmál', 'Inngangur', r.slug]) {
        expect(m.Text).not.toContain(leaked);
        expect(m.Subject).not.toContain(leaked);
      }
    }
  });

  // Plan Task 30 (decision 36.2): a worker killed mid-build no longer blocks the tenant.
  it('fails a stale building release first, then builds the tenant in the same sweep (n+1), notified and live', async () => {
    const stale = await withTx('service', async (w) => (await w.query('select r.id, r.number from api.worker_begin_release($1) as r', [TENANT.labak])).rows[0] as { id: string; number: number });
    await ownerQuery(`update cms.releases set created_at = now() - interval '421 seconds' where id = $1`, [stale.id]);
    const r = await requested('Eftir stöðvun');

    await sweep(fast);

    const [row] = await ownerQuery<{ status: string; error: unknown }>('select status, error from cms.releases where id = $1', [stale.id]);
    expect(row).toEqual({ status: 'failed', error: { code: 'stale_building', maxAgeSeconds: STALE_RELEASE_SECONDS } });
    const alerts = await ownerQuery('select 1 from cms.audit_log where action = $1 and details ->> $2 = $3', ['system.alert.release.stale_failed', 'releaseId', stale.id]);
    expect(alerts).toHaveLength(1);
    const d = await deliveryOf(r.requestId);
    expect(d).toMatchObject({ status: 'committed', number: stale.number + 1, notify_status: 'ok', live_status: 'ok' });
  });
});
