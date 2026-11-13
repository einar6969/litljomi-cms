// The importer as an editor (import plan section 2.2): a password sign-in with the publishable key,
// then every call with the editor's own token, so RLS, column grants and storage policies decide
// exactly as for a person. The secret key is never read. Tokens live in this object only, are
// redacted from anything printed, and are refreshed before they expire.
import { Failure, UUID_RE, guardedFetch, type FetchFn, type HttpRequest, type HttpResult } from '../hosted.ts';

export type ApiResult =
  | { ok: true; status: number; body: unknown; bytes: Uint8Array }
  | { ok: false; status: number | null; detail: string; errorCode: string | undefined; message: string | undefined };

// Storage errors carry `error` (Duplicate, not_found) and `message` (as boundary-check reads them).
const STORAGE_CODE_FIELDS = ['error_code', 'code', 'error'] as const;
/** A token is refreshed when it has less than this left. */
export const REFRESH_MARGIN_MS = 5 * 60_000;

export interface SessionTarget {
  origin: string;
  publishableKey: string;
}

interface Tokens {
  access: string;
  refresh: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const segments = (path: string) => path.split('/').map(encodeURIComponent).join('/');

export class EditorSession {
  private tokens: Tokens | null = null;
  userId = '';

  constructor(
    private readonly target: SessionTarget,
    private readonly fetchFn: FetchFn,
    /** Redacted from every server message and every printed line; tokens are added as they arrive. */
    readonly secrets: string[],
    private readonly now: () => number,
  ) {}

  private send(req: HttpRequest): Promise<HttpResult> {
    return guardedFetch(this.fetchFn, this.target.origin, this.secrets, req);
  }

  private remember(body: unknown): Tokens {
    const b = isObject(body) ? body : {};
    for (const k of ['access_token', 'refresh_token']) if (typeof b[k] === 'string' && b[k] !== '') this.secrets.push(b[k] as string);
    const access = b.access_token;
    const refresh = b.refresh_token;
    const expiresIn = b.expires_in;
    const expiresAtS = b.expires_at;
    if (typeof access !== 'string' || access === '' || typeof refresh !== 'string' || refresh === '') throw new Failure('FAILED: sign-in: unexpected response');
    const expiresAt =
      typeof expiresAtS === 'number' ? expiresAtS * 1000 : typeof expiresIn === 'number' ? this.now() + expiresIn * 1000 : this.now() + 3600_000;
    return { access, refresh, expiresAt };
  }

  /** Password sign-in; stops for an account that needs a TOTP step-up. */
  async signIn(email: string, password: string): Promise<void> {
    this.secrets.push(password);
    const result = await this.send({
      method: 'POST',
      path: '/auth/v1/token?grant_type=password',
      headers: { apikey: this.target.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (result.kind === 'network') throw new Failure(`FAILED: sign-in: ${result.detail}; nothing was written`);
    if (!result.ok) throw new Failure(`FAILED: sign-in as ${email}: ${result.detail}; nothing was written`);
    this.tokens = this.remember(result.body);
    const user = (result.body as { user?: unknown }).user;
    const id = isObject(user) ? user.id : undefined;
    if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Failure('FAILED: sign-in: unexpected response; nothing was written');
    this.userId = id;
    const factors = isObject(user) && Array.isArray(user.factors) ? user.factors : [];
    if (factors.some((f) => isObject(f) && f.status === 'verified')) {
      throw new Failure(`FAILED: ${email} has a verified second factor and would need a TOTP step-up; the import signs in with a password only. Use an editor account without one; nothing was written`);
    }
  }

  private async token(): Promise<string> {
    if (this.tokens === null) throw new Failure('FAILED: not signed in');
    if (this.tokens.expiresAt - this.now() > REFRESH_MARGIN_MS) return this.tokens.access;
    const result = await this.send({
      method: 'POST',
      path: '/auth/v1/token?grant_type=refresh_token',
      headers: { apikey: this.target.publishableKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh_token: this.tokens.refresh }),
    });
    if (result.kind === 'network' || !result.ok) throw new Failure(`FAILED: refreshing the session: ${result.detail}`);
    this.tokens = this.remember(result.body);
    return this.tokens.access;
  }

  private async call(req: Omit<HttpRequest, 'headers'> & { headers?: Record<string, string> }): Promise<ApiResult> {
    const token = await this.token();
    const result = await this.send({
      ...req,
      headers: { apikey: this.target.publishableKey, Authorization: `Bearer ${token}`, Accept: 'application/json', ...(req.headers ?? {}) },
    });
    if (result.kind === 'network') return { ok: false, status: null, detail: result.detail, errorCode: undefined, message: undefined };
    if (result.ok) return { ok: true, status: result.status, body: result.body, bytes: result.bytes };
    return { ok: false, status: result.status, detail: result.detail, errorCode: result.errorCode, message: result.message };
  }

  /** `api.<name>(args)`, the editor's own functions only. */
  rpc(name: string, args: Record<string, unknown>): Promise<ApiResult> {
    if (name.startsWith('admin_') || name.startsWith('worker_')) throw new Failure(`FAILED: refusing ${name}: the import calls an editor's functions only`);
    return this.call({
      method: 'POST',
      path: `/rest/v1/rpc/${name}`,
      headers: { 'Content-Type': 'application/json', 'Content-Profile': 'api' },
      body: JSON.stringify(args),
    });
  }

  /** `GET api.<view>?<query>`. */
  view(name: string, query: string): Promise<ApiResult> {
    return this.call({ method: 'GET', path: `/rest/v1/${name}?${query}`, headers: { 'Accept-Profile': 'api' } });
  }

  /** Uploads to a bucket without overwriting: 'created', 'exists', or a failure. */
  async upload(bucket: string, path: string, bytes: Uint8Array<ArrayBuffer>, mime: string): Promise<'created' | 'exists' | Extract<ApiResult, { ok: false }>> {
    const result = await this.call({
      method: 'POST',
      path: `/storage/v1/object/${bucket}/${segments(path)}`,
      headers: { 'Content-Type': mime, 'x-upsert': 'false' },
      body: bytes,
      codeFields: STORAGE_CODE_FIELDS,
    });
    if (result.ok) return 'created';
    if (result.status === 409 || result.errorCode === 'Duplicate' || result.errorCode === '409') return 'exists';
    return result;
  }

  /** An object of a private bucket, as the editor may read it. */
  download(bucket: string, path: string): Promise<ApiResult> {
    return this.call({ method: 'GET', path: `/storage/v1/object/authenticated/${bucket}/${segments(path)}`, codeFields: STORAGE_CODE_FIELDS });
  }

  /** A public object of the target, read without credentials (the delivery pointer, bundles, public images). */
  async publicGet(path: string): Promise<ApiResult> {
    const result = await this.send({ method: 'GET', path, headers: { 'Cache-Control': 'no-cache' }, codeFields: STORAGE_CODE_FIELDS });
    if (result.kind === 'network') return { ok: false, status: null, detail: result.detail, errorCode: undefined, message: undefined };
    if (result.ok) return { ok: true, status: result.status, body: result.body, bytes: result.bytes };
    return { ok: false, status: result.status, detail: result.detail, errorCode: result.errorCode, message: result.message };
  }

  get origin(): string {
    return this.target.origin;
  }
}
