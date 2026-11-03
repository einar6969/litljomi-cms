import { createAdminClient } from '../admin-client';
import { emailAlert } from './alert-email';
import { callRpc } from './rpc';

/**
 * Raises a platform alert (decision 10; spec §6.3, §7.1, §8.4): logged with console.error under the
 * prefix `[cms-alert]`, recorded in the audit log as the system event `system.alert.<event>`
 * through `api.worker_record_alert` (null actor, decision 12), and emailed to the platform admin
 * once per incident (M3-04, alert-email.ts). `details.tenantId`, when it is a string, names the
 * tenant the alert concerns; otherwise it is a platform alert (null tenant).
 *
 * `event` is a dotted lowercase name (`publish_request.failed`); details must be JSON-serialisable.
 * The returned promise never rejects: an alert that cannot be recorded or emailed is still logged,
 * and the failure is logged next to it, so raising an alert never breaks the caller's error path.
 */
export async function alert(event: string, details: Record<string, unknown>): Promise<void> {
  console.error(`[cms-alert] ${event}`, details);
  let db;
  try {
    db = createAdminClient();
  } catch (error) {
    console.error(`[cms-alert] could not record ${event} in the audit log`, error);
    return;
  }
  try {
    const tenantId = typeof details.tenantId === 'string' ? details.tenantId : null;
    await callRpc(db, 'worker_record_alert', { p_tenant_id: tenantId, p_event: event, p_details: details });
  } catch (error) {
    console.error(`[cms-alert] could not record ${event} in the audit log`, error);
  }
  try {
    await emailAlert(db, event, details);
  } catch (error) {
    console.error(`[cms-alert] could not email ${event}`, error);
  }
}
