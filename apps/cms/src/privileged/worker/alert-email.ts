import 'server-only';
import { createTransport } from 'nodemailer';
import type { SupabaseClient } from '../../lib/supabase/types';
import { callRpc } from './rpc';

/**
 * Alert emails to the platform admin (spec §8.4: "by email from M3"; plan M3-04).
 *
 * Every alert is still logged and recorded in the audit log (alerts.ts); the email is extra, and is
 * sent once per incident, however often the alert is raised: the database claims the incident
 * (api.worker_claim_alert_email) and only the first claim sends. An incident is the event's group
 * and the ids it is about (incidentOf), so a request re-claimed while its failure cannot be stored,
 * or a release failed by the sweep and then refused at its finish, sends one email.
 *
 * The email holds event names, ids, codes and counts only (composeAlertEmail's allowlist): never a
 * secret, an error message (which can quote data) or content.
 *
 * Transport: SMTP, configured by environment. Hosted: SendGrid (decision 50.5). Locally and in the
 * tests: the local stack's Mailpit, through the same code. With no CMS_ALERT_SMTP_HOST no email is
 * sent (the alert is still logged and audited).
 */

/** The SMTP settings and addresses, from the environment. */
export type AlertEmailConfig = {
  host: string;
  port: number;
  /** Implicit TLS (port 465). */
  secure: boolean;
  /** STARTTLS required: always, except to a loopback host (Mailpit). */
  requireTLS: boolean;
  auth: { user: string; pass: string } | null;
  from: string;
  to: string[];
};

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Reads the alert email settings: CMS_ALERT_SMTP_HOST, CMS_ALERT_SMTP_PORT (default 587),
 * CMS_ALERT_SMTP_USER and CMS_ALERT_SMTP_PASSWORD (both or neither; the password is SECRET),
 * CMS_ALERT_EMAIL_FROM and CMS_ALERT_EMAIL_TO (comma-separated). Null when no host is set (email
 * off). Throws when a host is set but the rest is incomplete or invalid, so a half-configured
 * deployment is reported in the log rather than silently sending nothing.
 */
export function alertEmailConfig(env: Record<string, string | undefined> = process.env): AlertEmailConfig | null {
  const host = env.CMS_ALERT_SMTP_HOST?.trim();
  if (!host) return null;
  const portText = env.CMS_ALERT_SMTP_PORT?.trim() || '587';
  const port = Number(portText);
  if (!/^\d{1,5}$/.test(portText) || port < 1 || port > 65535) throw new Error('CMS_ALERT_SMTP_PORT must be a port number');
  const user = env.CMS_ALERT_SMTP_USER?.trim() ?? '';
  const pass = env.CMS_ALERT_SMTP_PASSWORD ?? '';
  if ((user === '') !== (pass === '')) throw new Error('CMS_ALERT_SMTP_USER and CMS_ALERT_SMTP_PASSWORD must be set together');
  const from = env.CMS_ALERT_EMAIL_FROM?.trim() ?? '';
  if (from === '') throw new Error('CMS_ALERT_EMAIL_FROM is not set');
  const to = (env.CMS_ALERT_EMAIL_TO ?? '')
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '');
  if (to.length === 0) throw new Error('CMS_ALERT_EMAIL_TO is not set');
  const secure = port === 465;
  return { host, port, secure, requireTLS: !secure && !LOOPBACK.has(host.toLowerCase()), auth: user ? { user, pass } : null, from, to };
}

/**
 * Events that are one incident with another event: a release the sweep failed as stale
 * (`release.stale_failed`) is the same failed build as its worker's refused finish
 * (`release.finish_refused`) and as `release.failed`.
 */
const INCIDENT_GROUP: Record<string, string> = {
  'release.stale_failed': 'release.failed',
  'release.finish_refused': 'release.failed',
};

/** The details naming what an alert is about, in key order. */
const INCIDENT_IDS = ['requestId', 'releaseId', 'siteId'] as const;

const idPart = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value.toLowerCase().replace(/[^a-z0-9_.-]/g, '-').slice(0, 64) : null;

/**
 * The incident key of an alert: its event group and the request, release and site it is about
 * (`release.failed:<release id>`, `delivery.retries_exhausted:<release id>:<site id>`). An alert
 * naming none of them is keyed by its tenant, or by the event alone for a platform alert. At most
 * 200 characters of [a-z0-9_.:-], as api.worker_claim_alert_email requires.
 */
export function incidentOf(event: string, details: Record<string, unknown>): string {
  const group = INCIDENT_GROUP[event] ?? event;
  let ids = INCIDENT_IDS.map((k) => idPart(details[k])).filter((v): v is string => v !== null);
  if (ids.length === 0) {
    const tenant = idPart(details.tenantId);
    ids = tenant ? [tenant] : [];
  }
  return [group, ...ids].join(':').slice(0, 200);
}

/** The details an email may show, in this order: ids, codes, counts and flags only. */
const EMAIL_FIELDS = [
  'tenantId',
  'releaseId',
  'number',
  'requestId',
  'entryId',
  'siteId',
  'action',
  'code',
  'step',
  'status',
  'attempts',
  'stored',
  'pointerWritten',
  'createdAt',
  'maxAgeSeconds',
] as const;

/** Lists an alert carries (omitted entries, fallback entries, assets): only their length is shown. */
const COUNTED_FIELDS = ['omitted', 'fallback', 'assets', 'assetIds'] as const;

/** A scalar shown in an email: a number, a boolean or a short single-line string; otherwise null. */
function shown(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string' && value !== '') return value.replace(/[^\x20-\x7e]/g, '?').slice(0, 120);
  return null;
}

export type AlertEmail = { subject: string; text: string };

/**
 * The email of an alert: the event, the tenant, the release and the reason, and the other
 * allowlisted details. Nothing outside EMAIL_FIELDS is shown (an error `message` can quote data), and
 * lists are shown as counts.
 */
export function composeAlertEmail(event: string, details: Record<string, unknown>, at: Date): AlertEmail {
  const tenant = shown(details.tenantId);
  const code = shown(details.code);
  const step = shown(details.step);
  const release = shown(details.number);
  const lines = [
    `Alert: ${event}`,
    `Tenant: ${tenant ?? '(platform)'}`,
    ...(release !== null || details.releaseId !== undefined
      ? [`Release: ${release ?? '?'} (${shown(details.releaseId) ?? 'no id'})`]
      : []),
    `Reason: ${code ? `${code}${step ? ` at step ${step}` : ''}` : event}`,
    `Time: ${at.toISOString()}`,
    '',
  ];
  for (const field of EMAIL_FIELDS) {
    const value = shown(details[field]);
    if (value !== null) lines.push(`${field}: ${value}`);
  }
  for (const field of COUNTED_FIELDS) {
    const value = details[field];
    if (Array.isArray(value)) lines.push(`${field}: ${value.length}`);
  }
  lines.push(
    '',
    `The full alert is in the audit log (system.alert.${event}) and the server log ([cms-alert]).`,
    'This alert is emailed once per incident; repeats of it are recorded there only.',
  );
  const subject = `[Litljómi CMS] ${event}${tenant ? ` (tenant ${tenant})` : ''}`;
  return { subject, text: lines.join('\n') + '\n' };
}

/** Sends one email; the default sends it over SMTP with nodemailer. */
export type SendEmail = (config: AlertEmailConfig, email: AlertEmail) => Promise<void>;

export const sendSmtp: SendEmail = async (config, email) => {
  const transport = createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTLS,
    ...(config.auth ? { auth: config.auth } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    await transport.sendMail({ from: config.from, to: config.to, subject: email.subject, text: email.text });
  } finally {
    transport.close();
  }
};

export type AlertEmailOptions = {
  config?: AlertEmailConfig | null;
  send?: SendEmail;
  now?: () => Date;
};

/** What emailAlert did: sent, not sent because the incident was already claimed, or email is off. */
export type AlertEmailResult = 'sent' | 'duplicate' | 'not_configured';

/**
 * Emails an alert to the platform admin, once per incident: claims the incident in the database
 * and sends only when this call made the first claim. Throws when the configuration is invalid,
 * the claim fails (nothing is sent: a failed claim cannot tell a first from a repeat) or the send
 * fails (the incident stays claimed, so the email is not retried; the alert is in the log and the
 * audit log). The caller (alert) logs the error.
 */
export async function emailAlert(
  db: SupabaseClient,
  event: string,
  details: Record<string, unknown>,
  options: AlertEmailOptions = {},
): Promise<AlertEmailResult> {
  const config = options.config === undefined ? alertEmailConfig() : options.config;
  if (config === null) return 'not_configured';
  const tenantId = typeof details.tenantId === 'string' ? details.tenantId : null;
  const claimed = await callRpc<boolean>(db, 'worker_claim_alert_email', {
    p_tenant_id: tenantId,
    p_event: event,
    p_incident: incidentOf(event, details),
  });
  if (claimed !== true) return 'duplicate';
  await (options.send ?? sendSmtp)(config, composeAlertEmail(event, details, (options.now ?? (() => new Date()))()));
  return 'sent';
}
