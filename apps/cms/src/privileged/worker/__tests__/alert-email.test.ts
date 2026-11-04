// Unit tests of the alert email (M3-04): the configuration, the incident key that deduplicates
// re-claims and sweeps, the email's allowlisted content, and emailAlert's claim-then-send rule with
// a fake database and a fake transport. The SMTP path to Mailpit runs in
// alert-email.integration.test.ts and pipeline.integration.test.ts.
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '../../../lib/supabase/types';
import { type AlertEmailConfig, alertEmailConfig, composeAlertEmail, emailAlert, incidentOf } from '../alert-email';

const R1 = '00000000-0000-4000-8000-0000000000a1';
const T1 = '00000000-0000-4000-8000-0000000000b1';
const S1 = '00000000-0000-4000-8000-0000000000c1';
const Q1 = '00000000-0000-4000-8000-0000000000d1';

const config: AlertEmailConfig = {
  host: '127.0.0.1',
  port: 54325,
  secure: false,
  requireTLS: false,
  auth: null,
  from: 'cms@test.local',
  to: ['admin@test.local'],
};

describe('alertEmailConfig', () => {
  const base = { CMS_ALERT_SMTP_HOST: 'smtp.sendgrid.net', CMS_ALERT_EMAIL_FROM: 'cms@litljomi.is', CMS_ALERT_EMAIL_TO: 'a@x.is, b@x.is ,' };

  it('is null (email off) without a host', () => {
    expect(alertEmailConfig({})).toBeNull();
    expect(alertEmailConfig({ CMS_ALERT_SMTP_HOST: '  ' })).toBeNull();
  });

  it('reads a hosted setup: port 587 by default, STARTTLS required, credentials, trimmed recipients', () => {
    expect(alertEmailConfig({ ...base, CMS_ALERT_SMTP_USER: 'apikey', CMS_ALERT_SMTP_PASSWORD: 'k' })).toEqual({
      host: 'smtp.sendgrid.net',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'apikey', pass: 'k' },
      from: 'cms@litljomi.is',
      to: ['a@x.is', 'b@x.is'],
    });
  });

  it('uses implicit TLS on port 465, and lets a loopback host (Mailpit) go without TLS or credentials', () => {
    expect(alertEmailConfig({ ...base, CMS_ALERT_SMTP_PORT: '465' })).toMatchObject({ port: 465, secure: true, requireTLS: false });
    expect(alertEmailConfig({ ...base, CMS_ALERT_SMTP_HOST: '127.0.0.1', CMS_ALERT_SMTP_PORT: '54325' })).toMatchObject({
      secure: false,
      requireTLS: false,
      auth: null,
    });
    expect(alertEmailConfig({ ...base, CMS_ALERT_SMTP_HOST: 'localhost' })?.requireTLS).toBe(false);
  });

  it('throws on a half or invalid setup instead of sending nothing', () => {
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_SMTP_PORT: 'abc' })).toThrow('CMS_ALERT_SMTP_PORT');
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_SMTP_PORT: '70000' })).toThrow('CMS_ALERT_SMTP_PORT');
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_SMTP_USER: 'apikey' })).toThrow('set together');
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_SMTP_PASSWORD: 'k' })).toThrow('set together');
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_EMAIL_FROM: '' })).toThrow('CMS_ALERT_EMAIL_FROM');
    expect(() => alertEmailConfig({ ...base, CMS_ALERT_EMAIL_TO: ' , ' })).toThrow('CMS_ALERT_EMAIL_TO');
  });
});

describe('incidentOf (deduplication key)', () => {
  it('keys a request failure by the request, so every re-claim of it is the same incident', () => {
    const first = incidentOf('publish_request.failed', { tenantId: T1, requestId: Q1, attempts: 5, stored: false, storeError: 'x' });
    const again = incidentOf('publish_request.failed', { tenantId: T1, requestId: Q1, attempts: 6, stored: true });
    expect(first).toBe(`publish_request.failed:${Q1}`);
    expect(again).toBe(first);
  });

  it('makes a stale release failed by the sweep, its refused finish and a failed build one incident', () => {
    const keys = ['release.stale_failed', 'release.finish_refused', 'release.failed'].map((e) => incidentOf(e, { tenantId: T1, releaseId: R1, number: 4 }));
    expect(new Set(keys)).toEqual(new Set([`release.failed:${R1}`]));
  });

  it('keeps different releases, sites and events apart', () => {
    expect(incidentOf('release.failed', { releaseId: R1 })).not.toBe(incidentOf('release.failed', { releaseId: Q1 }));
    expect(incidentOf('release.retries_exhausted', { releaseId: R1 })).not.toBe(incidentOf('release.failed', { releaseId: R1 }));
    expect(incidentOf('delivery.retries_exhausted', { tenantId: T1, releaseId: R1, siteId: S1 })).toBe(`delivery.retries_exhausted:${R1}:${S1}`);
    expect(incidentOf('delivery.retries_exhausted', { releaseId: R1, siteId: Q1 })).not.toBe(`delivery.retries_exhausted:${R1}:${S1}`);
  });

  it('falls back to the tenant, then to the event alone', () => {
    expect(incidentOf('sweep.failed', { tenantId: T1 })).toBe(`sweep.failed:${T1}`);
    expect(incidentOf('sweep.failed', { marker: 'x' })).toBe('sweep.failed');
  });

  // Security fix, Thread A: a platform alert with no ids was one incident forever (one email ever).
  it('keys a sweep step failure by its step and its hour bucket', () => {
    const at12 = incidentOf('worker.step_failed', { step: 'release', failures: 2, bucket: '2026-11-03T12' });
    expect(at12).toBe('worker.step_failed:release:2026-11-03t12');
    expect(incidentOf('worker.step_failed', { step: 'release', failures: 9, bucket: '2026-11-03T12' })).toBe(at12);
    expect(incidentOf('worker.step_failed', { step: 'release', bucket: '2026-11-03T13' })).not.toBe(at12);
    expect(incidentOf('worker.step_failed', { step: 'private_orphans', bucket: '2026-11-03T12' })).not.toBe(at12);
  });

  it('stays within the database rule (1-200 characters of [a-z0-9_.:-]) for any id', () => {
    const key = incidentOf('release.failed', { releaseId: 'Ab C/<script>'.repeat(30), requestId: 'Ü'.repeat(300), siteId: 7 });
    expect(key).toMatch(/^[a-z0-9_.:-]{1,200}$/);
  });
});

describe('composeAlertEmail', () => {
  const at = new Date('2026-11-03T20:00:00Z');

  it('names the event, the tenant, the release and the reason', () => {
    const email = composeAlertEmail('release.failed', { tenantId: T1, releaseId: R1, number: 7, code: 'build_failed', step: 'project' }, at);
    expect(email.subject).toBe(`[Litljómi CMS] release.failed (tenant ${T1})`);
    expect(email.text).toContain('Alert: release.failed\n');
    expect(email.text).toContain(`Tenant: ${T1}\n`);
    expect(email.text).toContain(`Release: 7 (${R1})\n`);
    expect(email.text).toContain('Reason: build_failed at step project\n');
    expect(email.text).toContain('Time: 2026-11-03T20:00:00.000Z\n');
  });

  it('shows only allowlisted scalars: no error message, no secret, no content; lists as counts', () => {
    const email = composeAlertEmail(
      'release.entry_omitted',
      {
        tenantId: T1,
        releaseId: R1,
        number: 2,
        message: 'duplicate key value (title)=(Leynileg frétt)',
        storeError: 'boom',
        webhookSecret: 'whsec_123',
        data: { title: 'Leynileg frétt' },
        omitted: [{ entryId: 'e1', title: 'Leynileg frétt' }, { entryId: 'e2' }],
      },
      at,
    );
    expect(email.text).toContain('omitted: 2\n');
    for (const leaked of ['Leynileg', 'duplicate key', 'boom', 'whsec_', 'webhookSecret', 'message']) {
      expect(email.text).not.toContain(leaked);
      expect(email.subject).not.toContain(leaked);
    }
  });

  it('keeps a platform alert (no tenant) and strips control characters from shown values', () => {
    const email = composeAlertEmail('sweep.failed', { code: 'x\r\nBcc: evil@x.is' }, at);
    expect(email.subject).toBe('[Litljómi CMS] sweep.failed');
    expect(email.text).toContain('Tenant: (platform)\n');
    expect(email.text).toContain('code: x??Bcc: evil@x.is\n');
    expect(email.text).not.toContain('\r');
  });
});

describe('emailAlert', () => {
  const dbWith = (claim: () => { data: unknown; error: unknown }) => {
    const rpc = vi.fn(async (_fn: string, _args: Record<string, unknown>) => claim());
    return { db: { rpc } as unknown as SupabaseClient, rpc };
  };

  it('claims the incident and sends when the claim is the first', async () => {
    const { db, rpc } = dbWith(() => ({ data: true, error: null }));
    const send = vi.fn(async () => {});
    const result = await emailAlert(db, 'release.stale_failed', { tenantId: T1, releaseId: R1, number: 3 }, { config, send, now: () => new Date(0) });

    expect(result).toBe('sent');
    expect(rpc).toHaveBeenCalledWith('worker_claim_alert_email', { p_tenant_id: T1, p_event: 'release.stale_failed', p_incident: `release.failed:${R1}` });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(config, expect.objectContaining({ subject: `[Litljómi CMS] release.stale_failed (tenant ${T1})` }));
  });

  it('sends nothing for an incident already claimed (a re-claim or a later sweep)', async () => {
    const { db } = dbWith(() => ({ data: false, error: null }));
    const send = vi.fn(async () => {});
    expect(await emailAlert(db, 'release.finish_refused', { tenantId: T1, releaseId: R1 }, { config, send })).toBe('duplicate');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one email across repeated raises of one incident, with the database deciding', async () => {
    const claimed = new Set<string>();
    const rpc = vi.fn(async (_fn: string, args: Record<string, unknown>) => {
      const key = args.p_incident as string;
      const first = !claimed.has(key);
      claimed.add(key);
      return { data: first, error: null };
    });
    const db = { rpc } as unknown as SupabaseClient;
    const send = vi.fn(async () => {});
    const details = { tenantId: T1, requestId: Q1, attempts: 5, stored: false };

    const results = [];
    for (let attempt = 5; attempt < 9; attempt++) results.push(await emailAlert(db, 'publish_request.failed', { ...details, attempts: attempt }, { config, send }));
    results.push(await emailAlert(db, 'publish_request.failed', { ...details, requestId: R1 }, { config, send }));

    expect(results).toEqual(['sent', 'duplicate', 'duplicate', 'duplicate', 'sent']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('neither claims nor sends when email is off', async () => {
    const { db, rpc } = dbWith(() => ({ data: true, error: null }));
    const send = vi.fn(async () => {});
    expect(await emailAlert(db, 'release.failed', { releaseId: R1 }, { config: null, send })).toBe('not_configured');
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing when the claim fails, and throws for the caller to log', async () => {
    const { db } = dbWith(() => ({ data: null, error: { code: 'XX000', message: 'db down' } }));
    const send = vi.fn(async () => {});
    await expect(emailAlert(db, 'release.failed', { releaseId: R1 }, { config, send })).rejects.toThrow('worker_claim_alert_email');
    expect(send).not.toHaveBeenCalled();
  });

  it('throws when the send fails (the incident stays claimed: not retried)', async () => {
    const { db } = dbWith(() => ({ data: true, error: null }));
    const send = vi.fn(async () => {
      throw new Error('smtp down');
    });
    await expect(emailAlert(db, 'release.failed', { releaseId: R1 }, { config, send })).rejects.toThrow('smtp down');
  });
});
