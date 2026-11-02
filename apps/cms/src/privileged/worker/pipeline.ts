// The worker's jobs, imported only by the worker and cron route handlers (decision 35).
// Stubs until Task 21 implements them; the route tests inject fakes.

/** Processes one publish request, then builds, delivers and live-checks the release (Task 21). */
export async function processAndDeliver(_requestId: string): Promise<void> {
  throw new Error('not implemented');
}

/** Picks up whatever the fast path missed: pending requests, unreleased commits, failed deliveries (Task 21). */
export async function sweep(): Promise<void> {
  throw new Error('not implemented');
}
