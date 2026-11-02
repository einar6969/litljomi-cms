import { createAdminClient } from '../admin-client';
import { callRpc } from './rpc';

/**
 * Raises a platform alert (decision 10; spec §6.3, §7.1): logged with console.error under the
 * prefix `[cms-alert]`, and recorded in the audit log as the system event `system.alert.<event>`
 * through `api.worker_record_alert` (null actor, decision 12). `details.tenantId`, when it is a
 * string, names the tenant the alert concerns; otherwise it is a platform alert (null tenant).
 * Email alerts are M3.
 *
 * `event` is a dotted lowercase name (`publish_request.failed`); details must be JSON-serialisable.
 * The returned promise never rejects: an alert that cannot be recorded is still logged, and the
 * recording failure is logged next to it, so raising an alert never breaks the caller's error path.
 */
export async function alert(event: string, details: Record<string, unknown>): Promise<void> {
  console.error(`[cms-alert] ${event}`, details);
  try {
    const tenantId = typeof details.tenantId === 'string' ? details.tenantId : null;
    await callRpc(createAdminClient(), 'worker_record_alert', { p_tenant_id: tenantId, p_event: event, p_details: details });
  } catch (error) {
    console.error(`[cms-alert] could not record ${event} in the audit log`, error);
  }
}
