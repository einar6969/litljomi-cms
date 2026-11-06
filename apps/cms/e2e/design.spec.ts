// The UI level-up's screenshots: every screen and state of the approved canvas at 375, 768 and 1440
// px wide (full page), saved to the gitignored apps/cms/e2e-screenshots/ as `<name>-<width>.png`.
// Each screen at 375 px must not scroll sideways. Run as `pnpm --filter cms e2e design`.
//
// A state that passes too quickly to catch is held with a route; a state that needs an unusual
// answer gets it from one (`publish-*`: the publish panel's status read is answered with a row of
// api.publication_status, so all of §7.4's states can be shown without breaking anything).
//
// Three screens are not reached here: "Vefur óvirkur" (no seeded user belongs to a suspended tenant),
// the switch-account question (auth.spec.ts covers it, through a second sign-in), and the error page
// (nothing fails on demand). The empty entry list needs a database with no news entries: after
// `pnpm db:reset` it is the first thing shot here.
//
// The tenant overview's states (`home-overview-*`) are read on the server, where a route cannot
// reach. Its populated view is the demo tenant, published for real; the others are a fixture tenant
// on the local database, and the failed read is a real one: SELECT on api.publication_status is
// revoked from editors, on the local database only, and granted back in a `finally` (the seed heals
// a run killed in between).
//
// Every request is to a loopback address (support/test.ts aborts the rest). Besides the PNG files,
// the only things written are the local database's rows, through support/console-admin.ts.
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Route } from '@playwright/test';
import { DRAFT_OUTDATED } from '@litljomi/cms-schema/src/upcast.ts';
import { t } from '../src/i18n/is';
import { deriveBand, summarizeStatus, type OverviewStatusRow } from '../src/editor/overview';
import { arrangeOverview, arrangePages, cleanOverview, cleanPages, grantStatusRead, resetAdmin, revokeStatusRead } from './support/console-admin';
import { ensureDemoSite, newDemoEvent } from './support/demo-release';
import { createEvent, createNews } from './support/editor';
import { DEMO_SITE_URL } from './support/demo-site';
import { apiRows, editorHeadersOf } from './support/editor-api';
import { CMS_URL, requireLoopback, SUPABASE_URL } from './support/local';
import { PERSONA_EMAILS } from './support/personas';
import { sessionState } from './support/session';
import { signIn } from './support/sign-in';
import { expect, newLoopbackContext, test } from './support/test';
import { totp } from './support/totp';

const SHOTS = join(import.meta.dirname, '..', 'e2e-screenshots');
const WIDTHS = [375, 768, 1440] as const;
const SAVED = { timeout: 10_000 };
const CONFIRMED = { timeout: 150_000 };
const JPEG = readFileSync(join(import.meta.dirname, 'fixtures', 'rugbraud.jpg'));
const TITLE = 'Titill';
const state = (page: Page) => page.getByTestId('publish-state');

/** Saves `<name>-<width>.png` (full page) at each width; at 375 px the page must not scroll sideways. */
async function shoot(page: Page, name: string, widths: readonly number[] = WIDTHS): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    // Let fonts and the layout settle after the resize.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    if (width === 375) {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${name} scrolls sideways at 375 px`).toBeLessThanOrEqual(0);
    }
    await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
}

/** Holds the next server action POSTs to the current page until the returned function is called. */
async function holdActions(page: Page): Promise<() => void> {
  let release = () => undefined as void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(page.url(), async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await released;
    await route.fallback().catch(() => undefined);
  });
  return release;
}

/** Fails every server action POST to the current page. */
const failActions = (page: Page) =>
  page.route(page.url(), (route) => (route.request().method() === 'POST' ? route.abort() : route.fallback()));

// Sign-in: nobody is signed in.
test.describe('sign-in', () => {
  test('sign-in and confirm', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.login.title);
    // The self-hosted fonts must load before there is a session (the proxy must not redirect them).
    await page.evaluate(() => document.fonts.ready);
    const fontsLoaded = await page.evaluate(() => [document.fonts.check('16px "Albert Sans"'), document.fonts.check('700 28px "Bricolage Grotesque"')]);
    expect(fontsLoaded, 'Albert Sans and Bricolage Grotesque loaded signed out').toEqual([true, true]);
    // A face loads when something uses it, and the sign-in page has no monospace text.
    const faces = await page.evaluate(() => [...document.fonts].filter((f) => f.family.replaceAll('"', '') !== 'JetBrains Mono').map((f) => f.status));
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.every((s) => s === 'loaded'), `font faces: ${faces.join(',')}`).toBe(true);
    await shoot(page, 'login');

    await page.goto('/login?sent=1');
    await expect(page.getByText(t.login.sent)).toBeVisible();
    await shoot(page, 'login-sent');

    await page.goto('/login?error=link');
    await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.login.linkInvalid);
    await shoot(page, 'login-link-invalid');

    await page.goto('/login?emailChange=waiting');
    await expect(page.getByText(t.login.emailChangeWaiting)).toBeVisible();
    await shoot(page, 'login-email-change-waiting');

    // The magic link's page: one button. A made-up hash, never pressed.
    await page.goto(`/auth/confirm?token_hash=${'0'.repeat(56)}&type=email`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.title);
    await expect(page.getByRole('button', { name: t.confirm.submit })).toBeVisible();
    await shoot(page, 'confirm');

    await page.goto(`/auth/confirm?token_hash=${'0'.repeat(56)}&type=email_change`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.confirm.emailChangeTitle);
    await shoot(page, 'confirm-email-change');
  });

  test('a user with no tenant', async ({ page }) => {
    // The seeded outsider belongs to no tenant, so the page shows its empty state (a user with
    // exactly one tenant goes straight past it).
    await signIn(page, 'outsider@test.local');
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.tenants.title);
    await expect(page.getByText(t.tenants.none)).toBeVisible();
    await shoot(page, 'no-tenant');
  });
});

test.describe('labak: shell, list and news form', () => {
  test.use({ storageState: sessionState('editor_labak') });

  test('tenant home, drawer, not found and the confirm page signed in', async ({ page }) => {
    await page.goto('/t/labak');
    // The tenant home's h1 is the seeded tenant name (tests/integration/src/seed.ts).
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Landssamband bakarameistara');
    await expect(page.getByText(t.tenant.greeting)).toBeVisible();
    await shoot(page, 'tenant-home');

    for (const width of [375, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.getByRole('button', { name: t.app.menu }).click();
      await expect(page.getByRole('button', { name: t.app.closeMenu })).toBeVisible();
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(SHOTS, `drawer-open-${width}.png`) });
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: t.app.closeMenu })).toBeHidden();
    }
    await page.setViewportSize({ width: 1280, height: 720 });

    await page.goto('/t/finnst-ekki');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.notFound.title);
    await shoot(page, 'not-found');

    await page.goto(`/auth/confirm?token_hash=${'0'.repeat(56)}&type=email`);
    await expect(page.getByText(t.confirm.signedIn)).toBeVisible();
    await shoot(page, 'confirm-signed-in');
  });

  test('entry list: empty, rows, filters, creating, create failed', async ({ page }) => {
    await page.goto('/t/labak/news');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fréttir');
    if (await page.getByText(t.entries.empty).isVisible()) await shoot(page, 'list-empty');

    await createNews(page);
    await page.getByLabel(TITLE).fill('Nýtt sýningarár hefst');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

    await page.goto('/t/labak/news');
    await expect(page.getByRole('table')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const mono = await page.evaluate(() => [document.fonts.check('400 12.5px "JetBrains Mono"'), getComputedStyle(document.querySelector('time.mono')!).fontFamily]);
    expect(mono[0], 'JetBrains Mono loaded for the list\'s times').toBe(true);
    expect(mono[1]).toContain('JetBrains Mono');
    await shoot(page, 'list');

    // `/` jumps to the search box; Esc leaves it.
    await page.keyboard.press('/');
    await expect(page.getByLabel(t.entries.filter.search)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel(t.entries.filter.search)).not.toBeFocused();

    await page.goto('/t/labak/news?status=draft');
    await expect(page.getByRole('link', { name: t.entries.filter.clear })).toBeVisible();
    await shoot(page, 'list-filtered');

    await page.goto('/t/labak/news?q=finnst-alls-ekki');
    await expect(page.getByText(t.entries.filter.none)).toBeVisible();
    await shoot(page, 'list-no-match');

    await page.goto('/t/labak/news');
    const release = await holdActions(page);
    await page.getByRole('button', { name: t.entries.new }).click();
    await expect(page.getByRole('button', { name: t.entries.creating })).toBeDisabled();
    await shoot(page, 'list-creating');
    release();
    await page.waitForURL(/\/t\/labak\/news\/[0-9a-f-]{36}$/);

    await page.goto('/t/labak/news');
    await failActions(page);
    await page.getByRole('button', { name: t.entries.new }).click();
    await expect(page.getByRole('alert').filter({ hasText: t.entries.createFailed })).toBeVisible();
    await shoot(page, 'list-create-failed');
  });

  test('the news form: rich text, link, saving, save failed, copy restored', async ({ page }) => {
    await createNews(page);
    await page.getByLabel(TITLE).fill('Nýtt sýningarár hefst');
    await page.getByLabel('Inngangur').fill('Vetrardagskráin er kynnt.');
    await page.getByRole('textbox', { name: 'Meginmál' }).click();
    await page.keyboard.type('Fyrsta sýning vetrarins er í næstu viku.');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await shoot(page, 'form-saved');

    await page.getByRole('button', { name: t.editor.richText.link }).click();
    await expect(page.getByLabel(t.editor.richText.linkUrl)).toBeVisible();
    await shoot(page, 'form-rich-text-link');
    await page.getByRole('button', { name: t.editor.richText.link }).click();

    const release = await holdActions(page);
    await page.getByLabel(TITLE).fill('Nýtt sýningarár hefst, breytt');
    await expect(page.getByRole('status')).toHaveText(t.editor.saving, SAVED);
    await shoot(page, 'form-saving');
    release();
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await failActions(page);
    await page.getByLabel(TITLE).fill('Nýtt sýningarár hefst, aftur');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.error })).toBeVisible(SAVED);
    await shoot(page, 'form-save-failed');

    // The failed save is still in the tab's copy, so a reload brings it back with the notice.
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    await page.reload();
    await expect(page.getByRole('alert').filter({ hasText: t.editor.restoredCopy })).toBeVisible(SAVED);
    await shoot(page, 'form-copy-restored');
  });

  test('conflict: compare, cannot load, signed out', async ({ page, context }) => {
    await createNews(page);
    await page.getByLabel(TITLE).fill('Fyrsti flipi');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

    const second = await context.newPage();
    await second.goto(page.url());
    await second.getByLabel(TITLE).fill('Annar flipi');
    await expect(second.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await second.close();

    await page.getByLabel(TITLE).fill('Fyrsti flipi, meira');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.conflict })).toBeVisible(SAVED);
    await expect(page.getByTestId('conflict-field')).toBeVisible(SAVED);
    await shoot(page, 'form-conflict');

    // The newer version cannot be read: only the save gets through.
    await createNews(page);
    await page.getByLabel(TITLE).fill('Fyrsti flipi');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    const third = await context.newPage();
    await third.goto(page.url());
    await third.getByLabel(TITLE).fill('Annar flipi');
    await expect(third.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await third.close();
    let posts = 0;
    await page.route(page.url(), (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      posts += 1;
      return posts === 1 ? route.fallback() : route.abort();
    });
    await page.getByLabel(TITLE).fill('Fyrsti flipi, meira');
    await expect(page.getByText(t.editor.resolve.loadError)).toBeVisible(SAVED);
    await shoot(page, 'form-conflict-cannot-load');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    // A fresh entry for the signed-out notice: the session ends while the editor is typing.
    await createNews(page);
    await page.getByLabel(TITLE).fill('Fyrir útskráningu');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await context.clearCookies();
    await page.getByLabel(TITLE).fill('Eftir útskráningu');
    await expect(page.getByRole('alert').filter({ hasText: t.editor.signedOut })).toBeVisible(SAVED);
    await shoot(page, 'form-signed-out');
  });

  test('image field, image page and "Enginn vefur tengdur" (labak has no site)', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await createNews(page);
    await page.getByLabel(TITLE).fill('Nýtt brauð í bakaríinu');
    await page.getByLabel('Dagsetning').fill('2026-11-14');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);

    // A file of the wrong type: the field's error notice (checked in the browser, before any upload).
    await page.locator('#field-image').setInputFiles({ name: 'texti.txt', mimeType: 'text/plain', buffer: Buffer.from('ekki mynd') });
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.type);
    await shoot(page, 'image-field-error');

    // A real image, held on its way up first.
    let release = () => undefined as void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/storage/v1/**', async (route) => {
      await released;
      await route.fallback().catch(() => undefined);
    });
    await page.locator('#field-image').setInputFiles({ name: 'Rúgbrauð.jpg', mimeType: 'image/jpeg', buffer: JPEG });
    await expect(page.getByTestId('field-image-notice')).toHaveText(t.editor.image.uploading, SAVED);
    await shoot(page, 'image-field-uploading');
    release();
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    const preview = page.getByTestId('field-image-preview');
    await expect(preview).toBeVisible(SAVED);
    await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)), SAVED).toBeGreaterThan(0);
    await page.locator('#field-image-alt').fill('Rúgbrauð á borði');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await shoot(page, 'image-field');

    const form = page.url();
    const details = await page.getByRole('link', { name: t.editor.image.details }).getAttribute('href');
    await page.goto(details!);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.asset.title);
    await shoot(page, 'image-page');
    await page.goto(form);

    // Publish in a tenant with no active site: nothing can confirm it, so it ends at "Enginn vefur tengdur".
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.noSite, CONFIRMED);
    // The kit's warning: #85520a on #fcf3e2.
    await expect(state(page)).toHaveAttribute('data-tone', 'warning');
    await expect(state(page)).toHaveCSS('background-color', 'rgb(252, 243, 226)');
    await expect(state(page)).toHaveCSS('color', 'rgb(133, 82, 10)');
    await shoot(page, 'publish-no-site');
  });
});

test.describe('demo: groups, singleton, every field, publishing', () => {
  test.use({ storageState: sessionState('editor_demo') });

  async function newEvent(page: Page, title: string): Promise<void> {
    await createEvent(page);
    await page.getByLabel('Title').fill(title);
    await page.getByLabel('Start date').fill('2026-12-01');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
  }

  test('tenant home with a group and a singleton, and the singleton opening', async ({ page }) => {
    await page.goto('/t/demo');
    await expect(page.getByText(t.tenant.greeting)).toBeVisible();
    await shoot(page, 'tenant-home-groups');

    await page.route('**/t/demo/site-info', async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      await route.fallback().catch(() => undefined);
    });
    await page.goto('/t/demo/site-info');
    await expect(page.getByRole('status')).toHaveText(t.singleton.opening);
    await shoot(page, 'singleton-opening');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await page.route('**/t/demo/site-info', (route) => (route.request().method() === 'POST' ? route.abort() : route.fallback()));
    await page.goto('/t/demo/site-info');
    await expect(page.getByRole('alert').filter({ hasText: t.singleton.openFailed })).toBeVisible(SAVED);
    await shoot(page, 'singleton-failed');
  });

  test('every field kind, with list items', async ({ page }) => {
    await newEvent(page, 'Opnunarhátíð vorsins');
    await page.getByRole('button', { name: t.editor.list.add }).click();
    await page.getByRole('button', { name: t.editor.list.add }).click();
    await page.getByLabel('Capacity').fill('ekki tala');
    await expect(page.getByText(t.editor.number.invalid)).toBeVisible();
    await shoot(page, 'form-all-fields');
  });

  test('publishing for real, with history', async ({ page }) => {
    test.setTimeout(20 * 60_000);
    await ensureDemoSite(page);
    await newEvent(page, `Opnunarhátíð vorsins með tónlist og veitingum fyrir alla fjölskylduna ${Date.now()}`);
    await shoot(page, 'form-never-published');

    // In progress: the status read is held back so the "Í birtingu…" state stays on screen.
    await page.route('**/rest/v1/publication_status*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8_000));
      // fallback, not continue: the context's loopback guard (support/test.ts) still applies.
      await route.fallback().catch(() => undefined);
    });
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.inProgress);
    await shoot(page, 'form-in-progress');
    await page.unrouteAll({ behavior: 'ignoreErrors' });

    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await expect(state(page)).toHaveAttribute('data-tone', 'ok');
    await shoot(page, 'form-live');

    // A second publication, so there is an older one to restore.
    await page.getByLabel('Location').fill('Reykjavík');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    await page.getByRole('button', { name: t.publish.publish }).click();
    const revisions = page.getByTestId('revision');
    await expect
      .poll(async () => {
        await page.reload();
        await expect(state(page)).toBeVisible();
        return revisions.count();
      }, CONFIRMED)
      .toBe(2);
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    await shoot(page, 'history');

    await revisions.nth(1).getByRole('button', { name: t.editor.history.restore }).click();
    await expect(page.getByText(t.editor.history.confirm)).toBeVisible();
    await shoot(page, 'history-confirm');
    await page.getByRole('button', { name: t.editor.history.confirmRestore }).click();
    await expect(page.getByText(t.editor.history.restored)).toBeVisible(SAVED);
    await shoot(page, 'form-restored');

    await page.getByRole('button', { name: t.publish.unpublish }).click();
    await expect(state(page)).toHaveText(t.publish.removed, CONFIRMED);
    await expect(state(page)).toHaveAttribute('data-tone', 'neutral');
    await expect(state(page).locator('[class*="animate-pulse"]')).toHaveCount(0);
    await shoot(page, 'form-removed');
  });

  test('a publish error', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await createEvent(page);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toContainText(t.publish.invalid, CONFIRMED);
    await shoot(page, 'form-publish-error');
  });

  test('an outdated draft', async ({ page }) => {
    const statusRead = page.waitForRequest((r) => r.url().startsWith(`${SUPABASE_URL}/rest/v1/publication_status`));
    await createEvent(page);
    const editor = await editorHeadersOf(await statusRead);
    const [tenant] = await apiRows<{ id: string }>(editor, 'my_tenants?select=id&slug=eq.demo');
    const call = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
      const response = await fetch(requireLoopback(`${SUPABASE_URL}/rest/v1/rpc/${fn}`), {
        method: 'POST',
        headers: { ...editor, 'content-type': 'application/json', 'content-profile': 'api' },
        body: JSON.stringify(args),
        redirect: 'error',
      });
      return (await response.json()) as T;
    };
    const id = await call<string>('create_entry', { p_tenant_id: tenant!.id, p_type: 'notice', p_slug: null });
    await call('save_draft', { p_entry_id: id, p_expected_version: 1, p_data: { heading: 'Eldra uppkast' }, p_schema_version: 1, p_title: 'Eldra uppkast', p_sort_at: null });
    await page.goto(`/t/demo/notice/${id}`);
    await expect(page.getByRole('alert').filter({ hasText: t.editor.outdated.title })).toBeVisible();
    await shoot(page, 'form-outdated');
  });

  test('every publish status (§7.4), from a status row', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await newEvent(page, 'Staða birtingar');
    const url = page.url();
    const delivered = {
      request_id: 'r1',
      tenant_id: 't1',
      entry_id: 'e1',
      action: 'publish',
      status: 'committed',
      error: null,
      requested_at: '2026-11-05T12:00:00Z',
      release_number: 1,
      release_status: 'delivered',
      omitted: false,
      missing_assets: null,
      site_count: 1,
      sites_notified: 1,
      sites_live_ok: 0,
      sites_not_confirmed: 0,
      retries_exhausted: false,
      live_retrying: false,
      latest_request_id: 'r1',
      latest_action: 'publish',
    };
    const out = { action: 'unpublish', latest_action: 'unpublish' };
    const rows: Array<[name: string, label: string, row: Record<string, unknown>]> = [
      ['requested', t.publish.inProgress, { status: 'pending' }],
      ['waiting', t.publish.revalidated, {}],
      ['live', t.publish.live, { sites_live_ok: 1 }],
      ['removed', t.publish.removed, { ...out, sites_live_ok: 1 }],
      ['retrying', t.publish.notConfirmedRetrying, { sites_not_confirmed: 1, live_retrying: true }],
      ['retrying-unpublish', t.publish.notConfirmedRetrying, { ...out, sites_not_confirmed: 1, live_retrying: true }],
      ['not-confirmed', t.publish.notConfirmed, { sites_not_confirmed: 1 }],
      ['not-confirmed-unpublish', t.publish.notConfirmed, { ...out, sites_not_confirmed: 1 }],
      ['delivery-failed', t.publish.deliveryFailed, { retries_exhausted: true }],
      ['invalid-fields', t.publish.invalid, { status: 'failed_validation', error: { issues: [{ path: ['title'] }, { path: ['startDate'] }] } }],
      ['invalid-generic', t.publish.invalid, { status: 'failed_validation', error: {} }],
      ['missing-image', t.publish.invalid, { status: 'failed_validation', error: { code: 'asset_missing' }, missing_assets: ['mynd.jpg'] }],
      ['outdated', t.publish.invalid, { status: 'failed_validation', error: { code: DRAFT_OUTDATED } }],
      ['superseded', t.publish.superseded, { status: 'superseded' }],
      ['cancelled', t.publish.cancelled, { status: 'superseded', latest_action: 'unpublish' }],
      ['rejected', t.publish.rejected, { status: 'rejected' }],
      ['failed', t.publish.failed, { status: 'failed' }],
    ];
    for (const [name, label, row] of rows) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await page.route('**/rest/v1/publication_status*', (route: Route) => {
        const headers = {
          'access-control-allow-origin': CMS_URL,
          'access-control-allow-credentials': 'true',
          'access-control-allow-headers': route.request().headers()['access-control-request-headers'] ?? '*',
          'access-control-allow-methods': 'GET, OPTIONS',
        };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify([{ ...delivered, ...row }]) });
      });
      await page.goto(url);
      await expect(state(page), name).toContainText(label, SAVED);
      await shoot(page, `publish-${name}`);
    }
  });
});

test.describe('the tenant overview', () => {
  test.use({ storageState: sessionState('editor_demo') });

  const heading = (page: Page) => page.locator('#site-state');
  const tag = (page: Page) => page.locator('.band').getByText(t.overview.live, { exact: true });
  const lastPublished = (page: Page) => page.locator('.band').getByText(t.overview.lastPublished);
  const viewChanges = (page: Page) => page.getByRole('link', { name: t.overview.viewChanges });
  const viewSite = (page: Page) => page.getByRole('link', { name: t.overview.viewSite });
  const clear = (page: Page) => page.getByRole('link', { name: t.entries.filter.clear });
  const recentRows = (page: Page) => page.locator('.entry-table tbody tr');

  /** Every link of the overview and its "Ný færsla" buttons at phone width: 44 px or taller. */
  async function expectTapTargets(page: Page): Promise<void> {
    await page.setViewportSize({ width: 375, height: 900 });
    const short = await page.locator('main a, main button').evaluateAll((els) =>
      els.filter((el) => el.getBoundingClientRect().height < 44).map((el) => el.textContent),
    );
    expect(short, 'tap targets under 44 px').toEqual([]);
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  /** At each width, every recent row's type label starts at or below the end of its title link. */
  async function expectLabelsBelowTitles(page: Page): Promise<void> {
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      const rows = await recentRows(page).evaluateAll((trs) =>
        trs.flatMap((tr) => {
          const link = tr.querySelector('a.t');
          const label = tr.querySelector('.ov-type');
          return link && label ? [{ title: link.textContent, gap: label.getBoundingClientRect().top - link.getBoundingClientRect().bottom }] : [];
        }),
      );
      expect(rows.length, `recent rows with a label at ${width} px`).toBeGreaterThan(0);
      expect(rows.filter((row) => row.gap < 0), `labels above their title's end at ${width} px`).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  /** How many lines of text a link's title takes at 1440 px. */
  async function titleLines(page: Page, title: string): Promise<number> {
    await page.setViewportSize({ width: 1440, height: 900 });
    const lines = await recentRows(page)
      .locator('a.t', { hasText: title })
      .evaluate((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        return Math.round(range.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(link).lineHeight));
      });
    await page.setViewportSize({ width: 1280, height: 720 });
    return lines;
  }

  test('populated, and the waiting entries', async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await ensureDemoSite(page);
    const statusRead = page.waitForRequest((r) => r.url().startsWith(`${SUPABASE_URL}/rest/v1/publication_status`));
    // Long enough to wrap at 1440 px: its type label must still sit below its last line.
    const title = `Yfirlit opnunarhátíðar vorsins með tónlist og veitingum fyrir alla fjölskylduna ${Date.now()}`;
    await newDemoEvent(page, title);
    const editor = await editorHeadersOf(await statusRead);
    await page.getByRole('button', { name: t.publish.publish }).click();
    await expect(state(page)).toHaveText(t.publish.live, CONFIRMED);
    // Published, then edited: a change that waits.
    await page.getByLabel('Location').fill('Reykjavík');
    await expect(page.getByRole('status')).toHaveText(t.editor.saved, SAVED);
    // Opening the singleton gives the Síður card an entry with a pill.
    await page.goto('/t/demo/site-info');
    await page.waitForURL(/\/t\/demo\/site-info\/[0-9a-f-]{36}$/);

    // The demo tenant keeps what earlier specs left, so what the band must say comes from the rows.
    // Computed with production `deriveBand`, so this checks the wiring; overview.test.ts pins the rules.
    const rows = await apiRows<OverviewStatusRow>(editor, 'publication_status');
    const changed = await apiRows<{ id: string }>(editor, 'entry_list?select=id&status=eq.changed');
    const abandoned = await apiRows<{ id: string }>(editor, 'entry_list?select=id&archived_at=not.is.null&first_published_at=is.null');
    const expected = deriveBand({
      site: { ok: true, value: { url: DEMO_SITE_URL } },
      changed: { ok: true, value: changed.map((row) => row.id) },
      status: { ok: true, value: summarizeStatus(rows, new Set(abandoned.map((row) => row.id))) },
      published: null,
      currentlyPublished: null,
    });
    expect(expected.viewChanges).toBe(true);

    await page.goto('/t/demo');
    await expect(heading(page)).toHaveText(expected.heading);
    await expect(tag(page)).toHaveCount(expected.tag ? 1 : 0);
    await expect(viewSite(page)).toHaveAttribute('href', DEMO_SITE_URL);
    await expect(viewChanges(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: t.overview.pages })).toBeVisible();
    await expect(page.locator('.pg-row').filter({ hasText: 'Site info' }).locator('.pill')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Events' })).toHaveCount(1);
    await expect(recentRows(page).first()).toBeVisible();
    await expect(clear(page)).toHaveCount(0);
    await expectTapTargets(page);
    // On the plain list: the entry just created is the newest there, whatever the demo tenant holds.
    expect(await titleLines(page, title), 'the long title wraps at 1440 px').toBeGreaterThan(1);
    await expectLabelsBelowTitles(page);
    await shoot(page, 'home-overview-populated');

    await viewChanges(page).click();
    await page.waitForURL(/\/t\/demo\?breytingar=1#recent$/);
    await expect(heading(page)).toHaveText(expected.heading);
    await expect(tag(page)).toHaveCount(expected.tag ? 1 : 0);
    await expect(clear(page)).toBeVisible();
    await expect(recentRows(page).first()).toBeVisible();
    // Every entry the band counts is listed, up to the bound of the read.
    const waiting = Number((await heading(page).textContent())?.match(/^\d+/)?.[0]);
    expect(waiting, 'n in the band heading').toBeGreaterThan(0);
    await expect(recentRows(page)).toHaveCount(Math.min(waiting, 50));
    // `notice` is outside the structure: its rows show the module's label, never the key.
    const notices = recentRows(page).filter({ has: page.locator('a.t[href*="/notice/"]') });
    await expect(notices.locator('.ov-type')).toHaveText(Array.from({ length: await notices.count() }, () => 'Notice'));
    await expectTapTargets(page);
    await expectLabelsBelowTitles(page);
    await shoot(page, 'home-overview-changes');

    await clear(page).click();
    await page.waitForURL(/\/t\/demo$/);
    await expect(clear(page)).toHaveCount(0);
  });

  test('nothing waiting, a failed read, no site, nothing proven, all withdrawn', async ({ page }) => {
    test.setTimeout(5 * 60_000);
    try {
      await arrangeOverview('proven');
      await page.goto('/t/m4-probe');
      await expect(heading(page)).toHaveText(t.overview.upToDate);
      await expect(tag(page)).toHaveCount(1);
      await expect(tag(page)).toHaveCSS('background-color', 'rgb(142, 212, 98)');
      await expect(lastPublished(page)).toBeVisible();
      await expect(viewSite(page)).toBeVisible();
      await expect(viewChanges(page)).toHaveCount(0);
      await expect(page.locator('.tc-data .meta-l')).toHaveText('2 færslur, 1 uppkast');
      await expect(page.locator('main .pill-ok')).toHaveCount(1);
      await expectTapTargets(page);
      await shoot(page, 'home-overview-proven');

      await revokeStatusRead();
      try {
        await page.reload();
        await expect(heading(page)).toHaveText(t.publish.statusUnavailable);
        await expect(tag(page)).toHaveCount(0);
        await expect(lastPublished(page)).toHaveCount(0);
        await expect(viewChanges(page)).toHaveCount(0);
        await expect(viewSite(page)).toBeVisible();
        // Nothing proves it, so "Birt" is not green.
        await expect(recentRows(page).first()).toBeVisible();
        await expect(page.locator('main .pill-ok')).toHaveCount(0);
        await shoot(page, 'home-overview-failed');
      } finally {
        await grantStatusRead();
      }

      await arrangeOverview('no-site');
      await page.goto('/t/m4-probe');
      await expect(heading(page)).toHaveText(t.publish.noSite);
      await expect(tag(page)).toHaveCount(0);
      await expect(lastPublished(page)).toHaveCount(0);
      await expect(viewSite(page)).toHaveCount(0);
      await expect(page.locator('main .pill-ok')).toHaveCount(0);
      await shoot(page, 'home-overview-no-site');

      await arrangeOverview('nothing-proven');
      await page.goto('/t/m4-probe');
      await expect(heading(page)).toHaveText(t.overview.nothingPublished);
      await expect(tag(page)).toHaveCount(0);
      await expect(lastPublished(page)).toHaveCount(0);
      await expect(viewChanges(page)).toHaveCount(0);
      await expect(viewSite(page)).toBeVisible();
      await shoot(page, 'home-overview-nothing-proven');

      await arrangeOverview('withdrawn');
      await page.goto('/t/m4-probe');
      await expect(heading(page)).toHaveText(t.overview.nothingOnSite);
      await expect(tag(page)).toHaveCount(0);
      await expect(lastPublished(page)).toHaveCount(0);
      await expect(viewChanges(page)).toHaveCount(0);
      await expect(viewSite(page)).toBeVisible();
      await shoot(page, 'home-overview-withdrawn');
    } finally {
      await cleanOverview();
    }
  });
});

test.describe('console', () => {
  test('enrolment, code, tenants, a tenant, the phone menu', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    await resetAdmin();
    await arrangePages();
    const context = await newLoopbackContext(browser);
    const page = await context.newPage();
    try {
      await signIn(page, PERSONA_EMAILS.platform_admin);
      await page.goto('/console');
      await expect(page).toHaveURL(`${CMS_URL}/console/mfa`);
      const secret = await page.getByRole('main').locator('code').innerText();
      await shoot(page, 'console-mfa-enrol');

      await page.getByLabel('Six-digit code').fill('000000');
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page.getByRole('alert').filter({ hasText: "That code didn't work" })).toBeVisible(SAVED);
      await shoot(page, 'console-mfa-refused');

      await page.getByLabel('Six-digit code').fill(totp(secret));
      await page.getByRole('button', { name: 'Verify' }).click();
      await page.waitForURL(`${CMS_URL}/console`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console');
      await shoot(page, 'console-tenants');

      await page.setViewportSize({ width: 375, height: 900 });
      await page.locator('.csl-menu summary').click();
      await expect(page.locator('.csl-menu').getByRole('link', { name: 'Tenants' })).toBeVisible();
      await page.screenshot({ path: join(SHOTS, 'console-menu-open-375.png') });
      await page.setViewportSize({ width: 1280, height: 720 });

      await page.goto('/console/t/console-fixture');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Console fixture');
      await shoot(page, 'console-tenant');

      await page.goto('/console/t/console-paused');
      await expect(page.getByText('No requests.')).toBeVisible();
      await shoot(page, 'console-tenant-empty');
    } finally {
      await context.close();
      await cleanPages();
    }
  });
});
