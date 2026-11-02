// The worker's jobs, imported only by the worker and cron route handlers (decision 35).
import 'server-only';
import type { DeliveryOptions } from './deliver';
import { deliverTenant } from './deliver';
import { processRequestById } from './process-request';
import { runSweep } from './sweep';

/** Poll and timeout of the live checks (§7.4 defaults: 3 s and 60 s); injectable for tests. */
export type PipelineOptions = DeliveryOptions;

/**
 * The fast path (spec §6.1): claims and processes one publish request; when it commits, builds
 * the tenant's release and, once it is delivered, notifies every active site and live-checks every
 * request linked to the release (Task 21, decision 35). A request that does not commit, or a build
 * that is busy or fails, ends here: the sweep picks up what is left.
 */
export async function processAndDeliver(requestId: string, options: PipelineOptions = {}): Promise<void> {
  const outcome = await processRequestById(requestId);
  if (outcome.status !== 'committed') return;
  await deliverTenant(outcome.tenantId, options);
}

/** Picks up whatever the fast path missed: pending requests, unreleased commits, deliveries to retry. */
export async function sweep(options: PipelineOptions = {}): Promise<void> {
  await runSweep(options);
}
