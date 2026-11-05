/**
 * The worker's longest run (ms): the `maxDuration` (300 s) of the worker and cron routes, which a
 * test keeps equal. The worker's jobs set their run deadline from it, and the pointer poll before
 * the notification is bounded so that the live check still fits (decision 49.1). A delivery with
 * withdrawal state waits this long, five minutes, for its run (20261105130000_withdrawal_safety).
 */
export const WORKER_MAX_DURATION_MS = 300_000;
