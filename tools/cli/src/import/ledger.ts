// The ledger (import plan section 2.3): the importer's memory of which entry each manifest key became,
// which draft version it saved and which request it filed. The server is the truth; the ledger only
// says which server rows are the importer's own. It holds ids, versions and hashes, never content or
// credentials, and is written atomically (a temporary file, then a rename) after every step.
import { UUID_RE } from '../hosted.ts';

export type Pass = 'first' | 'full';

export interface LedgerEntry {
  id: string;
  type: string;
  /** The draft version the importer's last save produced, and what it saved. */
  savedVersion?: number;
  savedHash?: string;
  savedPass?: Pass;
  /** The importer's last publish request, for the draft version it named. */
  requestId?: string;
  requestedVersion?: number;
  /** The last draft version the importer saw published, and which pass it was. */
  publishedVersion?: number;
  publishedPass?: Pass;
  /** The saved hash whose request failed validation: not retried until the data changes. */
  failedHash?: string;
}

export interface Ledger {
  format: 1;
  ref: string;
  tenant: string;
  tenantId: string;
  entries: Record<string, LedgerEntry>;
}

export interface LedgerStore {
  /** The file's text, or null when there is none. */
  read(path: string): Promise<string | null>;
  /** Writes the whole file atomically. */
  write(path: string, text: string): Promise<void>;
}

/** `<manifest>.<ref>.<tenant>.ledger.json`, beside the manifest. */
export const ledgerPath = (manifest: string, ref: string, tenant: string) => `${manifest}.${ref}.${tenant}.ledger.json`;
export const reportPath = (manifest: string, ref: string, tenant: string) => `${manifest}.${ref}.${tenant}.report.json`;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optional = (v: unknown, check: (x: unknown) => boolean) => v === undefined || check(v);
const isVersion = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
const isPass = (v: unknown) => v === 'first' || v === 'full';
const isString = (v: unknown) => typeof v === 'string';

/** Parses a ledger, or explains why it is not one for this run (it is then left as it is). */
export function parseLedger(text: string, expect: { ref: string; tenant: string }): Ledger | string {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return 'is not valid JSON';
  }
  if (!isObject(raw) || raw.format !== 1 || !isObject(raw.entries) || typeof raw.tenantId !== 'string' || !UUID_RE.test(raw.tenantId)) return 'is not an import ledger';
  if (raw.ref !== expect.ref || raw.tenant !== expect.tenant) return `belongs to ${String(raw.ref)}/${String(raw.tenant)}, not ${expect.ref}/${expect.tenant}`;
  for (const [key, e] of Object.entries(raw.entries)) {
    const ok =
      isObject(e) &&
      typeof e.id === 'string' &&
      UUID_RE.test(e.id) &&
      typeof e.type === 'string' &&
      optional(e.savedVersion, isVersion) &&
      optional(e.savedHash, isString) &&
      optional(e.savedPass, isPass) &&
      optional(e.requestId, (x) => typeof x === 'string' && UUID_RE.test(x)) &&
      optional(e.requestedVersion, isVersion) &&
      optional(e.publishedVersion, isVersion) &&
      optional(e.publishedPass, isPass) &&
      optional(e.failedHash, isString);
    if (!ok) return `has an unreadable record for ${JSON.stringify(key)}`;
  }
  return raw as unknown as Ledger;
}

/** The ledger of one run, written through `store` after every change. */
export class LedgerFile {
  constructor(
    readonly path: string,
    readonly ledger: Ledger,
    private readonly store: LedgerStore,
  ) {}

  entry(key: string): LedgerEntry | undefined {
    return Object.hasOwn(this.ledger.entries, key) ? this.ledger.entries[key] : undefined;
  }

  async set(key: string, entry: LedgerEntry): Promise<void> {
    this.ledger.entries[key] = entry;
    await this.save();
  }

  async update(key: string, change: Partial<LedgerEntry>): Promise<void> {
    const current = this.entry(key);
    if (current === undefined) throw new Error(`ledger: no record for ${key}`);
    this.ledger.entries[key] = { ...current, ...change };
    await this.save();
  }

  save(): Promise<void> {
    return this.store.write(this.path, JSON.stringify(this.ledger, null, 2) + '\n');
  }
}
