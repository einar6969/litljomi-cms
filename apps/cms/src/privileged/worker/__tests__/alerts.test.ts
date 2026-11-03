// Unit test of alert()'s failure path with a fake admin client: recording the alert can fail,
// but the alert is still logged and the caller's promise still resolves (decision 10). The
// recording itself runs against the local stack in alerts.integration.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fakeClient = {
  rpc: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'audit down' } })),
};
vi.mock('../../admin-client', () => ({ createAdminClient: () => fakeClient }));

const { alert } = await import('../alerts');

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('alert', () => {
  it('logs the alert and the recording failure, and resolves, when worker_record_alert fails', async () => {
    await expect(alert('publish_request.failed', { tenantId: 't1', requestId: 'r1' })).resolves.toBeUndefined();

    expect(fakeClient.rpc).toHaveBeenCalledWith('worker_record_alert', {
      p_tenant_id: 't1',
      p_event: 'publish_request.failed',
      p_details: { tenantId: 't1', requestId: 'r1' },
    });
    expect(console.error).toHaveBeenCalledWith('[cms-alert] publish_request.failed', { tenantId: 't1', requestId: 'r1' });
    expect(console.error).toHaveBeenCalledWith(
      '[cms-alert] could not record publish_request.failed in the audit log',
      expect.objectContaining({ message: 'worker_record_alert: XX000 audit down' }),
    );
  });
});

describe('alert email', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('logs an email failure next to the alert and still resolves', async () => {
    vi.stubEnv('CMS_ALERT_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('CMS_ALERT_EMAIL_FROM', 'cms@test.local');
    vi.stubEnv('CMS_ALERT_EMAIL_TO', '');
    fakeClient.rpc.mockClear();

    await expect(alert('release.failed', { tenantId: 't1', releaseId: 'r1' })).resolves.toBeUndefined();

    expect(console.error).toHaveBeenCalledWith(
      '[cms-alert] could not email release.failed',
      expect.objectContaining({ message: 'CMS_ALERT_EMAIL_TO is not set' }),
    );
  });
});
