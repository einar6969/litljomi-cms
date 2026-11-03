/**
 * The worker's longest run (ms): the `maxDuration` (300 s) of the worker and cron routes, which a
 * test keeps equal. The worker's jobs set their run deadline from it, and the pointer poll before
 * the notification is bounded so that the live check still fits (decision 49.1).
 */
export const WORKER_MAX_DURATION_MS = 300_000;
