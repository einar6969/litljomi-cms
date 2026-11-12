// The safety rules shared by the commands that reach the hosted staging project (`provision`,
// `boundary-check`; decisions 44 and 46; runbook docs/runbooks/staging.md sections 7.4 and 11).
//
// - The env file is read as text, never executed, with the rules of the runbook's `env_value`: each
//   needed name exactly once on a plain NAME=value line, its value matching a fixed pattern. A
//   refusal names the variable, never its value.
// - The URL must be https://<--expect-ref>.supabase.co; any other host (loopback included) is refused.
// - Requests go only to that origin, with keys and tokens in headers only, and never follow a redirect.
// - Server errors are reduced to the HTTP status and the error's code and message fields, with every
//   known secret redacted, control characters removed and the length capped.
import { isAbsolute } from 'node:path';

export const DEFAULT_ENV_FILE = '/Users/einarzoega/litljomi-cms/.env.staging.local';

export const REF_RE = /^[a-z0-9]{20}$/;
export const URL_RE = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
export const KEY_RE = /^[A-Za-z0-9._-]+$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Wrong arguments: printed with the usage, exit 2. */
export class UsageError extends Error {}

/** A refusal or failure: its message is printed as is and the command exits 1. */
export class Failure extends Error {}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------------------------
// Arguments

export interface ArgSpec {
  positionals: number;
  flags: string[];
  repeatable?: string[];
}

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string[]>;
}

const COMMON_FLAGS = ['--expect-ref', '--env-file'];

/** Parses the arguments against `spec`; `--expect-ref` is required and `--env-file` must be absolute. */
export function parseArgs(args: string[], spec: ArgSpec): ParsedArgs {
  const known = new Set([...spec.flags, ...COMMON_FLAGS]);
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] as string;
    if (raw.startsWith('--')) {
      // `--flag=value` and `--flag value` are both accepted; `--env-file=<path>` is the documented form
      // because vite-node swallows a separate `--env-file <path>` when run through `pnpm … cli`.
      const eq = raw.indexOf('=');
      const arg = eq === -1 ? raw : raw.slice(0, eq);
      // Only the flag's name is ever printed, never a value.
      if (!known.has(arg)) throw new UsageError(`unknown option ${arg}`);
      const value = eq === -1 ? args[i + 1] : raw.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new UsageError(`${arg} needs a value`);
      const values = flags.get(arg) ?? [];
      if (values.length > 0 && !(spec.repeatable ?? []).includes(arg)) throw new UsageError(`${arg} given twice`);
      values.push(value);
      flags.set(arg, values);
      if (eq === -1) i++;
    } else {
      positionals.push(raw);
    }
  }
  if (positionals.length !== spec.positionals) throw new UsageError('unexpected or missing arguments');
  if (!flags.has('--expect-ref')) throw new UsageError('--expect-ref is required');
  const envFile = flags.get('--env-file')?.[0];
  if (envFile !== undefined && !isAbsolute(envFile)) throw new UsageError('--env-file must be an absolute path');
  return { positionals, flags };
}

export const flagValue = (p: ParsedArgs, name: string): string | undefined => p.flags.get(name)?.[0];

export function requiredFlag(p: ParsedArgs, name: string, pattern: RegExp): string {
  const value = flagValue(p, name);
  if (value === undefined) throw new UsageError(`${name} is required`);
  if (!pattern.test(value)) throw new UsageError(`${name} has an unexpected form`);
  return value;
}

// ---------------------------------------------------------------------------------------------
// The env file (runbook section 7.4, `env_value`)

/** NAME's value from the env file's text; refuses, naming only NAME, as the runbook's env_value does. */
export function envValue(text: string, name: string, allowed: RegExp, file: string): string {
  const assigned = new RegExp(`^\\s*(export\\s+)?${name}\\s*=`);
  let count = 0;
  let plain = false;
  let value = '';
  for (const line of text.split('\n')) {
    if (!assigned.test(line)) continue;
    count += 1;
    plain = line.startsWith(`${name}=`);
    if (plain) value = line.slice(name.length + 1);
  }
  if (count !== 1 || !plain) {
    throw new Failure(`FAILED: ${name} must be on exactly one plain ${name}=value line in ${file} (found ${count}); nothing was sent`);
  }
  if (!allowed.test(value)) throw new Failure(`FAILED: ${name} in ${file} has an unexpected form (value not shown); nothing was sent`);
  return value;
}

export interface Target {
  origin: string;
  /** The secret key. */
  key: string;
  /** The publishable key, when it was asked for. */
  publishableKey?: string;
  ref: string;
  envFile: string;
}

/**
 * Reads and checks the target project: `--expect-ref`'s form first (before any file is read), then
 * the env file's values, then that the URL is exactly https://<ref>.supabase.co.
 */
export async function readTarget(
  p: ParsedArgs,
  readTextFile: (path: string) => Promise<string>,
  options: { publishableKey?: boolean } = {},
): Promise<Target> {
  const ref = flagValue(p, '--expect-ref') as string;
  if (!REF_RE.test(ref)) {
    throw new Failure("FAILED: --expect-ref must be the staging project's reference (20 lowercase letters or digits); nothing was sent");
  }
  const envFile = flagValue(p, '--env-file') ?? DEFAULT_ENV_FILE;
  let text: string;
  try {
    text = await readTextFile(envFile);
  } catch {
    throw new Failure(`FAILED: ${envFile} could not be read; nothing was sent`);
  }
  const url = envValue(text, 'NEXT_PUBLIC_SUPABASE_URL', URL_RE, envFile);
  const key = envValue(text, 'SUPABASE_SECRET_KEY', KEY_RE, envFile);
  const publishableKey = options.publishableKey ? envValue(text, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', KEY_RE, envFile) : undefined;
  if (url !== `https://${ref}.supabase.co`) {
    throw new Failure(`FAILED: ${envFile} points at ${url.slice('https://'.length)}, not ${ref}.supabase.co; nothing was sent`);
  }
  return publishableKey === undefined ? { origin: url, key, ref, envFile } : { origin: url, key, publishableKey, ref, envFile };
}

// ---------------------------------------------------------------------------------------------
// Output hygiene

/** Replaces each secret with [redacted]. */
export const redactAll = (value: string, secrets: readonly string[]) =>
  secrets.filter((s) => s !== '').reduce((v, s) => v.split(s).join('[redacted]'), value);

/** Redacts, then removes control characters, then truncates (so no part of a secret survives). */
export const clean = (value: string, secrets: readonly string[] = []) =>
  redactAll(value, secrets).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200);

// ---------------------------------------------------------------------------------------------
// Requests

export interface HttpRequest {
  method: string;
  /** A path on the target origin, with its query. */
  path: string;
  headers: Record<string, string>;
  body?: string | Uint8Array<ArrayBuffer>;
  /** The error body fields read as the error code, first string wins. */
  codeFields?: readonly string[];
}

export type HttpResult =
  | { kind: 'network'; detail: string }
  | {
      kind: 'response';
      status: number;
      ok: boolean;
      /** The parsed JSON body, or null. */
      body: unknown;
      bytes: Uint8Array;
      errorCode: string | undefined;
      message: string | undefined;
      /** `HTTP <status>[ <code>][ <message>]`, cleaned. */
      detail: string;
    };

// PostgREST errors have code and message; Auth errors have error_code and msg.
const DEFAULT_CODE_FIELDS = ['error_code', 'code'] as const;

/**
 * One request to the target origin only, never following a redirect. A transport error becomes a
 * `network` result naming only the cause's code; an error response keeps only its status and the
 * code and message fields, cleaned of every secret in `secrets` (read at call time, so secrets
 * learned later, such as session tokens, are redacted too).
 */
export async function guardedFetch(fetchFn: FetchFn, origin: string, secrets: readonly string[], req: HttpRequest): Promise<HttpResult> {
  const url = new URL(req.path, origin);
  if (url.origin !== origin) throw new Failure('FAILED: refusing a request outside the target project');
  let response: Response;
  try {
    response = await fetchFn(url.href, {
      method: req.method,
      headers: req.headers,
      ...(req.body === undefined ? {} : { body: req.body }),
      redirect: 'error',
    });
  } catch (e) {
    // Only an error code from the cause (for example ENOTFOUND); never the error's text.
    const cause = (e as { cause?: { code?: unknown } } | null)?.cause?.code;
    return { kind: 'network', detail: `network error (${typeof cause === 'string' ? clean(cause, secrets) : 'no response'})` };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    bytes = new Uint8Array();
  }
  let parsed: unknown = null;
  try {
    const text = new TextDecoder().decode(bytes);
    parsed = text === '' ? null : (JSON.parse(text) as unknown);
  } catch {
    parsed = null;
  }
  if (response.ok) {
    return { kind: 'response', status: response.status, ok: true, body: parsed, bytes, errorCode: undefined, message: undefined, detail: `HTTP ${response.status}` };
  }
  const fields = (parsed !== null && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const pick = (names: readonly string[]) => names.map((n) => fields[n]).find((v): v is string => typeof v === 'string');
  const rawCode = pick(req.codeFields ?? DEFAULT_CODE_FIELDS);
  const rawMessage = pick(['message', 'msg']);
  const errorCode = rawCode === undefined ? undefined : clean(rawCode, secrets);
  const message = rawMessage === undefined ? undefined : clean(rawMessage, secrets);
  const detail = ['HTTP', String(response.status), errorCode, message].filter((v) => v !== undefined).join(' ');
  return { kind: 'response', status: response.status, ok: false, body: parsed, bytes, errorCode, message, detail };
}
