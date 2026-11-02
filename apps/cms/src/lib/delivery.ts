/**
 * M1: one notification attempt per sweep, up to this many per delivery (spec §7.4; decisions 35
 * and 36.1). The worker stops retrying a delivery at this count and alerts; the editor's status
 * display shows such a delivery as failed. Outside privileged/ so both can read it (decision 37.8).
 */
export const MAX_NOTIFY_ATTEMPTS = 10;
