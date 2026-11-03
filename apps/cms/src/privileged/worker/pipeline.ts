// The worker's jobs, imported only by the worker and cron route handlers (decision 35).
import 'server-only';
import { WORKER_MAX_DURATION_MS } from '../../lib/delivery';
import type { DeliveryOptions } from './deliver';
import { deliverTenant } from './deliver';
import { processRequestById } from './process-request';
import { runSweep } from './sweep';

/**
 * Poll and timeout of the live checks (§7.4 defaults: 3 s and 60 s); injectable for tests.
 * `arrivedAt` is when the route received the request (epoch ms): the platform's maxDuration runs
 * from there, not from the start of the job inside `after()` (Task 29 security r1, Minor 3).
 */
export type PipelineOptions = DeliveryOptions & { arrivedAt?: number };

/**
 * The options with the run deadline set, when not given, to the request's arrival (now, when that
 * is not given) plus the routes' maxDuration (decision 49.1): the pointer poll before the
 * notification ends early enough for the live check.
 */
const withRunDeadline = ({ arrivedAt, ...options }: PipelineOptions): DeliveryOptions => ({
  ...options,
  runDeadline: options.runDeadline ?? (arrivedAt ?? Date.now()) + WORKER_MAX_DURATION_MS,
});

/**
 * The fast path (spec §6.1): claims and processes one publish request; when it commits, builds
 * the tenant's release and, once it is delivered, notifies every active site and live-checks every
 * request linked to the release (Task 21, decision 35). A request that does not commit, or a build
 * that is busy or fails, ends here: the sweep picks up what is left.
 */
export async function processAndDeliver(requestId: string, options: PipelineOptions = {}): Promise<void> {
  const bounded = withRunDeadline(options);
  const outcome = await processRequestById(requestId);
  if (outcome.status !== 'committed') return;
  await deliverTenant(outcome.tenantId, bounded);
}

/** Picks up whatever the fast path missed: pending requests, unreleased commits, deliveries to retry. */
export async function sweep(options: PipelineOptions = {}): Promise<void> {
  await runSweep(withRunDeadline(options));
}
