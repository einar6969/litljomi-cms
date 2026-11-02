// alert() against the local stack (decisions 10 and 12): the event reaches the audit log as
// system.alert.<event> with a null actor, through api.worker_record_alert and the secret key.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { env } from '../../../../../../tests/integration/src/env.ts';
import { TENANT } from '../../../../../../tests/integration/src/fixtures.ts';
import { closeAll, ownerQuery } from '../../../../../../tests/integration/src/sql.ts';
import { alert } from '../alerts';

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', env.apiUrl);
  vi.stubEnv('SUPABASE_SECRET_KEY', env.secretKey);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await closeAll();
});

describe('alert', () => {
  it('logs under [cms-alert] and records system.alert.<event> for the tenant named in details', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const marker = randomUUID();

    await alert('publish_request.failed', { tenantId: TENANT.labak, requestId: marker });

    expect(logged).toHaveBeenCalledWith('[cms-alert] publish_request.failed', { tenantId: TENANT.labak, requestId: marker });
    const rows = await ownerQuery(
      `select tenant_id, actor_id, action, target_type, details from cms.audit_log where details ->> 'requestId' = $1`,
      [marker],
    );
    expect(rows).toEqual([
      {
        tenant_id: TENANT.labak,
        actor_id: null,
        action: 'system.alert.publish_request.failed',
        target_type: 'alert',
        details: { tenantId: TENANT.labak, requestId: marker },
      },
    ]);
  });

  it('records a platform alert (no tenantId) with a null tenant', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const marker = randomUUID();

    await alert('sweep.failed', { marker });

    const rows = await ownerQuery(`select tenant_id, action from cms.audit_log where details ->> 'marker' = $1`, [marker]);
    expect(rows).toEqual([{ tenant_id: null, action: 'system.alert.sweep.failed' }]);
  });
});
