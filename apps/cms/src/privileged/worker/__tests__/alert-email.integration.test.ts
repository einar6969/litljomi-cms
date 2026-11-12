// alert()'s email against the local stack (M3-04): the same SMTP code that sends through SendGrid
// when hosted sends to the local stack's Mailpit (127.0.0.1:54325 on slot 1), and the incident claim in the
// database (api.worker_claim_alert_email) lets one email through per incident, however often the
// alert is raised. The exhausted-retry email is tested in pipeline.integration.test.ts.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mailsTo, sleep, waitMail } from '../../../../../../tests/integration/src/auth-api.ts';
import { env, stack } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { alert } from '../alerts';

/** The local stack's Mailpit SMTP port (supabase/config.toml, [local_smtp] smtp_port; the stack slot's). */
const MAILPIT_SMTP_PORT = String(stack.ports.smtp);

let to: string;

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
  vi.stubEnv('CMS_ALERT_SMTP_HOST', '127.0.0.1');
  vi.stubEnv('CMS_ALERT_SMTP_PORT', MAILPIT_SMTP_PORT);
  vi.stubEnv('CMS_ALERT_EMAIL_FROM', 'cms-alerts@test.local');
  to = `alerts-${randomUUID().slice(0, 8)}@test.local`;
  vi.stubEnv('CMS_ALERT_EMAIL_TO', to);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeAll();
});

describe('alert email', () => {
  it('emails an incident once, however often it is raised (re-claims of one request), and every raise is audited', async () => {
    const requestId = randomUUID();
    for (let attempts = 5; attempts < 8; attempts++) {
      await alert('publish_request.failed', { tenantId: TENANT.labak, requestId, code: 'unexpected', attempts, stored: false, storeError: 'db down' });
    }

    const [mail] = await waitMail(to, 1);
    await sleep(1_000);
    const mails = (await mailsTo(to)).filter((m) => m.Text.includes(requestId));
    expect(mails).toHaveLength(1);
    expect(mail!.Subject).toBe(`[Litljómi CMS] publish_request.failed (tenant ${TENANT.labak})`);
    expect(mail!.Text).toContain(`Tenant: ${TENANT.labak}`);
    expect(mail!.Text).toContain('Reason: unexpected');
    expect(mail!.Text).not.toContain('db down');

    const audited = await ownerQuery<{ action: string }>(
      `select action from cms.audit_log where details ->> 'requestId' = $1 or details ->> 'incident' = $2 order by id`,
      [requestId, `publish_request.failed:${requestId}`],
    );
    expect(audited.map((a) => a.action)).toEqual([
      'system.alert.publish_request.failed',
      'system.alert_email',
      'system.alert.publish_request.failed',
      'system.alert.publish_request.failed',
    ]);
  });

  it("emails a release failed by the sweep once, not again when its worker's finish is refused", async () => {
    const releaseId = randomUUID();
    await alert('release.stale_failed', { tenantId: TENANT.labak, releaseId, number: 900 });
    await alert('release.finish_refused', { tenantId: TENANT.labak, releaseId, number: 900, code: 'finish_refused', step: 'finish' });
    const other = randomUUID();
    await alert('release.failed', { tenantId: TENANT.labak, releaseId: other, number: 901, code: 'build_failed', step: 'project' });

    await waitMail(to, 3);
    await sleep(1_000);
    const mine = (await mailsTo(to)).filter((m) => m.Text.includes(releaseId) || m.Text.includes(other));
    expect(mine.map((m) => m.Subject).sort()).toEqual([
      `[Litljómi CMS] release.failed (tenant ${TENANT.labak})`,
      `[Litljómi CMS] release.stale_failed (tenant ${TENANT.labak})`,
    ]);
  });
});
