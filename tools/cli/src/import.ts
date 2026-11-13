// `import`: a tenant-neutral manifest and a media folder, written into one tenant through the same
// `api` functions an editor calls, signed in as an editor (enhancement A2; docs/plans/import.md).
// Run by Einar only, in his own terminal.
//
// Safety rules (import plan section 3):
// - It is an editor. It never reads the secret key: the env file is read for the URL and the
//   publishable key only. It calls no worker route and no `admin_*` or `worker_*` function, writes
//   to no cms table, and archives, unpublishes or deletes nothing.
// - The password is read from standard input only, as provision reads secrets (piped, or typed at
//   a prompt that does not echo); never from an environment variable or an argument, which would
//   leave it in the shell history. It is never written to a file, logged or echoed. Tokens stay in
//   memory; everything printed is redacted of the password and every token.
// - The URL must be https://<--expect-ref>.supabase.co, or with --local exactly a local stack's own
//   address, slot 1's http://127.0.0.1:54321 or slot 2's http://127.0.0.1:54331 (import decision 3;
//   ./local.ts, the same rule as provision's --local); requests go to that origin only and never
//   follow a redirect (./hosted.ts).
// - Nothing is read outside --media and no symlink is followed; the manifest is never changed.
// - Output is keys, ids, statuses and counts; the dry run also prints the manifest's own text.
import { isAbsolute } from 'node:path';
import type { ModuleManifest } from '@litljomi/cms-schema';
import { DEFAULT_ENV_FILE, Failure, KEY_RE, REF_RE, URL_RE, UsageError, envValue, redactAll, type FetchFn } from './hosted.ts';
import { LOCAL_ORIGINS, LOCAL_REF, LOCAL_URL_RE, hostOf } from './local.ts';
import { LedgerFile, ledgerPath, parseLedger, reportPath, type Ledger, type LedgerStore } from './import/ledger.ts';
import type { InspectImage } from './import/media.ts';
import { comparisonText, dryRun, type MediaFs, type Plan } from './import/plan.ts';
import { buildReport, type Report } from './import/report.ts';
import { Importer, type RunDeps } from './import/run.ts';
import { EditorSession } from './import/session.ts';

/** The ledger and report name of a --local run, in place of a project ref. */
export { LOCAL_REF };
export const MAX_BATCH = 9;

export interface ImportDeps extends MediaFs, LedgerStore, Omit<RunDeps, 'readBytes'> {
  fetch: FetchFn;
  /** A text file: the manifest, the env file. */
  readTextFile(path: string): Promise<string>;
  /** The password, from standard input only; null when there is none. Never echoed. */
  readPassword(): Promise<string | null>;
  inspectImage: InspectImage;
  loadModule(slug: string): Promise<ModuleManifest>;
}

export interface ImportIo {
  log: (line: string) => void;
  error: (line: string) => void;
}

export const IMPORT_USAGE = [
  'usage: import --tenant <slug> --manifest <absolute path> --media <absolute folder> --dry-run',
  '       import --tenant <slug> --manifest <absolute path> --media <absolute folder> --email <editor> (--expect-ref <ref> | --local)',
  '              [--env-file=<absolute path>] [--batch-size <1-9>] [--first-batch-only] [--report <absolute path>]',
  '         (the password is read from standard input only, piped or typed; --local needs --env-file)',
].join('\n');

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const VALUE_FLAGS = ['--tenant', '--manifest', '--media', '--email', '--expect-ref', '--env-file', '--batch-size', '--report'];
const BOOLEAN_FLAGS = ['--dry-run', '--first-batch-only', '--local'];
const DRY_RUN_FLAGS = new Set(['--tenant', '--manifest', '--media', '--dry-run']);

interface Args {
  tenant: string;
  manifest: string;
  media: string;
  dryRun: boolean;
  email?: string;
  ref?: string;
  local: boolean;
  envFile?: string;
  batchSize: number;
  firstBatchOnly: boolean;
  report?: string;
}

export function parseImportArgs(args: string[]): Args {
  const values = new Map<string, string>();
  const booleans = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const raw = args[i] as string;
    if (!raw.startsWith('--')) throw new UsageError('unexpected argument');
    const eq = raw.indexOf('=');
    const name = eq === -1 ? raw : raw.slice(0, eq);
    // Only a flag's name is ever printed, never a value.
    if (BOOLEAN_FLAGS.includes(name)) {
      if (eq !== -1) throw new UsageError(`${name} takes no value`);
      if (booleans.has(name)) throw new UsageError(`${name} given twice`);
      booleans.add(name);
      continue;
    }
    if (!VALUE_FLAGS.includes(name)) throw new UsageError(`unknown option ${name.slice(0, 40)}`);
    const value = eq === -1 ? args[i + 1] : raw.slice(eq + 1);
    if (value === undefined || (eq === -1 && value.startsWith('--'))) throw new UsageError(`${name} needs a value`);
    if (values.has(name)) throw new UsageError(`${name} given twice`);
    values.set(name, value);
    if (eq === -1) i++;
  }
  const req = (name: string) => {
    const v = values.get(name);
    if (v === undefined) throw new UsageError(`${name} is required`);
    return v;
  };
  const absolute = (name: string, v: string | undefined) => {
    if (v !== undefined && !isAbsolute(v)) throw new UsageError(`${name} must be an absolute path`);
    return v;
  };
  const tenant = req('--tenant');
  if (!SLUG_RE.test(tenant)) throw new UsageError('--tenant has an unexpected form');
  const manifest = absolute('--manifest', req('--manifest')) as string;
  const media = absolute('--media', req('--media')) as string;
  const dryRun = booleans.has('--dry-run');
  if (dryRun) {
    const extra = [...values.keys(), ...booleans].filter((f) => !DRY_RUN_FLAGS.has(f));
    if (extra.length > 0) throw new UsageError(`--dry-run is offline and takes only --tenant, --manifest and --media (not ${extra.join(', ')})`);
    return { tenant, manifest, media, dryRun, local: false, batchSize: MAX_BATCH, firstBatchOnly: false };
  }
  const email = req('--email');
  if (!EMAIL_RE.test(email)) throw new UsageError('--email has an unexpected form');
  const local = booleans.has('--local');
  const ref = values.get('--expect-ref');
  if (local === (ref !== undefined)) throw new UsageError('give exactly one of --expect-ref and --local');
  const envFile = absolute('--env-file', values.get('--env-file'));
  if (local && envFile === undefined) throw new UsageError('--local needs --env-file (the default is the production env file)');
  const batchRaw = values.get('--batch-size') ?? String(MAX_BATCH);
  if (!/^[1-9]$/.test(batchRaw)) throw new UsageError(`--batch-size must be 1 to ${MAX_BATCH}`);
  const report = absolute('--report', values.get('--report'));
  return {
    tenant,
    manifest,
    media,
    dryRun,
    email,
    ...(ref === undefined ? {} : { ref }),
    local,
    ...(envFile === undefined ? {} : { envFile }),
    batchSize: Number(batchRaw),
    firstBatchOnly: booleans.has('--first-batch-only'),
    ...(report === undefined ? {} : { report }),
  };
}

/** The target's URL and publishable key only: the secret key is never read (import plan 2.2). */
async function readEditorTarget(a: Args, readTextFile: (p: string) => Promise<string>): Promise<{ origin: string; publishableKey: string; ref: string }> {
  if (!a.local && !REF_RE.test(a.ref as string)) {
    throw new Failure("FAILED: --expect-ref must be the hosted project's reference (20 lowercase letters or digits); nothing was sent");
  }
  const envFile = a.envFile ?? DEFAULT_ENV_FILE;
  let text: string;
  try {
    text = await readTextFile(envFile);
  } catch {
    throw new Failure(`FAILED: ${envFile} could not be read; nothing was sent`);
  }
  const url = envValue(text, 'NEXT_PUBLIC_SUPABASE_URL', a.local ? LOCAL_URL_RE : URL_RE, envFile);
  const publishableKey = envValue(text, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', KEY_RE, envFile);
  if (a.local && !(LOCAL_ORIGINS as readonly string[]).includes(url)) throw new Failure(`FAILED: ${envFile} points at ${hostOf(url)}, not a local stack; nothing was sent`);
  const expected = a.local ? url : `https://${a.ref as string}.supabase.co`;
  if (url !== expected) throw new Failure(`FAILED: ${envFile} points at ${hostOf(url)}, not ${hostOf(expected)}; nothing was sent`);
  return { origin: url, publishableKey, ref: a.local ? LOCAL_REF : (a.ref as string) };
}

function printPlan(plan: Plan, log: (l: string) => void): void {
  const perType = new Map<string, number>();
  for (const item of plan.items) perType.set(item.type, (perType.get(item.type) ?? 0) + 1);
  const bytes = [...plan.files.values()].reduce((n, f) => n + f.bytes, 0);
  log(`files: ${plan.files.size} (${bytes} bytes)`);
  log(`entries: ${[...perType].map(([t, n]) => `${t} ${n}`).join(', ') || 'none'}`);
  log(`waves: ${plan.waves.length}${plan.waves.map((w, i) => `\n  wave ${i + 1}: ${w.join(', ')}`).join('')}`);
  if (plan.secondPass.length > 0) log(`second pass (cycles broken at an optional reference): ${plan.secondPass.join(', ')}`);
  log(`slugs at risk: ${plan.slugsAtRisk.length}${plan.slugsAtRisk.map((r) => `\n  ${r.key}: ${r.slug} (the title gives ${r.fromTitle})`).join('')}`);
  if (Object.keys(plan.order).length > 0) log('order: validated; it is not applied until manual ordering (A12) exists');
}

function summarise(report: Report, log: (l: string) => void): void {
  log(`report: release ${report.release ?? 'none'}; ${report.checked.entries} entr${report.checked.entries === 1 ? 'y' : 'ies'} and ${report.checked.files} file(s) compared`);
  log(`  differences: ${report.differences.length}`);
  for (const d of report.differences.slice(0, 20)) log(`    ${d.key} ${d.at}: ${d.what.split(':')[0] as string}`);
  if (report.differences.length > 20) log(`    … ${report.differences.length - 20} more in the report file`);
  for (const u of report.unchecked) log(`  unchecked: ${u.count} ${u.what}`);
  if (report.extras.length > 0) log(`  not in the manifest (listed, not judged): ${report.extras.length}`);
}

/** Runs `import ...`; returns the exit code (0 ok, 1 refused, failed or any difference, 2 usage). */
export async function runImport(args: string[], io: ImportIo, deps: ImportDeps): Promise<number> {
  const secrets: string[] = [];
  const log = (line: string) => io.log(redactAll(line, secrets));
  const error = (line: string) => io.error(redactAll(line, secrets));

  let a: Args;
  try {
    a = parseImportArgs(args);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    error(`import: ${e.message}`);
    error(IMPORT_USAGE);
    return 2;
  }

  try {
    let module: ModuleManifest;
    try {
      module = await deps.loadModule(a.tenant);
    } catch {
      throw new Failure(`FAILED: the module of tenant ${a.tenant} could not be loaded`);
    }
    let manifestText: string;
    try {
      manifestText = await deps.readTextFile(a.manifest);
    } catch {
      throw new Failure(`FAILED: ${a.manifest} could not be read`);
    }
    const checked = await dryRun(manifestText, module, a.media, deps, deps.inspectImage);
    if (!checked.ok) {
      error(`the manifest has ${checked.problems.length} problem(s); nothing was ${a.dryRun ? 'checked further' : 'sent'}:`);
      for (const p of checked.problems) error(`  ${p}`);
      return 1;
    }
    const plan = checked.plan;
    printPlan(plan, log);
    if (a.dryRun) {
      log('the text the report will compare:');
      for (const line of comparisonText(plan)) log(line);
      log('dry run: no problems; nothing was sent');
      return 0;
    }

    // 2.2 Signing in.
    const target = await readEditorTarget(a, deps.readTextFile);
    secrets.push(target.publishableKey);
    log(`target: ${target.origin.replace(/^https?:\/\//, '')}`);
    const password = await deps.readPassword();
    if (password === null || password === '') throw new Failure('FAILED: no password: pipe or type it on standard input; nothing was sent');
    secrets.push(password);
    const session = new EditorSession({ origin: target.origin, publishableKey: target.publishableKey }, deps.fetch, secrets, deps.now);
    await session.signIn(a.email as string, password);
    log(`signed in: user ${session.userId}`);

    const tenants = await session.view('my_tenants', `slug=eq.${a.tenant}&select=id,slug,status`);
    if (!tenants.ok || !Array.isArray(tenants.body)) throw new Failure(`FAILED: reading api.my_tenants: ${tenants.ok ? 'unexpected response' : tenants.detail}; nothing was written`);
    const tenant = (tenants.body as { id?: unknown; slug?: unknown; status?: unknown }[]).find((t) => t.slug === a.tenant);
    if (tenant === undefined || typeof tenant.id !== 'string') throw new Failure(`FAILED: ${a.email as string} is not an editor of tenant ${a.tenant}; nothing was written`);
    if (tenant.status !== 'active') throw new Failure(`FAILED: tenant ${a.tenant} is not active; nothing was written`);
    const tenantId = tenant.id;
    log(`tenant ${a.tenant}: ${tenantId}`);
    // L1's read-only probe: without the library's functions the run stops before writing anything.
    const probe = await session.rpc('asset_summary', { p_tenant_id: tenantId });
    if (!probe.ok) {
      if (probe.status === 404 || probe.errorCode === 'PGRST202') throw new Failure('FAILED: the target has no api.asset_summary: the image library (L1) is not on it; nothing was written');
      throw new Failure(`FAILED: the library probe (asset_summary): ${probe.detail}; nothing was written`);
    }

    // The ledger: the importer's memory of what it created. Never overwritten when unreadable.
    const lPath = ledgerPath(a.manifest, target.ref, a.tenant);
    const existing = await deps.read(lPath);
    let ledger: Ledger;
    if (existing === null) {
      ledger = { format: 1, ref: target.ref, tenant: a.tenant, tenantId, entries: {} };
    } else {
      const parsed = parseLedger(existing, { ref: target.ref, tenant: a.tenant });
      if (typeof parsed === 'string') throw new Failure(`FAILED: the ledger ${lPath} ${parsed}; it was left as it is and nothing was written`);
      if (parsed.tenantId !== tenantId) throw new Failure(`FAILED: the ledger ${lPath} is for tenant id ${parsed.tenantId}, not ${tenantId}; nothing was written`);
      ledger = parsed;
    }
    const ledgerFile = new LedgerFile(lPath, ledger, deps);
    await ledgerFile.save();
    log(`ledger: ${lPath}`);

    const importer = new Importer(plan, session, ledgerFile, tenantId, deps, { media: a.media, batchSize: a.batchSize, firstBatchOnly: a.firstBatchOnly }, log);
    let stopped: string | null = null;
    let outcome: Awaited<ReturnType<Importer['run']>> | null = null;
    try {
      outcome = await importer.run();
      stopped = outcome.stopped;
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      error(e.message);
      stopped = 'a step failed';
    }
    const notices = outcome?.notices ?? [];
    if (outcome?.thumbnailsMissing) log(`thumbnails: ${outcome.thumbnailsMissing} file(s) without one (the thumbnail maker comes with L2)`);
    if (Object.keys(plan.order).length > 0) log('order: validated, not applied (manual ordering, A12, does not exist yet)');
    if (outcome?.firstBatchStop) {
      log('stopped after the first batch (--first-batch-only); run again without it to continue');
      return notices.length > 0 ? 1 : 0;
    }

    // 2.7 The report, always.
    const report = await buildReport({
      plan,
      module,
      tenant: { id: tenantId, slug: a.tenant },
      ids: importer.ids,
      lastRelease: outcome?.lastRelease ?? null,
      notices,
      session,
      now: deps.now,
      sleep: deps.sleep,
    });
    const rPath = a.report ?? reportPath(a.manifest, target.ref, a.tenant);
    await deps.write(rPath, JSON.stringify(report, null, 2) + '\n');
    summarise(report, log);
    log(`report written: ${rPath}`);
    if (stopped !== null) error(`FAILED: the import stopped (${stopped}); run it again with the same arguments to resume`);
    const failed = stopped !== null || notices.length > 0 || report.differences.length > 0 || (report.release === null && plan.items.length > 0);
    return failed ? 1 : 0;
  } catch (e) {
    // Our own refusals are printed; anything else only by its kind, never its text.
    error(e instanceof Failure ? e.message : `FAILED: unexpected error (${e instanceof Error ? e.name : 'unknown'})`);
    return 1;
  }
}
